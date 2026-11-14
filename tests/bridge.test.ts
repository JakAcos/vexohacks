import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { runTapBridge } from "../scripts/vexo-tap.mjs";
test("SDK-compatible tap adapter posts scripted sources and requests the corrected briefing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "copilot-bridge-"));
  const { app } = createApp({ directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  // This is an event-interface contract double, not a Vexo band or kit simulation.
  const source = Object.assign(new EventEmitter(), {
    configure: async (options: unknown) =>
      assert.deepEqual(options, { events: true }),
  });
  try {
    const state = await runTapBridge(source, {
      base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      incidentId: "adapter-test",
      trigger: () => source.emit("tap"),
      delayMs: 0,
    });
    assert.equal(state.observations.length, 3);
    assert.equal(state.observations[0].inputKind, "vexo-simulated-text");
    assert.match(
      state.briefings.at(-1)!.text,
      /resolved according to the resident/,
    );
    assert.equal(
      state.issues.filter((i: { status: string }) => i.status === "active")
        .length,
      2,
    );
    assert.equal(source.listenerCount("tap"), 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
