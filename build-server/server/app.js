import { BandSession } from "./band-session.js";
import { accessBoundary } from "./access.js";
import express from "express";
import { isBriefingCommand } from "../shared/voice.js";
import { z, ZodError } from "zod";
import { resolve } from "node:path";
import { Store, HttpError } from "./store.js";
import { audioTypes, voiceStatus, synthesizeBriefing, synthesizeGemini, } from "./voice.js";
import { incidentIdSchema, observationInput, sourceDeviceSchema, } from "../shared/model.js";
export function createApp({ directory = "./data", mode = "demo", serveDist = false, processing, access = {}, } = {}) {
    const app = express(), store = new Store(directory, { ...processing, onChange: state => publish(state) }), clients = new Map();
    app.disable("x-powered-by");
    app.get("/healthz", (_req, res) => res.json({ ok: true }));
    app.use(accessBoundary(access));
    app.use((req, res, next) => {
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
            if (["/api/audio/observations", "/api/voice/audio"].includes(req.path)
                ? !audioTypes.has((req.get("Content-Type") ?? "")
                    .split(";")[0]
                    .trim()
                    .toLowerCase())
                : !req.is("application/json"))
                return res
                    .status(415)
                    .json({
                    error: ["/api/audio/observations", "/api/voice/audio"].includes(req.path)
                        ? "Send a supported audio Content-Type (WAV, MP3, MP4, WebM, Ogg or FLAC)."
                        : "Send application/json.",
                });
        }
        next();
    });
    app.use(express.json({ limit: "24kb" }));
    const bandSession = new BandSession(directory, mode);
    app.get('/api/band/session', (_req, res) => res.json(bandSession.snapshot()));
    app.post('/api/band/session/start', (req, res) => {
        const { incidentId, speaker } = z.object({ incidentId: incidentIdSchema, speaker: z.string().trim().min(1).max(80) }).strict().parse(req.body);
        res.status(202).json(bandSession.start(incidentId, speaker));
    });
    app.post('/api/band/session/retry', (req, res) => {
        z.object({}).strict().parse(req.body);
        res.status(202).json(bandSession.retry());
    });
    app.post('/api/band/session/stop', (req, res) => {
        z.object({}).strict().parse(req.body);
        res.status(202).json(bandSession.stop());
    });
    const publish = (state) => {
        for (const client of clients.get(state.id) ?? [])
            client.write(`event: incident\ndata: ${JSON.stringify(state)}\n\n`);
        return state;
    };
    const ready = store.resume();
    app.use(async (_req, _res, next) => { try {
        await ready;
        next();
    }
    catch (error) {
        next(error);
    } });
    app.get("/api/health", (_req, res) => res.json({
        ok: true,
        mode,
        roles: {
            recorder: mode === "gemini"
                ? "Gemini extraction"
                : "deterministic scenario parser",
            tracker: "evidence-based state reducer",
            briefing: "source-based template",
            coordinator: mode === "gemini" ? "Gemini action planner" : "deterministic demo action planner",
            executor: "local simulated service connectors with durable receipts",
        },
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL),
        voice: voiceStatus(),
        simulated: true,
    }));
    app.get("/api/incidents/:id", async (req, res) => res.json(await store.get(incidentIdSchema.parse(req.params.id))));
    app.get("/api/incidents/:id/events", async (req, res) => {
        const id = incidentIdSchema.parse(req.params.id);
        // Serialize initial snapshot + subscription with writes so a reconnect cannot receive stale state.
        res.set({
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        res.flushHeaders();
        const group = clients.get(id) ?? new Set();
        const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
        req.on("close", () => {
            clearInterval(heartbeat);
            group.delete(res);
            if (!group.size)
                clients.delete(id);
        });
        await store.snapshot(id, (state) => {
            if (res.destroyed)
                return;
            group.add(res);
            clients.set(id, group);
            res.write(`event: incident\ndata: ${JSON.stringify(state)}\n\n`);
        });
    });
    const validateDevice = (device) => {
        if (device && device.bandNumber !== Number(process.env.VEXO_BAND_NUMBER))
            throw new HttpError(403, "Physical report must come from the configured team band.");
    };
    const voiceTurn = async (incidentId, speaker, text, clientEventId, inputKind = "transcript", sourceDevice) => {
        validateDevice(sourceDevice);
        if (isBriefingCommand(text)) {
            return { kind: "briefing", transcript: text, incident: (await store.voiceBriefing(incidentId, speaker, text, clientEventId)) };
        }
        const incident = await store.acceptRecord(incidentId, speaker, text, mode, inputKind, clientEventId, sourceDevice);
        return { kind: "observation", transcript: text, incident };
    };
    app.post("/api/voice/turn", async (req, res) => {
        const { incidentId, speaker, text, clientEventId, inputKind, sourceDevice } = observationInput.parse({ ...req.body, inputKind: req.body.inputKind ?? "transcript" });
        const turn = await voiceTurn(incidentId, speaker, text, clientEventId, inputKind, sourceDevice);
        res.status(turn.kind === "briefing" ? 200 : 202).json(turn);
    });
    app.post("/api/voice/audio", express.raw({ type: () => true, limit: "8mb" }), async (req, res) => {
        const { incidentId, speaker, provider, consent, clientEventId, inputKind, bandNumber, deviceTransport, capturedAt, captureMode } = z.object({ incidentId: incidentIdSchema,
            captureMode: z.literal("continuous").optional(),
            inputKind: z.literal("vexo-audio").optional(), bandNumber: z.coerce.number().int().min(1).max(999).optional(), deviceTransport: z.enum(["ble", "serial"]).optional(), capturedAt: z.string().datetime().optional(),
            speaker: z.string().trim().min(1).max(80), clientEventId: z.string().uuid().optional(), provider: z.enum(["deepgram", "gemini"]).default("deepgram"), consent: z.enum(["send-to-deepgram", "send-to-gemini"]) }).strict().parse(req.query);
        if (consent !== `send-to-${provider}`)
            throw new HttpError(400, "Consent must match the selected transcription provider.");
        if (!inputKind && (bandNumber !== undefined || deviceTransport || capturedAt))
            throw new HttpError(400, "Device metadata requires vexo-audio input kind.");
        const sourceDevice = inputKind ? sourceDeviceSchema.parse({ kind: "vexo", bandNumber, transport: deviceTransport, capturedAt }) : undefined;
        validateDevice(sourceDevice);
        if (captureMode && (provider !== "gemini" || !sourceDevice))
            throw new HttpError(400, "Continuous audio requires a configured physical band and Gemini.");
        if (!Buffer.isBuffer(req.body) || !req.body.length)
            throw new HttpError(400, "No audio recorded. Try again or type the report.");
        res.status(202).json(await store.acceptAudio(incidentId, speaker, req.body, (req.get("Content-Type") ?? "").split(";")[0].toLowerCase(), provider, mode, clientEventId, inputKind ?? "transcript", sourceDevice, captureMode));
    });
    app.post("/api/observations", async (req, res) => {
        const { incidentId, speaker, text, inputKind, clientEventId, sourceDevice } = observationInput.parse(req.body);
        validateDevice(sourceDevice);
        const state = await store.acceptRecord(incidentId, speaker, text, mode, inputKind, clientEventId, sourceDevice);
        res.status(202).json(state);
    });
    app.post("/api/audio/observations", express.raw({ type: () => true, limit: "8mb" }), async (req, res) => {
        const { incidentId, speaker, clientEventId } = z
            .object({
            incidentId: incidentIdSchema,
            speaker: z.string().trim().min(1).max(80),
            clientEventId: z.string().uuid().optional(),
            consent: z.literal("send-to-deepgram"),
        })
            .strict()
            .parse(req.query);
        if (!Buffer.isBuffer(req.body) || !req.body.length)
            throw new HttpError(400, "Choose a nonempty single-speaker audio file.");
        const result = await store.acceptAudio(incidentId, speaker, req.body, (req.get("Content-Type") ?? "").split(";")[0].toLowerCase(), "deepgram", mode, clientEventId);
        res.status(202).json(result.incident);
    });
    app.post("/api/briefings/audio", async (req, res) => {
        const { incidentId, briefingId, provider } = z
            .object({ incidentId: incidentIdSchema, briefingId: z.string().uuid(), provider: z.enum(["minimax", "gemini"]).default("minimax") })
            .strict()
            .parse(req.body);
        const state = await store.get(incidentId), briefing = state.briefings.at(-1);
        if (!briefing ||
            briefing.id !== briefingId ||
            briefing.stateVersion !== state.version)
            throw new HttpError(409, "Request and review a current briefing before generating audio.");
        const audio = await (provider === "gemini" ? synthesizeGemini : synthesizeBriefing)(briefing.text);
        const current = await store.get(incidentId);
        if (current.version !== state.version ||
            current.briefings.at(-1)?.id !== briefing.id)
            throw new HttpError(409, "Incident or briefing changed during synthesis. Request fresh briefing audio.");
        res
            .set({
            "Content-Type": provider === "gemini" ? "audio/wav" : "audio/mpeg",
            "Cache-Control": "no-store",
            "X-Briefing-Id": briefing.id,
        })
            .send(audio);
    });
    const idBody = z.object({ incidentId: incidentIdSchema }).strict();
    app.post("/api/actions/:id/approve", async (req, res) => {
        const body = z.object({ incidentId: incidentIdSchema, approvedBy: z.string().trim().min(1).max(80), expectedVersion: z.number().int().nonnegative() }).strict().parse(req.body);
        res.json((await store.approveAction(body.incidentId, z.string().uuid().parse(req.params.id), body.approvedBy, body.expectedVersion)));
    });
    app.post("/api/actions/:id/dismiss", async (req, res) => {
        const body = z.object({ incidentId: incidentIdSchema, expectedVersion: z.number().int().nonnegative() }).strict().parse(req.body);
        res.json((await store.dismissAction(body.incidentId, z.string().uuid().parse(req.params.id), body.expectedVersion)));
    });
    app.post("/api/observations/:id/plan", async (req, res) => {
        const body = idBody.parse(req.body);
        res.status(202).json((await store.retryPlanning(body.incidentId, z.string().uuid().parse(req.params.id), mode)));
    });
    app.post("/api/reports/:id/retry", async (req, res) => {
        const { incidentId } = idBody.parse(req.body);
        res.status(202).json(await store.retryReport(incidentId, z.string().uuid().parse(req.params.id)));
    });
    app.post("/api/briefings", async (req, res) => {
        const { incidentId } = idBody.parse(req.body);
        res.json((await store.briefing(incidentId)));
    });
    app.post("/api/handovers", async (req, res) => {
        const { incidentId } = idBody.parse(req.body);
        res.status(201).json((await store.briefing(incidentId, true)));
    });
    app.post("/api/handovers/:id/approve", async (req, res) => {
        const body = z
            .object({
            incidentId: incidentIdSchema,
            approvedBy: z.string().trim().min(1).max(80),
            expectedVersion: z.number().int().nonnegative(),
        })
            .strict()
            .parse(req.body);
        res.json((await store.approve(body.incidentId, req.params.id, body.approvedBy, body.expectedVersion)));
    });
    app.post("/api/incidents/:id/reset", async (req, res) => {
        z.object({ confirm: z.literal("RESET SIMULATION") })
            .strict()
            .parse(req.body);
        res.json((await store.reset(incidentIdSchema.parse(req.params.id))));
    });
    if (serveDist) {
        app.use(express.static(resolve("dist")));
        app.get("/", (_req, res) => res.sendFile(resolve("dist/index.html")));
    }
    app.use((_req, res) => res.status(404).json({ error: "Endpoint not found." }));
    app.use((error, _req, res, _next) => {
        if (res.headersSent) {
            res.end();
            return;
        }
        if (error instanceof ZodError)
            return res.status(400).json({
                error: "Invalid request or extraction.",
                details: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
            });
        const status = error instanceof HttpError
            ? error.status
            : (error.status ?? 500);
        res.status(status).json({
            error: status === 500
                ? "Request could not be confirmed. Retry with the same event identifier; already saved reports will not be duplicated."
                : error.message,
        });
    });
    return { app, store, ready, bandSession };
}
