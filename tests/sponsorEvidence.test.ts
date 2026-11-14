import { test } from "node:test";
import assert from "node:assert/strict";
import { sponsorEvidence, inputLabel } from "../src/shared/sponsorEvidence.js";
import type { Incident, Observation } from "../src/shared/model.js";

const observation = (changes: Partial<Observation> = {}): Observation => ({
  id: "report-1", speaker: "Responder", text: "Smoke reported", timestamp: "2026-11-14T20:00:00Z",
  mode: "demo", inputKind: "typed", processingMs: 20, facts: [], ...changes,
});
const incident = (observations: Observation[]) => ({ observations } as Incident);

test("empty and browser/typed demo reports cannot establish sponsor execution", () => {
  assert.equal(sponsorEvidence().geminiCount, 0);
  const result = sponsorEvidence(incident([observation(), observation({inputKind: "transcript"})]));
  assert.equal(result.gemini, undefined);
  assert.equal(result.vexo, undefined);
  assert.equal(inputLabel(result.latest!), "Speech transcript · input device not verified here");
});

test("saved Gemini extraction is attributed independently of Vexo input", () => {
  const gemini = observation({id: "g", mode: "gemini"});
  const local = observation({id: "later", inputKind: "transcript"});
  const result = sponsorEvidence(incident([gemini, local]));
  assert.equal(result.gemini?.id, "g");
  assert.equal(result.geminiCount, 1);
  assert.equal(result.vexoCount, 0);
  assert.equal(result.latest?.id, "later");
});

test("Vexo simulation is never promoted to physical speech or Gemini execution", () => {
  const simulated = observation({inputKind: "vexo-simulated-text"});
  const result = sponsorEvidence(incident([simulated]));
  assert.equal(result.vexoCount, 1);
  assert.equal(result.geminiCount, 0);
  assert.match(inputLabel(simulated), /simulator · scripted text/);
  assert.equal(sponsorEvidence(incident([])).vexoCount, 0);
});
