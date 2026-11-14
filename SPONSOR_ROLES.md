# Sponsor roles and demo evidence

Updated November 14, 2026 (Pacific). Agent-authored working record; implemented behavior, saved test evidence, and future goals are distinguished below.

## Product and priority

Relay is a **mission orchestrator**: responders contribute observations to shared mission context; the team sees changing conditions, requested assistance, and reviewable actions. Briefings are one output. Consequential dispatch remains subject to human approval; service acknowledgments in the demo are simulated.

Dante's latest direction: **Vexo and Google Gemini are the required sponsor priorities. MiniMax, Meta, and Deepgram are optional.** Do not add a provider merely to display its logo. MiniMax may contribute to narration for the recorded pitch video instead of becoming a runtime dependency. A complete official sponsor list, judging roles, and prize requirements still need separate confirmation.

## Each contribution, with proof

| Company | Specific role | What judges should see | Evidence and remaining limit |
| --- | --- | --- | --- |
| **Vexo — core** | Wearable entry point for a responder's observations into shared mission context. | Activate band 38, contribute a report, and inspect its timestamped physical source and resulting mission update. Scripted inputs must still be labeled **Vexo simulator · scripted text**. | SDK-compatible tap adapter exists in `scripts/vexo-bridge.mjs` and `scripts/vexo-tap.mjs`. `inputKind: vexo-simulated-text` identifies its scripted reports. Physical band 38 BLE speech passed bounded and continuous capture tests on November 14, including a new source-linked fire request and simulated receipt after the repaired build restarted. See the dated acceptance below. A transcript from a laptop is not evidence of Vexo use. |
| **Google Gemini — core** | Extracts structured, attributed observations from incoming reports; the consolidated app also uses Gemini for audio transcription and spoken output. The running shared backend reports a Gemini action planner for mission coordination, with an evidence reducer and local simulated service connectors handling state and execution. | Speak a report, show the recognized text and Gemini's extracted observations, then show the shared mission change. Inspect the actual result rather than only a provider logo. | Recorder: `src/server/agents.ts`; audio adapters in the consolidation owner's `src/server/voice.ts`. Saved live test evidence shows a synthetic spoken report → incident observation, a spoken command → briefing, and a returned WAV. That earlier fixture verifies real provider responses on synthetic audio. The later physical band acceptance below additionally verifies human speech through Gemini transcription, extraction and planning. |
| **MiniMax — optional** | Potential speech generation for the **recorded pitch/demo video**. Runtime briefing speech is optional. | If actually used, credit the specific narrated segment in the video or closing credits: “Narration generated with MiniMax.” | Existing speech adapter has mocked contract coverage. No MiniMax-generated pitch asset is recorded here. Record the model/voice, generated artifact, and final video time range before claiming use. Browser/Gemini voice is not MiniMax. |
| **Meta — optional design influence** | Wearable design questions: useful hands-busy interaction, distributed compute, and recurring user value. | Demonstrate a responder receiving or contributing an update while occupied with a staged task. | No Meta hardware, SDK, API, or model integration established. Describe design influence only; do not display a live Meta execution badge. |
| **Deepgram — optional** | Alternative speech-to-text adapter if it improves the demo. Gemini audio can satisfy the current core path. | If selected and successfully used, show the resulting transcript with Deepgram attribution. | Adapter in `src/server/voice.ts`; live Deepgram calls not established in this log. Configuration and mocked tests do not establish runtime use. |

## Visible proof in the app

`src/client/SponsorEvidence.tsx` displays Vexo and Gemini cards driven by **committed observations**, plus an inspectable receipt containing the source report, speaker, timestamp, structured result, and measured extraction duration. It updates when the shared incident feed updates. Empty state, disconnected feed, local scenario processing, and scripted Vexo input remain explicit.

- Vexo simulator credit requires the simulated input type. Physical source credit is separate: saved vexo-audio/vexo-transcript observations must include band number, physical transport and capture time. Those are bridge-reported metadata, not independently signed attestations. A connection or nonempty audio buffer alone is not proof of intelligible speech.
- Gemini extraction credit requires a saved observation with `mode: gemini`; merely enabling Gemini does not count.
- Receipts are historical application records, not cryptographically signed provider attestations. A reconnect can display past results. The current mode is shown separately.
- Optional providers do not receive unused logo tiles. Audio attribution belongs beside the actual audio operation; this panel claims only input and extraction evidence.
- Mission tracking, approval, service-request generation, and simulated acknowledgments must be labeled with their actual implementation. Do not describe local rules as a Gemini agent swarm.

Integration: import `SponsorEvidence` from `./SponsorEvidence` in the main React view and render `<SponsorEvidence incident={state} mode={health?.mode} connected={connected} />` in the visible presentation flow. Its stylesheet is imported by the component. The shared visual owner controls this mount to avoid concurrent edits.

## Pitch sequence

1. Show the need: responders are busy, but the whole team needs shared context.
2. Input through verified physical band 38. If using scripted fallback, explicitly label it as the simulator.
3. Show Gemini's actual extraction and source evidence. Let judges inspect a new report, not only a rehearsed success indicator.
4. Show that report changing mission context and a proposed service action. Review/approve consequential actions; label simulated acknowledgment.
5. Request an updated briefing. Credit the actual speech provider used.
6. Close with the demonstrated contribution: “Vexo captures spoken reports; Gemini turns them into shared mission context and reviewable actions.” Keep simulated dispatch clearly labeled.

## Live Gemini evidence inspected

The consolidation owner's saved `live-loop-evidence.json` reports `passed: true` and explicitly labels its input a synthetic spoken recording, not a physical microphone. Inspected November 14:

| Operation | Recorded elapsed time | Result |
| --- | --- | --- |
| Synthetic spoken smoke/occupant report | 8,085 ms | Transcript returned; one observation committed. |
| Synthetic spoken briefing request | 2,453 ms | Recognized as a briefing command; observation count remained one. |
| Spoken briefing generation | 4,994 ms | 526,108 bytes of `audio/wav` returned. |

These are individual fixture timings, not latency benchmarks or evidence of continuous real-world capture. Local source: `/Users/dantegarcia/Documents/Codex/2026-11-14/okay-brief-me-on-where-we/work/live-loop-evidence.json`. Provider keys and recordings are excluded from this documentation commit.

## Update log and acceptance

- November 14: replaced the earlier all-sponsors framing with Vexo/Gemini core, optional others, and MiniMax pitch-video option; aligned the narrative to mission orchestration.
- November 14: shared health endpoint verified Gemini extraction and action-planner mode, plus local simulated service execution; band 38 is assigned. Visual owner mounted the evidence panel in the canonical app and retained it in presentation mode.
- November 14: implemented observation-derived sponsor evidence UI; tests reject false credit for typed/browser demo inputs and distinguish simulator input from Gemini extraction.
- November 14: bounded and continuous physical band 38 speech verified; final repaired build produced a source-linked fire request and team update, with simulated receipts preserved through reload and duplicate approval.
- Pending: multi-hour physical endurance testing, externally hosted deployment, full presentation rehearsal, and optional MiniMax video asset only if useful.
- For each new proof append revision, input type, exact operation, result, measured timing definition, and redacted evidence artifact. Keep credentials out of the record.

## Mission action evidence

A separate live Gemini test passed on November 14: a police report produced a source-linked EMS request; a firefighter report produced automatic team updates; dispatcher approval produced a persisted simulated EMS receipt; retrying the approval returned the same receipt. First report extraction plus planning took 11,478 ms in this single test. All service connectors remained local simulations. Source: root mission-orchestrator chat work/live-actions-evidence.json.

## Physical acceptance — November 14, 2026

The first band scan failed, but subsequent physical tests succeeded. This replaces the earlier unverified status; it does not imply every spoken phrase was recognized correctly.

- **Bounded capture:** band 38 over BLE produced 44.92 seconds and 14.92 seconds of decoded audio in two tests. A saved Gemini observation (`e3990732-8b87-4e33-b901-1ab8d3815093`) produced a source-linked EMS proposal and acknowledged simulated team update. The opening band identifier was misrecognized; the ambulance request clause was recognized. Evidence: local QA artifact `band38-verification.json`.
- **Continuous capture:** the pre-update physical session ran 484.18 seconds, received 24,201 packets with zero recorded packet gaps, and saved all 27 segments before the approved pause. Capture resumed on the repaired build at 13:46:29 Pacific. Evidence: local QA artifact `band38-continuous-verification.json`. A synthetic 20-minute stream test is separate evidence, not a physical endurance result.
- **Fresh report after repair:** at 13:47:07 Pacific, physical observation `f80a2e78-ae19-4797-9867-7044fd2f53a5` produced a fire request and automatic team update through Gemini. Its background transcription, extraction and planning completed in 12,753 ms in this single sample; this is processing time, not save acknowledgment latency.
- **Approval and persistence:** Codex QA approved the simulated fire request at 13:48:10 Pacific. Receipt `sim-d445f201-e9cc-4fe3-8cfe-a498976690b6` remained linked to its source report after reload. Repeating approval returned the same receipt and created only one receipt event; continuous listening stayed active. Evidence: local QA artifact `final-e2e/build-2/final-action-proof.json`.
- **Recovery:** the corrected build preserved all 17 prior observations, 27 jobs and four actions with receipts, restored report/evidence order, and passed 58 Node tests plus 19 Python tests (one optional SDK test skipped). Evidence: `final-e2e/build-2/restoration-proof.json` and the runtime verification records.

The new entrance-clearance fact was saved, but the overall entrance issue remains conflicting under the existing conservative reducer for human review. Do not claim it was automatically cleared. Physical operation has been observed for minutes, not a multi-hour soak. Real emergency services are not connected; all dispatch receipts above are simulated. No externally hosted deployment is established. Generated speech plays on the computer; the band has no speaker.
