"use client";

import { useMemo } from "react";
import { Badge } from "@arcadeai/design-system";
import { CheckCircle2, Loader2, Zap } from "lucide-react";
import type { StatusEvent } from "@/hooks/use-plan-stream";
import { getSource } from "@/lib/sources";

interface GatewayActivityLogProps {
  events: StatusEvent[];
  loading: boolean;
}

/**
 * Renders the live stream of tool calls and classification events as they
 * come out of /api/plan. The goal is to make the parallel fan-out visible —
 * dev-rel audiences see 5 simultaneous tool calls through one gateway URL,
 * instead of a black-box loading spinner that makes items appear.
 */
export function GatewayActivityLog({ events, loading }: GatewayActivityLogProps) {
  const visible = useMemo(() => events.slice(-8), [events]);

  const summary = useMemo(() => {
    const toolNames = new Set<string>();
    const sources = new Set<string>();
    for (const e of events) {
      const m = e.message.match(/^Calling\s+([a-z_]+):\s+([A-Za-z_][\w]+)/i);
      if (m) {
        sources.add(m[1].toLowerCase());
        toolNames.add(m[2]);
      }
    }
    return { toolCount: toolNames.size, sourceCount: sources.size };
  }, [events]);

  if (events.length === 0) return null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : (
            <CheckCircle2 className="size-4 text-primary" />
          )}
          <span className="text-sm font-semibold">
            {loading ? "Arcade gateway — live activity" : "Arcade gateway — done"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {summary.toolCount > 0 && (
            <Badge variant="outline" className="gap-1 font-mono text-xs">
              <Zap className="size-3" />
              {summary.toolCount} tools · {summary.sourceCount} sources
            </Badge>
          )}
        </div>
      </div>

      <ul className="space-y-1 font-mono text-xs">
        {visible.map((event, i) => {
          const isLatest = i === visible.length - 1;
          const toolMatch = event.message.match(/^Calling\s+([a-z_]+):\s+([A-Za-z_][\w]+)/i);
          const source = toolMatch?.[1].toLowerCase();
          const sourceConfig = source ? getSource(source) : null;
          const toolName = toolMatch?.[2];

          return (
            <li
              key={event.id}
              className={`flex min-w-0 items-center gap-2 truncate ${
                isLatest && loading
                  ? "text-foreground"
                  : "text-muted-foreground/80"
              }`}
            >
              <span className="text-primary/60">→</span>
              {toolMatch && sourceConfig ? (
                <>
                  <Badge
                    variant="outline"
                    className={`h-5 px-1.5 text-[10px] ${sourceConfig.className}`}
                  >
                    {sourceConfig.label}
                  </Badge>
                  <span className="font-semibold">{toolName}</span>
                  <span className="text-muted-foreground/70">()</span>
                </>
              ) : (
                <span>{event.message}</span>
              )}
            </li>
          );
        })}
      </ul>

      {events.length > visible.length && (
        <p className="mt-2 text-[10px] text-muted-foreground/60">
          +{events.length - visible.length} earlier events
        </p>
      )}
    </div>
  );
}
