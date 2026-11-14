import "dotenv/config";
import { createApp } from "./app.js";
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
const { app } = createApp({
  directory: process.env.DATA_DIR ?? "./data",
  mode,
  serveDist: true,
});
app.listen(port, host, () =>
  console.log(
    `Simulated incident backend: http://${host}:${port} · ${mode} extraction · no real dispatch`,
  ),
);
