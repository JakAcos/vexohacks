# First Responder Copilot

A wearable incident coordination system proposed for the November 14, 2026 Vexo hackathon.

**Status: working local text demo; wearable integration pending.** The backend, React dashboard, persistent incident record, source-based tracking, requested briefings, and human-approved simulated handover feed are implemented. Default processing is deterministic scenario logic, not live Gemini. Planning, implementation, and README preparation were AI-assisted.

> For a simulated emergency only. The prototype is intended to support communication and situational awareness. Humans make all operational decisions. No real emergency service is contacted during the demo.

## Run the local demo

Requires **Node.js 24 or newer** and npm. From this repository:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3001**. No API keys or band are needed. For development with live rebuilds, run `npm run dev` and open **http://127.0.0.1:5173** (backend stays on port 3001).

1. Use **Reset simulation** if there is already an incident.
2. Click **Smoke + possible occupant**, then **Rear entrance blocked**.
3. Click **Give me the latest briefing**. The resident's possible occupant remains unconfirmed.
4. Click **Resident locates missing person**, then **Update my briefing**. Only the resident occupant concern resolves, according to the resident; smoke and the blocked entrance remain active. Original reports remain in the timeline and source history.
5. Click **Prepare handover**, review the draft, enter the reviewer's name, check the review box, and approve it to the **simulated** team feed. An incident update invalidates an older draft.

You can also type speaker-tagged reports as Firefighter A or B. The narrow demo parser recognizes the staged scenario and basic smoke/entrance reports; other reports remain visible as unclassified questions requiring review. Conflicting reports are retained and flagged. It is not a general emergency reasoning system.

The dashboard receives live Server-Sent Events (SSE). Observation extraction time and the browser's last request round trip are measured locally and labeled separately. No voice-to-dashboard latency claim is made. **Read aloud on this computer** uses browser speech synthesis when available; it is not MiniMax or wearable playback.

## Backend contract

All mutations require `Content-Type: application/json`. The default UI incident ID is `apartment-demo`; IDs are 1–64 letters, digits, `_` or `-`. State is isolated by incident ID.

```sh
curl -X POST http://127.0.0.1:3001/api/observations \
  -H 'Content-Type: application/json' \
  -d '{"incidentId":"apartment-demo","speaker":"Firefighter B","text":"Rear entrance is blocked.","inputKind":"transcript"}'
```

`inputKind` is optional (`typed` by default); accepted values are `typed`, `transcript`, and `vexo-simulated-text`. Send only final transcripts once. There is no idempotency or transcript deduplication yet; retrying a committed observation creates another timeline entry.

| Endpoint                          | Request / response                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                 | Processing mode, role implementations, and Gemini configuration availability. Never returns credentials.                                                  |
| `GET /api/incidents/:id`          | Complete incident snapshot, including observations, evidence, briefing revisions and handovers.                                                           |
| `GET /api/incidents/:id/events`   | SSE `incident` events containing complete snapshots; reconnect gets the current state.                                                                    |
| `POST /api/observations`          | `{incidentId, speaker, text, inputKind?}` → committed incident (`201`).                                                                                   |
| `POST /api/briefings`             | `{incidentId}` → incident with a new requested briefing.                                                                                                  |
| `POST /api/handovers`             | `{incidentId}` → incident with an unapproved handover draft (`201`).                                                                                      |
| `POST /api/handovers/:id/approve` | `{incidentId, approvedBy, expectedVersion}` → approved local handover. Use the current incident `version`; stale or already-approved drafts return `409`. |
| `POST /api/incidents/:id/reset`   | `{"confirm":"RESET SIMULATION"}` → empty demo incident. Destructively clears this incident only.                                                          |

Validation errors return `400`, cross-origin writes `403`, unsupported content type `415`, and processing failures `500`. A failed extraction does not commit partial state. Mutations serialize per incident; atomic JSON file replacement preserves data across server restarts in `./data` (ignored by Git). Run **one backend process** per data directory. No multi-process database locking, authentication, or production deployment is provided. The server binds to loopback by default; do not expose this unauthenticated prototype to a network.

## Vexo simulator adapter

Reference: [Vexo Open kit](https://github.com/VexoAI-Org/vexo-open-kit). This project uses its `Band`, `SimTransport`, `on/off('tap')`, `configure({events:true})`, and `sim.tap('tap')` interfaces. The kit is a reference dependency, not the destination repository, and is never modified or committed here.

The team's band number is currently unknown. **Do not guess a number, including for the simulator.** Once the team supplies the number, put it in the ignored `.env` file using `VEXO_BAND_NUMBER`. Keep that single value for all connections.

```sh
# From this repository (the folder containing package.json):
git clone https://github.com/VexoAI-Org/vexo-open-kit.git vexo-open-kit
cp .env.example .env
# Edit .env: set VEXO_BAND_NUMBER to your own team's number from the bag.
# In one terminal, start the built app:
npm start
# In another terminal, run the simulator adapter:
npm run vexo:sim
```

The adapter refuses missing/invalid numbers, connects only with `SimTransport`, verifies the returned identity, configures events, and triggers three simulated taps. Each tap releases one **scripted text** report through `/api/observations`; it then requests the updated briefing. Keep the dashboard open to see the streamed updates. Reset the demo before replaying it. `VEXO_KIT_PATH` defaults to `./vexo-open-kit`; `COPILOT_URL` defaults to `http://127.0.0.1:3001`. Optional separate incident: `npm run vexo:sim -- --incident-id adapter-test` (view that incident at `http://127.0.0.1:3001/?incidentId=adapter-test`).

**This adapter does not capture or transcribe speech.** The kit's default simulated audio is silence, and its bundled speech recording is a fable, not the incident scenario. Our scripted text is explicitly labeled `vexo-simulated-text`. The adapter's event interface and HTTP flow are tested with a contract double; an actual kit connection has not been run while the team number is unknown.

For the later wearable bridge, use the kit's speech helper (`examples/python/speech.py`: `speech.listen(band, seconds)` or final transcript callbacks), then POST `{incidentId,speaker,text,inputKind:"transcript"}` to the endpoint above. Follow the kit's own number filtering, microphone/consent and Deepgram-key instructions. Deepgram and physical microphone capture remain pending; no key belongs in the React app. The kit documents **no speaker on the band**, so spoken briefings need the laptop or another separately verified audio device.

## Optional live Gemini extraction

Default: `AGENT_MODE=demo`. To opt in, create an ignored `.env` from `.env.example`, set `AGENT_MODE=gemini`, and configure `GEMINI_API_KEY` and `GEMINI_MODEL` locally. Choose a model available to your key from the [official model list](https://ai.google.dev/gemini-api/docs/models). Never paste keys into chat, commit them, or place them in frontend variables.

The backend uses the official [Interactions structured-output API](https://ai.google.dev/gemini-api/docs/structured-output), with a JSON schema and application-side validation. The dashboard explicitly shows **Gemini extraction** when enabled. Only recorder extraction uses the live model; tracking remains an evidence reducer and briefings remain source-based templates. No fake swarm or silent fallback runs. Startup fails if Gemini configuration is incomplete; request failures leave the observation uncommitted and show an error. Incident text leaves the computer for Google in this mode.

Live Gemini has not been exercised with credentials. Its request/response handling is covered by mocked contract tests, which do not establish real provider compatibility or extraction quality. Deepgram and MiniMax are planned, not integrated.

## Checks and implementation map

```sh
npm run typecheck
npm test
npm run build
```

Tests cover the resident correction and retained hazards/history; responder-vs-resident concern isolation; contradictions; disk persistence; failed extractions and concurrent writes; input validation; HTTP/SSE flow; stale and duplicate handover approvals; scoped resets; cross-origin rejection; Gemini response validation; and the tap-adapter-to-backend flow. Tests use temporary state folders and do not contact real emergency services or a live AI provider.

- `src/server/agents.ts`: recorder extraction providers and source-based briefing role.
- `src/server/store.ts`: shared store, situation tracking, history and handover approval.
- `src/server/app.ts`: validated HTTP endpoints and live SSE updates.
- `src/client/`: responsive team lead dashboard and demo controls.
- `scripts/vexo-bridge.mjs`: optional kit simulator connection; no physical-band access.

## Original design and demo plan

The following sections preserve the proposed hackathon plan. They describe intended voice/wearable capabilities as well as the implemented local text loop; the status and run instructions above define what is working now.

## The idea

A firefighter wears Vexo and speaks observations while a team lead follows a shared dashboard on a laptop or tablet. Three agent roles maintain the incident record, track changing conditions, and provide requested briefings. The dispatcher and the person needing help require no device.

Every role uses one shared incident store. Observations retain their speaker, original source, timestamp, and uncertainty. A resident's report remains a report rather than becoming an established fact.

## Three agent roles

| Role                  | Responsibility                                                                                                                                                              | Output                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Incident recorder** | Extract timestamped observations from speech while preserving speaker, source, and uncertainty.                                                                             | A live incident timeline.                    |
| **Situation tracker** | Maintain active hazards and unresolved questions, connect updates to earlier reports, flag contradictions rather than silently choosing between them, and preserve history. | Current incident state with source evidence. |
| **Briefing agent**    | Build a short recap when requested from the current incident state and prepare a draft handover for human review and approval.                                              | Voice and written updates.                   |

## Proposed stack

These are proposed components, not verified integrations.

| Component                             | Intended use                                                                      | Verification needed                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Vexo**                              | Wearable voice interaction.                                                       | Confirm actual microphone, activation, connectivity/bridge, and playback capabilities. |
| **Deepgram**                          | Speech recognition.                                                               | Confirm API access and recognition through the selected audio path.                    |
| **Google Gemini**                     | Structured extraction, situation tracking, and briefings.                         | Confirm API access and behavior on the staged incident.                                |
| **MiniMax**                           | Speech synthesis.                                                                 | Confirm API access, synthesis, and playback through a supported audio device.          |
| **TypeScript backend**                | Receive observations, run the three agent roles, store state, and stream updates. | Build and verify the end-to-end flow.                                                  |
| **React dashboard**                   | Display the timeline, hazards, unresolved questions, and briefing.                | Build and verify live updates.                                                         |
| **Lightweight shared incident store** | Keep observations, their sources, status changes, and briefing revisions.         | Verify traceable updates and preserved history.                                        |

The band would connect through a **verified phone or laptop bridge**; the supported route must be established before building around it. The initial scope has no camera dependency or on-device inference. Verify sponsor prize eligibility separately.

## Demo script — approximately two minutes

**Setup:** Clearly identify the scene as a simulated apartment fire. Firefighter A wears Vexo. A teammate plays Firefighter B using a second microphone. A laptop displays the team lead's dashboard. A performs a staged hands-busy task during updates.

1. **Open the incident.** A activates the supported input and says:

   > Start incident. Apartment building. Smoke assessment.

   The system opens the incident with an empty observation timeline and incident state, ready for reports.

2. **Record observations and uncertainty.** A says:

   > Smoke coming from the second floor. A resident reports someone may still be upstairs.

   The dashboard shows smoke reported by A and a possible occupant reported by a resident through A. Occupant status remains **unconfirmed**.

3. **Update from a second speaker.** B says:

   > Rear entrance is blocked.

   The timeline and hazards update with B as the source while A continues the staged hands-busy task.

4. **Request a briefing.** A asks:

   > Give me the latest briefing.

   The system speaks the following through a supported, verified audio device:

   > Second-floor smoke reported. Rear entrance reported blocked. A resident reports a possible occupant upstairs; occupant status is unconfirmed.

5. **Show the changing shared picture.** B says:

   > The resident has located the missing person outside. The resident reports nobody else is missing.

   The situation tracker connects this update to the earlier occupant concern and marks that concern **resolved according to the resident**, preserving both observations and their history. Smoke and the blocked entrance remain active. A asks:

   > Update my briefing.

   The recap reflects the changed occupant concern, keeps the resident attribution visible, and retains the active hazards.

6. **Prepare a human-approved handover.** The team lead clicks **Prepare handover**, reviews the draft, and approves it to a simulated shared team feed. No real emergency service is contacted.

## Build order

1. Verify Vexo input, activation, connectivity, and the phone/laptop bridge.
2. Build shared incident state and the live dashboard.
3. Connect speech recognition and the three agent roles.
4. Add requested spoken briefings through a verified playback path.
5. Rehearse the full demo and measure latency.

## Success criteria

The target is for a spoken observation to change the shared incident picture within seconds, with sources and uncertainty visible while the firefighter's hands remain free. Briefings should reflect later updates without erasing earlier reports, and handovers require human approval.

Latency has **not been measured**. End-to-end behavior and hardware compatibility must be tested before claiming the prototype meets these criteria.
