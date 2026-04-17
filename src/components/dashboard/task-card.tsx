"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Textarea,
} from "@arcadeai/design-system";
import { Check, Copy, ExternalLink, KeyRound, Loader2, Send, ShieldAlert, ShieldCheck, Smartphone, X } from "lucide-react";
import type { InboxItem } from "@/types/inbox";
import { getSource } from "@/lib/sources";

const priorityConfig: Record<
  InboxItem["priority"],
  { label: string; variant: "destructive" | "secondary" | "outline"; className?: string }
> = {
  P0: { label: "P0", variant: "destructive" },
  P1: {
    label: "P1",
    variant: "secondary",
    className:
      "bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-950",
  },
  P2: { label: "P2", variant: "secondary" },
  FYI: { label: "FYI", variant: "outline" },
};

const categoryLabels: Record<InboxItem["category"], string> = {
  NEEDS_REPLY: "Needs Reply",
  NEEDS_FEEDBACK: "Needs Feedback",
  NEEDS_DECISION: "Needs Decision",
  NEEDS_REVIEW: "Needs Review",
  ATTEND: "Attend",
  FYI: "FYI",
  IGNORE: "Ignore",
};

type SendState = "idle" | "sending" | "sent" | "error";

interface PolicyDeny {
  policy: string;
  reason: string;
  action: "block" | "require_mfa";
  matched?: string[];
}

interface ActionResponse {
  ok: boolean;
  error?: string;
  denied?: boolean;
  action?: "block" | "require_mfa";
  policy?: string;
  reason?: string;
  matched?: string[];
  needsAuth?: string;
  message?: string;
  tool?: string;
}

interface AuthPrompt {
  url: string;
  message: string;
  tool: string;
}

interface TaskCardProps {
  item: InboxItem;
}

export function TaskCard({ item }: TaskCardProps) {
  const priority = priorityConfig[item.priority];
  const source = getSource(item.source);
  const SourceIcon = source.icon;
  const subtitle = item.sourceDetail || item.participants?.map((p) => p.name).join(", ");
  const formattedTime = item.scheduledTime
    ? new Date(item.scheduledTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  const [draft, setDraft] = useState(item.draftReply ?? "");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [denyInfo, setDenyInfo] = useState<PolicyDeny | null>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthPrompt | null>(null);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const hasDraft = !!item.draftReply && !!item.draftTarget;

  if (dismissed) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function postAction(mfaApproved: boolean): Promise<ActionResponse> {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: item.draftTarget,
        body: draft,
        mfaApproved,
      }),
    });
    return (await res.json().catch(() => ({}))) as ActionResponse;
  }

  async function handleSend(mfaApproved = false) {
    if (!item.draftTarget) return;
    setSendState("sending");
    setSendError(null);
    setDenyInfo(null);
    setAuthPrompt(null);
    try {
      const data = await postAction(mfaApproved);
      if (data.denied && data.action === "require_mfa") {
        setDenyInfo({
          policy: data.policy!,
          reason: data.reason!,
          action: "require_mfa",
        });
        setMfaOpen(true);
        setSendState("idle");
        return;
      }
      if (data.denied && data.action === "block") {
        setDenyInfo({
          policy: data.policy!,
          reason: data.reason!,
          action: "block",
          matched: data.matched,
        });
        setSendState("idle");
        return;
      }
      if (data.needsAuth) {
        setAuthPrompt({
          url: data.needsAuth,
          message: data.message ?? "Arcade needs additional authorization for this tool.",
          tool: data.tool ?? "the write tool",
        });
        setSendState("idle");
        return;
      }
      if (!data.ok) {
        throw new Error(data.error ?? "Send failed");
      }
      setSendState("sent");
    } catch (err) {
      setSendState("error");
      setSendError(err instanceof Error ? err.message : "Send failed");
    }
  }

  async function handleMfaApprove() {
    setMfaOpen(false);
    await handleSend(true);
  }

  function handleEditAndRetry() {
    setDenyInfo(null);
    setEditing(true);
  }

  return (
    <>
      <Card className="animate-card-in transition-shadow hover:shadow-md">
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={source.className}>
              <SourceIcon className="mr-1 size-3" />
              {source.label}
            </Badge>
            <Badge variant={priority.variant} className={priority.className}>
              {priority.label}
            </Badge>
            <Badge variant="outline">{categoryLabels[item.category] || item.category}</Badge>
            {formattedTime && (
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                {formattedTime}
              </span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">{item.effort}</span>
          </div>

          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-words text-sm font-medium leading-snug hover:underline"
            >
              {item.summary}
            </a>
          ) : (
            <p className="break-words text-sm font-medium leading-snug">{item.summary}</p>
          )}

          <div className="space-y-1">
            {subtitle && (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            )}
            {item.suggestedNextStep && (
              <p className="break-words text-xs italic text-muted-foreground">
                {item.suggestedNextStep}
              </p>
            )}
          </div>

          {hasDraft && (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Draft reply
                  {item.draftTarget?.recipientName && (
                    <span className="ml-1 font-normal normal-case">
                      → {item.draftTarget.recipientName}
                    </span>
                  )}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing((v) => !v)}
                    disabled={sendState === "sending" || sendState === "sent"}
                  >
                    {editing ? "Done" : "Edit"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleCopy}>
                    {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
              {editing ? (
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="min-h-[6rem] text-sm"
                />
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{draft}</p>
              )}

              {authPrompt && (
                <div className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
                  <div className="flex items-start gap-2">
                    <KeyRound className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
                    <div className="flex-1 space-y-2">
                      <div className="font-semibold text-amber-900 dark:text-amber-200">
                        Authorization needed for <code className="font-mono">{authPrompt.tool}</code>
                      </div>
                      <p className="text-amber-800 dark:text-amber-300">
                        {authPrompt.message}
                      </p>
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" asChild>
                          <a href={authPrompt.url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="size-3" />
                            Authorize
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAuthPrompt(null);
                            handleSend(false);
                          }}
                        >
                          I authorized — retry
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {denyInfo && denyInfo.action === "block" && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <div className="flex-1 space-y-1">
                      <div className="font-semibold text-destructive">
                        Blocked by Arcade policy: <code className="font-mono">{denyInfo.policy}</code>
                      </div>
                      <p className="text-destructive/90">{denyInfo.reason}</p>
                      {denyInfo.matched && denyInfo.matched.length > 0 && (
                        <p className="text-xs text-destructive/80">
                          Matched: {denyInfo.matched.join(", ")}
                        </p>
                      )}
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" variant="outline" onClick={handleEditAndRetry}>
                          Edit draft
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDenyInfo(null)}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {sendState === "sent" ? (
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="size-3" /> Sent via Arcade
                    </span>
                  ) : sendState === "error" ? (
                    sendError
                  ) : (
                    "Review and send — Arcade runs policy checks first"
                  )}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDismissed(true)}
                    disabled={sendState === "sending"}
                  >
                    <X className="size-3" />
                    Skip
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleSend(false)}
                    disabled={
                      sendState === "sending" ||
                      sendState === "sent" ||
                      draft.trim().length === 0
                    }
                  >
                    {sendState === "sending" ? (
                      <>
                        <Loader2 className="size-3 animate-spin" />
                        Checking policy...
                      </>
                    ) : sendState === "sent" ? (
                      <>
                        <Check className="size-3" />
                        Sent
                      </>
                    ) : (
                      <>
                        <Send className="size-3" />
                        Send
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={mfaOpen} onOpenChange={setMfaOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Smartphone className="size-5 text-primary" />
              Step-up authentication required
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 pt-2">
              <span className="block">
                Arcade policy <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                  {denyInfo?.policy ?? "high-risk-needs-mfa"}
                </code>{" "}
                requires an extra approval before this tool can run.
              </span>
              <span className="block text-muted-foreground">
                {denyInfo?.reason ??
                  "This action requires step-up authentication. Approve on your registered device to proceed."}
              </span>
              <span className="block rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                In production this prompt goes to your MFA provider (Okta, Duo, Auth0, Yubico, etc.)
                via the Arcade gateway. For this demo, clicking Approve below simulates a successful
                device response.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDenyInfo(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMfaApprove}>
              <Smartphone className="size-3" />
              Approve on device
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
