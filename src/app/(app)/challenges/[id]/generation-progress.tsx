"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Search,
  ShieldCheck,
  Database,
  Check,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Phases visible in the UI. The server may also emit "writing" briefly but
// in the speculative-writer pipeline that work runs in parallel with
// validation, so the UI collapses both into one "verifying" step.
type Phase = "starting" | "researching" | "validating" | "writing" | "saving";

interface PhaseResponse {
  phase: Phase | null | "failed";
  phaseAt: string | null;
  error?: string;
}

const PHASE_ORDER: Phase[] = ["researching", "validating", "saving"];

const PHASE_COPY: Record<Phase, { label: string; description: string }> = {
  starting: {
    label: "Starting",
    description: "Setting up — this usually takes a second.",
  },
  researching: {
    label: "Researching facts",
    description: "Gathering source-able claims about your topic.",
  },
  validating: {
    label: "Verifying & writing",
    description: "Cross-checking facts and drafting questions in parallel.",
  },
  writing: {
    label: "Verifying & writing",
    description: "Cross-checking facts and drafting questions in parallel.",
  },
  saving: {
    label: "Saving match",
    description: "Almost done — writing questions to the database.",
  },
};

interface GenerationProgressProps {
  challengeId: string;
  topic: string;
  numQuestions: number;
}

export function GenerationProgress({
  challengeId,
  topic,
  numQuestions,
}: GenerationProgressProps) {
  const router = useRouter();
  const [state, setState] = useState<PhaseResponse>({
    phase: "starting",
    phaseAt: new Date().toISOString(),
  });
  const [elapsed, setElapsed] = useState(0);
  // Lazily initialised so we don't call Date.now() during render. The first
  // effect tick captures the start, subsequent ticks compute elapsed.
  const startRef = useRef<number | null>(null);

  // Tick elapsed time for the honest "X:XX elapsed" display.
  useEffect(() => {
    startRef.current = Date.now();
    const tick = setInterval(() => {
      if (startRef.current === null) return;
      setElapsed(Date.now() - startRef.current);
    }, 250);
    return () => clearInterval(tick);
  }, []);

  // Poll the phase endpoint. When it goes null, refresh the page so the
  // server component re-renders with the completed match view.
  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/challenges/${challengeId}/phase`, {
          cache: "no-store",
        });
        if (!res.ok) {
          // Forbidden or not found — bail out, let the page error boundary handle it.
          if (!cancelled) router.refresh();
          return;
        }
        const data = (await res.json()) as PhaseResponse;
        if (cancelled) return;
        setState(data);
        if (data.phase === null) {
          // Generation finished. Refresh so the page re-fetches the match.
          router.refresh();
          return;
        }
        if (data.phase === "failed") {
          // Stop polling — the UI will offer a retry.
          return;
        }
        timeout = setTimeout(poll, 2000);
      } catch {
        // Network hiccup — retry quietly.
        if (!cancelled) timeout = setTimeout(poll, 3000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [challengeId, router]);

  if (state.phase === "failed") {
    return <FailedCard error={state.error ?? "Something went wrong."} />;
  }

  // Normalize "writing" → "validating" for the UI. The speculative-writer
  // pipeline runs them in parallel; we collapse both into one user-visible
  // step. (The server may still emit "writing" for in-flight legacy matches
  // during a deploy.)
  const rawPhase = state.phase ?? "saving";
  const activePhase: Phase = rawPhase === "writing" ? "validating" : (rawPhase as Phase);
  const cleanTopic = topic.trim() || "your topic";

  return (
    <Card className="border-2">
      <CardContent className="p-8 sm:p-10 text-center space-y-6">
        <div className="size-16 mx-auto rounded-2xl bg-primary/10 grid place-items-center">
          <Sparkles className="size-8 text-primary" />
        </div>

        <div className="space-y-1">
          <h3 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tighter">
            Creating your match…
          </h3>
          <p className="text-sm text-muted-foreground">
            {numQuestions} questions on &ldquo;{cleanTopic}&rdquo;
          </p>
        </div>

        {/* Indeterminate shimmer — honest about not knowing the percentage. */}
        <div className="h-2 bg-muted rounded-full overflow-hidden relative">
          <div className="absolute inset-y-0 w-1/3 bg-primary/70 rounded-full animate-[progressShimmer_1.6s_ease-in-out_infinite]" />
        </div>
        <style jsx>{`
          @keyframes progressShimmer {
            0% {
              left: -33%;
            }
            100% {
              left: 100%;
            }
          }
        `}</style>

        <div className="text-sm text-muted-foreground tabular-nums">
          {formatElapsed(elapsed)} elapsed
        </div>

        <div className="grid gap-2 text-sm text-left max-w-xs mx-auto">
          {PHASE_ORDER.map((p) => (
            <PhaseRow key={p} phase={p} state={phaseState(p, activePhase)} />
          ))}
        </div>

        {elapsed > 180_000 && (
          <p className="text-xs text-muted-foreground">
            This is taking longer than usual. You can leave this page open — when generation finishes,
            the match will appear automatically.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function phaseState(
  row: Phase,
  active: Phase
): "done" | "active" | "pending" {
  const rowIdx = PHASE_ORDER.indexOf(row);
  const activeIdx = PHASE_ORDER.indexOf(active);
  if (rowIdx < activeIdx) return "done";
  if (rowIdx === activeIdx) return "active";
  return "pending";
}

function PhaseRow({
  phase,
  state,
}: {
  phase: Phase;
  state: "done" | "active" | "pending";
}) {
  const copy = PHASE_COPY[phase];
  const Icon = ICONS[phase];
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
        state === "done" && "text-foreground",
        state === "active" && "bg-primary/5 text-foreground",
        state === "pending" && "text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "size-6 rounded-md grid place-items-center shrink-0",
          state === "done" && "bg-chart-5/20 text-chart-5",
          state === "active" && "bg-primary/15 text-primary",
          state === "pending" && "bg-muted"
        )}
      >
        {state === "done" ? (
          <Check className="size-3.5" />
        ) : state === "active" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Icon className="size-3.5" />
        )}
      </span>
      <span className="font-medium">{copy.label}</span>
    </div>
  );
}

const ICONS: Record<Phase, React.ComponentType<{ className?: string }>> = {
  starting: Sparkles,
  researching: Search,
  validating: ShieldCheck,
  writing: ShieldCheck, // collapsed into the "validating" UI step
  saving: Database,
};

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function FailedCard({ error }: { error: string }) {
  return (
    <Card className="border-2 border-destructive/40">
      <CardContent className="p-8 sm:p-10 space-y-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="size-6 text-destructive shrink-0" />
          <div className="space-y-1">
            <h3 className="font-display text-xl font-bold">
              Generation failed
            </h3>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href="/challenges/new">Try again</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
