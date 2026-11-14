import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";

const root = resolve(import.meta.dirname, ".."), data = resolve(process.env.RELAY_TEST_DEMO_DIR ?? resolve(root, ".test-dispatch-demo"));
const relayPort = Number(process.env.RELAY_TEST_DEMO_PORT ?? 14317), deskPort = Number(process.env.TEST_DESK_PORT ?? 14318);
if (relayPort === deskPort || ![relayPort, deskPort].every(p => Number.isInteger(p) && p > 1024 && p < 65536)) throw new Error("Choose two distinct unprivileged ports.");
for (const port of [relayPort, deskPort]) await new Promise((resolve, reject) => {
  const probe = createServer(); probe.once("error", reject); probe.listen(port, "127.0.0.1", () => probe.close(resolve));
});
await mkdir(data, { recursive: true });
const credentialsPath = resolve(data, "worker-credentials.json");
let credentials;
try { credentials = JSON.parse(await readFile(credentialsPath, "utf8")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  credentials = { a: randomBytes(32).toString("hex"), b: randomBytes(32).toString("hex") };
  await writeFile(credentialsPath, JSON.stringify(credentials), { mode: 0o600, flag: "wx" });
}
const env = { ...process.env, AGENT_MODE: "demo", HOST: "127.0.0.1", PORT: String(relayPort), TEST_DESK_PORT: String(deskPort),
  DATA_DIR: resolve(data, "relay"), TEST_DESK_DATA_DIR: resolve(data, "destination"),
  RELAY_TEST_DESK_ORIGIN: `http://127.0.0.1:${deskPort}`,
  RELAY_TEST_DISPATCH_A_TOKEN: credentials.a, RELAY_TEST_DISPATCH_B_TOKEN: credentials.b,
  // No physical devices or paid model calls in this separate acceptance instance.
  VEXO_BAND_NUMBER: "", GEMINI_API_KEY: "", GEMINI_MODEL: "", DEEPGRAM_API_KEY: "", MINIMAX_API_KEY: "", PUBLIC_ORIGIN: "", RELAY_ACCESS_TOKEN: "", DOTENV_CONFIG_PATH: resolve(data, "unused.env"),
};
const children = [];
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill("SIGTERM"); }
for (const entry of ["test-desk-main.js", "index.js"]) {
  const child = spawn(process.execPath, [resolve(root, "build-server/server", entry)], { cwd: root, env, stdio: "inherit" });
  children.push(child);
  child.on("error", error => { console.error(error.message); process.exitCode = 1; stop(); });
  child.on("exit", code => { if (!stopping) { process.exitCode = code || 1; stop(); } });
}
process.once("SIGINT", stop); process.once("SIGTERM", stop);
console.log(`Open http://127.0.0.1:${relayPort}/?incidentId=test-dispatch-demo#test-dispatch`);
console.log("Separate synthetic mission and test destination. Existing Relay/band sessions are untouched. Ctrl+C stops these two processes; receipts survive restart.");
