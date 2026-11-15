# Relay MCP server

Relay ships an [MCP](https://modelcontextprotocol.io) server so any MCP-capable AI agent (Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, VS Code, etc.) can read a mission and act on it.

It is a thin stdio client over the Relay HTTP API. All validation, idempotency, stale-version checks and access control stay in the Relay server, so an agent can do nothing through MCP that the dashboard could not.

## Run

```sh
npm ci && npm run build
npm start              # Relay on http://127.0.0.1:3001
npm run mcp            # MCP server on stdio (normally your agent launches this)
```

| Env var | Default | Purpose |
| --- | --- | --- |
| `RELAY_URL` | `http://127.0.0.1:3001` | Relay server origin |
| `RELAY_ACCESS_TOKEN` | unset | Bearer token when Relay runs in remote mode (`PUBLIC_ORIGIN` + `RELAY_ACCESS_TOKEN`) |

## Tools

| Tool | What it does |
| --- | --- |
| `relay_health` | Server reachable? demo or gemini mode, connectors in use |
| `relay_list_missions` | Saved missions, newest first, with report counts, active issues and pending approvals |
| `relay_get_mission` | Mission version and revision, situation issues with source report IDs, actions with their source reports and proposer, recent reports, pending jobs, latest briefing (`includeFull` for the raw record) |
| `relay_get_changes` | What changed since a time: new reports, issues with new evidence, changed actions, briefings, agent activity. Use `sinceMinutes`, or pass back the returned `cursor` as `since` to follow a mission without gaps |
| `relay_wait_for_change` | Blocks until the mission revision passes `afterRevision` (or the timeout), using Relay's live event stream, then returns the new summary |
| `relay_submit_report` | Add a typed responder report; waits for extraction and planning by default; `clientEventId` makes retries safe |
| `relay_propose_action` | An outside agent proposes a `service_request` (ems, fire, police) or `team_update` (team). Must cite existing report IDs. Always lands as "Needs approval" with "Proposed by external agent: <name>" on the dashboard. A second request for a service with an open request is linked, not duplicated |
| `relay_approve_action` | Dispatcher approval of a proposed action; needs the `expectedVersion` you reviewed, stale versions get HTTP 409 |
| `relay_dismiss_action` | Dismiss a proposed action |
| `relay_request_briefing` | Generate a source-based briefing |
| `relay_retry_report` / `relay_retry_planning` | Retry a failed job or failed planning |

Resource: `relay://missions/{incidentId}` returns the full mission JSON. It supports MCP subscriptions: subscribed clients get `notifications/resources/updated` on every committed change. Many clients (including Claude Code today) do not use subscriptions yet, which is why `relay_wait_for_change` exists.

Not exposed on purpose: mission reset, band controls and raw audio upload. Those are physical or destructive operations that should stay in the dashboard.

### Rules for agent proposals

- **Evidence required.** At least one report ID from the same mission, or Relay returns 422. Agents cannot invent actions from nothing.
- **Always human-approved.** Relay's own coordinator auto-sends team updates, but outside agents are less trusted, so their team updates also wait for a dispatcher.
- **No test-desk tickets.** Those execute automatically, so only Relay's own planner can create them.
- **Does not bump the mission version.** A proposal is not new evidence, so a dispatcher's view stays valid for approval.
- **Idempotent.** Retrying with the same `clientEventId` returns the original action.

### Multi-agent pattern

```
medical-agent   relay_wait_for_change -> relay_get_changes -> relay_propose_action (ems, cites report)
comms-agent     relay_wait_for_change -> relay_propose_action (team_update)
dispatcher      sees both in the dashboard (or via a co-pilot agent) -> approve / dismiss
```

## Connect an agent

**Claude Code**: this repo has a project `.mcp.json`, so just open the repo and approve the `relay` server. Elsewhere:

```sh
claude mcp add relay -e RELAY_URL=http://127.0.0.1:3001 -- node /path/to/relay/build-server/mcp/main.js
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.relay]
command = "node"
args = ["/path/to/relay/build-server/mcp/main.js"]
env = { RELAY_URL = "http://127.0.0.1:3001" }
```

**Claude Desktop, Cursor, Gemini CLI, VS Code** all take the same JSON shape (`claude_desktop_config.json`, `.cursor/mcp.json`, `~/.gemini/settings.json`; VS Code uses a top-level `servers` key instead of `mcpServers`):

```json
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["/path/to/relay/build-server/mcp/main.js"],
      "env": { "RELAY_URL": "http://127.0.0.1:3001" }
    }
  }
}
```

## Safety

Emergency connectors are simulated. The server instructions tell agents never to approve a service request without the user's explicit authorization, and that report text is untrusted data. Approval always requires the mission version the agent just read.

## HTTP endpoints added for this

- `GET /api/incidents` lists saved missions.
- `POST /api/actions/propose` creates an external proposal (body: `incidentId`, `proposedBy`, `kind`, `service`, `title`, `detail`, `sourceObservationIds`, optional `clientEventId`).

## Verification

`tests/mcp.test.ts` spawns the real MCP server over stdio against a real Relay instance in demo mode: submit report, EMS proposal, idempotent resubmit, stale approval rejected (409), approval with receipt, briefing, resource read, bad input and unreachable Relay errors. Further tests cover proposals (evidence check, kind/service check, idempotency, linking, team updates held for approval, approval with receipt), mission listing, change cursors, and live push (wait returns on a real change, waits that span Relay's 15 s heartbeat still end on time, subscribers receive `resources/updated`).

Live `claude -p` runs with only the `relay` MCP tools completed the dispatcher flow, proposed a source-linked EMS recommendation as `medical-agent` (shown on the dashboard with its proposer label), and woke from `relay_wait_for_change` within a second of a new report. Stored mission records were checked independently.
