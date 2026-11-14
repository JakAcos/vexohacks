import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { validateAccess } from "../src/server/access.js";

test("remote configuration refuses incomplete or insecure deployment", () => {
  for (const config of [
    { publicOrigin: "https://relay.example" }, { accessToken: "x".repeat(32) },
    { publicOrigin: "http://relay.example", accessToken: "x".repeat(32) },
    { publicOrigin: "https://relay.example/path", accessToken: "x".repeat(32) },
    { publicOrigin: "https://relay.example", accessToken: "short" },
  ]) assert.throws(() => validateAccess(config));
});

test("private cloud protects state and streams, and accepts only its configured HTTPS origin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-private-"));
  const token = "test-secret-".repeat(4), origin = "https://relay.example";
  const { app, store } = createApp({ directory, access: { publicOrigin: origin, accessToken: token } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = { Authorization: `Bearer ${token}` };
  try {
    assert.deepEqual(await (await fetch(base + "/healthz")).json(), { ok: true });
    for (const path of ["/", "/api/health", "/api/incidents/stage", "/api/incidents/stage/events"])
      assert.equal((await fetch(base + path)).status, 401, path);
    assert.equal((await fetch(base + "/api/health", { headers: { Authorization: "Bearer wrong" } })).status, 401);
    const body = JSON.stringify({ incidentId: "stage", speaker: "Demo firefighter", text: "Smoke on the second floor. Request an ambulance. Request police for traffic control." });
    const post = (requestOrigin: string, extra = {}) => fetch(base + "/api/observations", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json", Origin: requestOrigin, ...extra }, body,
    });
    assert.equal((await post("https://attacker.example", { "X-Forwarded-Host": "attacker.example" })).status, 403);
    assert.equal((await post("http://localhost:5173")).status, 403);
    const response = await post(origin);
    assert.equal(response.status, 202);
    await response.json();
    await store.idle();
    const state = await store.get("stage");
    assert.equal(state.observations.length, 1);
    assert.deepEqual(state.actions.map((a: { service: string }) => a.service).sort(), ["ems", "police", "team"]);
    const basic = { Authorization: `Basic ${Buffer.from(`relay:${token}`).toString("base64")}` };
    assert.equal((await fetch(base + "/api/incidents/stage", { headers: basic })).status, 200);
    assert.equal((await fetch(base + "/api/incidents/stage", { headers: { ...basic, Origin: "https://attacker.example" } })).status, 403);
    const stream = await fetch(base + "/api/incidents/stage/events", { headers: basic });
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: incident/);
    await reader.cancel();
  } finally {
    await store.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
