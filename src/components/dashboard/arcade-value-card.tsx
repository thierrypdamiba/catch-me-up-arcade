"use client";

import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@arcadeai/design-system";
import { Zap } from "lucide-react";

interface ArcadeValueCardProps {
  sourcesConnected?: number;
  totalSources?: number;
}

export function ArcadeValueCard({
  sourcesConnected,
  totalSources = 5,
}: ArcadeValueCardProps) {
  const connected = sourcesConnected ?? totalSources;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="size-5 text-primary" />
          Built on Arcade — one gateway, five services
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat value={String(connected)} label="sources unified" />
          <Stat value="1" label="gateway URL" />
          <Stat value="~1,180" label="lines of OAuth I didn't write" />
          <Stat value="0" label="token stores I operate" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Auth, tokens, refresh, and policy enforcement all handled by Arcade&apos;s gateway.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/compare">See the code →</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-2xl font-semibold text-primary">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
