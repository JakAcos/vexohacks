// Interface shared by the real kit simulator and the contract test's event source.
// Scripted text represents the future speech-to-text boundary; it is never called microphone capture.
export const reports = [
  {
    speaker: "Firefighter A",
    text: "Smoke coming from the second floor. A resident reports someone may still be upstairs.",
  },
  { speaker: "Firefighter B", text: "Rear entrance is blocked." },
  {
    speaker: "Firefighter B",
    text: "The resident has located the missing person outside. The resident reports nobody else is missing.",
  },
];
export async function runTapBridge(
  band,
  { base, incidentId, trigger, delayMs = 1200 },
) {
  const url = new URL(base);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.protocol !== "http:"
  )
    throw new Error("The demo bridge only posts to a local HTTP backend.");
  const post = async (path, body) => {
    const response = await fetch(new URL(`/api${path}`, base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? `Backend status ${response.status}`);
    return result;
  };
  for (const report of reports) {
    let cleanup = () => {};
    const tapped = new Promise((resolve, reject) => {
      const handler = () => {
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for the simulated tap."));
      }, 5000);
      cleanup = () => {
        clearTimeout(timer);
        band.off("tap", handler);
      };
      band.on("tap", handler);
    });
    try {
      await band.configure({ events: true });
      trigger();
      await tapped;
    } finally {
      cleanup();
    }
    const start = performance.now();
    await post("/observations", {
      incidentId,
      ...report,
      inputKind: "vexo-simulated-text",
    });
    console.log(
      `${report.speaker} scripted observation committed · ${Math.round(performance.now() - start)} ms round trip`,
    );
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const state = await post("/briefings", { incidentId });
  console.log("Requested briefing:", state.briefings.at(-1).text);
  return state;
}
