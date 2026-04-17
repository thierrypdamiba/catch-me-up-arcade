"use client";

import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CodeBlock,
  CodeBlockCode,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@arcadeai/design-system";
import { ArrowLeft, ArrowRight, Clock, FileCode2, ShieldCheck, Users } from "lucide-react";
import { contextualAccessSample, memorySample, sourceSamples } from "./code-samples";

const TOTAL_WITHOUT = sourceSamples.reduce((s, x) => s + x.withoutLoC, 0);
const TOTAL_WITH = sourceSamples.reduce((s, x) => s + x.withLoC, 0);

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>

        <header className="mb-10 space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline">The case for Arcade</Badge>
          </div>
          <h1 className="text-3xl font-semibold">What Arcade replaces</h1>
          <p className="max-w-3xl text-muted-foreground">
            Arcade&apos;s core value is <strong>managed auth</strong> across many SaaS providers
            — plus a policy layer (Contextual Access) that enforces rules at every tool call. Both
            are the hard parts of building a real agent. Here&apos;s what you&apos;d write without
            it, side-by-side with what you write on top of it.
          </p>
        </header>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="contextual">Contextual Access</TabsTrigger>
            <TabsTrigger value="memory">Memory (Qdrant)</TabsTrigger>
            {sourceSamples.map((s) => (
              <TabsTrigger key={s.id} value={s.id}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview">
            <Card className="mb-6 border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background">
              <CardContent className="py-8">
                <div className="grid grid-cols-1 items-center gap-6 text-center sm:grid-cols-[1fr_auto_1fr]">
                  <div className="space-y-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-destructive">
                      Without Arcade
                    </div>
                    <HeroStat value={`~${TOTAL_WITHOUT}`} unit="lines of OAuth + API-client code" tone="bad" big />
                    <HeroStat value="5" unit="OAuth apps to register & operate" tone="bad" />
                    <HeroStat value="~1–2 weeks" unit="to first authenticated call" tone="bad" />
                  </div>
                  <div className="hidden text-4xl text-muted-foreground sm:block">→</div>
                  <div className="space-y-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                      With Arcade
                    </div>
                    <HeroStat value={`~${TOTAL_WITH}`} unit="lines of glue you write" tone="good" big />
                    <HeroStat value="0" unit="OAuth apps — Arcade runs them" tone="good" />
                    <HeroStat value="~5 minutes" unit="to first authenticated call" tone="good" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-destructive">
                    <FileCode2 className="size-5" />
                    Without Arcade
                  </CardTitle>
                  <CardDescription>What you build yourself</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Auth + API client code</span>
                    <span className="font-mono font-semibold">~{TOTAL_WITHOUT} LoC</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">OAuth apps registered</span>
                    <span className="font-mono font-semibold">5</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Token stores to run</span>
                    <span className="font-mono font-semibold">1 (encrypted, per-user)</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Refresh loops to operate</span>
                    <span className="font-mono font-semibold">5 (one per provider)</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Rate-limit strategies</span>
                    <span className="font-mono font-semibold">5 (different tiers/quotas)</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Policy engine</span>
                    <span className="font-mono font-semibold">Build your own</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">COAT mitigation</span>
                    <span className="font-mono font-semibold">DIY session binding</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <ShieldCheck className="size-5" />
                    With Arcade
                  </CardTitle>
                  <CardDescription>What you write on top of the gateway</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Auth + API client code</span>
                    <span className="font-mono font-semibold">~{TOTAL_WITH} LoC</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">OAuth apps registered</span>
                    <span className="font-mono font-semibold">0</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Token stores to run</span>
                    <span className="font-mono font-semibold">0 (Arcade stores them)</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Refresh loops to operate</span>
                    <span className="font-mono font-semibold">0</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Rate-limit strategies</span>
                    <span className="font-mono font-semibold">0 (gateway handles)</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">Policy engine</span>
                    <span className="font-mono font-semibold">Config (Contextual Access)</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">COAT mitigation</span>
                    <span className="font-mono font-semibold">Built in (verifier binding)</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
              <ValueAxis
                icon={<Clock className="size-5" />}
                title="Developer time"
                body="5 OAuth flows, 5 token stores, 5 rate-limit playbooks. One week minimum before your agent makes its first authenticated call. With Arcade: minutes."
              />
              <ValueAxis
                icon={<ShieldCheck className="size-5" />}
                title="Security"
                body="Token binding, refresh rotation, scope handling, COAT protection. All live places where DIY teams get breached. Arcade ships this as the product."
              />
              <ValueAxis
                icon={<FileCode2 className="size-5" />}
                title="Ops complexity"
                body="Token revocation, scope re-consent, provider deprecations, secret rotation. You either operate this yourself or pay Arcade to do it once, for every customer."
              />
              <ValueAxis
                icon={<Users className="size-5" />}
                title="End-user UX"
                body="One 'Sign in with Arcade' vs five separate OAuth hops. Your users see one consent screen, not a sequence they forget halfway through."
              />
            </div>

            <div className="mt-8 rounded-lg border border-primary/30 bg-primary/5 p-6 text-center">
              <h3 className="mb-2 text-lg font-semibold">Try it with your own accounts</h3>
              <p className="mx-auto mb-4 max-w-xl text-sm text-muted-foreground">
                The catch-me-up agent above runs on this exact stack — five sources fanned out
                in parallel, drafts written inline, memory indexed per-user. Open it against
                your real Gmail, Slack, GitHub, Linear, and Calendar.
              </p>
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Open the agent
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="memory">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Memory — Qdrant is the easy part</CardTitle>
                  <CardDescription>
                    The Qdrant code to index + search across five sources is ~20 lines. It&apos;s
                    the data pipeline feeding it that&apos;s the work. Without Arcade, you build
                    five OAuth integrations and five response normalizers before the first vector
                    ever lands — the memory layer is gated behind the auth layer. With Arcade,
                    the gateway hands the LLM already-normalized tool responses and you embed
                    what comes out. Same Qdrant code, radically less glue.
                  </CardDescription>
                </CardHeader>
              </Card>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-destructive">
                    Without Arcade — 5 pipelines + a normalizer
                  </h3>
                  <CodeBlock className="max-h-[560px] overflow-auto">
                    <CodeBlockCode code={memorySample.without} language="ts" />
                  </CodeBlock>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">
                    With Arcade + Qdrant
                  </h3>
                  <CodeBlock className="max-h-[560px] overflow-auto">
                    <CodeBlockCode code={memorySample.with} language="ts" />
                  </CodeBlock>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="contextual">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Contextual Access — the real moat</CardTitle>
                  <CardDescription>
                    Policy enforcement at every stage of the agent&apos;s tool loop. Pre-resolution
                    (should this tool even be visible?), pre-execution (is this call allowed?),
                    post-execution (did the params comply?). Declarative config instead of a custom
                    policy engine per team.
                  </CardDescription>
                </CardHeader>
              </Card>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-destructive">
                    Without Arcade
                  </h3>
                  <CodeBlock className="max-h-[560px] overflow-auto">
                    <CodeBlockCode code={contextualAccessSample.without} language="ts" />
                  </CodeBlock>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">
                    With Arcade
                  </h3>
                  <CodeBlock className="max-h-[560px] overflow-auto">
                    <CodeBlockCode code={contextualAccessSample.with} language="ts" />
                  </CodeBlock>
                </div>
              </div>
            </div>
          </TabsContent>

          {sourceSamples.map((s) => (
            <TabsContent key={s.id} value={s.id}>
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                  <StatCell label="Without Arcade" value={`${s.withoutLoC} LoC`} tone="bad" />
                  <StatCell label="With Arcade" value={`${s.withLoC} LoC`} tone="good" />
                  <StatCell label="Extra setup" value={s.withoutSetup} />
                  <StatCell
                    label="Reduction"
                    value={`${Math.round((1 - s.withLoC / s.withoutLoC) * 100)}% less code`}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-destructive">
                      Without Arcade — {s.label}
                    </h3>
                    <CodeBlock className="max-h-[560px] overflow-auto">
                      <CodeBlockCode code={s.without} language="ts" />
                    </CodeBlock>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">
                      With Arcade — {s.label}
                    </h3>
                    <CodeBlock className="max-h-[560px] overflow-auto">
                      <CodeBlockCode code={s.with} language="ts" />
                    </CodeBlock>
                  </div>
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <div className="mt-10 flex items-center justify-center">
          <Button asChild size="lg" variant="outline">
            <Link href="/dashboard">Back to the agent</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function HeroStat({
  value,
  unit,
  tone,
  big,
}: {
  value: string;
  unit: string;
  tone: "good" | "bad";
  big?: boolean;
}) {
  const color = tone === "good" ? "text-primary" : "text-destructive";
  return (
    <div>
      <div
        className={`font-mono font-bold ${color} ${big ? "text-5xl" : "text-2xl"}`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{unit}</div>
    </div>
  );
}

function ValueAxis({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-primary"
      : tone === "bad"
        ? "text-destructive"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 font-mono text-sm font-semibold ${toneCls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
