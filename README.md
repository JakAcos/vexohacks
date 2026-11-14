# First Responder Copilot

A wearable incident coordination system proposed for the November 14, 2026 Vexo hackathon.

**Status: prototype plan.** This repository currently documents the intended build and demo; it does not contain an implemented or verified system. Planning and README preparation were AI-assisted.

> For a simulated emergency only. The prototype is intended to support communication and situational awareness. Humans make all operational decisions. No real emergency service is contacted during the demo.

## The idea

A firefighter wears Vexo and speaks observations while a team lead follows a shared dashboard on a laptop or tablet. Three agent roles maintain the incident record, track changing conditions, and provide requested briefings. The dispatcher and the person needing help require no device.

Every role uses one shared incident store. Observations retain their speaker, original source, timestamp, and uncertainty. A resident's report remains a report rather than becoming an established fact.

## Three agent roles

| Role | Responsibility | Output |
| --- | --- | --- |
| **Incident recorder** | Extract timestamped observations from speech while preserving speaker, source, and uncertainty. | A live incident timeline. |
| **Situation tracker** | Maintain active hazards and unresolved questions, connect updates to earlier reports, flag contradictions rather than silently choosing between them, and preserve history. | Current incident state with source evidence. |
| **Briefing agent** | Build a short recap when requested from the current incident state and prepare a draft handover for human review and approval. | Voice and written updates. |

## Proposed stack

These are proposed components, not verified integrations.

| Component | Intended use | Verification needed |
| --- | --- | --- |
| **Vexo** | Wearable voice interaction. | Confirm actual microphone, activation, connectivity/bridge, and playback capabilities. |
| **Deepgram** | Speech recognition. | Confirm API access and recognition through the selected audio path. |
| **Google Gemini** | Structured extraction, situation tracking, and briefings. | Confirm API access and behavior on the staged incident. |
| **MiniMax** | Speech synthesis. | Confirm API access, synthesis, and playback through a supported audio device. |
| **TypeScript backend** | Receive observations, run the three agent roles, store state, and stream updates. | Build and verify the end-to-end flow. |
| **React dashboard** | Display the timeline, hazards, unresolved questions, and briefing. | Build and verify live updates. |
| **Lightweight shared incident store** | Keep observations, their sources, status changes, and briefing revisions. | Verify traceable updates and preserved history. |

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
