import { testDeskForm } from "./test-desk-form.js";
import express from "express";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DispatchLock, saveDispatchFile } from "./test-dispatch-files.js";
import { followUpMessage } from "../shared/test-dispatch.js";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const missionId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const ticketInput = z.object({ runId: z.string().uuid(), missionId, title: z.string().trim().min(1).max(160), detail: z.string().min(1).max(1000).optional() }).strict();
const followInput = z.object({ runId: z.string().uuid(), missionId, sourceReceiptId: z.string().uuid(), message: z.string().max(400) }).strict();
// An actual, separately hosted HTTP destination. It creates its own durable receipts.
export function createTestDesk(directory, tokens) {
    if (tokens.a.length < 32 || tokens.b.length < 32 || tokens.a === tokens.b)
        throw new Error("Test desk requires separate worker credentials of at least 32 characters.");
    const app = express(), lock = new DispatchLock();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "4kb" }));
    app.get("/healthz", (_req, res) => res.json({ ok: true, destination: "Relay Test Desk", test: true }));
    app.use((req, res, next) => {
        const worker = ((req.method === "POST" && req.path === "/tickets") || req.path === "/computer/tickets") ? "a" : "b";
        const supplied = (req.get("authorization") ?? "").replace(/^Bearer /, "");
        if (!timingSafeEqual(Buffer.from(hash(supplied)), Buffer.from(hash(tokens[worker]))))
            return void res.status(401).json({ error: "Worker credential required." });
        if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json"))
            return void res.status(415).json({ error: "Send application/json." });
        res.set("Cache-Control", "no-store");
        next();
    });
    app.get("/computer/tickets", (_req, res) => res.type("html").send(testDeskForm));
    async function readEntry(file) {
        try {
            return JSON.parse(await readFile(join(directory, file), "utf8"));
        }
        catch (error) {
            if (error.code === "ENOENT")
                return;
            throw error;
        }
    }
    async function lookup(id) {
        await mkdir(directory, { recursive: true });
        for (const name of await readdir(directory)) {
            if (!/^[a-f0-9]{64}\.json$/.test(name))
                continue;
            const entry = await readEntry(name);
            if (entry?.receipt.id === id)
                return entry.receipt;
        }
    }
    async function commit(key, input, makeReceipt) {
        return lock.run(key, async () => {
            const file = `${hash(key)}.json`, requestHash = hash(JSON.stringify(input));
            const existing = await readEntry(file);
            if (existing) {
                if (existing.requestHash !== requestHash)
                    throw Object.assign(new Error("Idempotency key already belongs to a different request."), { status: 409 });
                return { receipt: existing.receipt, replayed: true };
            }
            const receipt = await makeReceipt();
            await saveDispatchFile(join(directory, file), { requestHash, receipt });
            return { receipt, replayed: false };
        });
    }
    app.post("/tickets", async (req, res) => {
        const input = ticketInput.parse(req.body);
        const key = `${input.runId}:ticket`;
        if (req.get("Idempotency-Key") !== key)
            return void res.status(400).json({ error: "Stable ticket idempotency key required." });
        const result = await commit(key, input, async () => ({ ...input, id: randomUUID(), kind: "ticket", acceptedAt: new Date().toISOString(), destination: "Relay Test Desk", test: true }));
        res.status(result.replayed ? 200 : 201).json(result.receipt);
    });
    app.post("/follow-ups", async (req, res) => {
        const input = followInput.parse(req.body), key = `${input.runId}:follow-up`;
        if (req.get("Idempotency-Key") !== key)
            return void res.status(400).json({ error: "Stable follow-up idempotency key required." });
        const result = await commit(key, input, async () => {
            const ticket = await lookup(input.sourceReceiptId);
            if (!ticket || ticket.kind !== "ticket" || ticket.runId !== input.runId || ticket.missionId !== input.missionId || followUpMessage(ticket) !== input.message)
                throw Object.assign(new Error("Follow-up requires a matching accepted ticket and its result."), { status: 409 });
            return { ...input, id: randomUUID(), kind: "follow_up", acceptedAt: new Date().toISOString(), destination: "Relay Test Desk", test: true };
        });
        res.status(result.replayed ? 200 : 201).json(result.receipt);
    });
    app.post("/mission-follow-ups", async (req, res) => {
        const input = followInput.parse(req.body), key = `${input.runId}:mission-follow-up`;
        if (req.get("Idempotency-Key") !== key)
            return void res.status(400).json({ error: "Stable mission follow-up key required." });
        const result = await commit(key, input, async () => {
            const ticket = await lookup(input.sourceReceiptId);
            if (!ticket || ticket.kind !== "ticket" || ticket.runId !== input.runId || ticket.missionId !== input.missionId || !input.message.trim() || !input.message.includes(ticket.id))
                throw Object.assign(new Error("Mission follow-up requires the confirmed ticket from this mission and its receipt UUID."), { status: 409 });
            return { ...input, id: randomUUID(), kind: "follow_up", acceptedAt: new Date().toISOString(), destination: "Relay Test Desk", test: true };
        });
        res.status(result.replayed ? 200 : 201).json(result.receipt);
    });
    for (const [path, kind] of [["tickets", "ticket"], ["follow-ups", "follow_up"]])
        app.get(`/${path}/:id`, async (req, res) => {
            const receipt = await lookup(z.string().uuid().parse(req.params.id));
            if (!receipt || receipt.kind !== kind)
                return void res.status(404).json({ error: "Receipt not found." });
            res.json(receipt);
        });
    app.use((error, _req, res, _next) => {
        const status = error instanceof z.ZodError ? 400 : error.status ?? 500;
        res.status(status).json({ error: status === 500 ? "Test desk could not confirm persistence." : error.message });
    });
    return { app, lookup };
}
