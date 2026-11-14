# Push handoffs

The `Push teammate handoff` GitHub Actions workflow posts to https://github.com/JakAcos/vexohacks/issues/2 after branch pushes. Teammates should subscribe to that issue. Reports are automatically prepared, not human-reviewed.

The posting job runs only in `JakAcos/vexohacks`. Mirrors retain the workflow but skip the job, so a similarly numbered issue in another repository cannot receive the team's reports. See [TEAM_STATUS.md](../TEAM_STATUS.md) for the latest five-hour rundown and [STAGE_DEMO.md](../STAGE_DEMO.md) for the verified physical demo. Push reports and their continuation prompts link to both at the exact pushed revision.

For useful reasoning and next steps, include these lines in commit bodies before pushing. Claude and other coding agents should follow the same format:

```
Why: Explain the problem and resulting behavior.
Tests: Exact commands and outcomes; name skipped checks and blockers.
Next: The smallest useful next step and any inputs needed.
```

The workflow lists commits and changed paths, links associated PR context, reads setup files at the exact pushed SHA, and provides a copy-paste Claude prompt. It reports missing motivation honestly. Author test claims and PR descriptions are unverified. The workflow never runs application code or calls an AI service; there are no model charges or model secrets.

## Permissions and coverage

- Job token: `contents: read`, `pull-requests: read`, `issues: write`. No personal token or external webhook.
- Trigger: every branch push **on branches that contain the workflow**. No tag trigger.
- Installed on `main` and `feat/incident-copilot`. New branches created from these inherit it; branches created from older commits must add the workflow.
- No concurrency cancellation: separate rapid pushes get separate runs/comments. Comments may arrive out of order; use branch, SHA and run links.
- A rerun checks its run marker to avoid duplicating a delivered report. Run one rerun attempt at a time.
- GitHub API requests retry transient failures up to three times. Permanent failures leave a failed Actions run. GitHub availability, Actions quotas/policy and repository permissions still apply.
- Large comparisons, new/deleted refs, and force pushes may have limited history coverage; reports explicitly flag that limitation. Full diffs remain in Git history.
- Subscribe to Actions failure notifications as well as the issue. No external notification channel is configured, and receipt by the teammate has not been verified.

## Recovery

Open Actions → Push teammate handoff. Rerun a failed run to recover that push. Use **Run workflow** on the desired branch for a baseline at its current revision; a baseline does not reconstruct a missed historical push. Keep issue #2 open and retain the workflow on monitored branches.

The action dependency is pinned to the v8 release commit. Review and update it deliberately. The workflow reads selected repository files as data and does not execute them.
