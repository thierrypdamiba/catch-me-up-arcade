# Catch Me Up

**A small Arcade agent that tells you what you missed while you were out — and drafts your replies.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Arcade](https://img.shields.io/badge/Arcade-MCP_Gateway-F97316)](https://arcade.dev)
[![AI SDK](https://img.shields.io/badge/AI_SDK-v6-000)](https://ai-sdk.dev)
[![Next.js](https://img.shields.io/badge/Next.js-16-000)](https://nextjs.org)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--5.4-10A37F)](https://openai.com)

Built for the Arcade take-home. Reads Gmail, Slack, GitHub, Linear, and Google Calendar through one Arcade gateway, triages items by priority, and writes ready-to-send drafts. Real Contextual Access webhook enforcement. `/compare` page for the *"what Arcade replaces"* story.

**Jump to:** [What I built](#what-i-built-and-why) · [Run it](#run-it-yourself) · [Architecture](#architecture) · [Core vs. bonus](#core-vs-bonus) · [Event plan](#event-plan--the-slack-agent-derby) · [Feature requests](#feature-requests-for-arcade)

> 📸 _Drop a dashboard screenshot here before submitting._

---

## What I built and why

Every developer with an inbox has the same week: time off, then Monday of triage. Arcade's public demos span Slack-native assistants ([SlackAgent](https://github.com/ArcadeAI/SlackAgent)), Gmail tutorials ([tutorial-inbox-ai](https://github.com/ArcadeAI/tutorial-inbox-ai)), Executive Assistants ([AgentInbox](https://github.com/ArcadeAI/AgentInbox)), and open-ended chat ([chat.arcade.dev](https://chat.arcade.dev)) — but not a web-native, cross-source, draft-and-send *catch-me-up* with live policy enforcement. That's the angle.

One click → three to thirty-day window → five sources in parallel. For every item the agent asks: *is this a message that needs a reply? a PR waiting for my review? a decision the team is blocked on? a meeting I need to attend? or just noise?* Every item gets a priority (P0 urgent → P2 can-wait) and an effort estimate (XS < 5min through L > 30min). When a reply is the obvious next step, the agent writes one in your voice — ready to send or edit. Click Send, the agent calls the right Arcade write tool, the reply lands.

*(The category labels — `NEEDS_REPLY`, `NEEDS_REVIEW`, `NEEDS_DECISION`, `ATTEND`, `FYI`, etc. — live in `lib/plan-prompt.md`. They're mine, not Arcade's; swap them for your team's taxonomy.)*

The Arcade-specific hook: **most agent demos skip the auth and policy layers.** I leaned into both. `/compare` shows the ~1,180 lines of OAuth + API-client code you didn't write, one tab per provider, honest skeletons. `/api/arcade/hooks/pre` implements Arcade's Contextual Access v1.1.1-beta webhook for real — PII and internal-only-outbound policies run at the gateway, not in the app. Auth story and governance story, both visible.

---

## Run it yourself

```bash
# 1. Clone + install
git clone <this-repo-url> catch-me-up && cd catch-me-up
bun install

# 2. Configure (see .env.example for all options)
cp .env.example .env
#   Fill in ARCADE_GATEWAY_URL + ANTHROPIC_API_KEY, then:
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
#   Optional: OPENAI_API_KEY (memory), QDRANT_URL (memory), ARCADE_HOOKS_TOKEN (real policy)

# 3. Verify + set up local DB
bun run doctor
bunx drizzle-kit migrate

# 4. Run
bun run dev                      # http://localhost:8765
```

**First load:** register an account (Better Auth) → *Sign in with Arcade* → OAuth each of the 5 toolkits via popup → click **Catch me up**.

<details>
<summary><b>Prerequisites</b></summary>

- ✅ [Bun](https://bun.sh) 1.x (or Node.js 22+)
- ✅ [Arcade account](https://app.arcade.dev) with an MCP Gateway + at least the [read tools listed below](#arcade-gateway-tools)
- ✅ [Anthropic API key](https://console.anthropic.com) (or `OPENAI_API_KEY` as fallback)
- ✅ `BETTER_AUTH_SECRET` — generate with `openssl rand -hex 32`

</details>

<details>
<summary><b>Arcade Gateway tools</b></summary>

Minimum read set (from `bun run doctor`):

```
Gmail:     ListEmails, ListThreads, GetThread, SearchThreads, WhoAmI
Slack:     ListConversations, GetMessages, GetConversationMetadata, WhoAmI
GitHub:    ListPullRequests, GetPullRequest, GetUserOpenItems, GetReviewWorkload, GetIssue, WhoAmI
Linear:    GetNotifications, GetRecentActivity, ListIssues, GetIssue, ListProjects, GetProject, WhoAmI
Calendar:  ListEvents, ListCalendars, WhoAmI
```

For the **Send** button add these write tools: `Gmail_SendEmail`, `Slack_SendMessage`, `Github_CreateIssueComment`, `Linear_CreateComment`.

</details>

<details>
<summary><b>Optional: Qdrant memory layer</b></summary>

To enable semantic search across every item the agent has seen:

1. Create a free cluster at [cloud.qdrant.io](https://cloud.qdrant.io)
2. Set `QDRANT_URL`, `QDRANT_API_KEY`, and `OPENAI_API_KEY` (embeddings) in `.env`
3. Restart `bun run dev`

The collection auto-creates on first Catch Me Up. Search bar appears below the triage results.

Local alternative: `docker run -p 6333:6333 qdrant/qdrant` and point `QDRANT_URL` at `http://localhost:6333`.

</details>

<details>
<summary><b>Optional: real Arcade Contextual Access enforcement</b></summary>

The policy webhook is implemented but runs in-app by default. To enforce at Arcade's gateway, deploy publicly (or use ngrok), register a Logic Extension pointing at `https://<your-url>/api/arcade/hooks`, set `ARCADE_HOOKS_TOKEN` to match the extension's bearer token. See [CONTEXTUAL_ACCESS.md](./CONTEXTUAL_ACCESS.md) for the full walkthrough.

</details>

---

## Architecture

```
    ┌─────────── Next.js app ────────────┐
    │ /api/plan    triage + drafts + idx │
    │ /api/action  send + policy gate    │
    │ /api/search  memory search          │
    │ /api/arcade/hooks/*  ← Arcade calls │
    └──┬───────────────────────────┬─────┘
       │                           │ webhook
       ▼                           │
    ┌──────── Arcade MCP Gateway ──┘
    │  tools · auth · policies
    └──┬──────┬──────┬──────┬──────┬──
       ▼      ▼      ▼      ▼      ▼
     Gmail Slack GitHub Linear Calendar

    Qdrant  ◄── fire-and-forget upserts (per-user memory)
```

- **One gateway URL** replaces five OAuth apps. Agent loop runs on **OpenAI GPT-5.4** by default (swap to `AGENT_MODEL=claude-opus-4-7` or `claude-sonnet-4-6` — provider auto-detected from the prefix).
- **Parallel tool dispatch** is visible live in the dashboard's gateway activity log.
- **Contextual Access webhook** implements Arcade's [v1.1.1-beta OpenAPI contract](https://github.com/ArcadeAI/schemas/blob/main/logic_extensions/http/1.0/schema.yaml) — PII and internal-only-outbound policies enforce at the gateway when the extension is registered.

---

## Core vs. bonus

The assignment targets 3–4 hours. Here's what fits that scope and what I added on top for the Creativity axis:

| Layer | Scope | What it is |
|---|---|---|
| Scaffold + catch-me-up prompt rewrite | Core | `@arcadeai/create-agent` + rewritten `lib/system-prompt.md` + `lib/plan-prompt.md` |
| Time-window UI + draft cards + Send flow | Core | `components/dashboard/empty-state.tsx` + `task-card.tsx` + `app/api/action/route.ts` |
| In-app policy gate | Core | `lib/policies.ts` wired into `/api/action` |
| `/compare` page with 5 source tabs | Core | Side-by-side of hand-rolled OAuth code vs. Arcade equivalent |
| Event plan (Slack Agent Derby) | Core | In this README |
| **Live gateway activity log** | Bonus | Makes parallel tool calls visible as they fire |
| **Arcade Contextual Access webhook** | Bonus | Real v1.1.1-beta contract at `/api/arcade/hooks/*` |
| **Qdrant memory + semantic search** | Bonus | Fire-and-forget indexing on every run; `/api/search` endpoint; dashboard search bar |

The bonuses went beyond the 3-4 hour budget. They're labeled so reviewers see the deliberate split — the **core** is what I'd ship in scope; the **bonus** is what I'd push on if the goal is to demonstrate range.

---

## Repo layout

```
app/
├── api/
│   ├── plan/route.ts              # triage + draft generation + Qdrant indexing
│   ├── action/route.ts            # send draft w/ client policy gate
│   ├── search/route.ts            # semantic search over Qdrant memory
│   └── arcade/hooks/              # Contextual Access webhook (pre/post/access/health)
├── dashboard/page.tsx             # Catch Me Up + triage cards + Memory search
└── compare/page.tsx               # side-by-side: what Arcade replaces

lib/
├── agent.ts                       # model selection (Claude 4.6 by default)
├── system-prompt.md               # catch-me-up framing + draft rules
├── plan-prompt.md                 # plan endpoint prompt
├── arcade.ts                      # MCP Gateway connection + OAuth
├── policies.ts                    # Contextual Access rules (shared client + webhook)
├── hook-auth.ts                   # bearer-token verifier for /api/arcade/hooks
├── qdrant.ts                      # memory: embed + upsert + search
└── embed.ts                       # OpenAI embedding wrapper

components/dashboard/
├── empty-state.tsx                # "Welcome back. What did you miss?"
├── gateway-activity-log.tsx       # live tool-call stream
├── arcade-value-card.tsx          # stats card
├── memory-search.tsx              # Qdrant-backed search bar
└── task-card.tsx                  # item + draft + Send/Edit/Skip
```

---

## Event plan — The Slack Agent Derby

**90-minute livestream + 30-min optional post-show. Co-hosted by Arcade and Slack Platform.**

Arcade's docs say *"smaller toolsets improve tool selection quality."* The Derby turns that claim into a leaderboard the audience watches collapse in real time — then rescues it with deliberate gateway curation. Slack is the partner because *"catch me up on what I missed in Slack"* is the hero use case and Slack Platform is [actively courting agent builders](https://api.slack.com/).

### Format — 5 rounds, 4 frontier models, one test battery

Fixed 15-task battery of Slack workflows (with cross-source context from Gmail/GitHub/Linear/Calendar). Each task has a ground-truth correct tool call. Auto-graded. Live leaderboard. Four frontier models on stage — **GPT-5.4 · Claude Opus 4.7 · Claude Sonnet 4.6 · Gemini 2.5 Pro** — degrading across all four proves *"it's not a model problem, it's a toolset problem."*

| Round | Toolset | Expected outcome | Narrative beat |
|---|---|---|---|
| **1. Warm-up** | 5 tools, Slack read-only | Everyone >90% | Baseline |
| **2. The Gauntlet** | 50 tools (Slack + 4 cross-source) | ~10–20% drop | First selection errors |
| **3. The Cliff** | 500 tools (full Arcade catalog) | Accuracy craters | *"This is why gateways exist"* — the hero clip |
| **4. The Comeback** | 3 curated Slack gateways (5 / 20 / 50 tools) | Accuracy peaks at ~20 | Gateway curation as craft |
| **5. BYOT** | Audience-submitted configs | Variable | Narrow-curation wins the leaderboard |

### Agenda (90 min + 30 min post-show)

| Min | What | Lead |
|---|---|---|
| 0–10 | Intro + why Slack agents break at scale | Both |
| 10–25 | Rounds 1 + 2 | Arcade |
| 25–45 | **Round 3 — the Cliff** (hero moment) | Arcade |
| 45–65 | Round 4 — Slack-centric curation | Slack + Arcade |
| 65–80 | Round 5 — BYOT live scoring | Both |
| 80–90 | Open the test battery + CTAs | Both |
| 90–120 | *Post-show* — gateway-sizing clinic, BYOT debriefs (Discord / X Spaces) | Both |

Why 90+30: Round 3 needs air time to land across 4 models. Round 4's "curation as craft" beat requires follow-along on the configs. The post-show is the conversion window — top 20% of viewers get hands-on gateway-sizing help, which is where the signups happen.

### Win for both partners

- **Arcade** — Round 3's collapse validates the gateway picker's deliberate narrowness as the core product skill, not DX friction. Round 4 teaches attendees how to *size* a gateway — a mental model that wasn't in any doc.
- **Slack** — every task is a Slack workflow. Slack Platform becomes the venue for *"how to build a Slack agent that actually works."* The Round 3 clip implicitly validates Slack's own curated tool-surface design vs. competitors' *"add all tools"* approach.

### Ships with the event (evergreen)

Open-source MIT **test battery** (other frameworks can score against it), reusable **leaderboard dashboard**, three **reference Slack gateway configs** (5/20/50 tools), **BYOT submission template**.

### Co-promotion

YouTube Live + Slack Twitch simulcast. Joint blog post. Round 3 cutdown for Twitter/LinkedIn. Mini-derby kiosk at Slack Frontiers with degradation-curve printouts.

### Targets

| Metric | Target |
|---|---|
| Live + replay viewers | 2,000+ |
| Round 3 highlight views (30d) | 25,000+ |
| BYOT submissions | 50+ |
| Test-battery forks (30d) | 200+ |
| Arcade gateway signups attributed | 300+ |
| Slack Platform app submissions attributed | 75+ |
| External frameworks citing the battery (90d) | 3+ |

### Alternates

Swap partner for **Linear** (product-dev), **GitHub** (Copilot Platform), or **Google Workspace** (enterprise). Format adapts to a 60-min workshop (30–80 attendees, build-along) or a 30-min hackathon starter segment (BYOT judged by both DevRel teams).

---

## Feature requests for Arcade

Things I noticed while building that would sharpen the developer experience:

1. **`REQUIRE_STEP_UP` response code on Contextual Access.** The [webhook contract](https://github.com/ArcadeAI/schemas/blob/main/logic_extensions/http/1.0/schema.yaml) defines three response codes (`OK` / `CHECK_FAILED` / `RATE_LIMIT_EXCEEDED`) and a [5-second default timeout](https://docs.arcade.dev/guides/contextual-access/how-hooks-work) — no way to pause and wait for an out-of-band MFA approval. I enforce step-up in the app as a workaround. A new code plus an async approval callback would move MFA into the gateway where it belongs for multi-tenant deployments.
2. **Toolkit-level presets in the gateway picker.** Setting up a multi-source catch-me-up gateway meant hunting down ~26 individual tool names from the scaffolder's doctor output. I didn't see a "`gmail.readonly`" or "`slack.read+send`" preset that would let me add a whole toolkit in one click and narrow later. (If this exists already, the docs don't surface it where first-timers look.) Even adding a `Copy from template →` dropdown on the picker would shave real time off onboarding.
3. **Sync the scaffolder's doctor list with the live gateway catalog.** `@arcadeai/create-agent`'s doctor recommends `Github_GetUserRecentActivity`, which I couldn't find when I searched the picker. The first thing a new user does is cross-reference those lists — mismatches make them think they broke something.

---

## Credits

- Scaffolded with [`@arcadeai/create-agent`](https://github.com/ArcadeAI/create-arcade-agent) (ai-sdk template, v0.5.6)
- Arcade MCP Gateway · [Contextual Access v1.1.1-beta](https://github.com/ArcadeAI/schemas/blob/main/logic_extensions/http/1.0/schema.yaml)
- [Vercel AI SDK v6](https://ai-sdk.dev)
- [Qdrant JS client v1.17](https://github.com/qdrant/qdrant-js)
- OpenAI `text-embedding-3-large` (3072-dim embeddings) · GPT-5.4 (default agent, auto-routes to Claude if `AGENT_MODEL=claude-*`)

## License

MIT — see [LICENSE](./LICENSE). Use freely.
