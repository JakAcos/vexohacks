# Relay checkpoint handoff

**Current handoff: [TEAM_STATUS.md — five-hour rundown, fixes and present state](TEAM_STATUS.md).** Updated November 14, 2026 after two physical wristband runs passed in 40.910 and 39.325 seconds without manual retry. Prepared by Codex; agent-authored.

Start with the [stage runbook](STAGE_DEMO.md), [mission execution setup](MISSION_EXECUTION.md), [physical evidence](docs/verification/physical-demo-2026-11-14.json), and [combined-release verification](docs/verification/verified-wristband-release-2026-11-14.json).

The strongest demonstrated path is physical band → shared report → Gemini-selected test request → verified destination receipt → second Gemini agent’s confirmed follow-up. Real emergency-service dispatch remains simulated. The preserved browser worker is a separate, manually triggered capability; the mission AI does not route into it.

The earlier three-hour catch-up is superseded. Historical evidence remains scoped to its original commit:

| Checkpoint | Evidence |
| --- | --- |
| HTTP handoff `dc506a8` | [Request/receipt recovery](docs/verification/test-dispatch-2026-11-14.json) |
| Browser worker `b6901ce` | [Browser acceptance](docs/verification/browser-actions-2026-11-14.json) |
| Shared main `5f49379` | [Repository synchronization](docs/verification/main-merge-2026-11-14.json) |
| Mission AI `82f2aea` | [Synthetic-input live-Gemini acceptance](docs/verification/mission-execution-2026-11-14.json) |
| Current physical milestone | [Two no-manual-retry rehearsals](docs/verification/physical-demo-2026-11-14.json) |

Preserve completed evidence and private configuration. Use one process per store and a fresh mission for a new demo. Do not interpret historical hashes, packaged submission notes or the older software video as acceptance of every feature on current `main`.
