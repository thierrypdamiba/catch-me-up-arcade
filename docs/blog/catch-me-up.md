# Give your agent hands AND memory: a catch-me-up agent in one weekend

Every Monday after time off looks the same. You open your laptop, you feel the weight of five tabs you haven't touched, and you spend ninety minutes on inbox archaeology trying to figure out what actually happened while you were out. I've tried the usual fixes — smart filters, a Slack bot, a fourth attempt at inbox zero. None of them survived first contact with an actual missed week.

So I built the thing I wanted. One button, five sources, real drafts ready to send. The first full catch-up across Gmail, Slack, GitHub, Linear, and Google Calendar took about thirty seconds. The reply I sent to the first triaged item landed in a colleague's inbox twenty seconds after that. The repo's [on GitHub](#) — fork it, point it at your accounts, and you'll have the same thing running locally by lunch.

This post is how the thing actually works — and the two layers you need that nobody tells you about until you hit them.

The first layer you already know: **hands**. The agent can touch real services. OAuth, tokens, API clients, the whole rodeo. That's Arcade.

The second layer is quieter but harder without: **memory**. Not short-term context — the stuff the agent has already seen, persisted and searchable, so next Monday's run doesn't start from zero and next Wednesday's *"what did Jane say about Q2?"* doesn't require refetching from the provider. That's Qdrant.

If you want your agent to be useful across sessions, you need both. Here's how they fit together.

## Why catch-me-up is a two-layer problem

A catch-me-up agent is the use case that cleanly forces you to solve the three hard problems most agent demos skip.

**You need real auth across many services.** Not one OAuth flow — five of them, against providers that each have their own scope model, their own token lifetime, their own rate limits. This is the part that turns "weekend project" into "two-week project" if you try to do it yourself.

**You need structured output across heterogeneous sources.** A Gmail thread, a Slack message, a GitHub PR, a Linear issue, a Calendar event — these return five different JSON shapes. Your UI needs one shape. Somewhere, something has to normalize.

**You need memory across runs.** Your week doesn't reset on Monday. If the agent classified an email last Tuesday and you want to pull it up Thursday, refetching every provider is wasteful and slow. The classification already happened; the result should survive.

Chat-first agents dodge all three. RAG-only agents dodge two. Catch-me-up lets you dodge none. That's why it's the right shape for showing what happens when you give an agent proper hands and memory.

## Hands: one gateway, five providers

The hard part of agent-building isn't the LLM. It's the OAuth.

Go through the exercise yourself. Gmail alone: create a Google Cloud project, configure the consent screen, add scopes, verify your domain for distribution, generate a `client_id`/`client_secret`, store them, implement PKCE, exchange codes, persist refresh tokens per-user, rotate access tokens every ~50 minutes, handle scope re-consent when Google changes its mind. That's ~320 lines of real code — and that's *just the Gmail integration*. Slack has its own app manifest and install flow. GitHub has its own rate-limit tiers. Linear has its own GraphQL shape. Calendar shares Google's plumbing but different scopes. Multiply by five and you're a week in before the first email is fetched.

Arcade replaces all of that with one gateway URL:

```ts
import { getArcadeMCPClient } from "@/lib/arcade";

const mcp = await getArcadeMCPClient();
const tools = await mcp.tools();
// tools now contains Gmail_ListEmails, Slack_GetMessages,
// Github_GetUserOpenItems, Linear_ListIssues,
// GoogleCalendar_ListEvents, and anything else on this
// gateway's allow-list. Zero OAuth code, zero token handling.
```

That `getArcadeMCPClient()` wraps Arcade's MCP Gateway — a managed endpoint that speaks the [Model Context Protocol](https://modelcontextprotocol.io) and resolves to N underlying SaaS tools. The gateway handles OAuth per tool, token refresh, rate-limit back-off, and scope escalation. From your code's point of view, it's just a typed tool list.

Which matters for catch-me-up because **step one** is fanning out across every source in parallel. The [Vercel AI SDK](https://ai-sdk.dev)'s `streamText` loop makes that trivial:

```ts
const result = streamText({
  model: anthropic("claude-sonnet-4-6"),
  tools,
  stopWhen: stepCountIs(30),
  messages: [{ role: "user", content: `Catch me up on the last 7 days…` }],
  system: planPrompt,
});
```

On the first step, Claude calls every tool it decides is relevant — in my runs, about 13 of 20 gateway tools fire in a single parallel burst, then 5-6 follow-up drill-downs happen on step two. Twelve seconds after the click, the agent has enough classified data to start streaming triage cards back to the UI.

There's a subtle lesson here that Arcade's docs already call out: *"smaller toolsets improve tool selection quality."* Watching Claude select 13 of 20 on step one is that advice in action — the model is making a judgment about which entry-point tools to hit and which to skip. Give it 500 tools instead, and accuracy craters. Your gateway's tool list isn't a menu, it's a prompt. Every tool you leave in is a token Claude has to evaluate. Curate.

## Triage is a prompt problem

Once the tool responses come back, you have messy provider JSON. You need structured, typed `InboxItem` blocks the UI can render. The LLM is the classifier.

The system prompt does two things. First, it defines a taxonomy:

```
Category:  NEEDS_REPLY | NEEDS_FEEDBACK | NEEDS_DECISION
         | NEEDS_REVIEW | ATTEND | FYI | IGNORE
Priority:  P0 | P1 | P2 | FYI
Effort:    XS (<5m) | S (5-15m) | M (15-30m) | L (>30m)
```

Second, it tells the model to emit one `json:task` block per actionable item, and — for anything in the first four categories — to also write a ready-to-send `draftReply` in the user's voice. That draft is what you actually ship when you click Send.

Two things I learned tuning this prompt:

**Labels are a taste decision, not a standard.** My seven categories are what worked for my inbox. If you're triaging customer support instead of personal mail, you want NEEDS_TRIAGE / NEEDS_ESCALATION / SOLVED. Swap them in `lib/plan-prompt.md` — the rest of the app just reads enum values back, it doesn't care what they mean.

**Different frontier models produce different item densities on the same data.** Same prompt, same data window, Claude Sonnet 4.6 surfaces ~11 items per run while GPT-5.4 surfaces ~6. Neither is wrong. Sonnet errs toward inclusion (borderline items get classified as FYI instead of dropped); GPT-5.4 filters harder. For a demo, Sonnet's output feels richer. For a production setup where a user might act on every item surfaced, GPT's conservatism might be better. The point: your prompt is tuned against one model's bias. Switching models is a breaking change.

## Defense in depth with Contextual Access

Here's the part that nobody tells you about when they sell you on AI agents.

If you build an agent that can write — send emails, post to Slack, comment on PRs — the auth layer is only half the security story. The other half is a policy layer. What counts as an acceptable send? Can this user email external domains? Are you leaking PII into a draft? Does this high-risk action require step-up MFA? Most teams either build this themselves (500+ lines of bespoke gating code, badly tested) or skip it entirely and hope for the best.

Arcade's answer is [Contextual Access](https://docs.arcade.dev/guides/contextual-access) — a webhook contract (v1.1.1-beta, [OpenAPI schema on GitHub](https://github.com/ArcadeAI/schemas/blob/main/logic_extensions/http/1.0/schema.yaml)) where Arcade calls your policy endpoint *before* every tool execution. You return `OK` or `CHECK_FAILED` with an error message, and the gateway enforces your decision.

The policies I ship in this demo are the two that matter for a catch-me-up agent:

```ts
// lib/policies.ts — shared between the in-app gate and the webhook.
function piiOutbound(ctx: PolicyContext): PolicyResult {
  const matched: string[] = [];
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(ctx.body)) matched.push("SSN");
  if (/\b(?:\d{4}[- ]?){3}\d{4}\b/.test(ctx.body)) matched.push("Credit card");
  if (matched.length === 0) return { allow: true };
  return { allow: false, policy: "pii-outbound", reason: `…${matched.join(" + ")}…`, action: "block" };
}

function internalOnlyOutbound(ctx: PolicyContext): PolicyResult {
  if (ctx.target.type !== "gmail_reply") return { allow: true };
  const external = findEmails(ctx.body).filter((e) => !e.endsWith(`@${INTERNAL_DOMAIN}`));
  if (external.length === 0) return { allow: true };
  return { allow: false, policy: "internal-only-outbound", reason: `External: ${external}`, action: "block" };
}
```

Two things that matter about this design.

**The policy function runs in both places.** The app's `/api/action` route calls `runPolicies()` before dispatching any write tool, so the UX feels instant when a draft is blocked. The webhook at `/api/arcade/hooks/pre` calls the same `runPolicies()` when Arcade's gateway dispatches to the underlying service. One function, two enforcement points. A malicious client that bypasses the UI still hits the gateway. Defense in depth means the client isn't the only wall.

**The webhook contract is smaller than you think.** Implementing Arcade's v1.1.1-beta spec is fewer than 100 lines of TypeScript — request shape, response shape, bearer auth, done. As far as I can tell, this is the first public TypeScript reference for the contract — their [logic-extensions-examples](https://github.com/ArcadeAI/logic-extensions-examples) repo ships Go servers. If you're on a Next.js / Vercel stack, the pattern in `/api/arcade/hooks/pre` is the fastest path.

There's one honest gap I hit during the build: **Contextual Access has no native step-up MFA.** The webhook is synchronous with a 5-second default timeout. There's no way to return *"pause this call, ask the user for MFA, resume on approval."* My third policy — `high-risk-needs-mfa` for Slack posts and GitHub PR comments — therefore enforces in the client, not the gateway. That's worth calling out because it's a real product gap: a `REQUIRE_STEP_UP` response code with an async approval callback would move MFA into the gateway where it belongs for multi-tenant deployments. I mentioned this in the feedback I sent Arcade along with the submission. It's exactly the kind of thing a real webhook contract grows into once teams start using it in production.

## Memory: Qdrant as the other half

Hands give you action. Memory gives you continuity.

After the agent classifies everything, you have structured items — typed, useful, summarized. If you throw them away after the UI renders them, you're back to refetching every provider every Monday. Worse, you can't answer natural queries like *"what did Jane say about Q2 last week?"* without another full catch-up cycle.

So every classified item gets embedded and upserted into a per-user Qdrant collection, fire-and-forget, at the tail of the plan endpoint:

```ts
import { QdrantClient } from "@qdrant/js-client-rest";
import { openai } from "@ai-sdk/openai";
import { embedMany } from "ai";

const client = new QdrantClient({ url: process.env.QDRANT_URL!, apiKey: process.env.QDRANT_API_KEY });
const embeddingModel = openai.embedding("text-embedding-3-large"); // 3072-dim

export async function upsertItems(userId: string, items: InboxItem[]) {
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: items.map((it) => `[${it.source}] ${it.summary}`),
  });
  await client.upsert("catchmeup_items", {
    points: items.map((item, i) => ({
      id: hashId(userId, item),   // deterministic: userId::source::item.id
      vector: embeddings[i],
      payload: { user_id: userId, source: item.source, ...item },
    })),
  });
}
```

Three things about this that matter.

**Dedup is free if you hash the ID deterministically.** The point ID is a hash of `userId::source::item.id`. Re-running a catch-up over an overlapping window means the same thread gets the same ID, and Qdrant's upsert overwrites in place rather than duplicating. Across four runs on my data, 51 points indexed and zero duplicates. No audit, no cleanup job — just correct-by-construction storage.

**User scoping is a filter, not a collection-per-user.** Every point carries `user_id` in its payload, and queries filter on it. That means one collection scales to N users without operational overhead, and you can still run analytics across the whole corpus if you want. Qdrant's [indexed payload fields](https://qdrant.tech/documentation/concepts/indexing/#payload-index) make the filter cheap.

**Embeddings matter more than you'd think, but not in the obvious way.** I'm using OpenAI's `text-embedding-3-large` (3072 dimensions) — not because Arcade recommends it, but because it's the best price/quality tradeoff for the short, summary-shaped text we're indexing. Scores on semantic queries sit in the 0.4–0.55 range for on-topic matches and 0.1–0.15 for unrelated queries. That gap between signal and noise is what matters for search quality, not the absolute numbers. [Kacper Łukawski has written the definitive piece on this](https://qdrant.tech/articles/hybrid-search/) — if you want to push further (hybrid search, reranking), start there.

The result: a searchable archive of every item the agent has ever classified, keyed to you, queryable in natural language. Not an after-the-fact add-on — a first-class feature that makes the agent actually useful after the first run.

## What I'd build next

Three things surfaced while building this that I'd ship in my first month at Arcade.

**A `REQUIRE_STEP_UP` response code on Contextual Access.** Webhook is synchronous with a 5-second timeout and three response codes. There's no native way to pause for an out-of-band MFA approval. I enforce step-up in the app as a workaround. A new code with an async approval callback would move MFA into the gateway where it belongs for enterprise deployments.

**Toolkit-level presets in the gateway picker.** Setting up a multi-source gateway meant hunting down ~26 individual tool names from the scaffolder's doctor output. A `gmail.readonly`, `slack.read+send` shorthand — narrow later — would shave real time off first-run onboarding. If this exists already, the docs don't surface it where first-timers look.

**Sync the scaffolder's `doctor` list with the live gateway catalog.** `@arcadeai/create-agent`'s doctor recommends `Github_GetUserRecentActivity`, which I couldn't find when I searched the picker. The first thing a new user does is cross-reference those lists — mismatches make them think they broke something.

None of these are gripes. They're the first commits.

## Build your own

The repo is at [github.com/thierrypdamiba/catch-me-up-arcade](#). Clone, set five env vars, run `bun run dev`, and you'll have the same thing pointed at your accounts within ten minutes.

```bash
git clone <repo-url> && cd catch-me-up-arcade
bun install
cp .env.example .env
# Fill in ARCADE_GATEWAY_URL + ANTHROPIC_API_KEY + BETTER_AUTH_SECRET
# Optional: QDRANT_URL + OPENAI_API_KEY for the memory layer
bun run doctor && bunx drizzle-kit migrate && bun run dev
```

You'll need an Arcade gateway with the tools listed in the README's gateway setup section. The gateway picker takes about two minutes if you paste the tool names in bulk.

If you want to push further, the event format I pitched for Arcade's first developer livestream with Slack Platform is the **[Slack Agent Derby](#)**: four frontier models on stage, five escalating toolset rounds, live leaderboard. Round 3 runs the agents against 500 tools from the full Arcade catalog and watches their tool-selection accuracy crater. Round 4 restores it with three curated Slack-centric gateways (5 / 20 / 50 tools) and lets the audience vote on the best curation. It's Arcade's *"smaller toolsets improve tool selection"* thesis, proven live instead of asserted in docs. Open-source test battery ships with the event as evergreen content.

Fork the repo, run it against your accounts, send me what breaks. That's the fastest path from reading this post to having your own Monday-morning triage agent live — one gateway URL, one webhook, and a Qdrant collection that makes every run additive. Hands and memory. Nothing more than that.

---

*Thanks to [Kacper Łukawski](https://github.com/kacperlukawski) and the Qdrant team for the embeddings deep-dives that shaped the memory-layer design, and to the Arcade engineering team for the Contextual Access schema I built against. The v1.1.1-beta spec is the cleanest webhook contract I've worked with in a while.*
