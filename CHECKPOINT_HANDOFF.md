# Relay: the three-hour catch-up

Updated November 14, 2026 after the mission-driven execution milestone. Prepared by Codex; agent-authored, not human-reviewed.

## The central idea

**R̳e̳l̳a̳y̳ i̳s̳ t̳h̳e̳ c̳e̳n̳t̳r̳a̳l̳ m̳i̳s̳s̳i̳o̳n̳ o̳r̳c̳h̳e̳s̳t̳r̳a̳t̳o̳r̳:̳ c̳o̳n̳t̳i̳n̳u̳o̳u̳s̳ c̳o̳n̳t̳e̳x̳t̳ f̳r̳o̳m̳ e̳v̳e̳r̳y̳ r̳e̳s̳p̳o̳n̳d̳e̳r̳’̳s̳ V̳e̳x̳o̳ b̳a̳n̳d̳ b̳e̳c̳o̳m̳e̳s̳ s̳h̳a̳r̳e̳d̳ u̳n̳d̳e̳r̳s̳t̳a̳n̳d̳i̳n̳g̳ a̳n̳d̳ c̳o̳o̳r̳d̳i̳n̳a̳t̳e̳d̳ a̳g̳e̳n̳t̳ a̳c̳t̳i̳o̳n̳s̳.̳**

Dante’s central idea is a shared operating center for a mission. Police, firefighters, EMS and the 911 dispatcher contribute through Vexo bands. Their ongoing reports accumulate in one mission-specific context. Agents use that combined picture to communicate, request services and act, without people repeatedly prompting or wiring the parts together. Multiple responders and mission-long listening, potentially two hours, remain the target.

## The latest milestone: context now leads to a real test action

The latest verified chain uses a new mission report as its trigger, rather than a manually entered dispatcher test request:

1. Relay saves the report and its source. An optional read-only follower can import new, completed reports from a separate mission without taking over its band or microphone.
2. Gemini receives the current mission and the available test-service capability. It chooses a bounded test action, an ordinary simulated action, or no action.
3. Relay saves the selected action and source links, then sends its **complete title and detail** to the controlled Test Desk. Quantity and location must survive in the destination-issued receipt.
4. Relay validates and reads back that ticket. A separate Gemini receipt-agent call uses the confirmed result and current mission context to plan a dependent follow-up.
5. Relay saves that decision before sending it. The destination verifies the ticket dependency, issues the follow-up receipt, and Relay reads it back. Both actions, receipts and source links appear together in the mission screen.

This is the closest tested implementation of the central idea so far: **shared context selects useful work, and one agent’s confirmed result becomes another agent’s input.** The action is a real test-service record. It does not establish that supplies were delivered or responders dispatched. Gemini chooses among bounded capabilities; it cannot select arbitrary destinations, commands or credentials.

## What actually works, and where

| Piece | Proven behavior | Boundary |
| --- | --- | --- |
| Shared mission | Attributed reports, issues, source-linked actions, approval history and live updates. | Current structured scenarios emphasize the apartment-fire prototype. |
| Durable intake | Reports/audio save before AI finishes; processing, failure and retry remain visible. | Browser audio not yet uploaded can still be lost on tab closure. |
| Mission-driven execution — latest | Gemini selects a test action from a report; a separate Gemini call uses its confirmed receipt for a real follow-up. | Live acceptance used a labeled synthetic source and real Gemini, not fresh physical band capture. |
| Full request transfer | Destination ticket preserves the selected title and detail; missing or mismatched details stop the next agent. | A confirmed test ticket records a request; it does not fulfill it. |
| Recovery | Stable identities, saved follow-up decisions and durable receipts support retry and restart without duplication in the tested cases. | One backend process owns each data directory. |
| Source follower | Baselines existing reports and unfinished jobs; imports only fresh completed reports with matching source/job metadata; replays do not duplicate them. | Device metadata comes from the bridge; it is not independent hardware attestation. |
| HTTP dispatcher demo — PR #5 | Manually triggered A ticket → B independently verified follow-up; both receipts persist. | Fixed workflow, independent of mission-driven AI selection. |
| Browser worker — PR #6 | A fills the controlled form and clicks Submit; B uses its real receipt. Relay shows before/after images and receipt evidence. | Separate verified branch; host-specific, fixed workflow. Not integrated with this mission-driven branch. |
| Continuous input | Segmented browser capture, managed Vexo listening, outbox delivery and silence/retry handling. | Two-hour operation and simultaneous multi-band acceptance remain open. |
| Deployment preparation | Authentication, container/proxy configuration and laptop-bridge setup. | Preparation is not proof of public hosted operation. |

## Evidence and its limits

**This mission-driven source:** the release checkout independently passed its production build/type checks and **79 Node tests**. Coverage includes lost ticket and follow-up acknowledgments, receipt identity/detail validation, retry/restart identity, stale context, reset during model work, disabled capabilities and source history/provenance filters. Original simulation and HTTP workflow checks also passed.

The source-test owner exercised the final candidate with **real Gemini** and a clearly labeled synthetic source fixture. Historical reports, audio already pending at arming, wrong-band, typed, demo-mode and failed reports were excluded in the source tests. A fresh logistics report led to a test ticket and receipt-dependent Gemini follow-up. Cancellation did not produce a new test request. The release review independently compared the final full request and both receipts with the destination’s saved files, checked source/action links and inspected the mission UI. Both final receipts remained identical after the owner restarted the candidate and switched it to the separate `band-auto-test` source. The release review checked this directly, and verified all three served web assets against its own build. Recording remained stopped, with zero reports imported from the newly armed physical source. This is readiness, not a fresh band acceptance. Final identifiers and restart/replay evidence are recorded in [structured verification](docs/verification/mission-execution-2026-11-14.json).

**Earlier HTTP checkpoint `dc506a8`, PR #5:** 68 Node tests and build passed. Independent UI acceptance covered destination outage/retry, both-process restart, and a lost-response race held through seven background polls. Recovery reused the same UUID and payload. Four intentional runs produced exactly eight destination receipts. See [HTTP evidence](docs/verification/test-dispatch-2026-11-14.json).

**Separate browser checkpoint `b6901ce`, PR #6:** 70 Node tests and build passed. Independent real-Chrome checks covered successful form submission, blocked same-/cross-origin redirects and cleanup after setup failure; redirect targets received zero requests. Relay’s complete browser-to-follow-up chain, saved receipt files, image hashes, process restart, page reload and replay passed. See [browser PR #6](https://github.com/JakAcos/vexohacks/pull/6). This branch does not contain that browser executor.

**Earlier physical evidence:** hardware owners observed band-38 audio reaching Gemini, source-linked proposals, a simulated team update and an approved simulated police receipt. A continuous session exceeded six minutes with 27 segments saved; a second intended spoken update was not recognized. These observations do not prove two-hour listening, simultaneous bands or the new physical-band-to-real-test-action chain. The unchanged bridge suite previously passed 19 tests with one optional SDK decoder skip.

## How the parts fit together

The server owns mission context; the browser displays it; the laptop owns Bluetooth. The new executor does network and model work outside the mission write lock. New reports can arrive while an action is running. A queued action whose context has changed is dismissed before submission; the receipt agent replans if context changes during reasoning. A retry after an uncertain submission keeps the original identity and saved payload.

The original emergency path still ends in reviewed, simulated connectors. The new test path is opt-in and automatically creates only controlled test records. Browser execution is another independently verified capability, not yet part of the AI-selected mission path.

## What remains to achieve the full idea

- Observe a fresh physical-band report completing the new mission-driven action/receipt/follow-up chain. Configuring the read-only source is readiness, not that proof.
- Integrate the browser executor with mission-driven selection and test the combined path before claiming it works.
- Complete longer and simultaneous multi-responder listening, including a clearly recognized follow-up after restart.
- Validate the chosen hosted deployment with the remote bridge. Real email, actual emergency services and general autonomous computer use remain outside these checkpoints.

## Run and preserve the checkpoints

For mission-driven execution, install dependencies, build, configure Gemini privately, then run `npm run mission:demo`. Default isolated ports are 14417/14418. The launcher generates separate worker credentials/data, refuses occupied ports and does not start a microphone. Follow [MISSION_EXECUTION.md](MISSION_EXECUTION.md) for configuration, the read-only source and recovery.

For the fixed HTTP demo, use `npm run demo:test-dispatch`; see [TEST_DISPATCH.md](TEST_DISPATCH.md). For browser mode, use the separately published [PR #6](https://github.com/JakAcos/vexohacks/pull/6) and its browser setup instructions.

Mission execution is on `checkpoint/relay-mission-execution-2026-11-14`, based on frozen HTTP commit `dc506a8`. [PR #5](https://github.com/JakAcos/vexohacks/pull/5) and [PR #6](https://github.com/JakAcos/vexohacks/pull/6) remain separate recoverable checkpoints. Nothing here merges the default branch, publishes a stable release or changes repository visibility. GitHub’s existing workflow publishes handoff information; application checks were run independently and are not provided by that workflow.

Included: reviewed source, tests, setup instructions and synthetic verification summaries. Excluded: credentials, real mission records, recordings, screenshots, generated data, dependencies and compiled bundles. The release work did not alter the shared band runtime or stage mission. Vexo and Gemini remain the core path; MiniMax and Deepgram are optional adapters, and no Meta runtime integration is claimed.
