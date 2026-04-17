<p align="center">
  <img src="./public/arcade-logo.svg" alt="Arcade" width="120" />
</p>

# Catch Me Up

A catch-me-up agent built on [Arcade](https://arcade.dev). Scans Gmail, Slack, GitHub, Linear, and Google Calendar in parallel for a time window you pick, triages what matters, and drafts ready-to-send replies. Includes a real implementation of Arcade's [Contextual Access webhook contract](https://github.com/ArcadeAI/schemas/blob/main/logic_extensions/http/1.0/schema.yaml) and a per-user Qdrant memory layer.

Built for the Arcade take-home. Scaffolded with [`@arcadeai/create-agent`](https://github.com/ArcadeAI/create-arcade-agent) (ai-sdk template, v0.5.6).

## What it does

Click "Catch me up" with a 3–30 day window. The agent:

1. Fans out parallel tool calls across the five sources through one Arcade gateway URL.
2. Classifies every item returned with a category (`NEEDS_REPLY`, `NEEDS_REVIEW`, `NEEDS_DECISION`, `ATTEND`, `FYI`, `IGNORE`), a priority (`P0`–`P2`), and an effort estimate. These labels live in `lib/plan-prompt.md` — they're this app's taxonomy, not Arcade's.
3. Writes a ready-to-send `draftReply` in the user's voice for anything reply-shaped.
4. Indexes each classified item into a per-user Qdrant collection for later semantic search.
5. Surfaces a **Send** button on each draft. Clicking it routes through the Arcade gateway. If the Contextual Access webhook is registered, policy enforces at the gateway; otherwise an in-app policy chain mirrors the same rules.

## Prerequisites

- Node.js >= 22
- Bun >= 1.x (install from [bun.sh](https://bun.sh))
- An [Arcade account](https://app.arcade.dev) and an MCP Gateway at [app.arcade.dev/mcp-gateways](https://app.arcade.dev/mcp-gateways)
- An LLM API key — [OpenAI](https://platform.openai.com) (default: `gpt-5.4`) or [Anthropic](https://console.anthropic.com) (default: `claude-sonnet-4-6`)
- *Optional, for memory:* [Qdrant Cloud](https://cloud.qdrant.io) free tier or local Docker, plus `OPENAI_API_KEY` for embeddings

## Quick start

```bash
bun install
cp .env.example .env
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
# then fill in ARCADE_GATEWAY_URL + your LLM key in .env
bun run doctor
bunx drizzle-kit migrate
bun run dev
```

Open [http://localhost:8765](http://localhost:8765), register, connect Arcade, authorize each toolkit once, click **Catch me up**.

## Configuration

### Required

| Variable | Description |
|---|---|
| `ARCADE_GATEWAY_URL` | MCP Gateway URL from [app.arcade.dev/mcp-gateways](https://app.arcade.dev/mcp-gateways) |
| `ANTHROPIC_API_KEY` *or* `OPENAI_API_KEY` | At least one LLM provider key |
| `BETTER_AUTH_SECRET` | Session-signing key — generate with `openssl rand -hex 32` |

### Optional

| Variable | Description |
|---|---|
| `AGENT_MODEL` | Override model (provider auto-detected). Examples: `gpt-5.4`, `gpt-5.4-mini`, `claude-opus-4-7`, `claude-sonnet-4-6` |
| `EMBEDDING_MODEL` | `text-embedding-3-large` (default, 3072-dim) or `text-embedding-3-small` |
| `QDRANT_URL` | Enables the memory layer. Set together with `QDRANT_API_KEY` for Qdrant Cloud |
| `QDRANT_API_KEY` | API key for your Qdrant cluster |
| `QDRANT_COLLECTION` | Collection name (default: `catchmeup_items`) |
| `ARCADE_HOOKS_TOKEN` | Bearer token Arcade uses to call your Contextual Access webhook |
| `INTERNAL_DOMAIN` | Domain allowlist for the `internal-only-outbound` policy (default: `arcade.dev`) |
| `ARCADE_CUSTOM_VERIFIER` | Set to `true` to enable COAT protection in production |
| `ARCADE_API_KEY` | Required when custom verifier is enabled |
| `DATABASE_URL` | SQLite file path (default: `local.db`) |
| `PORT` | Server port (default: `8765`) |

## Arcade Gateway setup

Enable only the tools below in your gateway. Narrower is better — Arcade's docs recommend it, and the [`/compare`](#what-arcade-replaces) page demonstrates why.

- **Slack:** `Slack_ListConversations`, `Slack_GetMessages`, `Slack_GetConversationMetadata`, `Slack_WhoAmI`
- **Google Calendar:** `GoogleCalendar_ListEvents`, `GoogleCalendar_ListCalendars`, `GoogleCalendar_WhoAmI`
- **Linear:** `Linear_GetNotifications`, `Linear_GetRecentActivity`, `Linear_ListIssues`, `Linear_GetIssue`, `Linear_ListProjects`, `Linear_GetProject`, `Linear_WhoAmI`
- **GitHub:** `Github_ListPullRequests`, `Github_GetPullRequest`, `Github_GetUserOpenItems`, `Github_GetUserRecentActivity`, `Github_GetReviewWorkload`, `Github_GetIssue`, `Github_WhoAmI`
- **Gmail:** `Gmail_ListEmails`, `Gmail_ListThreads`, `Gmail_GetThread`, `Gmail_SearchThreads`, `Gmail_WhoAmI`

For the Send button to execute writes, also add: `Gmail_SendEmail`, `Slack_SendMessage`, `Github_CreateIssueComment`, `Linear_CreateComment`.

## Make it yours

Every extensibility point is marked in the code. The files you'll actually touch:

| File | Purpose |
|---|---|
| `lib/system-prompt.md` | Agent personality and purpose |
| `lib/plan-prompt.md` | Triage + draft generation rules |
| `lib/agent.ts` | Model selection (auto-routes by `AGENT_MODEL` prefix) |
| `lib/policies.ts` | Contextual Access policies (shared by client + webhook) |
| `lib/qdrant.ts` | Memory layer — collection, distance, payload shape |
| `lib/embed.ts` | Embedding model — swap OpenAI for Voyage/Cohere in one file |
| `lib/arcade.ts` | MCP Gateway connection and OAuth |
| `components/dashboard/empty-state.tsx` | "Catch me up" entry UI |
| `app/compare/code-samples.ts` | Side-by-side code on the `/compare` page |
| `.env` | Configuration |

## Architecture

```
    Next.js app (this repo)
     ├─ /api/plan              triage + drafts + fire-and-forget Qdrant index
     ├─ /api/action            send draft (with client-side policy gate)
     ├─ /api/search            memory search (filtered per-user)
     └─ /api/arcade/hooks/*    Arcade calls us: pre, post, access, health

    Arcade MCP Gateway ──► Gmail · Slack · GitHub · Linear · Calendar
    Qdrant ◄── fire-and-forget upserts (per-user memory, vector search)
```

One gateway URL, one webhook. The Contextual Access webhook at `/api/arcade/hooks/pre` implements Arcade's [v1.1.1-beta OpenAPI contract](https://github.com/ArcadeAI/schemas/blob/main/logic_extensions/http/1.0/schema.yaml) — to my knowledge the first public TypeScript reference implementation of that contract. Policy logic in `lib/policies.ts` is shared between the webhook and the in-app gate, so enforcement stays consistent whether the gateway is configured to call the extension or not.

## Scope

The take-home target was 3–4 hours. This splits cleanly:

**In scope**
- Catch-me-up framing, triage, draft generation, Send flow
- In-app policy gate
- `/compare` page with side-by-side code
- Event plan

**Added on top for Creativity**
- `/api/arcade/hooks/*` — real v1.1.1-beta Contextual Access webhook
- Qdrant memory layer + `/api/search`
- Live gateway activity log in the dashboard

## Contextual Access

By default the policy chain runs in `/api/action` on the client side, so the demo works without any external registration. To enforce at Arcade's gateway edge:

1. Deploy publicly (or expose localhost with ngrok)
2. Register a Logic Extension at [app.arcade.dev](https://app.arcade.dev) pointing at `https://<your-url>/api/arcade/hooks`
3. Set `ARCADE_HOOKS_TOKEN` in `.env` to match the extension's bearer token
4. Attach the extension to your gateway with `fail-closed` mode for the pre-execution hook

Full walkthrough in [CONTEXTUAL_ACCESS.md](./CONTEXTUAL_ACCESS.md).

Two policies enforce at the gateway: `pii-outbound` (scans draft for SSN and credit-card patterns) and `internal-only-outbound` (restricts Gmail sends to `INTERNAL_DOMAIN`). A third, `high-risk-needs-mfa`, stays client-side — the webhook contract is synchronous with a 5-second timeout and has no native way to pause for out-of-band MFA approval. See [Feature requests](#feature-requests-for-arcade).

## Memory layer

Enable by setting `QDRANT_URL`, `QDRANT_API_KEY`, and `OPENAI_API_KEY`. The collection auto-creates on first catch-up (1536 or 3072 dim cosine, payload indexed by `user_id`). Every run upserts with deterministic point IDs — re-running a catch-up updates existing points in place instead of duplicating.

Dedup verified in production testing: 51 points across 4 runs, 0 hard duplicates, 0 near-duplicate summaries. To reset, delete the collection via the Qdrant API — next catch-up recreates it.

## Troubleshooting

**Port already in use.** Default port is 8765. Change via `PORT` in `.env`.

**`ARCADE_GATEWAY_URL is missing`.** Create a gateway, add the tools listed above, copy the URL into `.env`.

**Tool calls return authorization URLs.** Expected. The first time the agent hits a tool, the user OAuths that provider. The dashboard surfaces the auth link.

**Login form appears unexpectedly.** `local.db` was deleted or `BETTER_AUTH_SECRET` changed. Register again; session persists for 7 days.

**Memory search returns nothing.** Collection hasn't been populated yet — run a catch-up first.

**Qdrant dimension mismatch error.** You switched `EMBEDDING_MODEL` after data was indexed. Drop the collection and re-run.

## Production notes

This demo uses local-development defaults that don't scale:

- **OAuth tokens** live in `.arcade-auth/` (file-based). Multi-user deployments need a DB-backed store keyed by user ID, or enable `ARCADE_CUSTOM_VERIFIER=true` + `ARCADE_API_KEY` so Arcade holds tokens server-side.
- **SQLite** via Better Auth is single-node. Swap for Postgres or Turso for serverless deploys.
- **Contextual Access webhook** needs a public URL (deploy or ngrok) for Arcade's gateway to reach it.
- **Embedding model swaps** require re-indexing — vectors aren't interchangeable across models.

## Event plan — The Slack Agent Derby

**90-minute livestream + 30-minute optional post-show. Co-hosted by Arcade and Slack Platform.**

Arcade's docs say *"smaller toolsets improve tool selection quality."* The Derby turns that claim into a leaderboard the audience watches collapse in real time — then rescues it with deliberate gateway curation. Slack is the workflow partner because *"catch me up on what I missed in Slack"* is the single highest-signal catch-me-up source, and Slack Platform is [actively courting agent builders](https://api.slack.com/).

### Format

Fifteen-task battery of Slack workflows with cross-source context. Each task has a ground-truth correct tool call. Auto-graded. Live leaderboard. Four frontier models on stage — **GPT-5.4 · Claude Opus 4.7 · Claude Sonnet 4.6 · Gemini 2.5 Pro** — degrading in lockstep on Round 3 proves *"it's not a model problem, it's a toolset problem."*

| Round | Toolset | Expected outcome | Narrative beat |
|---|---|---|---|
| 1. Warm-up | 5 tools, Slack read-only | Everyone >90% | Baseline |
| 2. The Gauntlet | 50 tools (Slack + 4 cross-source) | ~10–20% drop | First selection errors |
| 3. The Cliff | 500 tools (full Arcade catalog) | Accuracy craters | *"This is why gateways exist"* — the hero clip |
| 4. The Comeback | Three curated Slack gateways (5 / 20 / 50 tools) | Accuracy peaks at ~20 | Gateway curation as craft |
| 5. BYOT | Audience-submitted gateway configs | Variable | Narrow-curation wins the leaderboard |

### Agenda

| Minutes | What | Lead |
|---|---|---|
| 0–10 | Intro: why Slack agents break at scale | Both DevRel |
| 10–25 | Rounds 1 + 2 | Arcade |
| 25–45 | Round 3 — the Cliff (hero moment) | Arcade |
| 45–65 | Round 4 — Slack-centric curation | Slack + Arcade |
| 65–80 | Round 5 — BYOT live scoring, audience vote | Both |
| 80–90 | Open the test battery + CTAs | Both |
| 90–120 | Post-show on Discord / X Spaces — gateway-sizing clinic, BYOT debriefs | Both |

### Why this works for both partners

- **Arcade** — Round 3's collapse validates the gateway picker's deliberate narrowness as a product skill, not DX friction. Round 4 teaches attendees how to *size* a gateway, filling a gap that isn't in any doc today.
- **Slack** — every task is a Slack-workflow task, so Slack Platform owns the venue for *"how to build a Slack agent that actually works."* The Round 3 cutdown implicitly validates Slack's own curated tool-surface design against competitors' *"add all tools"* approach.

### Evergreen artifacts

Open-source MIT test battery. Reusable leaderboard dashboard. Three reference Slack gateway configs (5 / 20 / 50 tools) as JSON. BYOT submission template. Other agent frameworks can score against the battery the week after the event, producing citations indefinitely.

### Measurable targets

| Metric | Target |
|---|---|
| Live + replay viewers | 2,000+ |
| Round 3 highlight views (30 days) | 25,000+ |
| BYOT submissions | 50+ |
| Test-battery forks (30 days) | 200+ |
| Arcade gateway signups attributed | 300+ |
| Slack Platform app submissions attributed | 75+ |
| External frameworks citing the battery (90 days) | 3+ |

### Alternates

Swap Slack for **Linear** (product-dev teams), **GitHub** (Copilot Platform co-host), or **Google Workspace** (enterprise Gmail + Calendar). For smaller audiences, the same content becomes a 60-minute workshop (booths, meetups, 30–80 attendees). For hackathons, a 30-minute opener with BYOT judged by both DevRel teams.

## Feature requests for Arcade

1. **`REQUIRE_STEP_UP` response code on Contextual Access.** The [webhook contract](https://github.com/ArcadeAI/schemas/blob/main/logic_extensions/http/1.0/schema.yaml) defines three response codes (`OK` / `CHECK_FAILED` / `RATE_LIMIT_EXCEEDED`) and a [5-second default timeout](https://docs.arcade.dev/guides/contextual-access/how-hooks-work). There's no way to pause and wait for an out-of-band MFA approval. I enforce step-up in the app as a workaround. A new code plus an async approval callback would move MFA into the gateway where it belongs for multi-tenant deployments.
2. **Toolkit-level presets in the gateway picker.** Setting up a multi-source catch-me-up gateway meant hunting ~26 individual tool names from the scaffolder's `doctor` output. I didn't find a "`gmail.readonly`" or "`slack.read+send`" preset to add a whole toolkit in one click and narrow later. If this exists already, the docs don't surface it where first-timers look.
3. **Sync the scaffolder's doctor list with the live gateway catalog.** `@arcadeai/create-agent`'s doctor recommends `Github_GetUserRecentActivity`, which I couldn't find when I searched the picker. The first thing a new user does is cross-reference those lists — mismatches make them think they broke something.

## Credits

Scaffolded with [`@arcadeai/create-agent`](https://github.com/ArcadeAI/create-arcade-agent) (ai-sdk template, v0.5.6). Arcade MCP Gateway, [Contextual Access v1.1.1-beta](https://github.com/ArcadeAI/schemas/blob/main/logic_extensions/http/1.0/schema.yaml) (MIT), Vercel AI SDK v6, Qdrant v1.17 JS client, OpenAI `text-embedding-3-large` for memory embeddings, GPT-5.4 or Claude Sonnet 4.6 for the agent.

## License

MIT — see [LICENSE](./LICENSE).
