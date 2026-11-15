import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApp } from "../src/server/app.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

async function startRelay() {
  const directory = await mkdtemp(join(tmpdir(), "relay-mcp-"));
  const { app, store, ready } = createApp({ directory, mode: "demo" });
  await ready;
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = new Client({ name: "relay-mcp-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [mainJs], env: { RELAY_URL: url }, stderr: "ignore" }));
  const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const post = (path: string, body: unknown) => fetch(url + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { url, client, call, post, store, async close() { await client.close(); server.close(); await store.close(); await rm(directory, { recursive: true, force: true }); } };
}
const errText = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

const mainJs = join(dirname(fileURLToPath(import.meta.url)), "../src/mcp/main.js");
const json = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);

test("MCP server drives a real Relay mission over stdio: report -> proposal -> approval -> receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-mcp-"));
  const { app, store, ready } = createApp({ directory, mode: "demo" });
  await ready;
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const client = new Client({ name: "relay-mcp-test", version: "0" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [mainJs], env: { RELAY_URL: `http://127.0.0.1:${port}` }, stderr: "ignore" }));
    const tools = (await client.listTools()).tools.map(t => t.name).sort();
    assert.deepEqual(tools, ["relay_approve_action", "relay_dismiss_action", "relay_get_changes", "relay_get_mission", "relay_health", "relay_list_missions", "relay_propose_action", "relay_request_briefing", "relay_retry_planning", "relay_retry_report", "relay_submit_report", "relay_wait_for_change"]);

    const health = json(await client.callTool({ name: "relay_health", arguments: {} }));
    assert.equal(health.ok, true);
    assert.equal(health.mode, "demo");

    const submitted = json(await client.callTool({ name: "relay_submit_report", arguments: { incidentId: "mcp-test", speaker: "Police", text: "Request an ambulance for two injured people." } }));
    assert.equal(submitted.stillProcessing, false);
    assert.equal(submitted.job?.status ?? "complete", "complete");
    assert.equal(submitted.mission.recentReports.at(-1).text, "Request an ambulance for two injured people.");
    const proposal = submitted.mission.actions.find((a: { service: string; status: string }) => a.service === "ems" && a.status === "proposed");
    assert.ok(proposal, "demo coordinator should propose an EMS request");
    assert.deepEqual(proposal.sourceReportIds, [submitted.mission.recentReports.at(-1).id], "action links to the report that caused it");

    // Same idempotency key must not duplicate the report.
    const again = json(await client.callTool({ name: "relay_submit_report", arguments: { incidentId: "mcp-test", speaker: "Police", text: "Request an ambulance for two injured people.", clientEventId: submitted.clientEventId } }));
    assert.equal(again.mission.recentReports.length, 1);

    const before = json(await client.callTool({ name: "relay_get_mission", arguments: { incidentId: "mcp-test" } }));
    const stale = await client.callTool({ name: "relay_approve_action", arguments: { incidentId: "mcp-test", actionId: proposal.id, approvedBy: "Dispatcher", expectedVersion: before.version - 1 } });
    assert.equal(stale.isError, true, "stale version must be rejected by Relay");
    assert.match((stale.content as { text: string }[])[0].text, /HTTP 409/);

    const approved = json(await client.callTool({ name: "relay_approve_action", arguments: { incidentId: "mcp-test", actionId: proposal.id, approvedBy: "Dispatcher", expectedVersion: before.version } }));
    const done = approved.actions.find((a: { id: string }) => a.id === proposal.id);
    assert.equal(done.status, "acknowledged");
    assert.equal(done.approvedBy, "Dispatcher");
    assert.ok(done.receipt, "simulated connector receipt recorded");

    const briefing = json(await client.callTool({ name: "relay_request_briefing", arguments: { incidentId: "mcp-test" } }));
    assert.ok(briefing.briefing.text.length > 0);

    const resource = await client.readResource({ uri: "relay://missions/mcp-test" });
    assert.equal(JSON.parse((resource.contents[0] as { text: string }).text).id, "mcp-test");

    const bad = await client.callTool({ name: "relay_get_mission", arguments: { incidentId: "bad id!" } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
    server.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("MCP server reports an unreachable Relay as a tool error, not a crash", async () => {
  const client = new Client({ name: "relay-mcp-test", version: "0" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [mainJs], env: { RELAY_URL: "http://127.0.0.1:9" }, stderr: "ignore" }));
    const r = await client.callTool({ name: "relay_health", arguments: {} });
    assert.equal(r.isError, true);
    assert.match((r.content as { text: string }[])[0].text, /Could not reach Relay/);
  } finally { await client.close(); }
});

test("outside agents propose source-linked actions that always wait for a dispatcher", async () => {
  const r = await startRelay();
  try {
    const sub = json(await r.call("relay_submit_report", { incidentId: "multi", speaker: "Firefighter A", text: "Smoke coming from the second floor. A resident reports someone may still be upstairs." }));
    const reportId = sub.mission.recentReports.at(-1).id;

    // Must cite a real report from this mission.
    const bogus = await r.call("relay_propose_action", { incidentId: "multi", proposedBy: "medical-agent", kind: "service_request", service: "ems", title: "Request EMS standby", detail: "x", sourceReportIds: ["00000000-0000-4000-8000-000000000000"] });
    assert.equal(bogus.isError, true); assert.match(errText(bogus), /HTTP 422.*Unknown source report/);
    // kind/service must agree.
    const mismatched = await r.call("relay_propose_action", { incidentId: "multi", proposedBy: "medical-agent", kind: "team_update", service: "ems", title: "t", detail: "d", sourceReportIds: [reportId] });
    assert.equal(mismatched.isError, true); assert.match(errText(mismatched), /HTTP 400/);

    const key = "11111111-1111-4111-8111-111111111111";
    const created = json(await r.call("relay_propose_action", { incidentId: "multi", proposedBy: "medical-agent", kind: "service_request", service: "ems", title: "Recommend EMS standby", detail: "Possible occupant upstairs with smoke on floor two; unconfirmed.", sourceReportIds: [reportId], clientEventId: key }));
    assert.equal(created.outcome, "created");
    assert.equal(created.action.status, "proposed");
    assert.equal(created.action.proposedBy, "medical-agent");
    assert.deepEqual(created.action.sourceReportIds, [reportId]);
    const retry = json(await r.call("relay_propose_action", { incidentId: "multi", proposedBy: "medical-agent", kind: "service_request", service: "ems", title: "Recommend EMS standby", detail: "retry", sourceReportIds: [reportId], clientEventId: key }));
    assert.equal(retry.outcome, "duplicate"); assert.equal(retry.actionId, created.actionId);
    const second = json(await r.call("relay_propose_action", { incidentId: "multi", proposedBy: "logistics-agent", kind: "service_request", service: "ems", title: "EMS again", detail: "same need", sourceReportIds: [reportId] }));
    assert.equal(second.outcome, "linked"); assert.equal(second.actionId, created.actionId);

    // Even a team update from an outside agent is not auto-sent.
    const team = json(await r.call("relay_propose_action", { incidentId: "multi", proposedBy: "comms-agent", kind: "team_update", service: "team", title: "Second floor smoke", detail: "Share with all crews.", sourceReportIds: [reportId] }));
    assert.equal(team.action.status, "proposed"); assert.equal(team.action.receipt, undefined);

    const m = json(await r.call("relay_get_mission", { incidentId: "multi" }));
    assert.equal(m.actions.filter((a: { status: string; proposedBy: string }) => a.status === "proposed" && a.proposedBy !== "relay-coordinator").length, 2);
    assert.equal(m.version, created.missionVersion, "a proposal adds no evidence, so the mission version is unchanged");
    const approved = json(await r.call("relay_approve_action", { incidentId: "multi", actionId: created.actionId, approvedBy: "Dispatcher", expectedVersion: m.version }));
    const ems = approved.actions.find((a: { id: string }) => a.id === created.actionId);
    assert.equal(ems.status, "acknowledged"); assert.match(ems.receipt, /simulation/);

    // Proposing into a mission nobody created must fail, not create an empty mission.
    const empty = await r.call("relay_propose_action", { incidentId: "nowhere", proposedBy: "a", kind: "team_update", service: "team", title: "t", detail: "d", sourceReportIds: [reportId] });
    assert.equal(empty.isError, true);
  } finally { await r.close(); }
});

test("list missions and changes since a cursor", async () => {
  const r = await startRelay();
  try {
    assert.deepEqual(json(await r.call("relay_list_missions")).missions, []);
    await r.call("relay_submit_report", { incidentId: "alpha", speaker: "Police", text: "Request an ambulance for two injured people." });
    const first = json(await r.call("relay_get_changes", { incidentId: "alpha", sinceMinutes: 5 }));
    assert.equal(first.newReports.length, 1);
    assert.equal(first.changedActions[0].service, "ems");
    await r.call("relay_submit_report", { incidentId: "beta", speaker: "Firefighter B", text: "Rear entrance is blocked." });

    const listed = json(await r.call("relay_list_missions")).missions;
    assert.deepEqual(listed.map((m: { id: string }) => m.id), ["beta", "alpha"], "most recent first");
    assert.equal(listed.find((m: { id: string }) => m.id === "alpha").pendingActions, 1);

    const quiet = json(await r.call("relay_get_changes", { incidentId: "alpha", since: first.cursor }));
    assert.equal(quiet.newReports.length + quiet.changedActions.length, 0, "nothing new after the cursor");
    await r.call("relay_submit_report", { incidentId: "alpha", speaker: "Firefighter B", text: "Rear entrance is blocked." });
    const next = json(await r.call("relay_get_changes", { incidentId: "alpha", since: first.cursor }));
    assert.deepEqual(next.newReports.map((o: { text: string }) => o.text), ["Rear entrance is blocked."]);
    assert.ok(next.changedIssues.some((i: { topic: string }) => i.topic === "rear-entrance"));
  } finally { await r.close(); }
});

test("live push: wait_for_change returns on a real change and resource subscribers are notified", { timeout: 45000 }, async () => {
  const r = await startRelay();
  try {
    const base = json(await r.call("relay_get_mission", { incidentId: "live" }));
    const timedOut = json(await r.call("relay_wait_for_change", { incidentId: "live", afterRevision: base.revision, timeoutSeconds: 1 }));
    assert.equal(timedOut.changed, false);
    // Relay sends an SSE heartbeat every 15 s; a wait spanning one must still end on time.
    const t0 = Date.now();
    const spanning = json(await r.call("relay_wait_for_change", { incidentId: "live", afterRevision: base.revision, timeoutSeconds: 17 }));
    assert.equal(spanning.timedOut, true);
    assert.ok(Date.now() - t0 < 20000, `wait across a heartbeat returned in ${Date.now() - t0} ms`);

    const updates: string[] = [];
    r.client.setNotificationHandler(ResourceUpdatedNotificationSchema, n => { updates.push(n.params.uri); });
    await r.client.subscribeResource({ uri: "relay://missions/live" });
    await new Promise(res => setTimeout(res, 200));

    const started = Date.now();
    const waiting = r.call("relay_wait_for_change", { incidentId: "live", afterRevision: base.revision, timeoutSeconds: 20 });
    await new Promise(res => setTimeout(res, 300));
    const sent = await r.post("/api/observations", { incidentId: "live", speaker: "Police", text: "Request an ambulance for two injured people." });
    assert.equal(sent.status, 202);
    const woke = json(await waiting);
    assert.equal(woke.changed, true);
    assert.ok(woke.mission.revision > base.revision);
    assert.ok(Date.now() - started < 10000, "returned on the change, not the timeout");

    for (let i = 0; i < 40 && !updates.length; i++) await new Promise(res => setTimeout(res, 100));
    assert.ok(updates.includes("relay://missions/live"), "subscriber got resources/updated");
    await r.client.unsubscribeResource({ uri: "relay://missions/live" });
    const bad = await r.client.subscribeResource({ uri: "relay://other/x" }).then(() => "ok", () => "rejected");
    assert.equal(bad, "rejected");
  } finally { await r.close(); }
});
