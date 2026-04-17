export type KnownSource = "slack" | "google_calendar" | "linear" | "github" | "gmail";
export type ItemSource = KnownSource | (string & {});

export type SourceStatus = "unknown" | "checking" | "connected" | "auth_required" | "skipped";

export type DraftTargetType =
  | "gmail_reply"
  | "slack_message"
  | "github_issue_comment"
  | "github_pr_comment"
  | "linear_comment";

export interface DraftTarget {
  type: DraftTargetType;
  threadId?: string;
  channelId?: string;
  ts?: string;
  issueNumber?: string;
  repo?: string;
  recipientName?: string;
}

export interface InboxItem {
  id: string;
  source: ItemSource;
  sourceDetail?: string;
  summary: string;
  category:
    | "NEEDS_REPLY"
    | "NEEDS_FEEDBACK"
    | "NEEDS_DECISION"
    | "NEEDS_REVIEW"
    | "ATTEND"
    | "FYI"
    | "IGNORE";
  priority: "P0" | "P1" | "P2" | "FYI";
  effort: "XS" | "S" | "M" | "L";
  why: string;
  suggestedNextStep: string;
  confidence: number;
  participants?: { id: string; name: string }[];
  url?: string;
  scheduledTime?: string;
  draftReply?: string;
  draftTarget?: DraftTarget;
}

export type PlanEvent =
  | { type: "status"; message: string }
  | { type: "task"; data: InboxItem }
  | { type: "summary"; data: { total: number; bySource: Record<string, number> } }
  | { type: "auth_required"; authUrl: string; toolName?: string }
  | { type: "sources"; sources: string[] }
  | { type: "error"; message: string }
  | { type: "done" };
