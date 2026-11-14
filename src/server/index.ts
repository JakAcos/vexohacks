import { validateAccess } from "./access.js";
import "dotenv/config";
import { createApp } from "./app.js";
import { testDispatchConfig } from "./test-dispatch.js";
const mode = process.env.AGENT_MODE ?? "demo";
if (mode !== "demo" && mode !== "gemini")
  throw new Error("AGENT_MODE must be demo or gemini.");
if (
  mode === "gemini" &&
  (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL)
)
  throw new Error("Gemini mode requires GEMINI_API_KEY and GEMINI_MODEL.");
const port = Number(process.env.PORT ?? 3001),
  host = process.env.HOST ?? "127.0.0.1";
const access = validateAccess({ publicOrigin: process.env.PUBLIC_ORIGIN, accessToken: process.env.RELAY_ACCESS_TOKEN });
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !access.publicOrigin)
  throw new Error("A non-loopback server requires private remote access configuration.");
const { app, store, ready, bandSession, dispatch } = createApp({
  access,
  directory: process.env.DATA_DIR ?? "./data",
  mode,
  serveDist: true,
  testDispatch: testDispatchConfig(),
});
await ready;
const server = app.listen(port, host, () =>
  console.log(
    `Simulated incident backend: http://${host}:${port} · ${mode} extraction · no real dispatch`,
  ),
);

const shutdown = () => {
  bandSession.stop();
  server.close(() => {});
  void Promise.all([store.close(), dispatch.close()]).then(() => process.exit(0));
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
