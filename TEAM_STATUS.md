# Relay: five-hour rundown and current state

Updated November 14, 2026 after the two timed physical rehearsals at approximately 2:57–2:59 PM Pacific. Prepared by Codex from source, test results, saved service receipts and user-spoken rehearsals. This is agent-authored evidence, not a claim of independent human code review.

## What to know first

**The essential demo now works: a real wristband report produces a Gemini-selected request, a real controlled test-service receipt, and a second Gemini agent’s confirmed follow-up.** Two consecutive runs took **40.910 seconds** and **39.325 seconds**, with **zero manual retries**. The clock starts when the band is listening, includes the spoken request and processing, and ends when Relay saves the final confirmation. Bluetooth discovery/pairing happens beforehand.

The most useful current context is this document, [the stage runbook](STAGE_DEMO.md), [mission execution setup](MISSION_EXECUTION.md), and [physical acceptance evidence](docs/verification/physical-demo-2026-11-14.json). Older documents saying that the fresh wristband chain is unverified describe earlier checkpoints; this report supersedes that status.

Relay’s intended product is a shared operating center: continuous reports from responders become shared mission understanding and coordinated, accountable actions. The demonstrated slice is one physical band and one controlled logistics workflow. It establishes a working demo, not a deployed emergency dispatch system.

## What happened during roughly the last five hours

These are build phases, not an invented minute-by-minute activity log. Work overlapped across several chats; older checkpoint records remain linked below.

### 1. Established the shared mission and physical input

We built around a mission-specific server record: attributed observations, extracted facts, unresolved issues, team updates, proposed actions, approvals and receipts. Every browser looking at the same mission ID receives the same state through snapshots and live updates. Corrections preserve earlier evidence instead of rewriting history.

The laptop owns Bluetooth and Vexo capture. Band 38 sends audio through the bridge; Gemini transcribes and extracts the report. The bridge provides band number, transport and capture metadata. Those labels are useful provenance, not signed hardware attestation. We also preserved browser/typed rehearsal inputs, explicitly labeled so they cannot masquerade as wearable capture.

### 2. Made intake durable and responsive

Audio and reports are saved before model processing. Background jobs expose transcription, extraction, planning, completion and failure states. Stable event IDs prevent replay from creating duplicate reports. Saved unfinished jobs resume after restart; failed provider calls retain evidence for recovery.

Slow model calls do not hold the mission’s write lock. New reports and the dashboard remain responsive. Out-of-order processing restores the original report order so a late older extraction cannot overwrite a newer correction. This is durable server intake; audio still waiting in a browser tab can be lost if the tab closes.

### 3. Proved actual controlled execution

The initial emergency-service connectors were simulated. We added a separate local Test Desk to prove actual execution: worker A submits a ticket, the destination saves and returns its own receipt, and worker B independently reads that receipt before submitting a dependent follow-up. Receipt identity, mission binding and stable request identities are checked.

A separate browser capability also filled and submitted the controlled form in an agent-owned Chrome session, with before/after evidence. That code is preserved on `main`. It is a fixed dispatcher workflow, not part of the timed wristband demo and not AI-selected general computer use.

### 4. Connected mission reasoning to execution

The mission planner now chooses a bounded test request from a new report and current context. Relay persists the decision, sends the complete title and detail, verifies the destination’s saved ticket, then invokes a distinct Gemini receipt agent. That agent receives the confirmed result and latest context and plans a linked follow-up. Both actions and receipts appear in one mission history.

A read-only source follower connects the existing band service to the new mission-execution instance. It baselines historical reports and already-pending audio, accepts only fresh completed reports with matching source/job metadata, and uses stable identities to avoid duplicate imports. The source service remains the only owner of band start/stop. Synthetic reports with real Gemini first proved this chain; they were not represented as physical acceptance.

### 5. Tested real speech, found the failure, and fixed it

The first physical run captured the requested quantity and location correctly, but later audio invalidated planning. Competing planners could repeatedly invalidate each other, and the old three-attempt cap marked a saved report failed. Manually retrying that report recovered the chain, but it took **72.603 seconds from report intake to the final destination receipt**. That was diagnostic evidence, not a passing one-minute demo. Its timing starts later than the two final runs, so it is not an apples-to-apples performance benchmark.

We reproduced the failure in automated tests before changing code. The fix serializes planning per mission, separately from intake, extraction and the write lock. If newer context invalidates a proposal, Relay automatically re-evaluates the saved report against current context rather than failing after three interruptions. A short pause coalesces rapid changes. Stale proposals remain rejected; cancellation, reset and real provider-error handling remain intact. Different missions can still progress independently.

A restart also exposed a local band setup problem: the Python/SDK paths had depended on launch-time settings. We restored the verified paths and persisted them in the private local configuration. The band’s short discoverability window expired during setup; double-tapping the assigned band reopened it. Neither failed connection attempt captured audio or counted as a demo run.

### 6. Repeated the full physical flow successfully

| Run | User-spoken training request | Listening → final confirmation | Manual retries |
| --- | --- | ---: | ---: |
| 1 | 12 spare radio batteries at staging area Charlie | 40.910 s | 0 |
| 2 | 6 flashlights at staging area Bravo | 39.325 s | 0 |

Both requests preserved their quantities and locations. All four destination records matched Relay’s receipts. Each follow-up referenced the exact prior receipt and both actions linked back to the original physical report. Additional speech did not break the completed chain. After stopping, all six captured report jobs across these sessions completed; there were exactly two test requests and two test follow-ups, and no pending delivery.

We stopped recording and preserved the successful mission. The two measured runs used the fixed mission candidate and older source runtime patched with the same scheduling fix. Publication combines that path with the previously committed browser capability; the final combined-tree build/tests and source comparison are recorded separately in the release manifest. Do not imply that the newly merged tree received another physical rehearsal.

## Problems, fixes, and remaining boundaries

| Problem | What changed / evidence | Remaining boundary |
| --- | --- | --- |
| Context changes repeatedly failed planning | Per-mission planning serialization and automatic reevaluation; regression tests failed before the fix and passed afterward; two physical passes | Unbounded incoming context and provider latency can still affect timing; two runs are not a latency guarantee |
| Destination received a title without the full request | Full detail is sent and validated before the receipt agent can continue | A ticket acknowledges a request; it does not deliver supplies |
| Lost responses or replay could duplicate work | Stable IDs, saved payloads, destination readback and receipt-dependent follow-up; outage/restart/replay tests | One server process owns each data directory |
| Historical or wrong-source reports could trigger new actions | Source baseline plus matching mode, band, job and observation metadata | Metadata is reported by the bridge, not cryptographic device identity |
| Bluetooth unavailable or competing clients | Assigned band only, visible connection state, close other clients and reopen discovery | Pairing is a pre-demo step; no alternate band is silently selected |
| Restart lost private SDK/Python launch settings | Verified absolute paths persisted locally; setup documented | Teammates must configure their own installed paths and private credentials |
| Disk pressure interrupted builds/saving | Earlier work reclaimed regenerable caches, recovered a local runtime and checked durable writes | This was a machine resource problem, not proof of long-term storage capacity |
| Parallel branches made “current” ambiguous | Essential path and this handoff promoted together to both repositories’ `main` | Fetch before editing; historical hashes describe their original snapshots |

## Current architecture and state

`Band 38 → laptop bridge → source mission (:3001) → fresh-report follower → mission executor (:14417) → controlled Test Desk (:14418) → receipt-aware Gemini follow-up → mission history`

The source stores audio/reports and handles transcription/extraction. The follower reuses completed facts instead of retranscribing audio. Gemini reasons from the mission context; execution is restricted to configured test capabilities and destinations. The receipt agent acts only after validation and readback. The dashboard shows the accumulated record. The local services call cloud Gemini; this does **not** establish cloud-hosted orchestration.

**Proven:** two under-one-minute physical demos, source-linked actions, exact request transfer, dependent receipts, recovery behavior in tests, and saved history. The fixed candidate passed 81 Node tests and a production build; 23 tests separately passed against the exact older source-runtime patch. See the [current publication manifest](docs/verification/verified-wristband-release-2026-11-14.json) for checks on the combined release tree, rather than treating those earlier counts as its test result.

**Still unproven or outside this demo:** sustained two-hour operation, simultaneous multiple bands, portable cloud browser workers, AI-selected browser execution, a fresh remote/second-device deployment on the stage network, real emails, real emergency-service integration, and real-world fulfillment. Optional Antigravity work is not silently merged. Vexo and Gemini are the essential demonstrated path; optional sponsor adapters are not prerequisites.

## Pull this into your context

Both repositories use `main` for this handoff:

- [Shared team repository](https://github.com/JakAcos/vexohacks/tree/main) — existing collaborators retain access.
- [Public mirror](https://github.com/dantegarcia654/relay-vexohacks/tree/main) — anyone can read it.

In an existing clone, preserve local changes, fetch, and fast-forward `main`; do not reset somebody else’s work. For a fresh copy use either repository, Node 24+, `npm ci`, `npm test`, and `npm run build`. Follow [STAGE_DEMO.md](STAGE_DEMO.md) for the essential physical flow. `npm run demo:test-dispatch` remains a useful no-key HTTP smoke demo, but it does not prove wristband input or model selection.

The repository’s automatic push handoff links directly to this file and the stage runbook at the pushed commit. The workflow reports changes; it is not the application test runner or evidence that a teammate read the message.

## Demo plan and stopping point

**30 seconds explain → 60 seconds demonstrate → 30 seconds finish.** Prepare the connection before the timed minute, use one fresh logistics request, show the report and both receipts, and trace the follow-up to its confirmed source. Preserve the completed rehearsal as a clearly labeled fallback. Repeating an already fulfilled request may correctly produce no new request; prepare a fresh source/target mission instead of deleting the proof.

We have reached a working-demo stopping point. Freeze the essential path for presentation; prioritize clear setup and one rehearsed story over adding new execution modes. The preserved older video and Devpost materials are historical artifacts, not a recording of the newest physical flow. This push does not upload a replacement video or resubmit Devpost.

## Historical evidence

- Shared-context checkpoint: `e316eaa`.
- HTTP receipts: `dc506a8`, [verification](docs/verification/test-dispatch-2026-11-14.json).
- Fixed browser worker: `b6901ce`, [verification](docs/verification/browser-actions-2026-11-14.json).
- Prior synchronized main: `5f49379`; [merge manifest](docs/verification/main-merge-2026-11-14.json).
- Mission-driven synthetic Gemini acceptance: `82f2aea`; [verification](docs/verification/mission-execution-2026-11-14.json).
- Latest physical acceptance: [two timed runs](docs/verification/physical-demo-2026-11-14.json).

Historical publication manifests and `SUBMISSION.md` retain their original scope. No credentials, raw recordings, incidental conversations, personal local paths or live mission stores are included in this update.
