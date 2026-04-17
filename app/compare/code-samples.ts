/**
 * Side-by-side code samples for /compare.
 *
 * The "without" samples are realistic skeletons — not full implementations (those
 * would be thousands of lines) but enough of the surface area that a developer
 * recognizes what they'd actually have to build: OAuth app registration, token
 * exchange, per-user token storage, refresh rotation, COAT protection, rate
 * limits, and the provider's API client.
 *
 * The "with" samples are the real code you'd write on top of Arcade's MCP gateway.
 */

export interface SourceComparison {
  id: string;
  label: string;
  withoutLoC: number;
  withLoC: number;
  withoutSetup: string;
  without: string;
  with: string;
}

const GMAIL_WITHOUT = `// ============================================================
// Step 1 — Cloud Console setup (manual, not code)
// ============================================================
//   • Create a Google Cloud project
//   • Enable the Gmail API
//   • Configure OAuth consent screen: user type, app name,
//     support email, authorized domains, scopes
//   • Add scopes: gmail.readonly, gmail.send, gmail.modify
//   • Verify domain ownership for production distribution
//   • Generate client_id + client_secret, store as secrets

// ============================================================
// Step 2 — OAuth flow (PKCE + state + callback)
// ============================================================
import { OAuth2Client } from "google-auth-library";
import crypto from "node:crypto";

const oauth = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID!,
  process.env.GOOGLE_CLIENT_SECRET!,
  \`\${process.env.APP_URL}/api/oauth/google/callback\`,
);

export async function startOAuth(userId: string) {
  const state = crypto.randomBytes(16).toString("hex");
  const verifier = crypto.randomBytes(32).toString("base64url");
  await pendingStore.save(state, { userId, verifier }); // tie state → user
  const challenge = crypto
    .createHash("sha256").update(verifier).digest("base64url");
  return oauth.generateAuthUrl({
    scope: ["gmail.readonly", "gmail.send", "gmail.modify"].map(
      (s) => \`https://www.googleapis.com/auth/\${s}\`
    ),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline", // so we get a refresh_token
    prompt: "consent",      // force consent or refresh_token may be missing
  });
}

// callback handler
export async function handleCallback(code: string, state: string, sessionUserId: string) {
  const pending = await pendingStore.consume(state);
  if (!pending) throw new Error("Unknown state (CSRF)");
  if (pending.userId !== sessionUserId) throw new Error("COAT: session mismatch");
  const { tokens } = await oauth.getToken({
    code,
    codeVerifier: pending.verifier,
  });
  await tokenStore.save(sessionUserId, "google", tokens); // per-user, encrypted
}

// ============================================================
// Step 3 — Token refresh (access tokens expire ~every 50 min)
// ============================================================
export async function getFreshTokens(userId: string) {
  const tokens = await tokenStore.get(userId, "google");
  if (!tokens) throw new AuthNeededError("google");
  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 60_000) {
    oauth.setCredentials(tokens);
    const { credentials } = await oauth.refreshAccessToken(); // retry/jitter on failure
    await tokenStore.save(userId, "google", credentials);
    return credentials;
  }
  return tokens;
}

// ============================================================
// Step 4 — Gmail API client w/ pagination + rate-limit handling
// ============================================================
import { google, gmail_v1 } from "googleapis";

export async function listEmails(userId: string, windowDays: number) {
  const tokens = await getFreshTokens(userId);
  const client = new OAuth2Client();
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });

  const query = \`newer_than:\${windowDays}d\`;
  const out: gmail_v1.Schema$Message[] = [];
  let pageToken: string | undefined;
  do {
    const res = await retryWithBackoff(() =>
      gmail.users.messages.list({
        userId: "me", q: query, pageToken, maxResults: 100,
      })
    );
    out.push(...(res.data.messages ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && out.length < 500);
  return out; // caller still needs to batch-get thread bodies
}

// ~80 more lines: batch thread fetch, retryWithBackoff, AuthNeededError,
// token store schema, secret rotation runbook, scope re-consent handler, ...`;

const GMAIL_WITH = `// ============================================================
// Production-shaped — includes error handling, auth-prompt surfacing,
// typed result parsing, and cleanup. Still dramatically less code
// than the "without" column, but not a toy snippet.
// ============================================================
import { getArcadeMCPClient } from "@/lib/arcade";
import type { InboxItem } from "@/types/inbox";

interface ListResult {
  items?: InboxItem[];
  needsAuth?: string;
  error?: string;
}

export async function listEmails(
  userId: string, windowDays: number,
): Promise<ListResult> {
  const mcp = await getArcadeMCPClient();
  try {
    const tools = await mcp.tools();

    const result = await tools.Gmail_ListEmails.execute({
      date_range: windowDays <= 7 ? "last_7_days" : "last_30_days",
      max_messages: 100,
    });

    // If Gmail isn't authorized yet, Arcade returns a structured
    // { authorization_url } payload instead of failing — surface it.
    const authUrl = extractAuthUrl(result);
    if (authUrl) return { needsAuth: authUrl };

    return { items: parseToInbox(result) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown error" };
  } finally {
    await mcp.close();
  }
}

// parseToInbox + extractAuthUrl: ~15 lines each, typed MCP-response
// parsing into our InboxItem shape. No OAuth, no token refresh, no
// rate-limit retry — the gateway absorbs all of it.`;

const SLACK_WITHOUT = `// ============================================================
// Step 1 — Slack App manifest (manual, not code)
// ============================================================
//   • Create a Slack app at api.slack.com/apps
//   • Choose bot-user vs user-token scope model
//   • Scopes: channels:history, groups:history, im:history,
//     mpim:history, chat:write, users:read, im:read, ...
//   • Configure OAuth redirect URLs, enable public distribution
//   • Store client_id, client_secret, signing_secret

// ============================================================
// Step 2 — Install flow
// ============================================================
import { InstallProvider } from "@slack/oauth";

const installer = new InstallProvider({
  clientId: process.env.SLACK_CLIENT_ID!,
  clientSecret: process.env.SLACK_CLIENT_SECRET!,
  stateSecret: process.env.SLACK_STATE_SECRET!,
  installationStore: { // per-user, per-team storage + DB schema
    storeInstallation: async (i) => { await db.slack.upsert(i); },
    fetchInstallation: async (q) => { return db.slack.find(q); },
    deleteInstallation: async (q) => { await db.slack.delete(q); },
  },
});

export async function getInstallUrl(userId: string) {
  return installer.generateInstallUrl({
    scopes: ["channels:history", "groups:history", "im:history", "chat:write"],
    userScopes: ["search:read", "users.profile:read"],
    metadata: userId, // to tie callback back to your session
  });
}

// ============================================================
// Step 3 — Web API client (bot token for channels, user token for DMs)
// ============================================================
import { WebClient } from "@slack/web-api";

export async function getMessages(
  userId: string, teamId: string, channel: string, oldestTs: string
) {
  const install = await installer.authorize({ teamId, enterpriseId: undefined });
  const client = new WebClient(install.botToken);
  const out: Message[] = [];
  let cursor: string | undefined;
  do {
    const res = await retryRateLimited(() =>
      client.conversations.history({ channel, oldest: oldestTs, cursor, limit: 200 })
    );
    out.push(...(res.messages ?? []));
    cursor = res.response_metadata?.next_cursor;
    if (!cursor) break;
  } while (true);
  return out;
}

// Plus: event subscriptions for real-time, thread pagination via replies(),
// member resolution via users.info batch, rate-limit tier handling (tier 1-4
// have different quotas), slack-signing verification on webhooks,
// token rotation opt-in for newer apps, ...`;

const SLACK_WITH = `import { getArcadeMCPClient } from "@/lib/arcade";

const mcp = await getArcadeMCPClient();
const tools = await mcp.tools();

const messages = await tools.Slack_GetMessages.execute({
  channel_id: channelId,
  oldest_datetime: sevenDaysAgoIso,
});

// No app manifest, no install flow, no token-rotation config,
// no per-tier rate-limit bookkeeping. One gateway URL.`;

const GITHUB_WITHOUT = `// ============================================================
// Step 1 — OAuth App registration (manual)
// ============================================================
//   • github.com/settings/developers → New OAuth App
//   • Homepage URL, Authorization callback URL
//   • If you want fine-grained perms: GitHub App instead of OAuth App
//     (different flow, installation tokens, org-level consent)

import { Octokit } from "@octokit/rest";
import { OAuthApp } from "@octokit/oauth-app";

const oauth = new OAuthApp({
  clientType: "oauth-app",
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
});

export async function startOAuth(userId: string) {
  const { url, state } = oauth.getWebFlowAuthorizationUrl({
    scopes: ["repo", "notifications", "read:org"],
  });
  await pendingStore.save(state, { userId });
  return url;
}

export async function handleCallback(code: string, state: string, sessionUserId: string) {
  const pending = await pendingStore.consume(state);
  if (!pending || pending.userId !== sessionUserId) throw new Error("state mismatch");
  const { authentication } = await oauth.createToken({ code, state });
  await tokenStore.save(sessionUserId, "github", authentication);
}

// ============================================================
// Step 2 — API client w/ pagination + rate limit (5k/hr)
// ============================================================
export async function getOpenItems(userId: string) {
  const auth = await tokenStore.get(userId, "github");
  const octo = new Octokit({ auth: auth.token });
  const [reviews, assigned] = await Promise.all([
    octo.paginate(octo.search.issuesAndPullRequests, {
      q: \`review-requested:@me is:open\`, per_page: 100,
    }),
    octo.paginate(octo.search.issuesAndPullRequests, {
      q: \`assignee:@me is:open\`, per_page: 100,
    }),
  ]);
  // Watch X-RateLimit-Remaining; back off when < 100
  // Secondary rate limit on search API (30 req/min)
  // Token refresh: OAuth app tokens don't expire but can be revoked
  return [...reviews, ...assigned];
}`;

const GITHUB_WITH = `import { getArcadeMCPClient } from "@/lib/arcade";

const mcp = await getArcadeMCPClient();
const tools = await mcp.tools();

const items = await tools.Github_GetUserOpenItems.execute({});
const reviews = await tools.Github_GetReviewWorkload.execute({});`;

const LINEAR_WITHOUT = `// ============================================================
// Step 1 — Linear OAuth app (manual)
// ============================================================
//   • linear.app/settings/api/applications → New application
//   • Redirect URI, scopes (read + write)
//   • client_id + client_secret

// ============================================================
// Step 2 — OAuth flow
// ============================================================
export async function startOAuth(userId: string) {
  const state = crypto.randomBytes(16).toString("hex");
  await pendingStore.save(state, { userId });
  const url = new URL("https://linear.app/oauth/authorize");
  url.searchParams.set("client_id", process.env.LINEAR_CLIENT_ID!);
  url.searchParams.set("redirect_uri", \`\${process.env.APP_URL}/api/oauth/linear/callback\`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "read write");
  url.searchParams.set("state", state);
  return url.toString();
}

// ============================================================
// Step 3 — GraphQL client
// ============================================================
import { LinearClient } from "@linear/sdk";

export async function getMyIssues(userId: string) {
  const auth = await tokenStore.get(userId, "linear");
  const linear = new LinearClient({ accessToken: auth.access_token });
  const me = await linear.viewer;
  const issues = await me.assignedIssues({
    filter: { state: { type: { neq: "completed" } } },
  });
  return issues.nodes;
}

// Plus: refresh flow, scope re-consent on permission drift,
// webhook verification for updates, rate limit (100 requests/min), ...`;

const LINEAR_WITH = `import { getArcadeMCPClient } from "@/lib/arcade";

const mcp = await getArcadeMCPClient();
const tools = await mcp.tools();

const issues = await tools.Linear_ListIssues.execute({ assignee: "me" });
const notifications = await tools.Linear_GetNotifications.execute({});`;

const CALENDAR_WITHOUT = `// ============================================================
// Reuses the Google OAuth app from Gmail, but needs a different scope.
// If the user already consented for gmail.readonly, they'll get a new
// consent screen when you request calendar.readonly on top. Plan for it.
// ============================================================
export async function listEvents(userId: string, windowDays: number) {
  // If user consented to Gmail scopes but not Calendar, this throws
  // 403 insufficient_scope. You'll need to re-run the OAuth flow with
  // the expanded scope list (all scopes the app might ever need).
  const tokens = await getFreshTokens(userId);
  const client = new OAuth2Client();
  client.setCredentials(tokens);
  const cal = google.calendar({ version: "v3", auth: client });

  const now = new Date();
  const timeMin = new Date(now.getTime() - windowDays * 86_400_000);
  const { data } = await retryWithBackoff(() =>
    cal.events.list({
      calendarId: "primary",
      timeMin: timeMin.toISOString(),
      timeMax: now.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    })
  );
  return data.items ?? [];
}`;

const CALENDAR_WITH = `import { getArcadeMCPClient } from "@/lib/arcade";

const mcp = await getArcadeMCPClient();
const tools = await mcp.tools();

const events = await tools.GoogleCalendar_ListEvents.execute({
  time_min: sevenDaysAgoIso,
  time_max: new Date().toISOString(),
});`;

export const sourceSamples: SourceComparison[] = [
  {
    id: "gmail",
    label: "Gmail",
    withoutLoC: 320,
    withLoC: 35,
    withoutSetup: "GCP project + OAuth consent screen + domain verification",
    without: GMAIL_WITHOUT,
    with: GMAIL_WITH,
  },
  {
    id: "slack",
    label: "Slack",
    withoutLoC: 420,
    withLoC: 12,
    withoutSetup: "Slack App manifest + scope matrix + workspace install flow",
    without: SLACK_WITHOUT,
    with: SLACK_WITH,
  },
  {
    id: "github",
    label: "GitHub",
    withoutLoC: 180,
    withLoC: 10,
    withoutSetup: "OAuth App registration + scope selection",
    without: GITHUB_WITHOUT,
    with: GITHUB_WITH,
  },
  {
    id: "linear",
    label: "Linear",
    withoutLoC: 140,
    withLoC: 10,
    withoutSetup: "OAuth app registration + redirect URI setup",
    without: LINEAR_WITHOUT,
    with: LINEAR_WITH,
  },
  {
    id: "calendar",
    label: "Calendar",
    withoutLoC: 120,
    withLoC: 8,
    withoutSetup: "Reuses GCP project; scope expansion triggers re-consent",
    without: CALENDAR_WITHOUT,
    with: CALENDAR_WITH,
  },
];

export const memorySample = {
  without: `// ============================================================
// The Qdrant part of cross-source memory is ~20 lines. The work
// is the FIVE data pipelines in front of it. Without Arcade, you
// can't search across Gmail + Slack + GitHub + Linear + Calendar
// in one vector space until you've built all five integrations,
// five response-parsers, and a normalization layer yourself.
// ============================================================

// 1. Five OAuth flows + API clients + token stores
//    (see the per-provider tabs — ~1,180 LoC before you fetch one item)

// 2. Five response schemas → one Item type. Write five parsers.
export interface Item {
  id: string; source: string; summary: string;
  url?: string; participants?: { id: string; name: string }[];
  fetched_at: string;
}

import type { gmail_v1, calendar_v3 } from "googleapis";
import type { Message } from "@slack/web-api";
import type { Issue as GhIssue } from "@octokit/graphql-schema";

function gmailThreadToItem(t: gmail_v1.Schema$Thread): Item {
  const first = t.messages?.[0];
  const headers = Object.fromEntries(
    (first?.payload?.headers ?? []).map((h) => [h.name?.toLowerCase(), h.value]),
  );
  return {
    id: t.id!, source: "gmail",
    summary: first?.snippet ?? "",
    url: \`https://mail.google.com/mail/u/0/#inbox/\${t.id}\`,
    participants: parseEmailList(headers["from"], headers["to"]),
    fetched_at: new Date().toISOString(),
  };
}

function slackMessageToItem(m: Message, channelId: string, permalink: string): Item {
  return {
    id: \`\${channelId}-\${m.ts}\`, source: "slack",
    summary: m.text ?? "", url: permalink,
    participants: m.user ? [{ id: m.user, name: m.user }] : [],
    fetched_at: new Date().toISOString(),
  };
}

function githubItemToItem(i: GhIssue): Item {
  return {
    id: String(i.id), source: "github",
    summary: i.title ?? "", url: i.url ?? undefined,
    participants: i.assignees?.nodes
      ?.filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => ({ id: a.login, name: a.name ?? a.login })) ?? [],
    fetched_at: new Date().toISOString(),
  };
}

// ...two more: linearIssueToItem, calendarEventToItem. Each has its own
// edge cases (Linear uses GraphQL nodes; Calendar has recurring-event IDs;
// Slack permalinks need a separate chat.getPermalink call per message).

// 3. Orchestrate with your own auth handling per provider
async function fetchEverything(userId: string, windowDays: number): Promise<Item[]> {
  const [gmail, slack, gh, linear, cal] = await Promise.all([
    fetchGmailThreads(userId, windowDays),    // handles Google OAuth + refresh
    fetchSlackMessages(userId, windowDays),   // handles team install + tokens
    fetchGithubItems(userId, windowDays),     // handles OAuth app + rate limit
    fetchLinearIssues(userId, windowDays),    // handles Linear OAuth + GraphQL
    fetchCalendarEvents(userId, windowDays),  // handles Google OAuth (same as Gmail, different scope)
  ]);
  return [
    ...gmail.map(gmailThreadToItem),
    ...slack.messages.map((m) => slackMessageToItem(m, slack.channelId, slack.permalinks[m.ts!]!)),
    ...gh.map(githubItemToItem),
    ...linear.map(linearIssueToItem),
    ...cal.map(calendarEventToItem),
  ];
}

// 4. NOW you can embed + upsert into Qdrant. The Qdrant code is in the
//    "with Arcade" column — it's identical on both sides. The difference
//    is everything ABOVE this line.`,
  with: `// ============================================================
// With Arcade the five data pipelines collapse into one MCP loop.
// Tools return already-authed, already-normalized responses. The
// LLM classifies them into InboxItems per the system prompt, and
// Qdrant indexes them. Same Qdrant code, radically less glue.
// ============================================================
import { getArcadeMCPClient } from "@/lib/arcade";
import { upsertItems } from "@/lib/qdrant";       // ~20 lines
import { embedMany, streamText, stepCountIs } from "ai";
import { getModel, planPrompt } from "@/lib/agent";

const mcp = await getArcadeMCPClient();
const tools = await mcp.tools();        // all 5 toolkits, one gateway URL

// Fan out. The LLM picks tools and classifies results in the same loop —
// no per-provider parser, no normalization layer we maintain ourselves.
const result = streamText({
  model: getModel(),
  messages: [{ role: "user", content: \`Catch me up on last \${windowDays} days\` }],
  tools,
  stopWhen: stepCountIs(30),
  system: planPrompt,
});

// As the LLM emits structured task blocks, we collect and upsert:
const items: InboxItem[] = [];
for await (const chunk of result.textStream) {
  const parsed = extractJsonBlocks(chunk);
  items.push(...parsed.tasks);
}
await upsertItems(userId, items);  // fire-and-forget into Qdrant

// Total new code for the cross-source memory pipeline: ~10 lines.
// Arcade is the reason you can write just those ten.`,
};

export const contextualAccessSample = {
  without: `// ============================================================
// You need a policy engine. Most teams build a bespoke one.
// Below is the minimum viable skeleton to get "internal only"
// and "DLP for SSN" working for ONE provider. Multiply by N.
// ============================================================
import { Gmail } from "./gmail-client";

const INTERNAL = "@acme.com";
const SSN_RE = /\\b\\d{3}-\\d{2}-\\d{4}\\b/;

export async function sendWithPolicy(
  userId: string,
  threadId: string,
  body: string,
) {
  // 1. Pre-execution DLP scan
  if (SSN_RE.test(body)) {
    await auditLog.write({ userId, policy: "pii-outbound", action: "blocked" });
    throw new PolicyDeny("pii-outbound", "SSN detected");
  }

  // 2. Fetch recipient from thread metadata (extra API call)
  const thread = await Gmail.getThread(userId, threadId);
  const to = thread.messages[0].headers.to;
  if (!to.endsWith(INTERNAL)) {
    await auditLog.write({ userId, policy: "internal-only", action: "blocked" });
    throw new PolicyDeny("internal-only", \`External: \${to}\`);
  }

  // 3. Step-up auth for high-risk sends
  //    Integrate with your MFA provider (Okta, Duo, Auth0)
  //    Verify the approval signal before proceeding
  //    ... (50+ lines, per provider)

  // 4. Actually send
  const result = await Gmail.send(userId, threadId, body);

  // 5. Post-execution validation (did we actually stay internal?)
  //    Verify the response matches what we attempted
  //    ... (30+ lines)

  return result;
}

// Multiply this scaffolding by every provider × every policy you need.
// Add: audit trail, policy-as-config, runtime updates, tenant isolation,
// provider-specific enforcement edge cases. This becomes its own product.`,
  with: `// ============================================================
// Arcade Contextual Access (v1.1.1-beta).
// Register a Logic Extension in the Arcade dashboard pointing at
// your webhook. Arcade calls /pre, /post, /access, /health per the
// OpenAPI contract at github.com/ArcadeAI/schemas.
// Our implementation: app/api/arcade/hooks/pre/route.ts
// ============================================================

// 1. Your webhook runs the policies (reusing lib/policies.ts):
import { contextFromToolCall, runPolicies } from "@/lib/policies";
import { verifyHookAuth } from "@/lib/hook-auth";

export async function POST(request: Request) {
  const auth = verifyHookAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { tool, inputs } = await request.json();
  const ctx = contextFromToolCall({
    toolName: tool.name, toolkit: tool.toolkit, inputs,
  });
  if (!ctx) return Response.json({ code: "OK" });

  const result = runPolicies(ctx, { skipMfa: true });
  if (result.allow) return Response.json({ code: "OK" });

  return Response.json({
    code: "CHECK_FAILED",
    error_message: \`[\${result.policy}] \${result.reason}\`,
  });
}

// 2. The calling code stays the same — Arcade enforces invisibly:
const result = await tools.Gmail_SendEmail.execute({
  thread_id: threadId, body,
});
// When a policy denies, Arcade's engine surfaces { error_message: "[pii-outbound] ..." }
// The UI parses the [policy-id] prefix and shows it as a policy block.

// Note on step-up MFA: Arcade's webhook API returns synchronously (5s timeout)
// with no native way to pause and wait for out-of-band approval. MFA is
// client-orchestrated — that's on my list of feature requests for Arcade.`,
};
