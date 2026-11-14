import type { Incident, Observation } from "./model.js";

// Only committed observations count. Configuration is not execution evidence.
export function sponsorEvidence(incident?: Incident) {
  const observations = incident?.observations ?? [];
  const vexo = observations.filter(o => o.inputKind === "vexo-simulated-text");
  const gemini = observations.filter(o => o.mode === "gemini");
  return {
    vexo: vexo.at(-1), vexoCount: vexo.length,
    gemini: gemini.at(-1), geminiCount: gemini.length,
    latest: observations.at(-1),
  };
}

export function inputLabel(observation: Observation) {
  if (observation.inputKind === "vexo-simulated-text") return "Vexo simulator · scripted text";
  if (observation.inputKind === "transcript") return "Speech transcript · input device not verified here";
  return "Typed report";
}
