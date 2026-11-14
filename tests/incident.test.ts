import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/store.js";
import {
  extractDemo,
  briefingText,
  extractGemini,
  isResidentResolution,
} from "../src/server/agents.js";
import { scenario } from "../src/shared/model.js";
import { createApp } from "../src/server/app.js";
import type { AddressInfo } from "node:net";

test("resident correction preserves original reports, hazards, scoped attribution and disk persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "copilot-"));
  const store = new Store(directory);
  try {
    for (const s of scenario)
      await store.record("test", s.speaker, s.text, "demo", async () =>
        extractDemo(s.text),
      );
    const state = await new Store(directory).get("test");
    assert.equal(state.observations.length, 3);
    const occupant = state.issues.find((i) => i.id === "occupant-resident")!;
    assert.equal(occupant.status, "resolved");
    assert.equal(occupant.uncertain, true);
    assert.equal(occupant.evidence.length, 2);
    assert.equal(occupant.evidence[0].source, "Resident via Firefighter A");
    assert.equal(occupant.evidence[1].source, "Resident via Firefighter B");
    assert.equal(
      state.issues.find((i) => i.topic === "smoke")!.status,
      "active",
    );
    assert.equal(
      state.issues.find((i) => i.topic === "rear-entrance")!.status,
      "active",
    );
    assert.match(briefingText(state), /according to the resident/);
    assert.match(briefingText(state), /not independently confirmed/);
    assert.match(briefingText(state), /smoke reported/);
    assert.equal((await store.get("other")).observations.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("contradictions remain visible and a resident correction cannot resolve a responder concern", async () => {
  const directory = await mkdtemp(join(tmpdir(), "copilot-"));
  const store = new Store(directory);
  try {
    for (const [speaker, text] of [
      ["A", "Smoke coming from the second floor."],
      ["B", "No smoke on the second floor."],
      ["A", "Someone is upstairs."],
      ["B", scenario[2].text],
    ])
      await store.record("test", speaker, text, "demo", async () =>
        extractDemo(text),
      );
    const state = await store.get("test");
    assert.equal(
      state.issues.find((i) => i.topic === "smoke")!.status,
      "conflicting",
    );
    assert.equal(
      state.issues.find((i) => i.id === "occupant-speaker")!.status,
      "active",
    );
    assert.match(briefingText(state), /conflicting reports/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed extraction leaves no partial state and concurrent writes preserve history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "copilot-"));
  const store = new Store(directory);
  try {
    await assert.rejects(
      store.record("test", "A", "Report", "demo", async () => {
        throw new Error("offline");
      }),
    );
    assert.equal((await store.get("test")).version, 0);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.record(
          "test",
          `Speaker ${i}`,
          "Rear entrance is blocked.",
          "demo",
          async () => extractDemo("Rear entrance is blocked."),
        ),
      ),
    );
    assert.equal((await store.get("test")).observations.length, 8);
    assert.equal((await store.get("test")).issues[0].evidence.length, 8);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTTP scenario streams updates, validates input, guards stale approvals, and resets one incident", async () => {
  const directory = await mkdtemp(join(tmpdir(), "copilot-http-"));
  const { app } = createApp({ directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const stream = await fetch(`${base}/incidents/demo/events`, {
      signal: controller.signal,
    });
    reader = stream.body!.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /event: incident/,
    );
    assert.equal(
      (
        await post("/observations", {
          incidentId: "../escape",
          speaker: "A",
          text: "x",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/observations", {
          incidentId: "demo",
          speaker: " ",
          text: "x",
        })
      ).status,
      400,
    );
    for (const s of scenario.slice(0, 2))
      assert.equal(
        (await post("/observations", { incidentId: "demo", ...s })).status,
        201,
      );
    const streamed = new TextDecoder().decode((await reader.read()).value);
    assert.match(streamed, /smoke/);
    const before = await (
      await post("/briefings", { incidentId: "demo" })
    ).json();
    assert.match(before.briefings.at(-1).text, /unconfirmed/);
    const draftState = await (
      await post("/handovers", { incidentId: "demo" })
    ).json();
    const old = draftState.handovers.at(-1);
    await post("/observations", { incidentId: "demo", ...scenario[2] });
    assert.equal(
      (
        await post(`/handovers/${old.id}/approve`, {
          incidentId: "demo",
          approvedBy: "Lead",
          expectedVersion: 2,
        })
      ).status,
      409,
    );
    const updated = await (
      await post("/briefings", { incidentId: "demo" })
    ).json();
    assert.match(
      updated.briefings.at(-1).text,
      /resolved according to the resident/,
    );
    const fresh = await (
      await post("/handovers", { incidentId: "demo" })
    ).json();
    const draft = fresh.handovers.at(-1);
    const approved = await post(`/handovers/${draft.id}/approve`, {
      incidentId: "demo",
      approvedBy: "Team lead",
      expectedVersion: 3,
    });
    assert.equal(approved.status, 200);
    assert.equal(
      (await approved.json()).handovers.at(-1).approvedBy,
      "Team lead",
    );
    assert.equal(
      (
        await post(`/handovers/${draft.id}/approve`, {
          incidentId: "demo",
          approvedBy: "Lead",
          expectedVersion: 3,
        })
      ).status,
      409,
    );
    await post("/observations", {
      incidentId: "other",
      speaker: "A",
      text: "Rear entrance is blocked.",
    });
    assert.equal(
      (await post("/incidents/demo/reset", { confirm: "no" })).status,
      400,
    );
    assert.equal(
      (
        await (
          await post("/incidents/demo/reset", { confirm: "RESET SIMULATION" })
        ).json()
      ).observations.length,
      0,
    );
    assert.equal(
      (await (await fetch(`${base}/incidents/other`)).json()).observations
        .length,
      1,
    );
    assert.equal(
      (
        await fetch(`${base}/observations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://unrelated.example",
          },
          body: JSON.stringify({ incidentId: "demo", speaker: "A", text: "x" }),
        })
      ).status,
      403,
    );
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("Gemini adapter sends structured extraction and rejects malformed output", async () => {
  const originalFetch = globalThis.fetch,
    oldKey = process.env.GEMINI_API_KEY,
    oldModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "test-only-not-a-credential";
  process.env.GEMINI_MODEL = "configured-model";
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      assert.equal(body.model, "configured-model");
      assert.equal(body.response_format.mime_type, "application/json");
      assert.match(body.input, /untrusted/);
      return new Response(
        JSON.stringify({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    facts: extractDemo(scenario[0].text),
                  }),
                },
              ],
            },
          ],
        }),
      );
    };
    assert.equal((await extractGemini(scenario[0].text, "A")).length, 2);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [
                { type: "text", text: '{"facts":[{"topic":"invented"}]}' },
              ],
            },
          ],
        }),
      );
    await assert.rejects(extractGemini("x", "A"));
    globalThis.fetch = async () =>
      new Response("provider details", { status: 401 });
    await assert.rejects(extractGemini("x", "A"), /401/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = oldModel;
  }
});

test("resident resolution accepts supported paraphrases and rejects negated or tentative claims", () => {
  assert.equal(
    isResidentResolution(
      "The resident found the person outdoors. The resident says everyone is accounted for.",
    ),
    true,
  );
  assert.equal(
    isResidentResolution(
      "The resident has not located the missing person outside. The resident reports nobody else is missing.",
    ),
    false,
  );
  assert.equal(
    isResidentResolution(
      "The resident may have located the missing person outside. The resident reports nobody else is missing.",
    ),
    false,
  );
  assert.equal(
    isResidentResolution(
      "A responder located the missing person outside. The resident reports nobody else is missing.",
    ),
    false,
  );
});

test("resident hazard reports retain resident attribution rather than becoming responder observations", () => {
  assert.equal(
    extractDemo("A resident reports smoke on the second floor.")[0].source,
    "resident",
  );
  assert.equal(
    extractDemo("A resident reports the rear entrance is blocked.")[0].source,
    "resident",
  );
  assert.equal(extractDemo(scenario[0].text)[0].source, "speaker");
});
