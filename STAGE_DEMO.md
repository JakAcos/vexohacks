# Relay: two-minute stage demo

Current essential path, November 14, 2026. Agent-authored runbook based on two user-spoken physical rehearsals: **40.910 s** and **39.325 s**, without manual retries. See [current status](TEAM_STATUS.md) and [evidence](docs/verification/physical-demo-2026-11-14.json).

## Before the presentation

Use the verified local band → mission → Test Desk path. Pair/discover the assigned band before the timed minute. The demonstrated services run locally and call Gemini; do not describe this as a verified cloud-hosted deployment. No Vexo phone app is required for the verified laptop Bluetooth bridge, and another app holding the band can prevent connection.

On the demo laptop, preserve the running services and successful mission. Do not launch a second service on their ports or delete the proof. The preserved rehearsal is `band-demo-final-01` and its results are at `http://127.0.0.1:14417/?incidentId=band-demo-final-01#mission-actions`. The physical capture controls are on port 3001. Listening was stopped after both rehearsals.

For a fresh installation or deliberately prepared new mission:

1. Use Node 24+, install with `npm ci`, run `npm test`, then `npm run build`.
2. Configure a private `.env` with `AGENT_MODE=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL`, the team's assigned `VEXO_BAND_NUMBER` (38 for the tested setup), and absolute `VEXO_KIT_PATH` / `VEXO_PYTHON` paths. Follow [VEXO_LIVE_BRIDGE.md](VEXO_LIVE_BRIDGE.md) for the official kit and Python dependencies. Never commit keys or another machine's absolute paths.
3. Confirm ports 3001, 14417 and 14418 are free before starting new instances. Use separate source/executor data directories and one process per directory.
4. Choose a **fresh mission ID** for this rehearsal. The examples use `relay-stage-01`; change it everywhere if it already contains history.

Terminal A, from the repository root:

```sh
HOST=127.0.0.1 PORT=3001 AGENT_MODE=gemini DATA_DIR=./data-source npm start
```

Terminal B, from the same root, after the source is healthy:

```sh
RELAY_GEMINI_ENV_FILE="$PWD/.env" \
RELAY_MISSION_SOURCE_ORIGIN=http://127.0.0.1:3001 \
RELAY_MISSION_SOURCE_ID=relay-stage-01 \
RELAY_MISSION_TARGET_ID=relay-stage-01 \
RELAY_MISSION_SOURCE_BAND=38 \
npm run mission:demo
```

Open the source controls at `http://127.0.0.1:3001/?incidentId=relay-stage-01` and the display at `http://127.0.0.1:14417/?incidentId=relay-stage-01#mission-actions`. The candidate intentionally hides band controls; only the source owns capture. Confirm the source-following banner names this mission. The follower baselines existing and unfinished reports, so arm it **before** speaking the new request.

Close competing band clients. Double-tap the assigned band until it blinks blue, then start band listening from the source controls. Wait for **Listening**, not merely Connecting. The microphone records nearby sound; keep this short demo focused on the scripted training request. The timing evidence starts at Listening and ends at the final saved confirmation; pairing time is excluded.

## 0:00–0:30 — explain

“Responders keep reporting what they see, but turning that information into coordinated action still takes work. Relay puts those reports into one shared mission. Its agents use that context to request what is needed, verify the result, and decide the next step. We’ll show that with a wristband and a controlled training service.”

## 0:30–1:30 — demonstrate

Once listening, say one fresh request:

> “Training exercise: we need twelve spare radio batteries at staging area Charlie. Record the request and confirm it in the mission log.”

Pause after the request. Show these four points on the mission display as they appear:

1. The report arrived from the band with the correct quantity and location.
2. Gemini selected the supply request from that report.
3. The Test Desk saved it and returned a receipt.
4. A second Gemini call used that exact receipt to create a confirmed follow-up. Show the source/receipt connection.

Both rehearsals finished around 40 seconds from Listening, leaving roughly 19 seconds in a 60-second slot. This is measured behavior, not a guarantee about the next model/network call. For a repeat in an existing mission, use a genuinely new request, such as six flashlights at staging area Bravo. A repeat of an already fulfilled request may correctly produce no duplicate action.

Stop listening after the result and let already-uploaded audio finish. Verify no delivery backlog remains. Do not click report or action Retry during an acceptance take: if recovery is needed, label it honestly as a failed uninterrupted run.

## 1:30–2:00 — finish

“That was one spoken report becoming a request and a follow-up, with a trace back to the original source. The destination here is our controlled test service. The broader goal is to give a whole response team a shared operating picture and accountable coordination, while keeping decisions and confirmations visible.”

## Fallback and scope

Keep the saved successful rehearsal available. If Bluetooth or the provider fails, show it as a **previously completed run**, not a new live execution. The older MP4 is a separate software demo; it is not footage of these timed physical runs.

The demo proves controlled test records. It does not dispatch emergency services, send real emails, deliver supplies, prove two-hour multi-band operation, or run an AI-selected browser worker. Keep those claims out of the presentation.
