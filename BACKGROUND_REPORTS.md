# Durable reports and background processing

Relay saves each incoming typed report or uploaded audio segment before acknowledging it. AI transcription, extraction and planning then run outside the mission write lock. This implementation was authored and tested with Codex; physical band acceptance is tracked separately by the runtime owner.

## Request and context flow

1. A device submits an event with a stable clientEventId, mission ID and source identity.
2. The server atomically saves the raw typed report or syncs audio bytes and a durable job to disk. HTTP 202 means saved, not AI complete. Retrying that event does not add another report.
3. Up to four background jobs process independently. Typed reports appear in the timeline immediately; audio appears as a saved job until transcription produces the report. Every saved transition advances snapshot revision and publishes to the mission stream.
4. Extraction rebuilds attributed evidence in received order. Planning uses current mission context outside the lock. Before applying a plan, the server checks the context version and action state; changed context is replanned, at most three attempts, then retained for explicit retry.
5. Automatic team updates receive simulated receipts. Service requests remain proposals until dispatcher approval against the current mission version. Delivery and its simulated receipt are committed together.

The single backend process owns the JSON mission store and audio spool. Browsers keep views of server context; AI receives bounded context rather than owning the authoritative record. Use a persistent volume and one writer per directory. This is a hackathon simulator, not a production multi-tenant emergency dispatch system.

## API changes

- POST /api/observations returns 202 and the accepted Incident. Its observation initially has factsReady:false and processing:queued.
- POST /api/voice/turn returns 202 {kind:observation, transcript, incident} for a report. An explicit briefing command still returns 200 with kind:briefing.
- POST /api/voice/audio returns 202 {kind:queued, jobId, transcript:"", incident}. Original audio is saved before transcription. POST /api/audio/observations returns the accepted Incident with the same asynchronous job behavior.
- Incident.reportJobs contains status queued, transcribing, extracting, planning, complete or failed; source identity, observationId or briefingId, error and phase timings.
- GET /api/incidents/:id/events streams every durable snapshot. GET /api/incidents/:id is suitable for reconnect or polling. Snapshot revision increases on every mutation, independently of context version.
- POST /api/reports/:jobId/retry {incidentId} retries a failed saved job. POST /api/observations/:observationId/plan remains a compatible planning retry entry point.
- For physical Gemini audio, captureMode:continuous permits confirmed silence. Such jobs finish with result:silence and create no observation. Ordinary empty or invalid transcription remains a failure. The next spoken segment retains its original band/source metadata.
- POST /api/band/session/retry {} asks the local bridge to drain its saved outbox without starting a microphone.

## Recovery and visible states

Provider failure preserves the report or audio and marks the job failed. The Saved reports panel distinguishes accepted, processing and needs-retry. Failed live processing never silently switches to demo logic. Completed extraction is required before a new report counts as Gemini execution.

On server restart, unfinished jobs resume from durable state. Completed jobs and explicit failures are not replayed automatically. The original mode and source are retained. Successfully processed audio is removed from the server spool; failed audio is retained for retry. An audio upload that has not yet reached server acceptance remains the device's responsibility.

Reset removes job identities. Late provider responses cannot recreate a reset report or action. Briefings remain available during processing and label raw reports or pending audio explicitly. Report total time and per-phase timings include the background work; the acceptance request time is separate.

## Verification

The regression suite covers immediate HTTP acceptance while providers are held open, concurrent responders, live snapshot subscription, saved-report retry, duplicate IDs, source isolation, stale planning, reset, evidence order, continuous silence followed by speech, private access, approvals and simulated receipt persistence. A separate process-kill test terminated a disposable server after acceptance and verified automatic completion after restart. Browser checks exercised pending visibility, another client, failed-job retry and simulated approvals. Live Gemini testing exercised a fictional report; no microphone or real emergency service was used by these checks.

Use scripts/cloud-smoke.mjs against an authenticated running server to verify the async acceptance-to-actions path. It uses a new fictional mission and requires an explicit configured base origin and access token. Cloud hosting, TLS and physical wearable capture are separate acceptance gates.
