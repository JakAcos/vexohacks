import express from "express";
import type { Response } from "express";
import { z, ZodError } from "zod";
import { resolve } from "node:path";
import { Store, HttpError } from "./store.js";
import { extractDemo, extractGemini } from "./agents.js";
import {
  audioTypes,
  voiceStatus,
  transcribeAudio,
  synthesizeBriefing,
} from "./voice.js";
import {
  incidentIdSchema,
  observationInput,
  type Incident,
  type Mode,
} from "../shared/model.js";
export function createApp({
  directory = "./data",
  mode = "demo",
  serveDist = false,
}: { directory?: string; mode?: Mode; serveDist?: boolean } = {}) {
  const app = express(),
    store = new Store(directory),
    clients = new Map<string, Set<Response>>();
  app.disable("x-powered-by");
  // Local-only by default. Reject cross-origin writes; no permissive CORS or frontend secrets.
  app.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (
        origin &&
        origin !== `http://${req.get("host")}` &&
        !["http://127.0.0.1:5173", "http://localhost:5173"].includes(origin)
      )
        return res
          .status(403)
          .json({ error: "Cross-origin writes are disabled." });
      if (
        req.path === "/api/audio/observations"
          ? !audioTypes.has(
              (req.get("Content-Type") ?? "")
                .split(";")[0]
                .trim()
                .toLowerCase(),
            )
          : !req.is("application/json")
      )
        return res
          .status(415)
          .json({
            error:
              req.path === "/api/audio/observations"
                ? "Send a supported audio Content-Type (WAV, MP3, MP4, WebM, Ogg or FLAC)."
                : "Send application/json.",
          });
    }
    next();
  });
  app.use(express.json({ limit: "24kb" }));
  const publish = (state: Incident) => {
    for (const client of clients.get(state.id) ?? [])
      client.write(`event: incident\ndata: ${JSON.stringify(state)}\n\n`);
    return state;
  };
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      mode,
      roles: {
        recorder:
          mode === "gemini"
            ? "Gemini extraction"
            : "deterministic scenario parser",
        tracker: "evidence-based state reducer",
        briefing: "source-based template",
      },
      geminiConfigured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL,
      ),
      voice: voiceStatus(),
      simulated: true,
    }),
  );
  app.get("/api/incidents/:id", async (req, res) =>
    res.json(await store.get(incidentIdSchema.parse(req.params.id))),
  );
  app.get("/api/incidents/:id/events", async (req, res) => {
    const id = incidentIdSchema.parse(req.params.id);
    // Serialize initial snapshot + subscription with writes so a reconnect cannot receive stale state.
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    const group = clients.get(id) ?? new Set<Response>();
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      group.delete(res);
      if (!group.size) clients.delete(id);
    });
    await store.snapshot(id, (state) => {
      if (res.destroyed) return;
      group.add(res);
      clients.set(id, group);
      res.write(`event: incident\ndata: ${JSON.stringify(state)}\n\n`);
    });
  });
  app.post("/api/observations", async (req, res) => {
    const { incidentId, speaker, text, inputKind } = observationInput.parse(
      req.body,
    );
    const state = await store.record(
      incidentId,
      speaker,
      text,
      mode,
      async () =>
        mode === "gemini" ? extractGemini(text, speaker) : extractDemo(text),
      inputKind,
    );
    res.status(201).json(publish(state));
  });
  app.post(
    "/api/audio/observations",
    express.raw({ type: () => true, limit: "8mb" }),
    async (req, res) => {
      const { incidentId, speaker } = z
        .object({
          incidentId: incidentIdSchema,
          speaker: z.string().trim().min(1).max(80),
          consent: z.literal("send-to-deepgram"),
        })
        .strict()
        .parse(req.query);
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new HttpError(
          400,
          "Choose a nonempty single-speaker audio file.",
        );
      const text = await transcribeAudio(
        req.body,
        (req.get("Content-Type") ?? "").split(";")[0].toLowerCase(),
      );
      const state = await store.record(
        incidentId,
        speaker,
        text,
        mode,
        async () =>
          mode === "gemini" ? extractGemini(text, speaker) : extractDemo(text),
        "transcript",
      );
      res.status(201).json(publish(state));
    },
  );
  app.post("/api/briefings/audio", async (req, res) => {
    const { incidentId, briefingId } = z
      .object({ incidentId: incidentIdSchema, briefingId: z.string().uuid() })
      .strict()
      .parse(req.body);
    const state = await store.get(incidentId),
      briefing = state.briefings.at(-1);
    if (
      !briefing ||
      briefing.id !== briefingId ||
      briefing.stateVersion !== state.version
    )
      throw new HttpError(
        409,
        "Request and review a current briefing before generating audio.",
      );
    const audio = await synthesizeBriefing(briefing.text);
    const current = await store.get(incidentId);
    if (
      current.version !== state.version ||
      current.briefings.at(-1)?.id !== briefing.id
    )
      throw new HttpError(
        409,
        "Incident or briefing changed during synthesis. Request fresh briefing audio.",
      );
    res
      .set({
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Briefing-Id": briefing.id,
      })
      .send(audio);
  });
  const idBody = z.object({ incidentId: incidentIdSchema }).strict();
  app.post("/api/briefings", async (req, res) => {
    const { incidentId } = idBody.parse(req.body);
    res.json(publish(await store.briefing(incidentId)));
  });
  app.post("/api/handovers", async (req, res) => {
    const { incidentId } = idBody.parse(req.body);
    res.status(201).json(publish(await store.briefing(incidentId, true)));
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
    res.json(
      publish(
        await store.approve(
          body.incidentId,
          req.params.id,
          body.approvedBy,
          body.expectedVersion,
        ),
      ),
    );
  });
  app.post("/api/incidents/:id/reset", async (req, res) => {
    z.object({ confirm: z.literal("RESET SIMULATION") })
      .strict()
      .parse(req.body);
    res.json(publish(await store.reset(incidentIdSchema.parse(req.params.id))));
  });
  if (serveDist) {
    app.use(express.static(resolve("dist")));
    app.get("/", (_req, res) => res.sendFile(resolve("dist/index.html")));
  }
  app.use((_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof ZodError)
        return res.status(400).json({
          error: "Invalid request or extraction.",
          details: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        });
      const status =
        error instanceof HttpError
          ? error.status
          : ((error as { status?: number }).status ?? 500);
      res.status(status).json({
        error:
          status === 500
            ? "Processing failed. Observation was not committed; verify provider settings and retry."
            : (error as Error).message,
      });
    },
  );
  return { app, store };
}
