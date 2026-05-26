"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Check, X, Clock, Hourglass, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { submitAnswer, type SubmitAnswerResult } from "./actions";

interface PlayCardProps {
  challengeId: string;
  topic: string;
  questionId: string;
  position: number;
  total: number;
  questionText: string;
  perQuestionFormat: "multiple_choice" | "free_text";
  timeLimitS: number | null;
  totalDeadlineMs: number | null;
  /** Epoch ms when this user opened their first question. Non-null only when
   *  timer_mode === 'stopwatch' — renders a count-up display used as the
   *  tiebreaker on the leaderboard. */
  stopwatchStartedMs: number | null;
  options: string[] | null;
}

function formatClock(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function formatStopwatch(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlayCard(props: PlayCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<SubmitAnswerResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [freeAnswer, setFreeAnswer] = useState("");
  const [startedAt] = useState(() => Date.now());

  // Per-question timer
  const [secondsLeft, setSecondsLeft] = useState<number | null>(
    props.timeLimitS ?? null
  );
  useEffect(() => {
    if (props.timeLimitS == null || feedback != null) return;
    const tick = setInterval(() => {
      setSecondsLeft((s) => (s == null ? null : Math.max(0, s - 1)));
    }, 1000);
    return () => clearInterval(tick);
  }, [props.timeLimitS, feedback]);

  useEffect(() => {
    if (secondsLeft === 0 && feedback == null && !pending) {
      handleSubmit(props.perQuestionFormat === "multiple_choice" ? "" : freeAnswer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  // Stopwatch (count-up) — runs across the whole match, ticking every second
  // while the user is on the play page. The leaderboard uses total_time_ms
  // from the attempts table to break ties; this display is the visible cue.
  const [stopwatchMs, setStopwatchMs] = useState<number | null>(() => {
    if (props.stopwatchStartedMs == null) return null;
    return Math.max(0, Date.now() - props.stopwatchStartedMs);
  });
  useEffect(() => {
    if (props.stopwatchStartedMs == null) return;
    const tick = setInterval(() => {
      setStopwatchMs(Math.max(0, Date.now() - props.stopwatchStartedMs!));
    }, 1000);
    return () => clearInterval(tick);
  }, [props.stopwatchStartedMs]);

  // Whole-quiz timer
  const [totalSecondsLeft, setTotalSecondsLeft] = useState<number | null>(() => {
    if (props.totalDeadlineMs == null) return null;
    return Math.max(0, Math.ceil((props.totalDeadlineMs - Date.now()) / 1000));
  });
  useEffect(() => {
    if (props.totalDeadlineMs == null) return;
    const tick = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((props.totalDeadlineMs! - Date.now()) / 1000)
      );
      setTotalSecondsLeft(remaining);
      if (remaining === 0) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [props.totalDeadlineMs]);

  // When the whole-quiz clock hits 0, kick the user back to the match detail.
  // The match itself only locks when the host closes it or it auto-closes; this
  // user's partial score will be tallied at that point.
  useEffect(() => {
    if (totalSecondsLeft === 0) {
      router.push(`/challenges/${props.challengeId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSecondsLeft]);

  function handleSubmit(answer: string) {
    if (pending || feedback) return;
    const timeMs = Date.now() - startedAt;
    startTransition(async () => {
      const res = await submitAnswer(props.challengeId, props.questionId, answer, timeMs);
      if (!res.ok) {
        router.push(`/challenges/${props.challengeId}`);
        return;
      }
      setFeedback(res);
    });
  }

  function handleNext() {
    if (feedback?.isLast) {
      router.push(`/challenges/${props.challengeId}`);
    } else {
      router.refresh();
    }
  }

  const isCorrect = feedback?.grade.isCorrect;
  const partial = feedback && !feedback.grade.isCorrect && feedback.grade.score > 0;
  const totalUrgent = totalSecondsLeft != null && totalSecondsLeft <= 15;

  return (
    <div className="space-y-6">
      {/* Whole-quiz countdown — sticky banner so it stays visible while playing */}
      {totalSecondsLeft != null && (
        <div
          className={cn(
            "flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border font-mono font-semibold tabular-nums",
            totalUrgent
              ? "bg-destructive/10 border-destructive/30 text-destructive"
              : "bg-muted border-border text-foreground"
          )}
        >
          <div className="flex items-center gap-2 text-sm">
            <Hourglass className="size-4" />
            <span className={totalUrgent ? "" : "text-muted-foreground"}>
              Total time
            </span>
          </div>
          <span className="text-base">{formatClock(totalSecondsLeft)}</span>
        </div>
      )}

      {/* Stopwatch banner — count-up. No urgency styling; the user can take
          as long as they want, but fastest wins ties. */}
      {stopwatchMs != null && (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border bg-muted border-border font-mono font-semibold tabular-nums">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="size-4" />
            <span>Your time (fastest wins ties)</span>
          </div>
          <span className="text-base">{formatStopwatch(stopwatchMs)}</span>
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{props.topic}</p>
          <p className="font-display text-lg font-semibold">
            Question {props.position}{" "}
            <span className="text-muted-foreground font-normal">of {props.total}</span>
          </p>
        </div>
        {props.timeLimitS && secondsLeft != null && feedback == null && (
          <div
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono font-semibold tabular-nums",
              secondsLeft <= 5 ? "bg-destructive/10 text-destructive" : "bg-muted"
            )}
          >
            <Clock className="size-4" />
            {secondsLeft}s
          </div>
        )}
      </header>

      <Card className="border-2">
        <CardContent className="p-6 sm:p-8 space-y-6">
          <p className="font-display text-2xl sm:text-3xl font-bold leading-tight text-balance">
            {props.questionText}
          </p>

          {!feedback && props.perQuestionFormat === "multiple_choice" && props.options && (
            <div className="grid gap-2">
              {props.options.map((opt) => (
                <Button
                  key={opt}
                  variant="outline"
                  size="lg"
                  className={cn(
                    "h-auto py-4 text-base whitespace-normal justify-start text-left",
                    selected === opt && "ring-2 ring-primary border-primary"
                  )}
                  onClick={() => {
                    setSelected(opt);
                    handleSubmit(opt);
                  }}
                  disabled={pending}
                >
                  {opt}
                </Button>
              ))}
            </div>
          )}

          {!feedback && props.perQuestionFormat === "free_text" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit(freeAnswer);
              }}
              className="space-y-3"
            >
              <Input
                value={freeAnswer}
                onChange={(e) => setFreeAnswer(e.target.value)}
                placeholder="Type your answer…"
                className="text-lg h-12"
                autoFocus
                disabled={pending}
              />
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={pending || freeAnswer.trim().length === 0}
              >
                {pending ? <Loader2 className="size-5 animate-spin" /> : "Submit"}
              </Button>
            </form>
          )}

          {feedback && (
            <div
              className={cn(
                "rounded-xl p-5 space-y-3",
                isCorrect && "bg-chart-5/15 border-2 border-chart-5/40",
                !isCorrect && partial && "bg-accent/30 border-2 border-accent",
                !isCorrect && !partial && "bg-destructive/10 border-2 border-destructive/30"
              )}
            >
              <div className="flex items-center gap-2 font-display text-xl font-bold">
                {isCorrect ? (
                  <>
                    <Check className="size-6 text-chart-5" />
                    Correct!
                  </>
                ) : partial ? (
                  <>
                    <Check className="size-6 text-accent-foreground" />
                    Partial credit
                  </>
                ) : (
                  <>
                    <X className="size-6 text-destructive" />
                    Not quite
                  </>
                )}
                <span className="ml-auto text-sm font-mono">
                  +{feedback.grade.score.toFixed(2)}
                </span>
              </div>
              {!isCorrect && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Correct answer:</span>{" "}
                  <span className="font-semibold">{feedback.correctAnswer}</span>
                </p>
              )}
              {feedback.grade.reason && (
                <p className="text-sm text-muted-foreground italic">
                  {feedback.grade.reason}
                </p>
              )}
              {feedback.sourceHint && (
                <p className="text-xs text-muted-foreground border-t pt-2 mt-2">
                  <span className="font-medium">Source:</span> {feedback.sourceHint}
                </p>
              )}

              <Button size="lg" onClick={handleNext} className="w-full mt-4 gap-2">
                {feedback.isLast ? "Finish" : "Next question"}
                <ArrowRight className="size-5" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
