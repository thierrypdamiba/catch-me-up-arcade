"use client";

import { useCallback, useRef, useState } from "react";
import type { InboxItem, PlanEvent } from "@/types/inbox";

interface PlanStreamCallbacks {
  onAuthRequired?: (authUrl: string, toolName?: string) => void;
  onSourcesDone?: () => void;
}

export interface StatusEvent {
  id: number;
  message: string;
  at: number;
}

export function usePlanStream(callbacks?: PlanStreamCallbacks): {
  items: InboxItem[];
  stats: { total: number; bySource: Record<string, number> };
  loading: boolean;
  error: string | null;
  showError: (message: string) => void;
  clearError: () => void;
  activeSource: string | null;
  setActiveSource: React.Dispatch<React.SetStateAction<string | null>>;
  statusMessage: string | null;
  statusHistory: StatusEvent[];
  planRan: boolean;
  resetPlan: () => void;
  handlePlan: (windowDays?: number) => Promise<void>;
} {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [stats, setStats] = useState<{ total: number; bySource: Record<string, number> }>({
    total: 0,
    bySource: {},
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusHistory, setStatusHistory] = useState<StatusEvent[]>([]);
  const statusIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [planRan, setPlanRan] = useState(false);

  // Keep callbacks in a ref so handlePlan is stable even when callbacks change
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const showError = useCallback((message: string) => setError(message), []);
  const clearError = useCallback(() => setError(null), []);
  const resetPlan = useCallback(() => setPlanRan(false), []);

  const handlePlan = useCallback(async (windowDays: number = 7) => {
    setLoading(true);
    setError(null);
    setItems([]);
    setStats({ total: 0, bySource: {} });
    setStatusMessage(null);
    setStatusHistory([]);
    statusIdRef.current = 0;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowDays }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Plan request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as PlanEvent;
            switch (event.type) {
              case "task":
                setItems((prev) => [...prev, event.data]);
                break;
              case "summary":
                setStats({
                  total: event.data.total,
                  bySource: event.data.bySource,
                });
                break;
              case "auth_required":
                callbacksRef.current?.onAuthRequired?.(event.authUrl, event.toolName);
                break;
              case "status": {
                setStatusMessage(event.message);
                const id = ++statusIdRef.current;
                setStatusHistory((prev) => {
                  const next = [...prev, { id, message: event.message, at: Date.now() }];
                  return next.length > 40 ? next.slice(-40) : next;
                });
                break;
              }
              case "error":
                setError(event.message);
                break;
              case "done":
                callbacksRef.current?.onSourcesDone?.();
                break;
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setLoading(false);
      setStatusMessage(null);
      setPlanRan(true);
    }
  }, []);

  return {
    items,
    stats,
    loading,
    error,
    showError,
    clearError,
    activeSource,
    setActiveSource,
    statusMessage,
    statusHistory,
    planRan,
    resetPlan,
    handlePlan,
  };
}
