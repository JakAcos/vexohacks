import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/server/store.js";
import { coordinate } from "../src/server/orchestrator.js";
import type { Observation } from "../src/shared/model.js";

test("Antigravity coordinator exposes actual tools, preserves sources and requires service approval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-antigravity-test-"));
  const oldFetch = globalThis.fetch;
  const oldProvider = process.env.COORDINATOR_PROVIDER, oldKey = process.env.GEMINI_API_KEY;
  try {
    process.env.COORDINATOR_PROVIDER = "antigravity";
    process.env.GEMINI_API_KEY = "test-only";
    const state = await new Store(directory).get("mission");
    const report = {id: "r1", speaker: "Officer", text: "Two injuries; no ambulance on scene.", timestamp: new Date().toISOString(), facts: [], mode: "gemini", inputKind: "typed", processingMs: 0} as Observation;
    state.observations.push(report);
    const actions = [
      {kind: "service_request", service: "ems", title: "Recommend EMS", detail: "Two reported injuries; extent unknown.", sourceObservationIds: ["r1"]},
      {kind: "team_update", service: "team", title: "Share reported injuries", detail: "Officer reports two injuries.", sourceObservationIds: ["r1"]},
    ];
    const responses = [
      {id: "i1", status: "requires_action", environment_id: "env-test", steps: [{id: "c1", type: "function_call", name: "read_mission_context", arguments: {}}]},
      {id: "i2", status: "requires_action", environment_id: "env-test", steps: [{id: "c2", type: "function_call", name: "propose_actions", arguments: {actions}}]},
      {id: "i3", status: "completed", environment_id: "env-test"},
    ];
    globalThis.fetch = async (_url, options) => options?.method === "DELETE" ? new Response(null, {status: 204}) : new Response(JSON.stringify(responses.shift()));
    await coordinate(state, report, "gemini");
    assert.equal(state.actions.length, 2);
    assert.equal(state.actions[0].status, "proposed");
    assert.equal(state.actions[0].receipt, undefined);
    assert.deepEqual(state.actions[0].sourceObservationIds, ["r1"]);
    assert.equal(state.actions[1].status, "acknowledged");
    assert.equal(state.actions[1].receipt?.simulated, true);
    assert.ok(state.agentEvents.some(e => /Antigravity read_mission_context.*i1/.test(e.message)));
    assert.ok(state.agentEvents.some(e => /Antigravity propose_actions.*i2/.test(e.message)));
    state.actions = []; state.agentEvents = [];
    globalThis.fetch = async () => new Response("unavailable", {status: 503});
    await coordinate(state, report, "gemini");
    assert.equal(state.actions.length, 0);
    assert.match(state.agentEvents[0].message, /Antigravity coordinator action planning failed/);
    assert.doesNotMatch(JSON.stringify(state.agentEvents), /read_mission_context|propose_actions/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldProvider === undefined) delete process.env.COORDINATOR_PROVIDER; else process.env.COORDINATOR_PROVIDER = oldProvider;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
    await rm(directory, {recursive: true, force: true});
  }
});
