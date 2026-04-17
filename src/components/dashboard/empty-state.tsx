"use client";

import { useState } from "react";
import { Inbox, Info, Loader2 } from "lucide-react";
import {
  Alert,
  AlertTitle,
  AlertDescription,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@arcadeai/design-system";

interface EmptyStateProps {
  onPlan: (windowDays: number) => void;
  loading: boolean;
}

const WINDOW_OPTIONS = [
  { value: "3", label: "Last 3 days" },
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 2 weeks" },
  { value: "30", label: "Last 30 days" },
];

export function EmptyState({ onPlan, loading }: EmptyStateProps) {
  const [windowDays, setWindowDays] = useState("7");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <Inbox size={48} className="text-muted-foreground/50" />
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-2xl font-semibold">Welcome back. What did you miss?</h2>
        <p className="max-w-md text-center text-muted-foreground">
          The agent scans your Gmail, Slack, GitHub, Linear, and Calendar for the time window you
          pick, triages by priority, and drafts replies to anything urgent.
        </p>
      </div>
      <Alert className="max-w-md text-left">
        <Info className="size-4" />
        <AlertTitle>How this works</AlertTitle>
        <AlertDescription>
          On first run you&apos;ll authorize each tool via OAuth (one-time). Then the agent fans out
          reads in parallel, classifies every item P0/P1/P2, and writes ready-to-send drafts for
          anything in the NEEDS_REPLY / NEEDS_REVIEW / NEEDS_DECISION buckets. You review and send.
        </AlertDescription>
      </Alert>
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Select value={windowDays} onValueChange={setWindowDays} disabled={loading}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="lg" disabled={loading} onClick={() => onPlan(Number(windowDays))}>
          {loading ? (
            <>
              <Loader2 className="animate-spin" />
              Catching you up...
            </>
          ) : (
            "Catch me up"
          )}
        </Button>
      </div>
    </div>
  );
}
