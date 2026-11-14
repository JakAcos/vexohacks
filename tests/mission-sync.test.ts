import { settle } from "./settle.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { latestIncident, ReportSubmissions } from "../src/shared/mission-sync.js";
import { Store } from "../src/server/store.js";
import { createApp } from "../src/server/app.js";
import type { Incident } from "../src/shared/model.js";

test("delayed responses cannot erase an approval or undo a reset", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-order-"));
  try {
    const store = new Store(directory);
    const reported = await store.record("mission", "A", "Need an ambulance.", "demo", async () => []);
    const approved = await store.approveAction("mission", reported.actions[0].id, "Lead", reported.version);
    assert.equal(reported.version, approved.version);
    assert.ok(approved.revision! > reported.revision!);
    assert.equal(latestIncident(approved, reported), approved);
    const reset = await store.reset("mission");
    assert.equal(reset.version, 0);
    assert.ok(reset.revision! > approved.revision!);
    assert.equal(latestIncident(reset, approved), reset);
    assert.equal(latestIncident(approved, reset), reset);
    assert.equal((await new Store(directory).get("mission")).revision, reset.revision);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("typed retry after a lost response saves once; a confirmed new report is distinct", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-retry-"));
  const { app, store } = createApp({ directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const submissions = new ReportSubmissions(randomUUID);
  const send = (body: unknown) => fetch(`${base}/observations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(response => settle(response, store));
  try {
    const first = submissions.prepare("mission", " A ", " Request an ambulance. ");
    const lost = await send(first);
    assert.equal(lost.status, 202);
    await lost.body?.cancel();
    const retry = submissions.prepare("mission", "A", "Request an ambulance.");
    assert.equal(retry.clientEventId, first.clientEventId);
    const saved = await (await send(retry)).json() as Incident;
    assert.equal(saved.observations.length, 1);
    assert.equal(saved.actions.length, 1);
    submissions.confirm(retry);
    const next = submissions.prepare("mission", "A", "Request an ambulance.");
    assert.notEqual(next.clientEventId, first.clientEventId);
    assert.equal((await (await send(next)).json()).observations.length, 2);
    assert.notEqual(submissions.prepare("other", "A", first.text).clientEventId, next.clientEventId);
    assert.notEqual(submissions.prepare("mission", "B", first.text).clientEventId, next.clientEventId);
  } finally {
    await store.close();
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
});


test("typed retry keeps one durable report and action after lost confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-confirm-"));
  try {
    const store = new Store(directory), submissions = new ReportSubmissions(randomUUID);
    const save = (r: ReturnType<ReportSubmissions["prepare"]>) => store.record(r.incidentId, r.speaker, r.text, "demo", async () => [], "typed", r.clientEventId);
    const first = submissions.prepare("mission", "A", "Request an ambulance.");
    await save(first); // Confirmation never reaches the UI.
    const retry = submissions.prepare("mission", " A ", " Request an ambulance. ");
    const state = await save(retry);
    assert.equal(state.observations.length, 1);
    assert.equal(state.actions.length, 1);
    submissions.confirm(retry);
    const next = submissions.prepare("mission", "A", first.text);
    assert.notEqual(next.clientEventId, first.clientEventId);
    await save(next);
    assert.equal((await new Store(directory).get("mission")).observations.length, 2);
    assert.notEqual(submissions.prepare("other", "A", first.text).clientEventId, next.clientEventId);
    assert.notEqual(submissions.prepare("mission", "B", first.text).clientEventId, next.clientEventId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("legacy snapshots remain readable while revised snapshots never move backwards", () => {
  const old = { id: "mission", updatedAt: "2026-11-14T10:00:00.000Z" } as Incident;
  const later = { ...old, updatedAt: "2026-11-14T10:01:00.000Z" };
  assert.equal(latestIncident(later, old), later);
  const revised = { ...old, revision: 1 };
  assert.equal(latestIncident(revised, later), revised);
  assert.equal(latestIncident(old, revised), revised);
  assert.equal(latestIncident(undefined, old), old);
});
