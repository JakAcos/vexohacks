# Relay: the three-hour catch-up

Updated November 14, 2026 after independent execution-milestone acceptance. Prepared by Codex; agent-authored, not human-reviewed. Delivered through [draft PR #5](https://github.com/JakAcos/vexohacks/pull/5).

## The central idea

**R̳e̳l̳a̳y̳ i̳s̳ t̳h̳e̳ c̳e̳n̳t̳r̳a̳l̳ m̳i̳s̳s̳i̳o̳n̳ o̳r̳c̳h̳e̳s̳t̳r̳a̳t̳o̳r̳:̳ c̳o̳n̳t̳i̳n̳u̳o̳u̳s̳ c̳o̳n̳t̳e̳x̳t̳ f̳r̳o̳m̳ e̳v̳e̳r̳y̳ r̳e̳s̳p̳o̳n̳d̳e̳r̳’̳s̳ V̳e̳x̳o̳ b̳a̳n̳d̳ b̳e̳c̳o̳m̳e̳s̳ s̳h̳a̳r̳e̳d̳ u̳n̳d̳e̳r̳s̳t̳a̳n̳d̳i̳n̳g̳ a̳n̳d̳ c̳o̳o̳r̳d̳i̳n̳a̳t̳e̳d̳ a̳g̳e̳n̳t̳ a̳c̳t̳i̳o̳n̳s̳.̳**

Dante’s product is a shared operating center for a mission. Police, firefighters, ambulance crews and the 911 dispatcher each contribute through a Vexo band. They leave it listening throughout the mission. Their reports and conversations accumulate in one mission-specific context. Agents there use the combined picture to communicate, request services and take useful actions. People should not have to repeatedly prompt the system or manage how its parts connect.

The target includes multiple responders and mission-long listening, potentially two hours. The current work proves parts of that vision: an earlier physical-band-to-Gemini path, a shared mission/approval system, and now a real, controlled two-worker execution chain. These have not yet been accepted as one continuous physical-band-to-external-action flow.

## The latest milestone: what actually works now

**A result from one worker becomes the next worker’s verified input.** From Relay’s “One request. Two dispatchers.” panel:

1. A person enters a synthetic request and clicks **Run test dispatch**.
2. Dispatcher A sends a real HTTP request to a separate local Relay Test Desk process. That destination saves a ticket and issues its receipt.
3. Dispatcher B reads A’s ticket back from the destination. It uses the confirmed ticket’s ID and title to submit a linked follow-up, then reads back that second receipt.
4. Relay shows both destination-issued IDs, their dependency, timestamps and the final result. The receipts survive reload and restart; the evidence can be downloaded.

This is the first verified execution handoff beyond the app’s simulated emergency connectors. The workers are fixed application workflows with separate credentials. They are not model-selected autonomous workers, browser-clicking computers or real emergency-service integrations. This flow is manually triggered and stored alongside its mission; mission reports do not automatically launch it yet.

That boundary matters to the central idea: shared context is useful when it leads to accountable action, and coordination is meaningful when one worker can rely on another’s confirmed result. The next integration step is to connect a source-linked mission proposal to this controlled execution path, preserving human approval, rather than merely adding more independent workers.

## What changed while you were away

| Area | Working capability | Relationship to the goal |
| --- | --- | --- |
| Shared mission | Attributed reports, issues, approvals, actions and receipts, with live dashboard updates. | Gives the team one inspectable record. |
| Immediate saving | Reports/audio persist before AI finishes; background progress and retry remain visible. | Incoming context does not wait on model latency. |
| Mission planning | Gemini proposes source-linked resource requests and team updates; emergency delivery remains simulated. | Turns changing context into reviewable proposed work. |
| Real test execution — new | A submits a ticket; B verifies it and submits a dependent follow-up; the destination creates both receipts. | Proves an actual action/result handoff. |
| Recovery — extended | Stable request IDs, failure states, retry and restart preserve results without duplicate submissions. | Workers can recover without inventing success or repeating actions. |
| Interface — extended | New test panel, receipt evidence/download, readable dark-theme cards and corrected lost-response recovery. | Makes the action chain understandable to someone returning to the project. |
| Continuous input | Browser segmentation and managed Vexo listening, outbox delivery, silence handling and retry. | Supports repeated reports; longer and simultaneous multi-band acceptance remain open. |
| Deployment preparation | Authenticated remote configuration, container/proxy setup and laptop bridge support. | Public hosting remains a separate acceptance step. |

## Evidence, separated by scope

**This execution checkpoint:** production build/type checks and all **68 Node tests passed**. The ten added execution tests use real local HTTP servers and cover ordering/dependencies, repeated requests, lost acknowledgments, resumed in-progress state, malformed or mismatched receipts, redirects, authorization and disabled configuration.

Independent browser acceptance used a fresh fictional mission and separate Relay/Test Desk processes. Displayed receipts matched the destination’s saved files. Both processes were restarted and the same receipts remained. Taking the destination offline produced a visible failure with no invented ticket or follow-up; restoring it and retrying recovered the same run.

The final UI’s lost-response regression held a real POST acknowledgment through **seven successful background polls**, then dropped it and temporarily blocked reconciliation reads. **Recover submission** reused the identical UUID and payload. The result remained one ticket/follow-up pair, and the stale error cleared. Across four intentional browser runs there were exactly eight destination receipts. The final panel was visually inspected. No model calls or physical recording occurred during these checks.

Example final accepted run: `c29d8a59-dabe-4daf-bce8-4e5b630e39a8`. Destination ticket: `143a63f8-b237-47b6-b0f9-617d2d545c28`. Follow-up: `78fb4999-3bc1-40d5-9332-a920d51187a6`. B’s `sourceReceiptId` exactly matches A’s ticket. See [structured verification](docs/verification/test-dispatch-2026-11-14.json).

**Previous source checkpoint `e316eaa`:** 58 Node tests, production build and real-process startup/restart checks passed. The unchanged Python bridge suite had 19 passes and one optional SDK decoder skip. Its fixes covered report ordering, duplicate retries, empty extraction, local-host access and the startup failure caused by treating band metadata as a mission. The audited earlier ZIP reproduced all 17 bundled app outputs; this Git branch also includes the later metadata repair.

**Earlier live hardware evidence, not repeated here:** hardware and QA owners observed real band-38 audio reaching Gemini and creating source-linked mission proposals, a simulated team update and an approved simulated police receipt. A continuous session exceeded six minutes and all 27 segments were saved before a coordinated pause. A second intended update was not recognized in that test. Those results do not establish two-hour operation, simultaneous bands or this new external execution chain from physical speech.

## Where context and actions live

Current mission path: Vexo → laptop bridge → Relay’s durable mission intake → Gemini transcription/extraction/planning → proposed action → human approval → simulated emergency connector → saved receipt and dashboard.

New opt-in execution path: Relay panel → durable test-workflow record → Dispatcher A → separate Test Desk ticket → Dispatcher B reads the confirmed result → linked follow-up → both real test receipts back in Relay.

The server owns mission context; the browser displays it. The laptop owns Bluetooth. The test workflow has its own storage directory and performs network calls outside the mission-store write lock. A single process owns each data directory. It does not alter existing mission reports or simulated emergency actions.

## What remains

- Connect mission-derived, source-linked proposals to the verified execution workflow with appropriate review. The current test request is entered manually.
- Complete longer and simultaneous multi-responder physical acceptance, including a clearly recognized follow-up after restart.
- Validate a chosen hosted deployment and remote bridge together. Deployment files are not proof of public operation.
- Add real outside service/browser integrations only as separately verified connectors. Email, actual emergency dispatch and generic computer operation are not part of this checkpoint. Separate browser-execution experiments are not included here.
- Complete presentation/submission work in its owning workstreams. This push does not merge the default branch, change repository visibility or publish a stable release.

Vexo and Gemini remain the core product contributions. MiniMax and Deepgram are optional adapters. No Meta runtime integration is claimed. Optional Antigravity work remains separate in [PR #4](https://github.com/JakAcos/vexohacks/pull/4).

## Run the verified milestone

```sh
npm ci
npm run build
npm run demo:test-dispatch
```

Open `http://127.0.0.1:14317/?incidentId=test-dispatch-demo#test-dispatch`. The launcher starts its own two local processes, uses synthetic data and generated worker credentials, and refuses occupied ports. It does not operate the band or call AI providers. Stop with Ctrl+C; restarting preserves receipts. Read [TEST_DISPATCH.md](TEST_DISPATCH.md) for ports, configuration, API contracts and recovery.

For the original mission flow use [README](README.md), [Vexo setup](VEXO_LIVE_BRIDGE.md) and [cloud preparation](CLOUD_DEPLOYMENT.md).

## GitHub checkpoint

Branch: `checkpoint/relay-working-2026-11-14`; [draft PR #5](https://github.com/JakAcos/vexohacks/pull/5). The original checkpoint remains in history, followed by this verified milestone and updated catch-up. GitHub’s existing workflow publishes handoff information; it does not run application tests.

Included: source, tests, dependency lockfile, setup documentation and a deliberately reviewed synthetic verification summary. Excluded: credentials, generated test data, real speech, mission records, screenshots, caches, dependencies, compiled bundles and ZIPs. Both Git and Docker ignore the generated test credential/data directories. The shared live demo was not modified by this publication.
