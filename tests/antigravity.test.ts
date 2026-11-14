import { test } from "node:test";
import assert from "node:assert/strict";
import { antigravityPlan, type MissionSnapshot } from "../src/server/antigravity.js";

const state: MissionSnapshot = {id: "test", version: 4,
  observations: [{id: "r1", speaker: "Officer", text: "Two people report injuries; no ambulance is on scene.", facts: [], timestamp: "2026-11-14T20:00:00Z"}],
  issues: [], actions: []};
const action = {kind: "service_request", service: "ems", title: "Recommend EMS support", detail: "Officer reports two injuries and no ambulance on scene; dispatcher review required.", sourceObservationIds: ["r1"]};
const call = (name: string, args: unknown, n = 1) => ({id: `interaction-${n}`, status: "requires_action", environment_id: "env-test",
  steps: [{type: "thought", summary: [{text: "private reasoning must not appear in receipts"}]}, {id: `call-${n}`, type: "function_call", name, arguments: args}]});
const completed = {id: "interaction-3", status: "completed", environment_id: "env-test"};
function mock(responses: unknown[], status = 200) {
  const requests: {url: string; options: RequestInit; body?: any}[] = [];
  const transport = (async (url: string | URL | Request, options: RequestInit = {}) => {
    requests.push({url: String(url), options, body: options.body ? JSON.parse(String(options.body)) : undefined});
    if (options.method === "DELETE") return new Response(null, {status: 204});
    const next = responses.shift();
    assert.notEqual(next, undefined, "unexpected extra provider request");
    return new Response(JSON.stringify(next), {status, headers: {"Content-Type": "application/json"}});
  }) as typeof fetch;
  return {requests, transport};
}

test("Antigravity reads captured context, validates source-linked proposals, acknowledges, and cleans up", async () => {
  const before = JSON.stringify(state);
  const m = mock([call("read_mission_context", {}), call("propose_actions", {actions: [action]}, 2), completed]);
  const result = await antigravityPlan(state, "r1", {apiKey: "test-only", fetch: m.transport});
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(result.actions, [action]);
  assert.deepEqual(result.receipts.map(r => r.tool), ["read_mission_context", "propose_actions"]);
  assert.doesNotMatch(JSON.stringify(result.receipts), /private reasoning/);
  assert.equal(m.requests.length, 4);
  assert.deepEqual(m.requests[0].body.tools.map((t: any) => t.name), ["read_mission_context", "propose_actions"]);
  assert.deepEqual(m.requests[0].body.environment.network.allowlist, []);
  assert.equal(m.requests[1].body.previous_interaction_id, "interaction-1");
  assert.deepEqual(m.requests[1].body.tools, m.requests[0].body.tools);
  assert.deepEqual(m.requests[2].body.tools, m.requests[0].body.tools);
  assert.equal(m.requests[1].body.agent_config, undefined);
  assert.equal(JSON.parse(m.requests[1].body.input[0].result[0].text).version, 4);
  assert.equal(JSON.parse(m.requests[2].body.input[0].result[0].text).executed, false);
  assert.equal(m.requests.at(-1)?.options.method, "DELETE");
});

test("unknown report references fail closed with no plan and clean up the environment", async () => {
  const m = mock([call("read_mission_context", {}), call("propose_actions", {actions: [{...action, sourceObservationIds: ["invented"]}]}, 2)]);
  await assert.rejects(antigravityPlan(state, "r1", {apiKey: "test-only", fetch: m.transport}), /unknown or unrelated/);
  assert.equal(m.requests.at(-1)?.options.method, "DELETE");
});

test("out-of-order tools and unauthorized dispatch requests are never executed", async () => {
  for (const name of ["propose_actions", "dispatch_ems", "code_execution", "google_search"]) {
    const m = mock([call(name, {actions: [action]})]);
    await assert.rejects(antigravityPlan(state, "r1", {apiKey: "test-only", fetch: m.transport}), /unavailable or out-of-order/);
    assert.equal(m.requests.length, 2);
  }
});

test("invalid action kinds, service combinations and oversized plans never become actions", async () => {
  for (const actions of [[{...action, kind: "approve"}], [{...action, service: "team"}], Array(5).fill(action)]) {
    const m = mock([call("read_mission_context", {}), call("propose_actions", {actions}, 2)]);
    await assert.rejects(antigravityPlan(state, "r1", {apiKey: "test-only", fetch: m.transport}));
    assert.equal(m.requests.at(-1)?.options.method, "DELETE");
  }
});

test("a completed message without tool evidence cannot impersonate success", async () => {
  const m = mock([completed]);
  await assert.rejects(antigravityPlan(state, "r1", {apiKey: "test-only", fetch: m.transport}), /without a validated/);
});

test("provider outage and token exhaustion do not silently fall back to Gemini or demo rules", async () => {
  const failure = mock([{error: "unavailable"}], 503);
  await assert.rejects(antigravityPlan(state, "r1", {apiKey: "test-only", fetch: failure.transport}), /HTTP 503/);
  assert.equal(failure.requests.length, 1);
  const incomplete = mock([{...completed, status: "incomplete"}]);
  await assert.rejects(antigravityPlan(state, "r1", {apiKey: "test-only", fetch: incomplete.transport}), /tool budget/);
});

test("snapshots must contain the newest report and remain bounded before any provider call", async () => {
  const m = mock([]);
  await assert.rejects(antigravityPlan(state, "missing", {apiKey: "test-only", fetch: m.transport}), /not in the mission/);
  await assert.rejects(antigravityPlan({...state, issues: ["x".repeat(41000)]}, "r1", {apiKey: "test-only", fetch: m.transport}), /too large/);
  assert.equal(m.requests.length, 0);
});

test("missing environment and duplicate pending calls fail without another agent turn", async () => {
  const noEnv = {...call("read_mission_context", {}), environment_id: undefined};
  const m = mock([noEnv]);
  await assert.rejects(antigravityPlan(state, "r1", {apiKey: "test-only", fetch: m.transport}), /identify its environment/);
  const duplicate = call("read_mission_context", {});
  duplicate.steps.push(duplicate.steps[1]);
  const d = mock([duplicate]);
  await assert.rejects(antigravityPlan(state, "r1", {apiKey: "test-only", fetch: d.transport}), /exactly one/);
});
