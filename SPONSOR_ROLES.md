# Sponsor roles and demo evidence

Updated November 14, 2026 (Pacific). Agent-authored working record; implemented behavior, saved test evidence, and future goals are distinguished below.

## Product and priority

Relay is a **mission orchestrator**: responders contribute observations to shared mission context; the team sees changing conditions, requested assistance, and reviewable actions. Briefings are one output. Consequential dispatch remains subject to human approval; service acknowledgments in the demo are simulated.

Dante's latest direction: **Vexo and Google Gemini are the required sponsor priorities. MiniMax, Meta, and Deepgram are optional.** Do not add a provider merely to display its logo. MiniMax may contribute to narration for the recorded pitch video instead of becoming a runtime dependency. A complete official sponsor list, judging roles, and prize requirements still need separate confirmation.

## Each contribution, with proof

| Company | Specific role | What judges should see | Evidence and remaining limit |
| --- | --- | --- | --- |
| **Vexo — core** | Wearable entry point for a responder's observations into shared mission context. | Activate the wearable, contribute a report, and inspect its timestamped source and resulting mission update. Until physical integration works, visibly label the input **Vexo simulator · scripted text**. | SDK-compatible tap adapter exists in `scripts/vexo-bridge.mjs` and `scripts/vexo-tap.mjs`. `inputKind: vexo-simulated-text` identifies its scripted reports. Actual simulator connection still needs the team's assigned band number; physical audio is unverified. A transcript from a laptop is not evidence of Vexo use. |
| **Google Gemini — core** | Extracts structured, attributed observations from incoming reports; the consolidated app also uses Gemini for audio transcription and spoken output. Mission tracking/action orchestration must retain attribution to the implementation that actually performs it. | Speak a report, show the recognized text and Gemini's extracted observations, then show the shared mission change. Inspect the actual result rather than only a provider logo. | Recorder: `src/server/agents.ts`; audio adapters in the consolidation owner's `src/server/voice.ts`. Saved live test evidence shows a synthetic spoken report → incident observation, a spoken command → briefing, and a returned WAV. This verifies real provider responses on a synthetic fixture, not a physical band or human microphone test. |
| **MiniMax — optional** | Potential speech generation for the **recorded pitch/demo video**. Runtime briefing speech is optional. | If actually used, credit the specific narrated segment in the video or closing credits: “Narration generated with MiniMax.” | Existing speech adapter has mocked contract coverage. No MiniMax-generated pitch asset is recorded here. Record the model/voice, generated artifact, and final video time range before claiming use. Browser/Gemini voice is not MiniMax. |
| **Meta — optional design influence** | Wearable design questions: useful hands-busy interaction, distributed compute, and recurring user value. | Demonstrate a responder receiving or contributing an update while occupied with a staged task. | No Meta hardware, SDK, API, or model integration established. Describe design influence only; do not display a live Meta execution badge. |
| **Deepgram — optional** | Alternative speech-to-text adapter if it improves the demo. Gemini audio can satisfy the current core path. | If selected and successfully used, show the resulting transcript with Deepgram attribution. | Adapter in `src/server/voice.ts`; live Deepgram calls not established in this log. Configuration and mocked tests do not establish runtime use. |

## Visible proof in the app

`src/client/SponsorEvidence.tsx` displays Vexo and Gemini cards driven by **committed observations**, plus an inspectable receipt containing the source report, speaker, timestamp, structured result, and measured extraction duration. It updates when the shared incident feed updates. Empty state, disconnected feed, local scenario processing, and scripted Vexo input remain explicit.

- Vexo credit requires the recorded Vexo simulator input type. The UI never promotes it to physical audio.
- Gemini extraction credit requires a saved observation with `mode: gemini`; merely enabling Gemini does not count.
- Receipts are historical application records, not cryptographically signed provider attestations. A reconnect can display past results. The current mode is shown separately.
- Optional providers do not receive unused logo tiles. Audio attribution belongs beside the actual audio operation; this panel claims only input and extraction evidence.
- Mission tracking, approval, service-request generation, and simulated acknowledgments must be labeled with their actual implementation. Do not describe local rules as a Gemini agent swarm.

Integration: import `SponsorEvidence` from `./SponsorEvidence` in the main React view and render `<SponsorEvidence incident={state} mode={health?.mode} connected={connected} />` in the visible presentation flow. Its stylesheet is imported by the component. The shared visual owner controls this mount to avoid concurrent edits.

## Pitch sequence

1. Show the need: responders are busy, but the whole team needs shared context.
2. Input through Vexo if verified; otherwise explicitly demonstrate the simulator and state the hardware gap.
3. Show Gemini's actual extraction and source evidence. Let judges inspect a new report, not only a rehearsed success indicator.
4. Show that report changing mission context and a proposed service action. Review/approve consequential actions; label simulated acknowledgment.
5. Request an updated briefing. Credit the actual speech provider used.
6. Close with the specific contribution: “Vexo is the intended wearable entry point; Gemini turns reports into usable shared context.” Change the Vexo wording to present tense only after physical proof.

## Live Gemini evidence inspected

The consolidation owner's saved `live-loop-evidence.json` reports `passed: true` and explicitly labels its input a synthetic spoken recording, not a physical microphone. Inspected November 14:

| Operation | Recorded elapsed time | Result |
| --- | --- | --- |
| Synthetic spoken smoke/occupant report | 8,085 ms | Transcript returned; one observation committed. |
| Synthetic spoken briefing request | 2,453 ms | Recognized as a briefing command; observation count remained one. |
| Spoken briefing generation | 4,994 ms | 526,108 bytes of `audio/wav` returned. |

These are individual fixture timings, not latency benchmarks or evidence of continuous real-world capture. Local source: `/Users/dantegarcia/Documents/Codex/2026-11-14/okay-brief-me-on-where-we/work/live-loop-evidence.json`. Provider keys and recordings are excluded from this documentation commit.

## Google's new agent feature

The user's exact feature reference remains unconfirmed. One plausible match is **Antigravity `/swarm`**, announced November 10: Google's development agent team workflow. See [official announcement](https://antigravity.google/blog/gemini-4-carbon-in-google-antigravity) and [swarm documentation](https://antigravity.google/docs/swarm). This is distinct from an application using Gemini inference. Google's [Agent Development Kit](https://adk.dev/) supports building application agent workflows, but this app does not currently claim ADK or Antigravity integration. Do not replace the working demo with a new framework based on an uncertain name.

## Update log and acceptance

- November 14: replaced the earlier all-sponsors framing with Vexo/Gemini core, optional others, and MiniMax pitch-video option; aligned the narrative to mission orchestration.
- November 14: implemented observation-derived sponsor evidence UI; tests reject false credit for typed/browser demo inputs and distinguish simulator input from Gemini extraction.
- Pending: assigned Vexo number and actual hardware/bridge verification; human microphone rehearsal; full presentation walkthrough after integration; optional MiniMax video asset only if useful.
- For each new proof append revision, input type, exact operation, result, measured timing definition, and redacted evidence artifact. Keep credentials out of the record.
