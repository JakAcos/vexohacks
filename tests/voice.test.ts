import { settle } from "./settle.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { scenario } from "../src/shared/model.js";

const names = [
  "DEEPGRAM_API_KEY",
  "DEEPGRAM_MODEL",
  "MINIMAX_API_KEY",
  "MINIMAX_MODEL",
  "MINIMAX_VOICE_ID",
] as const;
async function workspace(
  run: (context: {
    base: string;
    post: (path: string, body: unknown) => Promise<Response>;
    upload: (
      query?: string,
      contentType?: string,
      bytes?: Uint8Array<ArrayBuffer>,
    ) => Promise<Response>;
    originalFetch: typeof fetch;
  }) => Promise<void>,
) {
  const saved = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  for (const name of names) delete process.env[name];
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), "copilot-voice-"));
  const { app, store } = createApp({ directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(response => settle(response, store));
  // Synthetic bytes test the transport contract only, not recognition of real audio.
  const upload = (
    query = "incidentId=voice-test&speaker=Firefighter+A&consent=send-to-deepgram",
    contentType = "audio/wav",
    bytes = new Uint8Array([82, 73, 70, 70]),
  ) =>
    fetch(`${base}/audio/observations?${query}`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: bytes,
    }).then(response => settle(response, store));
  try {
    await run({ base, post, upload, originalFetch });
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    await store.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}
const transcript = (text: string, confidence = 0.99) =>
  new Response(
    JSON.stringify({
      results: {
        channels: [{ alternatives: [{ transcript: text, confidence }] }],
      },
    }),
  );

test("voice endpoints validate uploads and durably retain audio when provider credentials are missing", async () =>
  workspace(async ({ base, upload, post }) => {
    assert.equal(
      (await (await fetch(base + "/health")).json()).voice.deepgram.configured,
      false,
    );
    assert.equal((await upload("incidentId=voice-test&speaker=A")).status, 400);
    assert.equal((await upload(undefined, "text/plain")).status, 415);
    assert.equal(
      (await upload(undefined, undefined, new Uint8Array())).status,
      400,
    );
    assert.equal(
      (await upload(undefined, undefined, new Uint8Array(8 * 1024 * 1024 + 1)))
        .status,
      413,
    );
    const missing = await upload();
    assert.equal(missing.status, 202);
    const saved = await missing.json();
    assert.equal(saved.reportJobs[0].status, "failed");
    assert.match(saved.reportJobs[0].error, /DEEPGRAM_API_KEY/);
    const state = await (await fetch(base + "/incidents/voice-test")).json();
    assert.equal(state.observations.length, 0);
    const brief = await (
      await post("/briefings", { incidentId: "voice-test" })
    ).json();
    assert.equal(
      (
        await post("/briefings/audio", {
          incidentId: "voice-test",
          briefingId: brief.briefings.at(-1).id,
        })
      ).status,
      503,
    );
  }));

test("Deepgram raw upload commits attributed transcript through the normal recorder and tracker", async () =>
  workspace(async ({ upload, originalFetch, base }) => {
    process.env.DEEPGRAM_API_KEY = "test-key-not-real";
    globalThis.fetch = async (input, options) => {
      if (String(input).startsWith("https://api.deepgram.com/")) {
        const url = new URL(String(input));
        assert.equal(url.pathname, "/v1/listen");
        assert.equal(url.searchParams.get("mip_opt_out"), "true");
        assert.equal(url.searchParams.get("model"), "nova-3");
        assert.equal(
          (options!.headers as Record<string, string>).Authorization,
          "Token test-key-not-real",
        );
        assert.equal((options!.body as Uint8Array).length, 4);
        return transcript(scenario[0].text);
      }
      return originalFetch(input, options);
    };
    const response = await upload();
    assert.equal(response.status, 202);
    const state = await response.json();
    assert.equal(state.observations[0].inputKind, "transcript");
    assert.equal(state.observations[0].speaker, "Firefighter A");
    assert.equal(
      state.issues.find((i: { id: string }) => i.id === "occupant-resident")
        .status,
      "active",
    );
    assert.equal(
      state.issues.find((i: { id: string }) => i.id === "occupant-resident")
        .evidence[0].source,
      "Resident via Firefighter A",
    );
    const health = await (await fetch(base + "/health")).text();
    assert.ok(!health.includes("test-key-not-real"));
    assert.equal(JSON.parse(health).voice.deepgram.configured, true);
  }));

test("Deepgram empty, uncertain, malformed and failed responses never create an observation or fallback", async () =>
  workspace(async ({ upload, originalFetch, base }) => {
    process.env.DEEPGRAM_API_KEY = "test-only";
    const responses = [
      () => transcript(""),
      () => transcript(scenario[2].text, 0.2),
      () => new Response("{}"),
      () => new Response("sensitive provider body", { status: 401 }),
      () => {
        throw new Error("network credentials must never echo");
      },
    ];

    for (let n = 0; n < responses.length; n++) {
      globalThis.fetch = async (input, options) =>
        String(input).startsWith("https://api.deepgram.com/")
          ? responses[n]()
          : originalFetch(input, options);
      const result = await upload();
      assert.equal(result.status, 202);
      const saved = await result.json();
      assert.equal(saved.reportJobs.at(-1).status, "failed");
      assert.ok(!JSON.stringify(saved).includes("sensitive provider body"));
    }
    assert.equal(
      (await (await fetch(base + "/incidents/voice-test")).json()).observations
        .length,
      0,
    );
  }));

test("MiniMax uses current stored briefing and returns binary MP3 without changing incident history", async () =>
  workspace(async ({ post, originalFetch, base }) => {
    process.env.MINIMAX_API_KEY = "not-real";
    process.env.MINIMAX_MODEL = "configured-model";
    process.env.MINIMAX_VOICE_ID = "configured-voice";
    for (const report of scenario)
      await post("/observations", { incidentId: "voice-test", ...report });
    const state = await (
      await post("/briefings", { incidentId: "voice-test" })
    ).json();
    const briefing = state.briefings.at(-1);
    globalThis.fetch = async (input, options) => {
      if (String(input) === "https://api.minimax.io/v1/t2a_v2") {
        const body = JSON.parse(options!.body as string);
        assert.equal(body.model, "configured-model");
        assert.equal(body.voice_setting.voice_id, "configured-voice");
        assert.equal(body.output_format, "hex");
        assert.equal(body.audio_setting.format, "mp3");
        assert.equal(body.text, briefing.text);
        assert.match(body.text, /according to the resident/);
        return new Response(
          JSON.stringify({
            base_resp: { status_code: 0 },
            data: {
              status: 2,
              audio: Buffer.from("ID3 mock payload").toString("hex"),
            },
          }),
        );
      }
      return originalFetch(input, options);
    };
    const audio = await post("/briefings/audio", {
      incidentId: "voice-test",
      briefingId: briefing.id,
    });
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get("content-type"), "audio/mpeg");
    assert.equal(audio.headers.get("cache-control"), "no-store");
    assert.equal(
      Buffer.from(await audio.arrayBuffer()).toString(),
      "ID3 mock payload",
    );
    assert.equal(
      (await (await fetch(base + "/incidents/voice-test")).json()).observations
        .length,
      3,
    );
    await post("/observations", {
      incidentId: "voice-test",
      speaker: "B",
      text: "Rear entrance is blocked.",
    });
    assert.equal(
      (
        await post("/briefings/audio", {
          incidentId: "voice-test",
          briefingId: briefing.id,
        })
      ).status,
      409,
    );
  }));

test("MiniMax failure, malformed audio and incident changes during synthesis are rejected", async () =>
  workspace(async ({ post, originalFetch }) => {
    process.env.MINIMAX_API_KEY = "not-real";
    process.env.MINIMAX_MODEL = "configured-model";
    process.env.MINIMAX_VOICE_ID = "configured-voice";
    const state = await (
      await post("/briefings", { incidentId: "voice-test" })
    ).json();
    const body = {
      incidentId: "voice-test",
      briefingId: state.briefings.at(-1).id,
    };
    for (const reply of [
      () => new Response("{}"),
      () => new Response("upstream private details", { status: 403 }),
      () =>
        new Response(
          JSON.stringify({
            base_resp: { status_code: 0 },
            data: { status: 2, audio: "bad-hex" },
          }),
        ),
    ]) {
      globalThis.fetch = async (input, options) =>
        String(input).startsWith("https://api.minimax.io/")
          ? reply()
          : originalFetch(input, options);
      assert.equal((await post("/briefings/audio", body)).status, 502);
    }
    globalThis.fetch = async (input, options) => {
      if (String(input).startsWith("https://api.minimax.io/")) {
        await post("/observations", {
          incidentId: "voice-test",
          speaker: "B",
          text: "Rear entrance is blocked.",
        });
        return new Response(
          JSON.stringify({
            base_resp: { status_code: 0 },
            data: { status: 2, audio: "494433" },
          }),
        );
      }
      return originalFetch(input, options);
    };
    assert.equal((await post("/briefings/audio", body)).status, 409);
  }));
