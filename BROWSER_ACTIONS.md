# Relay browser actions — isolated test milestone

Prepared by Codex. This is a tested local prototype; human acceptance and promotion into the main band demo are separate.

A request in Relay triggers Dispatcher A to fill a controlled destination form in an agent-owned Chrome session and click Submit. The destination creates a durable test ticket. Dispatcher B independently reads the ticket, submits a linked follow-up, and reads that follow-up back. Relay displays both destination-issued receipts, before/after screenshots, and a downloadable execution record with screenshot hashes.

The workers follow a fixed workflow. This is not a general-purpose autonomous computer operator, and spoken band requests are not yet automatically routed into this execution path. The original incident actions remain simulated. The separate test desk receives real HTTP submissions but does not contact real emergency services.

## Run

Requires Node 24+, Chrome, the host's agent-session allocator, and Playwright Core. Install the app dependencies with `npm ci`. Provide Playwright Core with `npm install --no-save playwright-core`, or set `RELAY_PLAYWRIGHT_MODULE` to a trusted absolute module path already installed on the host.

1. Allocate the caller's owned session with `/Users/dantegarcia/Desktop/tools/agent-pov-monitor/agent-session allocate "$CODEX_THREAD_ID"`.
2. Run `npm run build`.
3. Run `RELAY_BROWSER_AGENT_ID="$CODEX_THREAD_ID" RELAY_TEST_DEMO_PORT=15317 TEST_DESK_PORT=15318 npm run demo:test-dispatch`.
4. Open `http://127.0.0.1:15317/?incidentId=test-dispatch-demo#test-dispatch` and enter a synthetic request.

The browser worker reconciles only the configured agent session and verifies profile, PID, and window ownership before interaction. It refuses a missing or mismatched session; it never falls back to a human browser or silently substitutes an HTTP-only submission. This runner is host-specific. It requires permission for the local servers and owned browser; it is not a cloud execution service.

The launcher preserves credentials and records in `.test-dispatch-demo` by default; set `RELAY_TEST_DEMO_DIR` to use another private location. Do not publish that directory. Screenshots are local and served through the existing Relay access boundary. Agent worker credentials are added only to the exact form GET and ticket POST. A routing handler forwards the browser-initiated requests with redirects disabled, returns the destination response to the page, and replaces redirects with an error. Credentials do not appear in HTML or screenshots. There is no video recording in this milestone.

## Integration

The change is additive to the preceding HTTP test-dispatch milestone. `TestDispatchConfig.ticketExecutor` supplies browser submission and evidence; without it, the original HTTP workflow remains. `RELAY_BROWSER_AGENT_ID` enables the browser implementation. Existing readback, destination idempotency keys, restart recovery, and Dispatcher B remain in use. Optional evidence files are served only for a saved run with browser evidence, with a fixed filename allowlist.

The UI delta is rebased on the other build chat's frozen TestDispatch.tsx and CSS, preserving lost-response request identity and separate connection errors. Review the remaining small server integration edits against any later changes. Do not overwrite the running V1 demo or band store.

## Verification

- Production build passed.
- All 70 Node checks passed, including browser failure preventing HTTP fallback/downstream execution, destination form authentication, and evidence path restrictions.
- Actual owned Chrome filled and submitted a ticket. Destination files, Relay receipts, dependent follow-up, and screenshot hashes matched independently.
- Independent Relay UI acceptance produced one ticket/follow-up pair. Restart, page reload and request replay preserved both receipts and screenshot evidence.
- The opt-in real-browser security check passed successful submission, cross-origin 307/302 redirects, same-origin 307 and setup failure cleanup. Redirect targets received zero requests.
- Evidence is a record of observed browser execution, not a cryptographic attestation of independent hardware or model intelligence.

## Repeat the browser security check

After building, run `CODEX_THREAD_ID="your-allocated-agent-id" RELAY_PLAYWRIGHT_MODULE="/absolute/path/to/playwright-core/index.mjs" node scripts/test-browser-redirects.mjs`. This opt-in check uses the specified owned browser and temporary local services to verify a real form submission, same-origin and cross-origin redirect rejection, and page cleanup after setup failure. It is separate from `npm test` and requires the host browser allocator.
