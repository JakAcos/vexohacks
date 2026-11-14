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

test("physical Vexo records require device metadata and stay separate from simulator reports", () => {
  const physical = observation({id: "physical", inputKind: "vexo-audio", sourceDevice: {kind: "vexo", bandNumber: 38, transport: "ble", capturedAt: "2026-11-14T20:00:00Z"}});
  const simulated = observation({id: "simulated", inputKind: "vexo-simulated-text"});
  const result = sponsorEvidence(incident([physical, simulated]));
  assert.equal(result.vexoPhysical?.id, "physical");
  assert.equal(result.vexoPhysicalCount, 1);
  assert.equal(result.vexoCount, 1);
  assert.equal(result.vexo?.id, "simulated");
  assert.match(inputLabel(physical), /Vexo band 38 · BLE audio/);
  assert.equal(result.geminiCount, 0);
});

test("missing or invalid physical metadata cannot establish band execution", () => {
  const missing = observation({inputKind: "vexo-transcript"});
  const invalid = observation({inputKind: "vexo-audio", sourceDevice: {kind: "vexo", bandNumber: 0, transport: "serial", capturedAt: "not-a-time"}});
  const typed = observation({sourceDevice: {kind: "vexo", bandNumber: 38, transport: "ble", capturedAt: "2026-11-14T20:00:00Z"}});
  assert.equal(sponsorEvidence(incident([missing, invalid, typed])).vexoPhysicalCount, 0);
  assert.match(inputLabel(missing), /device source not verified/);
  assert.equal(inputLabel(typed), "Typed report");
});
