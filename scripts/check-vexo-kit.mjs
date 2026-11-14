import "dotenv/config";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try {
  const kit = await import(
    pathToFileURL(
      resolve(
        process.env.VEXO_KIT_PATH ?? "./vexo-open-kit",
        "js/src/index.js",
      ),
    ).href
  );
  if (
    typeof kit.Band?.connect !== "function" ||
    typeof kit.SimTransport !== "function"
  )
    throw new Error("Kit must export Band.connect and SimTransport.");
  console.log(
    "Vexo SDK imports successfully. Band.connect and SimTransport are available. No band was constructed or connected; the team number is still required for vexo:sim.",
  );
} catch (error) {
  console.error(
    `Vexo SDK check: ${error.code === "ERR_MODULE_NOT_FOUND" ? "Clone the official kit into ./vexo-open-kit or set VEXO_KIT_PATH." : error.message}`,
  );
  process.exitCode = 1;
}
