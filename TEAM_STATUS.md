# Relay: start here, team

November 14, 2026 checkpoint. Prepared by Codex; agent-authored, not human-reviewed.

**Relay's goal is to turn continuous responder context into shared mission understanding and coordinated, accountable actions.** The current prototype proves the shared context and controlled execution pieces. The full physical-band → mission-selected action → external execution chain is still being integrated.

## Get the current code

The same checkpoint is published on `checkpoint/team-sync-2026-11-14` in both repositories:

- [Shared team repository](https://github.com/JakAcos/vexohacks/tree/checkpoint/team-sync-2026-11-14)
- [Dante's repository](https://github.com/dantegarcia654/relay-vexohacks/tree/checkpoint/team-sync-2026-11-14)

For an existing clone, commit or save local work first, then fetch and check out that branch. For a fresh copy:

```sh
git clone --branch checkpoint/team-sync-2026-11-14 https://github.com/JakAcos/vexohacks.git relay
cd relay
npm ci
npm test
npm run build
npm run demo:test-dispatch
```

Use Node 24 or newer. Open `http://127.0.0.1:14317/?incidentId=test-dispatch-demo#test-dispatch`. This starts the local HTTP demo with synthetic requests and generated local worker credentials. Browser execution needs the additional host setup in [BROWSER_ACTIONS.md](BROWSER_ACTIONS.md). No provider key is needed for this test-dispatch demo.

## What works, and what it proves

| Piece | Current behavior | Evidence / setup |
| --- | --- | --- |
| Shared mission context | Attributed reports, issues, proposed actions, approvals, receipts and dashboard updates. Gemini and physical Vexo input were exercised in earlier owner tests. | [Full catch-up](CHECKPOINT_HANDOFF.md), [Vexo setup](VEXO_LIVE_BRIDGE.md) |
| HTTP execution | A submits a real ticket to a separate local Test Desk; B reads it back and submits a dependent follow-up. | [Run guide](TEST_DISPATCH.md), [acceptance record](docs/verification/test-dispatch-2026-11-14.json) |
| Browser execution | A fills and submits the controlled destination form in an owned Chrome session. B verifies the resulting ticket over HTTP. Relay shows receipts and screenshot evidence. | [Browser guide](BROWSER_ACTIONS.md), [acceptance record](docs/verification/browser-actions-2026-11-14.json) |
| Recovery | Verified retries, restart persistence, duplicate protection and redirect rejection for the controlled test workflow. | Same acceptance records; automated tests are in `tests/`. |

Application source is unchanged from verified browser checkpoint `b6901cedbdf1f91a83bdf6610b7270ddb52b6dea`, which includes HTTP checkpoint `dc506a835a042ea2848987782562e4e109c8e3a4` and shared-context checkpoint `e316eaa`. This synchronization adds the team guide and restricts the shared-repository notification workflow to its intended repository. The browser checkpoint records 70 passing Node tests, a successful build, actual browser acceptance, matching destination receipts, and restart/replay checks. Physical hardware and live provider tests were earlier, separate checks, not repeated for this synchronization.

For this synchronization, a fresh `npm ci`, all 70 application tests, and the production build passed again. The Python bridge suite passed 19 tests with one optional SDK decoder check skipped because `VEXO_KIT_PATH` was not configured. Browser acceptance was not rerun; all 12 source hashes in its existing acceptance record were independently matched. No physical band or paid provider was used for these checks.

## What is still in progress

- Mission context selecting and launching the controlled execution workflow is a separate ongoing integration. The verified test workflow here is manually triggered and uses fixed workers.
- Cloud execution and deployment acceptance are separate work. [Deployment files](CLOUD_DEPLOYMENT.md) alone do not establish a working hosted service.
- Long-duration and simultaneous multi-band acceptance remain open. The browser runner depends on the current host's owned-session allocator; it is not portable cloud computer control.
- Real emergency-service dispatch remains simulated. No actual emergency services are contacted by these demos.
- Optional [Antigravity work in PR #4](https://github.com/JakAcos/vexohacks/pull/4) remains a separate branch and is not silently combined with this checkpoint.

This is a time-bounded checkpoint of the completed, verified work, not a claim that other active chats have stopped or that their unfinished changes are accepted.

## Demo and prior publication

The earlier submission package remains at [Dante's publication commit `720a9b2`](https://github.com/dantegarcia654/relay-vexohacks/tree/720a9b2ab3cbb90492bba117e05e524233ac97f5), including its [labeled software demo](https://github.com/dantegarcia654/relay-vexohacks/blob/720a9b2ab3cbb90492bba117e05e524233ac97f5/demo/Relay-Software-Demo-V1.mp4) and submission notes. That video shows the earlier simulated workflow and labeled historical hardware evidence; it does not demonstrate the newer browser checkpoint.

Both existing default branches and prior publication artifacts are preserved. Source, tests, dependency lockfile, setup guides and reviewed synthetic verification records are included here. Credentials, raw speech, mission stores, screenshots, caches, dependency folders and compiled bundles are excluded. The manifests in [docs/verification](docs/verification) identify the accepted source and limits. New commits on the shared repository also appear in its [team handoff issue](https://github.com/JakAcos/vexohacks/issues/2).
