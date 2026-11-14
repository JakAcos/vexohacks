import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/store.js";

test("startup preserves legacy band metadata while resuming a saved mission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-resume-metadata-"));
  const store = new Store(dir);
  const path = join(dir, "band-session-state.json");
  const metadata = JSON.stringify({ status: "stopped", bandNumber: 38, receivedPackets: 400, pendingReports: 0 });
  try {
    // Persist a genuinely queued report without a worker: the next process owns it.
    await store.close();
    const accepted = await store.acceptRecord("mission", "Responder", "Request an ambulance.", "demo");
    await writeFile(path, metadata);
    const resumed = new Store(dir);
    try {
      await resumed.resume();
      await resumed.idle();
      const state = await resumed.get("mission");
      assert.equal(state.observations[0].id, accepted.observations[0].id);
      assert.equal(state.reportJobs![0].status, "complete");
      assert.ok(state.actions.length > 0);
      await assert.rejects(resumed.get("band-session-state"), /band session settings/);
      await assert.rejects(resumed.acceptRecord("band-session-state", "Responder", "Smoke.", "demo"), /band session settings/);
      assert.equal(await readFile(path, "utf8"), metadata);
    } finally { await resumed.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a real mission named band-session-state remains a mission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-resume-mission-"));
  const store = new Store(dir);
  try {
    await store.close();
    await store.acceptRecord("band-session-state", "Responder", "Smoke reported.", "demo");
    const resumed = new Store(dir);
    try {
      await resumed.resume(); await resumed.idle();
      assert.equal((await resumed.get("band-session-state")).reportJobs![0].status, "complete");
    } finally { await resumed.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
