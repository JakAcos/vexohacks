# Relay — Mission Orchestrator

**Latest verified path — November 14, 2026:** physical Vexo wristband → shared mission report → Gemini-selected request → real controlled test-service receipt → a second Gemini agent’s confirmed follow-up. Two consecutive physical rehearsals completed in **40.910 s** and **39.325 s**, with **zero manual retries**. Timing starts when the band is listening and includes speech and processing; pair the band beforehand.

**Start here: [five-hour team rundown and current state](TEAM_STATUS.md).** Then read the [two-minute stage runbook](STAGE_DEMO.md), [mission execution setup](MISSION_EXECUTION.md), and [sanitized physical-run evidence](docs/verification/physical-demo-2026-11-14.json). These describe the essential demo path on `main` in the [shared team repository](https://github.com/JakAcos/vexohacks) and [public mirror](https://github.com/dantegarcia654/relay-vexohacks).

**AI agents:** connect any MCP client to Relay with the [Relay MCP server](MCP.md).

[Earlier software demo](demo/Relay-Software-Demo-V1.mp4) · [Historical demo scope](demo/README.md) · [Checkpoint evidence index](CHECKPOINT_HANDOFF.md)

**R̳e̳l̳a̳y̳ i̳s̳ t̳h̳e̳ c̳e̳n̳t̳r̳a̳l̳ m̳i̳s̳s̳i̳o̳n̳ o̳r̳c̳h̳e̳s̳t̳r̳a̳t̳o̳r̳:̳ c̳o̳n̳t̳i̳n̳u̳o̳u̳s̳ c̳o̳n̳t̳e̳x̳t̳ f̳r̳o̳m̳ e̳v̳e̳r̳y̳ r̳e̳s̳p̳o̳n̳d̳e̳r̳’̳s̳ V̳e̳x̳o̳ b̳a̳n̳d̳ b̳e̳c̳o̳m̳e̳s̳ s̳h̳a̳r̳e̳d̳ u̳n̳d̳e̳r̳s̳t̳a̳n̳d̳i̳n̳g̳ a̳n̳d̳ c̳o̳o̳r̳d̳i̳n̳a̳t̳e̳d̳ a̳g̳e̳n̳t̳ a̳c̳t̳i̳o̳n̳s̳.̳**

The earlier three-hour notes are superseded by [TEAM_STATUS.md](TEAM_STATUS.md). For new coding-agent context, read that file before choosing work.

Relay brings responder context into one shared mission, then coordinates source-linked actions from that context. Police, firefighters, EMS and the 911 dispatcher contribute to the same mission record. The dashboard shows what was reported, what changed, what the coordinator requested, and what the service returned.

**Hackathon prototype.** Gemini transcription, report extraction, action planning and spoken briefing have been exercised with live provider calls. Emergency-service execution uses local simulated connectors. The optional test workflow below contacts a real local Test Desk; no emergency units or emails are contacted. Implementation and this documentation are AI-assisted.

## Essential demo: mission-driven execution

Gemini selects a bounded logistics request from a fresh band report. Relay saves the full request and source links, submits it to the controlled Test Desk, and verifies the destination-issued receipt. A distinct Gemini receipt-agent call uses that confirmed result and current mission context to plan a dependent follow-up. Both receipts remain in mission history.

The live rehearsal exposed competing report planners: repeated context changes exhausted a three-attempt limit and left the source report failed. Planning now runs one report at a time per mission, separately from intake and extraction, and re-evaluates automatically when context changes. Stale proposals are still rejected. Real provider failures remain visible; they never become silent demo-mode successes.

Use [STAGE_DEMO.md](STAGE_DEMO.md) to run the physical flow. `npm run mission:demo` starts the isolated Relay/test-desk pair on ports 14417/14418; the source band service remains on port 3001. It needs private Gemini configuration and an explicitly configured source mission. The launcher does not start a microphone.

The HTTP and browser workflows below are preserved capabilities. The AI-selected mission executor uses HTTP; it does **not** autonomously operate the browser worker.

## Verified dispatcher handoff

The optional [test-dispatch milestone](TEST_DISPATCH.md) now makes real HTTP submissions to a separate local test destination. Dispatcher A creates a ticket; Dispatcher B reads its confirmed result, submits a linked follow-up, and reads back the receipt. Relay displays both receipts. These are fixed, manually triggered test workers; existing emergency dispatch remains simulated. See the [updated catch-up and acceptance evidence](CHECKPOINT_HANDOFF.md).

After `npm ci` and `npm run build`, run `npm run demo:test-dispatch` for the isolated demo on port 14317. It uses synthetic requests, separate generated worker credentials and no model calls or physical band.

The optional [browser executor](BROWSER_ACTIONS.md) now fills the controlled destination form and clicks Submit for Dispatcher A. Relay displays before/after screenshots and destination receipts; B still independently verifies the result over HTTP. This is a fixed local browser workflow requiring the host’s owned-session allocator and Playwright Core. Mission-driven AI routing and physical-band-to-browser execution are not included.

## Start

Requires Node.js 24 or newer and npm.

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:3001. By default `AGENT_MODE=demo` uses labeled scenario rules. A locally configured `.env` can select Gemini. Preserve any existing `.env`; never overwrite or commit credentials.

For live Gemini, configure `AGENT_MODE=gemini`, `GEMINI_API_KEY` and `GEMINI_MODEL` using the locally verified model available to your account. Gemini supplies transcription, structured report extraction, coordination and speech. Optional `GEMINI_TTS_MODEL` selects the speech model. Deepgram transcription and MiniMax speech remain optional adapters, with separate configuration and labels.

Use `?incidentId=your-mission` on every participant's browser to share the same mission. IDs allow 1–64 letters, digits, underscores and hyphens. Different IDs isolate mission records. This prototype binds to this computer by default; other devices require a separately configured secure connection. It is not a public multi-user deployment.

## Earlier simulated emergency scenario

1. Open a new mission and select a source role in the voice controls. Allow the selected speech service and start the mission microphone once. Keep it running as reports arrive.
2. Firefighter: “Smoke coming from the second floor. A resident reports someone may still be upstairs.” The report retains its speaker, timestamp and uncertainty. The coordinator sends a team update.
3. Police: “Request an ambulance for two injured people.” The coordinator proposes an EMS request and links its source. Use a second browser/source session on the same mission, or the labeled rehearsal buttons to demonstrate another responder.
4. The dispatcher reviews the latest mission context and approves the request. The local simulated EMS connector returns a receipt. The receipt and approval remain in the mission record, including after a server restart.
5. Another responder reports the rear entrance blocked. The shared picture and team feed update. A repeated resource request links to the existing request instead of sending a duplicate.
6. Say “Relay, give me the latest briefing.” The app speaks the current briefing, then resumes capture automatically. It labels the capture pause during playback.
7. Give the resident correction: “The resident has located the missing person outside. The resident reports nobody else is missing.” Earlier evidence remains; unrelated hazards remain visible.

The rehearsal buttons are explicitly typed fictional inputs. The real microphone path uses the selected speech provider. Do not describe rehearsal clicks, synthetic audio, browser recognition or the Vexo simulator as physical wearable capture.

## Continuous context

Laptop Gemini/Deepgram input uses AudioWorklet PCM capture and independent WAV segments at pauses or approximately 12-second boundaries. The session continues without a per-report Start button. Browser speech recognition is a separately labeled alternative with reconnection support.

Requests are queued in order. Each finalized segment has a stable client event ID; retries reuse it. Failed and overflow segments are retained in browser memory for explicit retry. Backpressure or a disconnected microphone stops capture and reports the interruption. Briefing playback pauses that device's microphone to avoid feedback and resumes it afterward. Other mission sources can continue reporting.

Accepted reports and uploaded audio are persisted on disk before AI processing. Failed server jobs remain available for retry; unfinished jobs resume after restart. Unsent audio is in browser memory only: closing or reloading the tab can lose that backlog. This is not lossless two-hour recording, speaker identification, or a verified long-duration wearable deployment. Choose the correct source role for each input device/session.

## Agents and actions

- **Recorder:** Gemini extraction in live mode; transparent scenario parsing in demo mode. Stores source-linked reports and facts.
- **Situation tracker:** application logic maintains evidence, uncertainty, corrections and contradictions. Current structured topics emphasize the apartment-fire demo; other reports remain visible.
- **Coordinator:** Gemini proposes bounded actions using the shared mission and newest report, including recommended resource requests grounded in an unmet need. Recommendations remain source-linked and require dispatcher review. Demo mode uses affirmative resource-request rules. It can create a service request to EMS, fire or police, or send an automatic update to the mission team feed.
- **Executor:** local simulated connectors commit delivery receipts. Service requests require dispatcher approval against the current mission version. Automatic team updates preserve their sources. Concurrent approval retries return the original receipt.
- **Briefing:** source-based briefing text with optional Gemini or MiniMax speech. It is not a separate autonomous reasoning agent.

No arbitrary code, external URL, email address or tool name from an incident report can become an executable action. Transcription, extraction or planner failure preserves the saved audio/report, records a visible failed job and allows retry. There is no silent replacement of failed live planning with demo rules.

## Backend contract

JSON mutations require `Content-Type: application/json`. Raw audio routes accept supported audio bytes. Report intake returns HTTP 202 with durable saved state before AI completes. Follow `reportJobs` through SSE or GET for derived facts and actions; other operations return updated state unless noted.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Actual processing mode, role implementations, provider configuration presence. No credentials. |
| `GET /api/incidents/:id` | Saved mission with observations, issues, briefings, handovers, actions and agent events. |
| `GET /api/incidents/:id/events` | Live SSE snapshots; reconnect receives current state. |
| `POST /api/observations` | `{incidentId,speaker,text,inputKind?,clientEventId?}` → HTTP 202 with saved Incident and background job. |
| `POST /api/voice/turn` | `{incidentId,speaker,text,clientEventId?}` → HTTP 202 `{kind:observation,transcript,incident}` for reports; explicit briefing commands return HTTP 200. |
| `POST /api/voice/audio` | Raw audio with query `incidentId,speaker,provider,consent,clientEventId?`. Provider gemini/deepgram; consent must match provider. HTTP 202 returns `{kind:queued,jobId,transcript:"",incident}` after audio is saved. |
| `POST /api/actions/:id/approve` | `{incidentId,approvedBy,expectedVersion}`. Produces or returns the same simulated receipt. |
| `POST /api/actions/:id/dismiss` | `{incidentId,expectedVersion}`. Dismisses a pending action while retaining history. |
| `POST /api/observations/:id/plan` | `{incidentId}`. Retries coordination for an existing report without duplicate actions. |
| `POST /api/reports/:id/retry` | `{incidentId}` → HTTP 202; retries saved audio/report processing without another upload. |
| `POST /api/briefings` | `{incidentId}`. Generates a requested source-based briefing. |
| `POST /api/briefings/audio` | `{incidentId,briefingId,provider?}`. Current briefing audio; provider gemini/minimax. |
| `POST /api/handovers` | `{incidentId}`. Prepares a handover draft. |
| `POST /api/handovers/:id/approve` | `{incidentId,approvedBy,expectedVersion}`. Human-reviewed simulated handover. |
| `POST /api/incidents/:id/reset` | `{"confirm":"RESET SIMULATION"}`. Clears only that simulation. |

The Vexo audio bridge sends `inputKind=vexo-audio`, `bandNumber`, `deviceTransport` (ble/serial), and UTC `capturedAt` query fields. The transcript bridge uses `inputKind: vexo-transcript` and `sourceDevice: {kind: vexo, bandNumber, transport, capturedAt}` in JSON. These fields are only for actual band input; the simulator retains its explicit simulated type.

`clientEventId` is an optional UUID, unique per mission input event. Briefing commands also deduplicate this ID. Reuse the ID for a retry of the same report; never for a different report. Persistent state uses atomic JSON replacement in `./data` by default, serialized per mission. Use one backend process per data directory. Private remote access is available through PUBLIC_ORIGIN and RELAY_ACCESS_TOKEN; see CLOUD_DEPLOYMENT.md. Use one server process per data directory. Multi-process database coordination is outside this prototype.

## Vexo

The user assigned **band 38**. Use that exact identifier; never guess another band. The physical bridge is implemented in `scripts/vexo-live.py`; see [live bridge setup](VEXO_LIVE_BRIDGE.md). Close competing band clients and double-tap band 38 to make it discoverable before connecting. Two fresh physical-band-to-test-action rehearsals passed under one minute; see the current physical evidence. Longer continuous sessions and simultaneous bands remain separate acceptance work. Physical success requires an observed band connection and captured report, not merely a configured number. Device-labeled observations persist the band number, transport and capture time; the backend checks the configured team number. These are bridge-provided metadata, not independently signed hardware attestations.

The original `scripts/vexo-bridge.mjs` remains a **simulator-only** tap adapter releasing scripted text. `npm run vexo:check` validates SDK imports without a connection. `npm run vexo:sim` requires the assigned number but does not record physical audio. The documented band has no speaker; briefings play on the laptop or another verified output device.

Vexo and Gemini are the required product path. MiniMax, Meta and Deepgram are optional; do not imply a live integration or sponsor endorsement from availability alone.

## Validation and implementation

```sh
npm run typecheck
npm test
npm run build
```

Automated checks cover mission isolation, concurrent writes, source preservation, conflict handling, persistence, stale approvals, duplicate event/approval handling, simulated receipts, failed planning and retry, speech provider contracts, PCM segmentation and briefing command isolation. Browser and live-provider tests are separate evidence; passing unit tests does not establish physical band or human acceptance.

- `src/server/orchestrator.ts`: bounded Gemini/demo planning, source links, simulated delivery and audit.
- `src/server/store.ts`: per-mission persistence, evidence and duplicate-safe action approval.
- `src/server/app.ts`: HTTP/SSE and voice/action routes.
- `src/client/MissionActions.tsx`: requests, review, receipts and agent activity.
- `src/client/VoiceConsole.tsx`, `src/shared/continuous-audio.ts`, `public/voice-capture.js`: continuous capture and recovery.
- `src/server/voice.ts`: server-side provider adapters; keys stay on the backend.

## Immediate save and background AI

Report and audio intake now return HTTP 202 after a durable save; AI continues in the background. Follow job progress through the mission stream and the Saved reports panel. See [durable intake and API contract](BACKGROUND_REPORTS.md) for response shapes, failure recovery, and verification. The endpoint descriptions above describe completed results; do not assume facts/actions exist in an intake acknowledgment.
