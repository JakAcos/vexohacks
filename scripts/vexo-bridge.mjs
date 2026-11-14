import "dotenv/config";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runTapBridge } from "./vexo-tap.mjs";
const { values } = parseArgs({
  options: { "incident-id": { type: "string", default: "apartment-demo" } },
});
try {
  const raw = process.env.VEXO_BAND_NUMBER ?? "";
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > 999)
    throw new Error(
      "Set VEXO_BAND_NUMBER to your own team number from the bag (1–999). No band number is guessed, even in simulation.",
    );
  const number = Number(raw);
  const { Band, SimTransport } = await import(
    pathToFileURL(
      resolve(
        process.env.VEXO_KIT_PATH ?? "./vexo-open-kit",
        "js/src/index.js",
      ),
    ).href
  );
  const sim = new SimTransport(number, { autoTap: false });
  const band = await Band.connect(number, { transport: sim });
  if (band.number !== number) {
    await band.disconnect();
    throw new Error("Wrong band identity; disconnected.");
  }
  console.log(
    `Connected to ${band.name} · simulator only. No microphone, Bluetooth, or real band is used.`,
  );
  console.log(
    "Simulated tap events release scripted incident text. This is NOT transcribed audio.",
  );
  try {
    await runTapBridge(band, {
      base: process.env.COPILOT_URL ?? "http://127.0.0.1:3001",
      incidentId: values["incident-id"],
      trigger: () => sim.tap("tap"),
    });
  } finally {
    await band.disconnect();
  }
} catch (error) {
  console.error(
    `Vexo bridge: ${error.code === "ERR_MODULE_NOT_FOUND" ? "Clone the Vexo kit into ./vexo-open-kit first; see README." : error.message}`,
  );
  process.exitCode = 1;
}
