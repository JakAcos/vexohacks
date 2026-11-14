// Copy into scripts/ after applying the integration patch. Explicit live check only.
import assert from "node:assert/strict";
import { coordinate } from "../build-server/server/orchestrator.js";
if (!process.argv.includes("--live")) throw new Error("Add --live to call the paid provider with a synthetic mission.");
process.env.COORDINATOR_PROVIDER = "antigravity";
const report = {id: "fictional-r1", speaker: "Officer A", text: "Two people report injuries after a collision. Both are speaking. No ambulance is on scene.", facts: [], timestamp: new Date().toISOString(), mode: "gemini", inputKind: "typed", processingMs: 0};
const state = {id: "antigravity-integration-fixture", title: "Synthetic check", version: 1, observations: [report], issues: [], actions: [], agentEvents: [], briefings: [], handovers: [], voiceCommands: [], updatedAt: report.timestamp};
const started = Date.now();
await coordinate(state, report, "gemini");
assert.ok(state.agentEvents.some(e => e.message.startsWith("Antigravity read_mission_context:")));
assert.ok(state.agentEvents.some(e => e.message.startsWith("Antigravity propose_actions:")));
assert.ok(!state.agentEvents.some(e => /planning failed/.test(e.message)));
assert.ok(state.actions.length > 0);
for (const action of state.actions) {
  assert.ok(action.sourceObservationIds.includes(report.id));
  if (action.kind === "service_request") {
    assert.equal(action.status, "proposed");
    assert.equal(action.receipt, undefined);
  } else {
    assert.equal(action.status, "acknowledged");
    assert.equal(action.receipt.simulated, true);
  }
}
console.log(JSON.stringify({passed: true, fixture: "Synthetic pre-extracted text; real Antigravity coordinator; simulated connectors; no wearable or audio test", elapsedMs: Date.now()-started, actions: state.actions, agentEvents: state.agentEvents}, null, 2));
