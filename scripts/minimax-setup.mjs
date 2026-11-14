// MiniMax setup helper. Reads MINIMAX_* from the ignored .env; never prints the key.
//   node scripts/minimax-setup.mjs status            which variables are set
//   node scripts/minimax-setup.mjs voices [filter]   list system voice IDs your key can use (default filter: English)
//   node scripts/minimax-setup.mjs test [voice_id]   synthesize one line to data/minimax-test.mp3 (uses MINIMAX_VOICE_ID if no arg)
// Same endpoint and body as src/server/voice.ts, so a passing test means the app's MiniMax briefing will work.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";

const API = "https://api.minimax.io/v1";
const [command = "status", arg] = process.argv.slice(2);
const key = process.env.MINIMAX_API_KEY?.trim();
const model = process.env.MINIMAX_MODEL?.trim();
const voice = (arg ?? process.env.MINIMAX_VOICE_ID)?.trim();

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}
function requireKey() {
  if (!key) fail("MINIMAX_API_KEY is empty. Paste your key into .env (platform.minimax.io → Account Management → API Keys), then rerun.");
}
async function call(path, body) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    fail("Could not reach api.minimax.io (timeout or network).");
  }
  const json = await response.json().catch(() => null);
  const code = json?.base_resp?.status_code;
  if (!response.ok || code !== 0) {
    const hint = { 1004: "authentication failed: check the key, and note that mainland-China keys use api.minimaxi.com, which this app does not call", 1002: "rate limited", 1039: "token rate limit", 2013: "invalid parameters: check MINIMAX_MODEL and the voice ID" }[code] ?? "";
    fail(`MiniMax ${path} failed: HTTP ${response.status}, status_code ${code ?? "none"} ${json?.base_resp?.status_msg ?? ""}${hint ? ` (${hint})` : ""}`);
  }
  return json;
}

if (command === "status") {
  for (const [name, value] of [["MINIMAX_API_KEY", key], ["MINIMAX_MODEL", model], ["MINIMAX_VOICE_ID", process.env.MINIMAX_VOICE_ID?.trim()]])
    console.log(`${value ? "✓" : "✗"} ${name}${value && name !== "MINIMAX_API_KEY" ? ` = ${value}` : value ? " is set" : " is empty"}`);
  console.log(key && model && process.env.MINIMAX_VOICE_ID?.trim() ? "All set. Run: node scripts/minimax-setup.mjs test" : "Fill the empty values in .env, then run the voices and test commands.");
} else if (command === "voices") {
  requireKey();
  const filter = (arg ?? "English").toLowerCase();
  const { system_voice = [] } = await call("/get_voice", { voice_type: "system" });
  const matches = system_voice.filter((v) => `${v.voice_id} ${v.voice_name} ${(v.description ?? []).join(" ")}`.toLowerCase().includes(filter));
  for (const v of matches) console.log(`${v.voice_id.padEnd(42)} ${v.voice_name ?? ""}${v.description?.length ? ` · ${v.description.join(", ")}` : ""}`);
  console.log(`\n${matches.length} of ${system_voice.length} system voices match "${filter}". Audition one with: node scripts/minimax-setup.mjs test <voice_id>`);
} else if (command === "test") {
  requireKey();
  if (!model) fail("MINIMAX_MODEL is empty. Set it in .env (for example speech-2.8-turbo for low latency or speech-2.8-hd for quality).");
  if (!voice) fail("No voice. Pass one (node scripts/minimax-setup.mjs test <voice_id>) or set MINIMAX_VOICE_ID in .env. List them with the voices command.");
  const text = "Simulated briefing. Second-floor smoke reported. Rear entrance reported blocked. Occupant status is unconfirmed.";
  const started = Date.now();
  const json = await call("/t2a_v2", {
    model, text, stream: false, output_format: "hex",
    voice_setting: { voice_id: voice, speed: 1, vol: 1, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
  });
  if (json?.data?.status !== 2 || !/^(?:[a-fA-F0-9]{2})+$/.test(json?.data?.audio ?? "")) fail("MiniMax answered without complete hex MP3 audio.");
  const audio = Buffer.from(json.data.audio, "hex");
  await mkdir("data", { recursive: true });
  await writeFile("data/minimax-test.mp3", audio);
  const info = json.extra_info ?? {};
  console.log(`✓ ${model} · ${voice} · ${audio.length} bytes · ${info.audio_length ?? "?"} ms audio · request took ${Date.now() - started} ms`);
  console.log("Saved data/minimax-test.mp3 (gitignored). Play it with: afplay data/minimax-test.mp3");
  if (arg && arg !== process.env.MINIMAX_VOICE_ID?.trim()) console.log(`Like it? Set MINIMAX_VOICE_ID=${arg} in .env and restart the server.`);
} else {
  fail(`Unknown command "${command}". Use status, voices or test.`);
}
