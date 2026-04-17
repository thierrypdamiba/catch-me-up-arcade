/**
 * Contextual Access policy engine.
 *
 * Two entry points use the same rule set:
 *
 *   1. In-app  — /api/action calls runPolicies(ctx) before dispatching a write
 *      tool. Acts as a defense-in-depth layer and keeps the demo self-contained
 *      if the Arcade gateway hasn't been wired to our webhook yet.
 *
 *   2. Gateway — /api/arcade/hooks/pre implements Arcade's Contextual Access
 *      v1.1.1-beta webhook contract. Arcade's engine calls this URL before
 *      every tool execution; we translate the PreHookRequest into the same
 *      PolicyContext and return OK / CHECK_FAILED to the engine.
 *
 * Three representative policies, mapped to the Contextual Access stages:
 *
 *   1. Pre-execution DLP   → pii-outbound          (scan args, block PII)
 *   2. Pre-execution scope → internal-only-outbound (recipient domain gate)
 *   3. Step-up auth        → high-risk-needs-mfa    (client-orchestrated; see README)
 *
 * Arcade's webhook API does not currently expose a native step-up action, so
 * the MFA policy is enforced in-app only and is kept as an open feature request.
 */

import type { DraftTarget, DraftTargetType } from "@/types/inbox";

export type PolicyAction = "block" | "require_mfa";

export interface PolicyContext {
  tool: string;
  target: DraftTarget;
  body: string;
}

export type PolicyResult =
  | { allow: true }
  | {
      allow: false;
      policy: string;
      reason: string;
      action: PolicyAction;
      matched?: string[];
    };

// Configure via env; defaults to a generic value for demos.
export const INTERNAL_DOMAIN = (process.env.INTERNAL_DOMAIN || "arcade.dev").toLowerCase();

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const CC_RE = /\b(?:\d{4}[- ]?){3}\d{4}\b/;

function internalOnlyOutbound(ctx: PolicyContext): PolicyResult {
  if (ctx.target.type !== "gmail_reply") return { allow: true };
  const emails = Array.from(ctx.body.matchAll(EMAIL_RE), (m) => m[0].toLowerCase());
  const external = emails.filter((e) => !e.endsWith("@" + INTERNAL_DOMAIN));
  if (external.length === 0) return { allow: true };
  return {
    allow: false,
    policy: "internal-only-outbound",
    reason: `Recipient is external. Outbound Gmail is restricted to @${INTERNAL_DOMAIN}.`,
    action: "block",
    matched: external,
  };
}

function piiOutbound(ctx: PolicyContext): PolicyResult {
  const matched: string[] = [];
  if (SSN_RE.test(ctx.body)) matched.push("SSN");
  if (CC_RE.test(ctx.body)) matched.push("Credit card number");
  if (matched.length === 0) return { allow: true };
  return {
    allow: false,
    policy: "pii-outbound",
    reason: `Draft contains ${matched.join(" + ")}. DLP policy blocks PII in outbound messages.`,
    action: "block",
    matched,
  };
}

function highRiskNeedsMfa(ctx: PolicyContext, mfaApproved: boolean): PolicyResult {
  if (mfaApproved) return { allow: true };
  const isHighRisk =
    ctx.target.type === "slack_message" || ctx.target.type === "github_pr_comment";
  if (!isHighRisk) return { allow: true };
  return {
    allow: false,
    policy: "high-risk-needs-mfa",
    reason:
      "This action requires step-up authentication. Approve on your registered device to proceed.",
    action: "require_mfa",
  };
}

export function runPolicies(
  ctx: PolicyContext,
  opts: { mfaApproved?: boolean; skipMfa?: boolean } = {}
): PolicyResult {
  const mfaApproved = opts.mfaApproved ?? false;
  const chain = [
    () => internalOnlyOutbound(ctx),
    () => piiOutbound(ctx),
    ...(opts.skipMfa ? [] : [() => highRiskNeedsMfa(ctx, mfaApproved)]),
  ];
  for (const step of chain) {
    const result = step();
    if (!result.allow) return result;
  }
  return { allow: true };
}

/**
 * Translate Arcade's PreHookRequest-style input into a PolicyContext we can
 * evaluate. Returns null when the tool isn't something our current policy set
 * has an opinion on (the webhook should respond OK in that case).
 */
export function contextFromToolCall(params: {
  toolName: string;
  toolkit?: string;
  inputs: Record<string, unknown>;
}): PolicyContext | null {
  const { toolName, toolkit, inputs } = params;
  const low = toolName.toLowerCase();
  const kit = (toolkit || low.split(/[._]/)[0] || "").toLowerCase();

  let draftType: DraftTargetType | null = null;
  let body = "";

  if (kit === "gmail" && /send|reply|draft/.test(low)) {
    draftType = "gmail_reply";
    body = String(inputs.body ?? inputs.text ?? "");
    const recipients = [inputs.to, inputs.recipient, inputs.recipient_name]
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    if (recipients.length > 0) body = `${body}\n\n[recipients: ${recipients.join(", ")}]`;
  } else if (kit === "slack" && /send|message|post/.test(low)) {
    draftType = "slack_message";
    body = String(inputs.text ?? inputs.message ?? inputs.body ?? "");
  } else if ((kit === "github" || kit === "git") && /pullrequest|pr/.test(low)) {
    draftType = "github_pr_comment";
    body = String(inputs.body ?? inputs.comment ?? "");
  } else if ((kit === "github" || kit === "git") && /issue|comment/.test(low)) {
    draftType = "github_issue_comment";
    body = String(inputs.body ?? inputs.comment ?? "");
  } else if (kit === "linear" && /comment/.test(low)) {
    draftType = "linear_comment";
    body = String(inputs.body ?? inputs.comment ?? "");
  }

  if (!draftType) return null;

  return {
    tool: toolName,
    target: { type: draftType },
    body,
  };
}

export const POLICY_DESCRIPTIONS: Record<string, { title: string; summary: string }> = {
  "internal-only-outbound": {
    title: "internal-only-outbound",
    summary: `Outbound Gmail is restricted to @${INTERNAL_DOMAIN}. Any external recipient is blocked.`,
  },
  "pii-outbound": {
    title: "pii-outbound",
    summary: "Drafts containing SSNs or credit card numbers are blocked before they leave.",
  },
  "high-risk-needs-mfa": {
    title: "high-risk-needs-mfa",
    summary:
      "Slack posts and GitHub PR comments require a step-up MFA approval before the tool runs.",
  },
};
