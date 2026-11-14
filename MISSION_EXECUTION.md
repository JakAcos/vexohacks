# Mission-driven test execution

**Current acceptance:** two fresh physical-band runs completed in 40.910 s and 39.325 s without manual retry. Read [TEAM_STATUS.md](TEAM_STATUS.md), [STAGE_DEMO.md](STAGE_DEMO.md), and [physical evidence](docs/verification/physical-demo-2026-11-14.json) first. Earlier synthetic acceptance remains historical evidence.

This opt-in candidate extends the shared mission pipeline. It leaves existing emergency-service simulation and the manually triggered two-worker test workflow intact when disabled. Agent-authored implementation and verification; no real emergency service is connected.

## The execution chain

1. A report is durably saved in Store before AI work. For linked band reports, a read-only follower imports only new, completed Gemini observations with matching physical source/job metadata. Existing facts are reused; it does not capture, transcribe, or extract again.
2. Gemini receives current mission context plus the configured test capability. It can choose a `test_request` to `test_desk` for a non-emergency logistics or coordination need, choose ordinary simulated actions, or choose no action. No magic test-service phrase is required.
3. The selected action and its source observation IDs are saved in the mission. A separate background executor submits it to the allowlisted local test service using the action ID as its idempotency identity. The saved title and full detail, including quantities and locations, are delivered together. The mission lock is never held during HTTP or model work.
4. The destination issues and durably saves a ticket receipt. Relay validates mission/action/title/full-detail binding and reads the ticket back before recording confirmation.
5. A distinct Gemini receipt-agent invocation receives the verified receipt and latest mission context. Its bounded follow-up must reference the exact receipt UUID. If context changes while it reasons, it replans. The resulting `test_follow_up` is persisted with its source report, parent action and receipt ID before submission.
6. The service verifies the dependency, issues its own follow-up receipt, and Relay reads that receipt back. Both actions and receipts appear in the mission's action panel and survive restart.

Execution is controlled: Gemini selects from explicit action types and supplies bounded data; it cannot choose destinations, credentials, commands or arbitrary URLs. Existing emergency requests still require review and use simulated connectors. A test ticket acknowledgment does not establish delivery of supplies or completion of any real-world mission task.

## Launch separately

Build with `npm run build`. Set `GEMINI_API_KEY` and `GEMINI_MODEL`, or set `RELAY_GEMINI_ENV_FILE` to a private existing configuration file. The launcher reads only those two provider values. Run `npm run mission:demo`.

Default isolated ports are 14417 (Relay) and 14418 (test desk). The launcher refuses occupied ports. It creates separate persistent data and distinct worker credentials. It does not stop other runtimes or start a microphone. Set `RELAY_MISSION_DEMO_DIR` to choose its private data location; `RELAY_MISSION_DEMO_PORT` and `TEST_DESK_PORT` select ports.

To follow a source mission read-only, configure:

- `RELAY_MISSION_SOURCE_ORIGIN=http://127.0.0.1:3001`
- `RELAY_MISSION_SOURCE_ID=band-auto-test`
- `RELAY_MISSION_TARGET_ID=band-auto-test`
- `RELAY_MISSION_SOURCE_BAND=38`

The source must be an explicit loopback origin. First connection saves a baseline containing all existing observation and job IDs, including unfinished audio. Old audio finishing later cannot trigger an action. Baselines are separately keyed by source origin, source mission, target mission and band. Source failures retain the baseline and imported reports. Replayed imports use stable source observation IDs and cannot duplicate the report. Source provenance is bridge-reported metadata, not a cryptographic hardware attestation.

When a source is configured, candidate band mutations are rejected and local band controls are hidden. Start/stop stays solely in the original mission. The judge mission `stage-3pm` is not used by this candidate.

## Recovery and truthful state

A failed call preserves its report/action and any confirmed receipt. Explicit retry uses the original IDs and saved payload. A missing HTTP acknowledgment is an unknown outcome until an idempotent retry or readback confirms it. Follow-up payloads are not regenerated after a possibly accepted submission. Unfinished actions resume after restart; completed actions are not replayed. Reset prevents late model/provider results from recreating actions, although an already submitted external test record remains at the destination.

A newer mission version invalidates a queued request that has not started. Later context changes inform the receipt agent; they do not erase an already accepted ticket. Cancellation of a fulfilled test submission is represented as new mission evidence, not a fictional reversal at the destination.

## Validation

Regression coverage includes actual local HTTP receipt binding, wrong receipt identity, lost ticket/follow-up acknowledgment, source history/pending-audio exclusion, repeated imports, retry/restart identity, context changes during reasoning, reset during provider work, disabled capability, and preserved original simulator behavior. Live acceptance uses actual Gemini planning and receipt reasoning against a clearly labeled synthetic source fixture. It is not fresh physical-band acceptance. Fresh physical acceptance subsequently passed twice on the fixed candidate. The publication tree also preserves the independently verified browser worker; it is not part of the AI-selected mission path.

## Planning during continuous input

Planning is serialized per mission independently of intake, extraction and the write lock. A context change rejects the stale proposal and automatically re-evaluates the saved report; it no longer becomes a failed job after three interruptions. Provider errors still fail visibly and retain evidence. Shutdown leaves unfinished work resumable. The original report identity and source links remain stable.
