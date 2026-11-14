import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createTestDesk } from "../src/server/test-desk.js";
import { TestDispatch, testDispatchConfig } from "../src/server/test-dispatch.js";
import { createApp } from "../src/server/app.js";
import { saveDispatchFile } from "../src/server/test-dispatch-files.js";
import type { DispatchRun } from "../src/shared/test-dispatch.js";

const tokens = { a: "a".repeat(48), b: "b".repeat(48) };
async function listen(app: ReturnType<typeof express>) {
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { server, origin };
}
async function stop(server: Server) { const done = new Promise<void>(r => server.close(() => r())); server.closeAllConnections(); await done; }
async function fixture(t: TestContext, interceptor?: express.RequestHandler) {
  const directory = await mkdtemp(join(tmpdir(), "relay-dispatch-test-"));
  const desk = createTestDesk(join(directory, "desk"), tokens), wrapper = express();
  if (interceptor) wrapper.use(interceptor);
  wrapper.use(desk.app);
  const { server, origin } = await listen(wrapper);
  const config = { origin, aToken: tokens.a, bToken: tokens.b, timeoutMs: 500 };
  const worker = new TestDispatch(join(directory, "relay"), config);
  t.after(async () => { await worker.close(); await stop(server); await rm(directory, { recursive: true, force: true }); });
  return { directory, desk, config, worker, origin };
}
const body = (id = randomUUID()) => ({ clientRequestId: id, title: "Synthetic supply pickup" });
async function entries(directory: string) {
  const files = (await readdir(join(directory, "desk"))).filter(f => f.endsWith(".json"));
  return Promise.all(files.map(f => readFile(join(directory, "desk", f), "utf8").then(JSON.parse)));
}

test("real HTTP loop: A creates ticket, B uses destination readback, Relay retains both receipts", async t => {
  const f = await fixture(t), input = body();
  await f.worker.start("test-mission", input); await f.worker.idle();
  const run = (await f.worker.snapshot("test-mission")).runs[0];
  assert.equal(run.status, "complete"); assert.ok(run.ticket); assert.ok(run.followUp);
  assert.equal(run.followUp.sourceReceiptId, run.ticket.id);
  assert.ok(run.followUp.message.includes(run.ticket.id)); assert.ok(run.followUp.message.includes(run.ticket.title));
  assert.deepEqual(await f.desk.lookup(run.ticket.id), run.ticket);
  assert.deepEqual(await f.desk.lookup(run.followUp.id), run.followUp);
  assert.equal((await entries(f.directory)).length, 2);
  await Promise.all(Array.from({ length: 5 }, () => f.worker.start("test-mission", input)));
  await Promise.all(Array.from({ length: 5 }, () => f.worker.retry("test-mission", run.id)));
  await f.worker.idle(); assert.equal((await entries(f.directory)).length, 2);
  const restored = new TestDispatch(join(f.directory, "relay"), f.config);
  await restored.resume(); await restored.idle();
  assert.deepEqual((await restored.snapshot("test-mission")).runs[0], run); await restored.close();
});

test("lost ticket acknowledgment: retry recovers same destination receipt without duplicate submission", async t => {
  let dropped = false, bCalls = 0;
  const f = await fixture(t, (req, res, next) => {
    if (req.path !== "/tickets") bCalls++;
    const send = res.json.bind(res);
    res.json = value => { if (req.path === "/tickets" && req.method === "POST" && !dropped) { dropped = true; req.socket.destroy(); return res; } return send(value); };
    next();
  });
  const input = body(); await f.worker.start("lost-ticket", input); await f.worker.idle();
  const failed = (await f.worker.snapshot("lost-ticket")).runs[0];
  assert.equal(failed.status, "failed"); assert.equal(failed.ticket, undefined); assert.equal(bCalls, 0);
  const first = await entries(f.directory); assert.equal(first.length, 1);
  await f.worker.retry("lost-ticket", input.clientRequestId); await f.worker.idle();
  const success = (await f.worker.snapshot("lost-ticket")).runs[0];
  assert.equal(success.status, "complete"); assert.equal(success.ticket!.id, first[0].receipt.id);
  assert.equal((await entries(f.directory)).length, 2);
});

test("lost follow-up acknowledgment and restored in-progress state reuse the accepted follow-up", async t => {
  let dropped = false;
  const f = await fixture(t, (req, res, next) => {
    const send = res.json.bind(res);
    res.json = value => { if (req.path === "/follow-ups" && !dropped) { dropped = true; req.socket.destroy(); return res; } return send(value); };
    next();
  });
  const input = body(); await f.worker.start("restart", input); await f.worker.idle();
  const failed = (await f.worker.snapshot("restart")).runs[0];
  assert.equal(failed.status, "failed"); assert.ok(failed.ticket); assert.equal(failed.followUp, undefined);
  const before = await entries(f.directory); assert.equal(before.length, 2);
  // Reconstruct the durable snapshot present after A completed but before the
  // failed B request returned, which is what a process crash would leave.
  const checkpoint: DispatchRun = { ...failed, status: "following_up" };
  delete checkpoint.error;
  await saveDispatchFile(join(f.directory, "relay", "test-dispatch", `restart--${input.clientRequestId}.json`), checkpoint);
  const restored = new TestDispatch(join(f.directory, "relay"), f.config);
  await restored.resume(); await restored.idle();
  const run = (await restored.snapshot("restart")).runs[0];
  assert.equal(run.status, "complete"); assert.equal((await entries(f.directory)).length, 2);
  assert.equal(run.followUp!.id, before.find(e => e.receipt.kind === "follow_up").receipt.id);
  await restored.close();
});

for (const fault of ["refusal", "malformed", "mismatched", "redirect"] as const) test(`${fault} ticket response blocks Dispatcher B and never records completion`, async t => {
  let bCalls = 0;
  const f = await fixture(t, (req, res, next) => {
    if (req.method === "POST" && req.path === "/tickets") {
      if (fault === "refusal") return void res.status(503).json({ error: "Unavailable" });
      if (fault === "malformed") return void res.json({ id: "not-a-receipt" });
      if (fault === "redirect") return void res.redirect(307, "/wrong-destination");
      const send = res.json.bind(res); res.json = value => send({ ...value, missionId: "different-mission" });
    } else bCalls++;
    next();
  });
  await f.worker.start("fault", body()); await f.worker.idle();
  const run = (await f.worker.snapshot("fault")).runs[0];
  assert.equal(run.status, "failed"); assert.equal(run.ticket, undefined); assert.equal(run.followUp, undefined); assert.equal(bCalls, 0);
});

test("changed readback blocks B; destination rejects out-of-order follow-up and wrong worker", async t => {
  let followPosts = 0;
  const f = await fixture(t, (req, res, next) => {
    if (req.method === "GET" && req.path.startsWith("/tickets/")) { const send = res.json.bind(res); res.json = value => send({ ...value, title: "changed" }); }
    if (req.path === "/follow-ups") followPosts++;
    next();
  });
  const input = body(); await f.worker.start("changed", input); await f.worker.idle();
  const run = (await f.worker.snapshot("changed")).runs[0];
  assert.equal(run.status, "failed"); assert.ok(run.ticket); assert.equal(followPosts, 0);
  const wrong = await fetch(f.origin + "/tickets", { method: "POST", headers: { Authorization: `Bearer ${tokens.b}`, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(wrong.status, 401);
  const missing = randomUUID();
  const early = await fetch(f.origin + "/follow-ups", { method: "POST", headers: { Authorization: `Bearer ${tokens.b}`, "Content-Type": "application/json", "Idempotency-Key": `${missing}:follow-up` }, body: JSON.stringify({ runId: missing, missionId: "changed", sourceReceiptId: randomUUID(), message: "unconfirmed" }) });
  assert.equal(early.status, 409);
});

test("HTTP Relay routes save immediately, reject changed request identity and protect mutations", async t => {
  const f = await fixture(t), relay = createApp({ directory: join(f.directory, "app"), testDispatch: f.config });
  await relay.ready;
  const { server, origin } = await listen(relay.app);
  t.after(async () => { await relay.dispatch.close(); await relay.store.close(); await stop(server); });
  const input = body(), path = origin + "/api/incidents/api-test/test-dispatch";
  const post = (data: unknown, originHeader?: string) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...(originHeader ? { Origin: originHeader } : {}) }, body: JSON.stringify(data) });
  assert.equal((await post(input, "https://untrusted.example")).status, 403);
  assert.equal((await post({ ...input, origin: "http://other" })).status, 400);
  assert.equal((await post(input)).status, 202); await relay.dispatch.idle();
  assert.equal((await post({ ...input, title: "Changed payload" })).status, 409);
  const snapshot = await (await fetch(path)).json();
  assert.equal(snapshot.runs[0].status, "complete");
  assert.equal(JSON.stringify(snapshot).includes(tokens.a), false); assert.equal(JSON.stringify(snapshot).includes(tokens.b), false);
  assert.equal((await (await fetch(origin + "/api/health")).json()).simulated, true);
  assert.equal((await relay.store.get("api-test")).actions.length, 0);
});

test("disabled connector and unsafe destinations fail closed", async t => {
  const directory = await mkdtemp(join(tmpdir(), "relay-disabled-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const dispatch = new TestDispatch(directory);
  assert.equal((await dispatch.snapshot("test")).enabled, false);
  await assert.rejects(dispatch.start("test", body()), /not configured/);
  for (const origin of ["https://example.com", "http://localhost:4318", "http://127.0.0.1:4318/elsewhere", "http://127.0.0.1:4318/?secret=1"]) assert.throws(() => testDispatchConfig({ RELAY_TEST_DESK_ORIGIN: origin, RELAY_TEST_DISPATCH_A_TOKEN: tokens.a, RELAY_TEST_DISPATCH_B_TOKEN: tokens.b }));
});
