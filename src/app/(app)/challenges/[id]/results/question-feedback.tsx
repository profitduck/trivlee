"use client";

import { useState, useTransition } from "react";
import { Flag, Star, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { rateQuestion, reportQuestion } from "./actions";

interface QuestionFeedbackProps {
  questionId: string;
  challengeId: string;
  existingQuality: number | null;
  existingReportStatus: string | null;
}

export function QuestionFeedback(props: QuestionFeedbackProps) {
  const [pending, startTransition] = useTransition();
  const [quality, setQuality] = useState<number | null>(props.existingQuality);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitted, setReportSubmitted] = useState(
    props.existingReportStatus !== null
  );
  const [error, setError] = useState<string | null>(null);

  function setStars(n: number) {
    setQuality(n);
    setError(null);
    startTransition(async () => {
      const res = await rateQuestion(props.questionId, props.challengeId, n, null);
      if ("error" in res && res.error) setError(res.error);
    });
  }

  function submitReport() {
    setError(null);
    startTransition(async () => {
      const res = await reportQuestion(
        props.questionId,
        props.challengeId,
        reportReason
      );
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setReportSubmitted(true);
      setShowReport(false);
      setReportReason("");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider font-semibold">Rate</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStars(n)}
            disabled={pending}
            className="p-0.5 hover:scale-110 transition-transform"
            aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
          >
            <Star
              className={cn(
                "size-4",
                quality !== null && n <= quality
                  ? "fill-accent text-accent stroke-accent-foreground/50"
                  : "text-muted-foreground"
              )}
            />
          </button>
        ))}
        {pending && quality !== null && <Loader2 className="size-3 animate-spin ml-1" />}
      </div>

      {!showReport && !reportSubmitted && (
        <button
          type="button"
          onClick={() => setShowReport(true)}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <Flag className="size-3.5" />
          Report
        </button>
      )}

      {reportSubmitted && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Check className="size-3.5" />
          Reported
        </span>
      )}

      {showReport && (
        <div className="basis-full mt-1 flex flex-col gap-2 p-3 bg-muted rounded-lg">
          <Textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder="What's wrong with this question?"
            rows={2}
            className="text-sm"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowReport(false);
                setReportReason("");
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submitReport}
              disabled={pending || reportReason.trim().length < 5}
            >
              {pending ? <Loader2 className="size-3 animate-spin" /> : "Submit report"}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="basis-full text-xs text-destructive">{error}</p>}
    </div>
  );
}
