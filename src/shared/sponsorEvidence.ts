import type { Incident, Observation } from "./model.js";

// Configuration never counts as execution. Physical input also needs the
// device metadata persisted by the bridge, distinct from simulator text.
export function hasVexoDeviceSource(observation: Observation) {
  const device = observation.sourceDevice;
  return ["vexo-audio", "vexo-transcript"].includes(observation.inputKind) &&
    device?.kind === "vexo" && Number.isInteger(device.bandNumber) &&
    device.bandNumber >= 1 && device.bandNumber <= 999 &&
    ["ble", "serial"].includes(device.transport) && Number.isFinite(Date.parse(device.capturedAt));
}
export function sponsorEvidence(incident?: Incident) {
  const observations = incident?.observations ?? [];
  const vexo = observations.filter(o => o.inputKind === "vexo-simulated-text");
  const physical = observations.filter(hasVexoDeviceSource);
  const gemini = observations.filter(o => o.mode === "gemini" && o.factsReady !== false);
  return {
    vexo: vexo.at(-1), vexoCount: vexo.length,
    vexoPhysical: physical.at(-1), vexoPhysicalCount: physical.length,
    gemini: gemini.at(-1), geminiCount: gemini.length,
    latest: observations.at(-1),
  };
}
export function inputLabel(observation: Observation) {
  if (observation.inputKind === "vexo-simulated-text") return "Vexo simulator · scripted text";
  if (hasVexoDeviceSource(observation)) {
    const device = observation.sourceDevice!;
    return `Vexo band ${device.bandNumber} · ${device.transport.toUpperCase()} ${observation.inputKind === "vexo-audio" ? "audio" : "transcript"}`;
  }
  if (["vexo-audio", "vexo-transcript"].includes(observation.inputKind)) return "Vexo input · device source not verified";
  if (observation.inputKind === "transcript") return "Speech transcript · input device not verified here";
  return "Typed report";
}
