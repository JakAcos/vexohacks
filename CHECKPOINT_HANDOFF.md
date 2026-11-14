# Relay: the three-hour catch-up

November 14, 2026 · checkpoint prepared by Codex; agent-authored, not human-reviewed.

## The central idea

**R̳e̳l̳a̳y̳ i̳s̳ t̳h̳e̳ c̳e̳n̳t̳r̳a̳l̳ m̳i̳s̳s̳i̳o̳n̳ o̳r̳c̳h̳e̳s̳t̳r̳a̳t̳o̳r̳:̳ c̳o̳n̳t̳i̳n̳u̳o̳u̳s̳ c̳o̳n̳t̳e̳x̳t̳ f̳r̳o̳m̳ e̳v̳e̳r̳y̳ r̳e̳s̳p̳o̳n̳d̳e̳r̳’̳s̳ V̳e̳x̳o̳ b̳a̳n̳d̳ b̳e̳c̳o̳m̳e̳s̳ s̳h̳a̳r̳e̳d̳ u̳n̳d̳e̳r̳s̳t̳a̳n̳d̳i̳n̳g̳ a̳n̳d̳ c̳o̳o̳r̳d̳i̳n̳a̳t̳e̳d̳ a̳g̳e̳n̳t̳ a̳c̳t̳i̳o̳n̳s̳.̳**

Dante’s intended product is a shared operating center for a mission. Police, firefighters, ambulance crews and the 911 dispatcher each contribute through a Vexo band. They leave it listening throughout the mission. Their reports and conversations accumulate in one mission-specific context. Agents there use the combined picture to communicate, request services and take useful actions. The desired experience is to leave it on and watch context become coordinated action without repeatedly prompting or managing the plumbing.

The target includes mission-long listening, potentially two hours, and multiple responders. Today’s checkpoint proves parts of that loop with one physical band and a simulated service layer. Real dispatch, email delivery, simultaneous multi-band operation and a two-hour run are not established.

## What changed while you were away

| Area | What the combined app now does | Why it matters to the idea |
| --- | --- | --- |
| One mission | Keeps attributed reports, changing issues, approvals, actions and receipts together; streams updates to the dashboard. | Everyone’s contribution can inform the same mission. |
| Immediate saving | Saves reports/audio before transcription, extraction and planning complete; shows background progress and retry. | AI latency does not hold the mission’s input path open. |
| Agent actions | Gemini proposes source-linked EMS, fire or police requests and automatic team updates. | Shared context produces observable work, with reasons attached. |
| Human review | Service requests require approval against current context; repeated approvals return the original simulated receipt. | A suggestion, approval and completed simulated action are distinguishable. |
| Continuous input | Adds browser audio segmentation and managed Vexo listening, outbox delivery, silence handling and retry. | Reports can arrive without starting a separate recording each time. |
| Clearer interface | Combines mission context, source reports, requested actions, receipts, voice controls and sponsor evidence. | A viewer can follow report → interpretation → action → result. |
| Recovery and boundaries | Preserves saved work through restart; prevents duplicate reports, stale updates, misleading source attribution and unexpected local hosts. | The shared picture remains inspectable when requests fail or arrive out of order. |
| Deployment preparation | Adds authenticated remote configuration, container/proxy files, bridge authentication and setup guides. | A cloud backend can receive a laptop’s band stream; public hosting is still unverified. |

## Where context and actions live

Vexo band → laptop Python bridge → Relay HTTP intake → durable per-mission files → Gemini transcription/extraction/planning → proposed actions → dispatcher approval where required → local simulated connector → saved receipt and live dashboard update.

The server owns shared mission state. The browser displays it and submits input. The laptop owns the Bluetooth connection; a cloud server does not connect directly to the nearby band. Gemini is used for transcription, report extraction, bounded action planning and optional spoken briefing. State tracking, approval checks, deduplication and the demo connectors are application code. Briefing is one output of the mission system.

## Evidence and what “working” means

**Checked on this exact source checkpoint:** fresh dependency install; production build/type checks; 58/58 Node tests; 19 Python tests passed and one SDK decoder check skipped because this isolated checkout has no configured Vexo SDK. An isolated real server accepted a fictional report, created three actions, saved three simulated receipts after approval, avoided duplication on retry, migrated legacy band metadata and preserved the report and receipts through process restart. This verification made no provider calls and did not operate hardware.

**Earlier live-session evidence reported by the hardware and independent QA chats:** real band 38 audio reached Gemini and produced source-linked mission actions. A continuous session ran for more than six minutes. A police proposal, automatic simulated team update and approved simulated police receipt were observed; the receipt survived reload and retry. All 27 captured segments were saved before the coordinated pause. A second intended spoken update was not recognized, so that part was not counted as a pass. Those observations validate the earlier live path, not every line of this checkpoint or a two-hour session.

**Independent package evidence:** candidate archive `8be84243f3218185396f3521458155e8656e38b5f0431998cf8213770ef6d28f` had a complete 88-file manifest and reproduced all 17 bundled browser/server outputs byte-for-byte after a fresh build. This source checkpoint takes its reviewed source from that archive and adds the subsequent startup repair and regression tests. It does not claim that earlier archive contains the repair.

## Problems found and fixed

- Reports whose AI jobs finished late could reorder mission context. The ordering regression now preserves received order and protects newer corrections.
- Lost upload confirmations could invite duplicate reports. Stable event IDs and retries preserve one report/action sequence.
- Speech with no incident facts previously caused unnecessary retry behavior. Empty extraction now preserves the transcript without inventing facts.
- Local access trusted an arbitrary Host value. Loopback-host checks now reject it.
- An earlier download’s built interface did not match its source. The audited candidate reproduced its bundled outputs.
- The live update failed startup because band-session metadata was read as an incident. The repair moves metadata into a separate directory, preserves compatible mission files and is covered by startup/recovery tests and this checkpoint’s real-process restart check.

## Remaining acceptance work

1. Complete the post-repair physical band reconnection and verify a new second report updates context and produces the intended action. Keep the designated hardware operator in control.
2. Rehearse the full multi-responder story and measure longer continuous operation. One band’s short run does not prove several simultaneous bands or mission-long capture.
3. Verify a chosen public deployment, remote bridge and browser flow together. Deployment files and local authentication tests are preparation, not evidence of hosted operation.
4. Finish the presentation video, submission and repository-visibility decisions in their owning workstreams. No public release, default-branch merge or submission is performed by this checkpoint.
5. Connect real services only as a separately designed and authorized integration. Current EMS/fire/police requests and team delivery receipts are simulations; no real units or emails are dispatched.

Vexo and Gemini are the core demonstrated contributions. MiniMax and Deepgram remain optional adapters. No Meta runtime integration is claimed. The optional Antigravity experiment remains separately reviewable in [PR #4](https://github.com/JakAcos/vexohacks/pull/4); it is not silently folded into this tested baseline.

## What was pushed

A dedicated branch, `checkpoint/relay-working-2026-11-14`, based on the existing incident-copilot branch, containing the integrated app, tests, dependency lockfile and durable setup/handoff documentation. See the accompanying draft PR for the exact commit and checks.

Excluded: credentials, local environment files, captured speech, mission records, screenshots, caches, dependencies, generated build folders and release ZIPs. Existing shared checkouts and the running band session are not modified by this publication.

## Pick it up

Read [README](README.md), run `npm ci`, `npm run build`, then `npm start`. The default is the clearly labeled local demo. Open `http://127.0.0.1:3001`; use the same mission ID across participants. Configure Gemini and the actual assigned band separately using [Vexo setup](VEXO_LIVE_BRIDGE.md). For the prepared remote topology, read [cloud deployment](CLOUD_DEPLOYMENT.md).

Run `npm test` and `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py'`. The SDK-specific Python test is optional until `VEXO_KIT_PATH` is configured. Local HTTP tests need permission to bind loopback ports.
