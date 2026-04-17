"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@arcadeai/design-system";
import { Database, Loader2, Search } from "lucide-react";
import { getSource } from "@/lib/sources";

interface SearchResult {
  score: number;
  source: string;
  sourceDetail: string | null;
  summary: string;
  category?: string;
  priority?: string;
  url: string | null;
  fetchedAt: string;
}

/**
 * Memory search bar — queries the Qdrant collection of everything the
 * catch-me-up agent has classified across past runs. Keyed per-user.
 */
export function MemorySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function runSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (query.trim().length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.trim(), limit: 8 }),
        });
        const data = (await res.json()) as
          | { ok: true; results: SearchResult[] }
          | { ok: false; error: string };
        if (!res.ok || !data.ok) {
          setError("error" in data ? data.error : `Search failed (${res.status})`);
          setResults([]);
          return;
        }
        setResults(data.results);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      }
    });
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="size-5 text-primary" />
          Memory search
        </CardTitle>
        <CardDescription className="text-xs">
          Search across every item the agent has ever classified — cross-source, no refetch. Try:
          <span className="font-mono text-foreground"> &quot;Q2 planning&quot;</span>,
          <span className="font-mono text-foreground"> &quot;review requests from last week&quot;</span>,
          <span className="font-mono text-foreground"> &quot;launch blockers&quot;</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={runSearch} className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What are you looking for?"
            className="flex-1"
            disabled={isPending}
          />
          <Button type="submit" disabled={isPending || query.trim().length === 0}>
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
        </form>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        {results && results.length === 0 && !error && (
          <p className="text-xs text-muted-foreground">
            No matches yet. Run a catch-up first, then try again.
          </p>
        )}

        {results && results.length > 0 && (
          <ul className="space-y-2">
            {results.map((hit, i) => {
              const sourceConfig = getSource(hit.source);
              const SourceIcon = sourceConfig.icon;
              return (
                <li
                  key={`${i}-${hit.summary.slice(0, 20)}`}
                  className="rounded-md border border-border bg-muted/20 p-3 text-sm"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`h-5 px-1.5 text-[10px] ${sourceConfig.className}`}
                    >
                      <SourceIcon className="mr-1 size-3" />
                      {sourceConfig.label}
                    </Badge>
                    {hit.priority && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {hit.priority}
                      </Badge>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      score {hit.score.toFixed(3)}
                    </span>
                  </div>
                  {hit.url ? (
                    <a
                      href={hit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block break-words text-sm leading-snug hover:underline"
                    >
                      {hit.summary}
                    </a>
                  ) : (
                    <p className="break-words text-sm leading-snug">{hit.summary}</p>
                  )}
                  {hit.sourceDetail && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {hit.sourceDetail}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
