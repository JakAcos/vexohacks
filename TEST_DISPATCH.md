# Relay: a confirmed result becomes the next worker's input

This optional milestone makes actual HTTP submissions to a separate local test service. It does not contact emergency services. Existing EMS, fire, police, and mission-team connectors remain simulated.

One synthetic request starts two controlled dispatcher workers. Dispatcher A creates a ticket at Relay Test Desk. The destination persists the ticket before issuing its receipt. Dispatcher B reads that ticket back from the destination, uses its ID and title in a follow-up, submits the follow-up, and reads back the second receipt. Relay displays both destination-issued IDs and their dependency.

These workers follow a fixed workflow. This milestone does not claim autonomous model decisions, computer clicking, public hosting, or physical-band execution. The result is a real local HTTP action chain with durable receipts, visible in the Relay interface.

## Run the isolated demo

Use Node 24 or newer. From a clean checkout:

```sh
npm ci
npm run build
npm run demo:test-dispatch
```

Open `http://127.0.0.1:14317/?incidentId=test-dispatch-demo#test-dispatch` and click **Run test dispatch**. The input is synthetic. The separate destination runs at `http://127.0.0.1:14318`.

The launcher checks both ports and refuses to replace an existing process. It uses its own `.test-dispatch-demo/` directory and separate generated credentials for workers A and B. It runs in demo mode, disables model credentials and band access, and never restarts another Relay instance. Ctrl+C stops only the two processes it launched. Running it again preserves receipts and resumes unfinished work.

Optional settings:

```sh
RELAY_TEST_DEMO_PORT=14327 TEST_DESK_PORT=14328 RELAY_TEST_DEMO_DIR=/tmp/relay-test-run npm run demo:test-dispatch
```

Use one Relay process and one test-desk process per pair of data directories. The local file store is designed for a single process owner, not distributed replicas. Do not commit or publish the generated credential file or data directory.

## Integration boundaries

- `TestDispatch` owns a separate `DATA_DIR/test-dispatch/` directory. It does not modify mission reports or existing emergency actions.
- Relay's existing access boundary protects the added endpoints.
- Destination URL and worker credentials are server configuration, never browser-supplied URLs. This milestone permits only an explicit loopback HTTP origin and rejects redirects.
- All destination calls happen outside the existing mission-store lock.
- Ticket and follow-up IDs are created by the destination. Relay validates receipt shape, run, mission, source ticket and contents before continuing.
- New requests are saved before asynchronous execution. A mission can have only one active test workflow. Every run retains its own history and receipts.
- Failed requests remain visible and require explicit retry. A restart resumes saved in-progress work; it does not blindly retry failed jobs.
- Both POSTs use stable idempotency keys, and the destination rejects the same key with changed content. A timeout means unconfirmed, not necessarily unsent; retry asks for the original receipt.
- Changing the configured destination cannot silently redirect an unfinished run. Restore its original destination before retrying.

Configuration for embedding in an existing Relay deployment is opt-in: `RELAY_TEST_DESK_ORIGIN`, `RELAY_TEST_DISPATCH_A_TOKEN`, `RELAY_TEST_DISPATCH_B_TOKEN`. Without these, new test dispatches are disabled. Use two distinct credentials with at least 32 characters each. The destination requires the same values and `TEST_DESK_DATA_DIR`.

## API contract

| Operation | Endpoint | Payload / result |
| --- | --- | --- |
| Start workflow | `POST /api/incidents/:id/test-dispatch` | `{clientRequestId: UUID, title: string}` → saved run, HTTP 202 |
| Read workflow | `GET /api/incidents/:id/test-dispatch` | Enabled status, destination, saved runs and receipts |
| Retry | `POST /api/incidents/:id/test-dispatch/:runId/retry` | `{}` → same run and keys |
| A submits | `POST /tickets` | A credential; `{runId, missionId, title}`; key `runId:ticket` |
| B verifies A | `GET /tickets/:receiptId` | B credential; persisted ticket receipt |
| B submits follow-up | `POST /follow-ups` | B credential; `{runId, missionId, sourceReceiptId, message}`; key `runId:follow-up` |
| B verifies its result | `GET /follow-ups/:receiptId` | B credential; persisted follow-up receipt |

Destination POSTs return 201 for a new receipt and 200 for an idempotent replay. The UI shows the final message, both receipt IDs, timestamps, the source link, and a downloadable JSON evidence record. Earlier runs remain accessible.

## Verification

`npm test` includes the original Relay suite and ten execution tests using actual local HTTP servers. They cover the complete chain, repeated requests, changed payloads, lost ticket and follow-up acknowledgments, restored in-progress state, refused/malformed/mismatched receipts, redirects, altered readback, wrong-worker credentials, missing dependencies, origin restrictions, and disabled configuration. Browser acceptance separately checks the user-facing flow and the lost POST acknowledgment/polling race. Automated checks do not imply human review or external emergency-service acceptance.

Prepared by Codex. Independent acceptance and publishing results belong in the checkpoint handoff; this file describes the implementation and reproducible workflow.
