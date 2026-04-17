# Agent Playbook

This project is intentionally structured so coding agents can safely customize it.

## Safe Edit Zones

Look for these markers:

- `CUSTOMIZATION POINT` — expected user customization area
- `AI-EDIT-SAFE` — safe for automated edits
- `AI-EDIT-CAUTION` — integration-sensitive; edit carefully

## First Customization Steps

1. Edit `lib/system-prompt.md` to change agent behavior.
2. Edit `lib/plan-prompt.md` to match your updated system prompt — this controls the plan endpoint's behavior.
3. Change model choice in `lib/agent.ts`.
4. Extend schema in `lib/db/schema.ts` if you need app-specific data.
5. Ensure `ARCADE_GATEWAY_URL` is set and the gateway has the expected tools.
6. If your agent needs write/mutation tools (send, create, reply, post, etc.) during planning, edit the `MUTATION` regex filter in `app/api/plan/route.ts`. By default, all write tools are stripped from the plan endpoint to keep triage read-only.
7. Update `components/dashboard/empty-state.tsx` to match your agent's purpose — replace "Ready to triage?" heading, the description text, and "Plan my day" button label.
8. Look for `CUSTOMIZATION POINT` markers in UI files for other safe edit zones.

## Gateway Checklist

Create/configure your gateway at `https://app.arcade.dev/mcp-gateways` and add:

- Slack
- Google Calendar
- Linear
- GitHub
- Gmail

If you add tools from services not listed above, also add a source entry in `lib/sources.ts` so they get proper icons and labels in the UI.

## Verification Commands

```bash
bun run doctor
bun run typecheck
bun run lint
```
