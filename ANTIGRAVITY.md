# Antigravity mission coordinator

Relay can use Google's managed Antigravity agent to read shared mission context and propose source-linked actions. This is a product integration through the Gemini Interactions API, not an Antigravity editor session or a claim that a multi-agent swarm is running.

The existing Gemini extraction path stays in place. Antigravity optionally replaces only the action planner. Vexo remains the wearable input source, with physical versus simulated provenance shown separately. MiniMax can support pitch-video narration; Meta and Deepgram remain optional. No sponsor is credited with work it did not perform.

## What judges can see

1. Submit a report through the existing input flow. The sponsor panel identifies its actual source and extraction mode.
2. Open **Mission orchestration → Agent activity**. Successful Antigravity turns add `read_mission_context` and `propose_actions` entries, with real provider interaction references and the captured mission version.
3. Inspect the resulting action and its report-source link. Inferred resource needs are recommendations with uncertainty. Service requests show **Needs approval**.
4. Approve a service request to obtain a clearly labeled simulated execution receipt. Team updates use the existing automatic simulated connector.

Tool entries are emitted only after the provider requests a recognized tool and its arguments validate. Selecting the provider is not execution evidence. If completion fails after tools run, their activity remains alongside a planning-failure message; proposals are not applied. Prior reports remain available for retry. Model reasoning is not displayed or stored by this adapter.

## Integration status

The additive adapter is safe to review independently. `integration/antigravity-coordinator.patch` wires it into the mission orchestrator from the frozen `Relay-Mission-Orchestrator.zip` release (SHA-256 `3d02721a32d31cd1444d0f05b8f5987f0fd62c400d19d772da70903ddf5e862c`). That orchestration code was not yet on this branch's GitHub base when prepared. The patch is deliberately separate to avoid overwriting concurrent release work. This branch alone does not enable the option in the app.

Apply after the mission-orchestrator files land, from the repository root:

```sh
git apply --check integration/antigravity-coordinator.patch
git apply integration/antigravity-coordinator.patch
cp integration/antigravity-coordinator.test.ts tests/
cp integration/check-antigravity-coordinator.mjs scripts/
npm test
npm run build
```

Set server environment values and restart the intended demo instance:

```dotenv
AGENT_MODE=gemini
COORDINATOR_PROVIDER=antigravity
# GEMINI_API_KEY and GEMINI_MODEL are still required by the existing Gemini input path.
```

Unset `COORDINATOR_PROVIDER`, or set it to `gemini`, to keep the current Gemini coordinator. Demo mode continues using deterministic rules. There is no automatic fallback on Antigravity failure.

The adapter exposes only `read_mission_context` and `propose_actions`. It supplies a captured context of up to 12 reports and 20 actions, capped at 40,000 characters. It allows at most four provider requests and four proposals, with a 45-second planning deadline. Initial agent configuration requests a 6,000-token limit. Tool continuations explicitly retain the tool definitions and use text-content function results. Proposals must cite known reports, including the newest report. They cannot approve or dispatch services. Existing mission locking, approval checks and simulated connectors remain responsible for applying results.

A restricted-network remote environment is created per planning turn and deleted afterward; cleanup warnings are retained on successful results. If a request fails before an environment ID is returned, immediate deletion cannot be confirmed. This preview integration needs latency, data-handling and reliability review before any operational use.

## Evidence and checks

Agent-authored verification, 2026-11-14:

- `integration/live-provider-evidence.json`: actual provider context → proposal → completion sequence, 17.6 seconds, synthetic text, two source-linked proposals; environment deletion confirmed.
- `integration/live-coordinator-evidence.json`: actual provider routed through the release coordinator, including approval state and simulated team-update receipts. This is a synthetic pre-extracted fixture, not proof of audio, wearable capture, or Gemini extraction.
- Release snapshot with patch: 45 automated tests passed; production build passed. Includes unknown sources, tool ordering, malformed actions, missing evidence, provider outages, approval preservation, no false execution labels and unchanged existing mission behavior.

Rerun only when live provider usage is intended:

```sh
node --env-file=.env scripts/check-antigravity.mjs --live
node --env-file=.env scripts/check-antigravity-coordinator.mjs --live
```

The first command tests the standalone adapter; the second requires the integration patch and copied script. Both send fixed synthetic reports and use the server-side Gemini key. Neither is part of `npm test`. Timing is a measured sample, not a latency guarantee; this coordinator is not intended to process every audio frame.

Official references: [managed Antigravity agent](https://aistudio.google.com/docs/antigravity-agent), [Antigravity SDK](https://antigravity.google/docs/sdk/overview), [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling).
