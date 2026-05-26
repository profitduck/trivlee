import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { NewChallengeForm, type RetryDefaults } from "./new-challenge-form";
import type { ChallengeFormat } from "@/lib/ai/types";

interface RetrySourceRow {
  challenger_id: string;
  topic: string;
  difficulty_requested: number;
  num_questions: number;
  format: string;
  timer_mode: string;
  time_per_question_s: number | null;
  total_time_s: number | null;
  max_players: number | null;
  auto_close_at: string | null;
  created_at: string;
}

/**
 * Load a previous (typically failed) challenge to seed the form. Returns null
 * if the row doesn't exist or belongs to a different user. Auto-close is
 * derived from the original auto_close_at - created_at delta, rounded to the
 * nearest preset (1h / 24h / 168h) or null if it doesn't match any preset.
 */
async function loadRetryDefaults(
  matchId: string,
  userId: string
): Promise<RetryDefaults | null> {
  const { rows } = await query<RetrySourceRow>(
    `SELECT challenger_id, topic, difficulty_requested, num_questions,
            format::text AS format, timer_mode::text AS timer_mode,
            time_per_question_s, total_time_s, max_players,
            auto_close_at, created_at
       FROM challenges
      WHERE id = $1`,
    [matchId]
  );
  const row = rows[0];
  if (!row || row.challenger_id !== userId) return null;

  // Derive auto-close in hours from the stored timestamp.
  let autoCloseHours: number | null = null;
  if (row.auto_close_at) {
    const ms = new Date(row.auto_close_at).getTime() - new Date(row.created_at).getTime();
    const hours = Math.round(ms / (3600 * 1000));
    // Snap to the form's presets so the chip selection lines up cleanly.
    const presets = [1, 24, 168];
    const nearest = presets.reduce((best, p) =>
      Math.abs(p - hours) < Math.abs(best - hours) ? p : best, presets[0]);
    autoCloseHours = Math.abs(nearest - hours) <= 1 ? nearest : null;
  }

  // Map the stored format string back to ChallengeFormat.
  const format = (
    row.format === "multiple_choice" || row.format === "free_text" || row.format === "mixed"
      ? row.format
      : "multiple_choice"
  ) as ChallengeFormat;

  // Map timer_mode back to the form's union.
  const timerMode = (
    row.timer_mode === "off" ||
    row.timer_mode === "per_question" ||
    row.timer_mode === "total" ||
    row.timer_mode === "stopwatch"
      ? row.timer_mode
      : "off"
  ) as RetryDefaults["timerMode"];

  return {
    topic: row.topic,
    difficulty: row.difficulty_requested,
    numQuestions: row.num_questions,
    format,
    timerMode,
    perQuestionDuration: row.time_per_question_s ?? undefined,
    totalDuration: row.total_time_s ?? undefined,
    sizeMode: row.max_players === null ? "open" : "cap",
    playerCap: row.max_players ?? undefined,
    autoCloseHours,
  };
}

export default async function NewChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ retry?: string }>;
}) {
  const user = await requireUser();
  const { retry } = await searchParams;
  const defaults = retry ? await loadRetryDefaults(retry, user.id) : null;

  return (
    <div className="max-w-2xl mx-auto">
      <Button variant="ghost" size="sm" asChild className="-ml-3 mb-4 gap-1.5">
        <Link href="/dashboard">
          <ArrowLeft className="size-4" />
          Back
        </Link>
      </Button>

      <div className="mb-8 anim-fade-up">
        <h1 className="font-display text-5xl font-extrabold tracking-tighter">
          <span className="text-gradient-warm">{defaults ? "Retry match" : "New match"}</span>
        </h1>
        <p className="text-muted-foreground mt-2 text-base">
          {defaults
            ? "We pre-filled your previous settings. Tweak anything you want, then create."
            : "Pick a topic, dial the difficulty, share the invite link with anyone you want to play."}
        </p>
      </div>

      {defaults && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-start gap-3">
            <RotateCcw className="size-5 text-primary shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Retrying a previous match</p>
              <p className="text-muted-foreground mt-0.5">
                Topic, difficulty, format, timer, and match-size settings are pre-filled
                from your earlier attempt.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <NewChallengeForm defaults={defaults ?? undefined} />
    </div>
  );
}
