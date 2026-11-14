import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Express } from "express";
import { z } from "zod";
import { incidentIdSchema } from "../shared/model.js";
import { followUpMessage, ticketReceiptSchema, followUpReceiptSchema, type DispatchRun, type DispatchSnapshot } from "../shared/test-dispatch.js";
import { DispatchLock, saveDispatchFile } from "./test-dispatch-files.js";

export type TestDispatchConfig = { origin: string; aToken: string; bToken: string; timeoutMs?: number };
export function testDispatchConfig(env: NodeJS.ProcessEnv = process.env): TestDispatchConfig | undefined {
  const origin = env.RELAY_TEST_DESK_ORIGIN, aToken = env.RELAY_TEST_DISPATCH_A_TOKEN, bToken = env.RELAY_TEST_DISPATCH_B_TOKEN;
  if (!origin && !aToken && !bToken) return;
  if (!origin || !aToken || !bToken) throw new Error("Configure the test desk origin and both worker credentials together.");
  return validateTestDispatch({ origin, aToken, bToken });
}
function validateTestDispatch(config: TestDispatchConfig) {
  const url = new URL(config.origin);
  // This milestone deliberately contacts only a separately running local test desk.
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Test desk origin must be an explicit http://127.0.0.1:PORT origin.");
  if (config.aToken.length < 32 || config.bToken.length < 32 || config.aToken === config.bToken) throw new Error("Separate worker credentials of at least 32 characters required.");
  return { ...config, origin: url.origin };
}
const inputSchema = z.object({ clientRequestId: z.string().uuid(), title: z.string().trim().min(1).max(160) }).strict();
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

export class TestDispatch {
  private directory: string;
  private config?: TestDispatchConfig;
  private lock = new DispatchLock();
  private tasks = new Map<string, Promise<void>>();
  private stopped = false;
  constructor(directory: string, config?: TestDispatchConfig) {
    this.directory = join(directory, "test-dispatch");
    this.config = config && validateTestDispatch(config);
  }
  private path(missionId: string, id: string) {
    incidentIdSchema.parse(missionId); z.string().uuid().parse(id);
    return join(this.directory, `${missionId}--${id}.json`);
  }
  async get(missionId: string, id: string): Promise<DispatchRun | undefined> {
    try { return JSON.parse(await readFile(this.path(missionId, id), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  }
  private async runs(): Promise<DispatchRun[]> {
    await mkdir(this.directory, { recursive: true });
    const result: DispatchRun[] = [];
    for (const file of await readdir(this.directory)) {
      if (!/^[a-zA-Z0-9_-]{1,64}--[a-f0-9-]{36}\.json$/.test(file)) continue;
      result.push(JSON.parse(await readFile(join(this.directory, file), "utf8")));
    }
    return result;
  }
  async snapshot(missionId: string): Promise<DispatchSnapshot> {
    incidentIdSchema.parse(missionId);
    const runs = (await this.runs()).filter(r => r.missionId === missionId).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    return { enabled: Boolean(this.config), destination: this.config?.origin, runs };
  }
  async resume() {
    if (!this.config) return;
    for (const run of await this.runs()) if (run.status === "submitting" || run.status === "following_up") this.schedule(run);
  }
  async start(missionId: string, body: unknown) {
    if (!this.config || this.stopped) throw fail(503, "Test destination is not configured or Relay is shutting down.");
    incidentIdSchema.parse(missionId);
    const input = inputSchema.parse(body);
    const run = await this.lock.run(missionId, async () => {
      const existing = await this.get(missionId, input.clientRequestId);
      if (existing) {
        if (existing.title !== input.title) throw fail(409, "This request ID already belongs to another title.");
        return existing;
      }
      if ((await this.snapshot(missionId)).runs.some(r => r.status === "submitting" || r.status === "following_up")) throw fail(409, "A test dispatch is already running for this mission.");
      const now = new Date().toISOString();
      const created: DispatchRun = { id: input.clientRequestId, missionId, title: input.title, createdAt: now, updatedAt: now, status: "submitting", destination: this.config!.origin,
        events: [{ worker: "coordinator", message: "Request saved. Dispatcher A owns the submission; Dispatcher B waits for its confirmed receipt.", timestamp: now }] };
      await saveDispatchFile(this.path(missionId, created.id), created);
      return created;
    });
    if (run.status === "submitting" || run.status === "following_up") this.schedule(run);
    return run;
  }
  async retry(missionId: string, id: string) {
    if (!this.config || this.stopped) throw fail(503, "Test destination is not configured or Relay is shutting down.");
    const run = await this.lock.run(missionId, async () => {
      const current = await this.get(missionId, id);
      if (!current) throw fail(404, "Test dispatch not found.");
      if (current.destination !== this.config!.origin) throw fail(409, "Restore the original test destination before retrying.");
      if (current.status !== "failed") return current;
      if ((await this.snapshot(missionId)).runs.some(r => r.id !== id && ["submitting", "following_up"].includes(r.status))) throw fail(409, "Another test dispatch is running.");
      current.status = current.ticket ? "following_up" : "submitting"; delete current.error;
      this.event(current, "coordinator", "Retrying the same request IDs. The test desk returns existing receipts for accepted requests.");
      await saveDispatchFile(this.path(missionId, id), current);
      return current;
    });
    if (run.status !== "complete") {
      const task = this.tasks.get(this.path(missionId,id));
      if (task) void task.then(() => this.schedule(run)); else this.schedule(run);
    }
    return run;
  }
  private event(run: DispatchRun, worker: DispatchRun["events"][number]["worker"], message: string) {
    run.updatedAt = new Date().toISOString();
    run.events.push({ worker, message, timestamp: run.updatedAt });
  }
  private schedule(run: DispatchRun) {
    const key = this.path(run.missionId, run.id);
    if (this.stopped || this.tasks.has(key)) return;
    const task = this.execute(run.missionId, run.id).finally(() => this.tasks.delete(key));
    this.tasks.set(key, task);
    // Failure to persist an error must not become an unhandled rejection. The last
    // durable in-progress state will be recovered with the same keys on restart.
    void task.catch(() => {});
  }
  private async call(path: string, worker: "a" | "b", key?: string, body?: unknown) {
    const config = this.config!;
    const response = await fetch(config.origin + path, {
      method: body ? "POST" : "GET", redirect: "error",
      headers: { Authorization: `Bearer ${worker === "a" ? config.aToken : config.bToken}`, ...(body ? { "Content-Type": "application/json", "Idempotency-Key": key! } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(config.timeoutMs ?? 8000),
    });
    if (!response.ok) throw new Error(`Test destination returned HTTP ${response.status}. No downstream success was recorded.`);
    return response.json();
  }
  private async execute(missionId: string, id: string) {
    const run = await this.get(missionId, id);
    if (!run || run.status === "complete" || run.status === "failed") return;
    try {
      if (run.destination !== this.config!.origin) throw new Error("Test destination changed. Restore the original destination before retrying.");
      if (!run.ticket) {
        const receipt = ticketReceiptSchema.parse(await this.call("/tickets", "a", `${id}:ticket`, { runId: id, missionId, title: run.title }));
        if (receipt.runId !== id || receipt.missionId !== missionId || receipt.title !== run.title) throw new Error("Submission receipt does not match this request.");
        run.ticket = receipt; run.status = "following_up";
        this.event(run, "dispatcher_a", `Test desk accepted ticket ${receipt.id}. Handing the destination-issued receipt to Dispatcher B.`);
        await saveDispatchFile(this.path(missionId, id), run);
      }
      // B independently reads A's ticket back from the destination before acting.
      const verified = ticketReceiptSchema.parse(await this.call(`/tickets/${run.ticket.id}`, "b"));
      if (JSON.stringify(verified) !== JSON.stringify(run.ticket)) throw new Error("Destination ticket no longer matches Dispatcher A's receipt.");
      const message = followUpMessage(verified);
      const receipt = followUpReceiptSchema.parse(await this.call("/follow-ups", "b", `${id}:follow-up`, { runId: id, missionId, sourceReceiptId: verified.id, message }));
      if (receipt.runId !== id || receipt.missionId !== missionId || receipt.sourceReceiptId !== verified.id || receipt.message !== message) throw new Error("Follow-up receipt does not match the verified ticket.");
      const confirmed = followUpReceiptSchema.parse(await this.call(`/follow-ups/${receipt.id}`, "b"));
      if (JSON.stringify(confirmed) !== JSON.stringify(receipt)) throw new Error("Follow-up could not be read back from the destination.");
      run.followUp = confirmed; run.status = "complete"; delete run.error;
      this.event(run, "dispatcher_b", `Verified ticket ${verified.id}, submitted its follow-up, and read back receipt ${confirmed.id}.`);
      await saveDispatchFile(this.path(missionId, id), run);
    } catch (error) {
      run.status = "failed";
      run.error = error instanceof z.ZodError ? "Destination returned an invalid receipt. The next step was not confirmed." : (error instanceof Error ? error.message : "Test destination could not be confirmed.");
      this.event(run, "coordinator", run.error);
      await saveDispatchFile(this.path(missionId, id), run);
    }
  }
  async idle() { await Promise.allSettled([...this.tasks.values()]); }
  async close() { this.stopped = true; await this.idle(); }
}

export function mountTestDispatch(app: Express, dispatch: TestDispatch) {
  app.get("/api/incidents/:id/test-dispatch", async (req, res) => res.json(await dispatch.snapshot(incidentIdSchema.parse(req.params.id))));
  app.post("/api/incidents/:id/test-dispatch", async (req, res) => res.status(202).json(await dispatch.start(incidentIdSchema.parse(req.params.id), req.body)));
  app.post("/api/incidents/:id/test-dispatch/:runId/retry", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.status(202).json(await dispatch.retry(incidentIdSchema.parse(req.params.id), z.string().uuid().parse(req.params.runId)));
  });
}
