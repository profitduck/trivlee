"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles, AlertTriangle, Users, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { createChallenge } from "./actions";
import type { ChallengeFormat } from "@/lib/ai/types";

const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Casual passerby",
  2: "Beginner",
  3: "Casual fan",
  4: "Regular fan",
  5: "Solid fan",
  6: "Engaged fan",
  7: "Devoted fan",
  8: "Expert",
  9: "Encyclopedic",
  10: "Obsessive",
};

type TimerMode = "off" | "per_question" | "total";
type SizeMode = "open" | "cap";

const PER_QUESTION_DURATIONS = [10, 20, 30, 60] as const;
const TOTAL_DURATIONS_SECONDS = [60, 120, 300, 600] as const;
const PLAYER_CAPS = [2, 3, 5, 10, 20] as const;
const AUTO_CLOSE_HOURS = [1, 24, 168] as const; // 1h, 24h, 7d

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

function formatHours(h: number): string {
  if (h < 24) return `${h}h`;
  if (h % 168 === 0) return `${h / 168}w`;
  if (h % 24 === 0) return `${h / 24}d`;
  return `${h}h`;
}

export function NewChallengeForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState(5);
  const [numQuestions, setNumQuestions] = useState(10);
  const [format, setFormat] = useState<ChallengeFormat>("multiple_choice");
  const [timerMode, setTimerMode] = useState<TimerMode>("off");
  const [perQuestionDuration, setPerQuestionDuration] = useState<number>(20);
  const [totalDuration, setTotalDuration] = useState<number>(120);

  const [sizeMode, setSizeMode] = useState<SizeMode>("open");
  const [playerCap, setPlayerCap] = useState<number>(5);
  const [autoCloseHours, setAutoCloseHours] = useState<number | null>(24);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const timePerQuestionS = timerMode === "per_question" ? perQuestionDuration : null;
    const totalTimeS = timerMode === "total" ? totalDuration : null;
    const maxPlayers = sizeMode === "cap" ? playerCap : null;
    startTransition(async () => {
      const result = await createChallenge({
        topic,
        difficulty,
        numQuestions,
        format,
        mode: "async",
        timePerQuestionS,
        totalTimeS,
        maxPlayers,
        autoCloseHours,
      });
      if (result?.error) setError(result.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6 space-y-2">
          <Label htmlFor="topic" className="text-base font-display">
            Topic
          </Label>
          <Textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder='e.g. "Always Sunny in Philadelphia" — or comma-separate for multi-topic: "Inception, car brands, photography"'
            required
            rows={2}
            className="resize-none text-lg"
            autoFocus
          />
          <TopicPreview topic={topic} count={numQuestions} />
          <p className="text-xs text-muted-foreground">
            Be specific. &ldquo;Movies&rdquo; is too vague; &ldquo;A24 horror movies&rdquo; works.
            Multi-topic: comma-separate (or &ldquo;and&rdquo;/&ldquo;+&rdquo;) and we&rsquo;ll split the questions evenly.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-6">
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Label className="text-base font-display">Difficulty</Label>
              <span className="text-sm font-medium text-primary">
                {difficulty} · {DIFFICULTY_LABELS[difficulty]}
              </span>
            </div>
            <Slider min={1} max={10} step={1} value={difficulty} onValueChange={setDifficulty} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1 · Easy</span>
              <span>10 · Obsessive</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Label className="text-base font-display">Questions</Label>
              <span className="text-sm font-medium text-primary">{numQuestions}</span>
            </div>
            <Slider min={5} max={20} step={1} value={numQuestions} onValueChange={setNumQuestions} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-5">
          <SegmentedField label="Format" value={format} onChange={(v) => setFormat(v)}
            options={[
              { value: "multiple_choice", label: "Multiple choice" },
              { value: "free_text", label: "Free text" },
              { value: "mixed", label: "Mixed" },
            ]}
          />

          <div className="space-y-3">
            <SegmentedField
              label="Timer"
              value={timerMode}
              onChange={(v) => setTimerMode(v)}
              options={[
                { value: "off", label: "Off" },
                { value: "per_question", label: "Per question" },
                { value: "total", label: "Whole quiz" },
              ]}
              hint={
                timerMode === "off"
                  ? "No timer — players take as long as they want."
                  : timerMode === "per_question"
                    ? "Each question has its own countdown."
                    : "One shared clock counts down for the entire quiz."
              }
            />

            {timerMode === "per_question" && (
              <SegmentedField
                label="Per-question duration"
                value={String(perQuestionDuration)}
                onChange={(v) => setPerQuestionDuration(Number(v))}
                options={PER_QUESTION_DURATIONS.map((s) => ({ value: String(s), label: formatDuration(s) }))}
              />
            )}

            {timerMode === "total" && (
              <SegmentedField
                label="Total time"
                value={String(totalDuration)}
                onChange={(v) => setTotalDuration(Number(v))}
                options={TOTAL_DURATIONS_SECONDS.map((s) => ({ value: String(s), label: formatDuration(s) }))}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <Users className="size-4 text-muted-foreground" />
              <Label className="text-base font-display">Match size</Label>
            </div>
            <SegmentedField
              label=""
              value={sizeMode}
              onChange={(v) => setSizeMode(v)}
              options={[
                { value: "open", label: "Open invite" },
                { value: "cap", label: "Player cap" },
              ]}
              hint={
                sizeMode === "open"
                  ? "Anyone with the link can join until you close the match."
                  : "First N players to accept the link can play. Late joiners get rejected."
              }
            />

            {sizeMode === "cap" && (
              <div className="space-y-2">
                <Label className="text-base font-display">Max players</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-muted">
                    {PLAYER_CAPS.map((n) => {
                      const selected = playerCap === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setPlayerCap(n)}
                          className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition",
                            selected
                              ? "bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-sm text-muted-foreground">or</span>
                  <Input
                    type="number"
                    min={2}
                    max={100}
                    inputMode="numeric"
                    value={playerCap}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v)) {
                        setPlayerCap(Math.max(2, Math.min(100, v)));
                      } else if (e.target.value === "") {
                        setPlayerCap(2);
                      }
                    }}
                    aria-label="Custom max players"
                    className="w-24 h-10"
                  />
                </div>
                <p className="text-xs text-muted-foreground">2 to 100 players.</p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <Hourglass className="size-4 text-muted-foreground" />
              <Label className="text-base font-display">Auto-close</Label>
            </div>
            <SegmentedField
              label=""
              value={autoCloseHours === null ? "never" : String(autoCloseHours)}
              onChange={(v) => setAutoCloseHours(v === "never" ? null : Number(v))}
              options={[
                { value: "never", label: "Never" },
                ...AUTO_CLOSE_HOURS.map((h) => ({ value: String(h), label: formatHours(h) })),
              ]}
              hint={
                autoCloseHours === null
                  ? "Match stays open until you manually close it."
                  : `Match auto-closes ${formatHours(autoCloseHours)} after creation. Anyone still answering at that time keeps their partial score.`
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3 sticky bottom-4">
        <Button type="submit" size="lg" disabled={pending || topic.trim().length < 2}
          className="gap-2 shadow-lg">
          {pending ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="size-5" />
              Create match
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function parseSubTopics(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  // Split on common separators: , ; / + & and newlines. Also split on " and "
  // when the surrounding tokens look like distinct topics.
  const parts = trimmed
    .split(/\s*[,;/+&\n]\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // Dedupe (case-insensitive) while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function distributeCount(total: number, buckets: number): number[] {
  if (buckets <= 0) return [];
  const base = Math.floor(total / buckets);
  const extra = total % buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < extra ? 1 : 0));
}

function TopicPreview({ topic, count }: { topic: string; count: number }) {
  const subs = parseSubTopics(topic);
  if (subs.length < 2) return null;
  const split = distributeCount(count, subs.length);
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 mt-1">
      <p className="text-xs uppercase tracking-wider font-semibold text-primary mb-2">
        Multi-topic detected · {subs.length} subjects
      </p>
      <div className="flex flex-wrap gap-1.5">
        {subs.map((s, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card border text-xs font-medium"
          >
            <span>{s}</span>
            <span className="text-muted-foreground tabular-nums">· {split[i]}q</span>
          </span>
        ))}
      </div>
    </div>
  );
}

interface SegmentedFieldProps<T extends string> {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  hint?: string;
}

function SegmentedField<T extends string>({ label, value, onChange, options, hint }: SegmentedFieldProps<T>) {
  return (
    <div className="space-y-2">
      {label && <Label className="text-base font-display">{label}</Label>}
      <div className="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-muted">
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition",
                selected
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
