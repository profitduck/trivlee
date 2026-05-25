import Link from "next/link";
import { Flag, ArrowLeft, EyeOff, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { dismissReport, hideReportedQuestion } from "./actions";

interface ReportRow {
  id: string;
  question_id: string;
  question_text: string;
  correct_answer: string;
  bank_question_id: string | null;
  reporter_username: string;
  reason: string;
  status: string;
  created_at: string;
  challenge_id: string;
  challenge_topic: string;
  total_reports: number;
  hidden_in_bank: boolean;
}

async function getOpenReports(): Promise<ReportRow[]> {
  const { rows } = await query<ReportRow & { total_reports: string }>(
    `SELECT
       qr.id, qr.question_id, q.question_text, q.correct_answer, q.bank_question_id,
       u.username AS reporter_username,
       qr.reason, qr.status::text AS status, qr.created_at,
       qs.challenge_id, c.topic AS challenge_topic,
       (SELECT COUNT(*) FROM question_reports x WHERE x.question_id = q.id) AS total_reports,
       COALESCE(qb.hidden, false) AS hidden_in_bank
     FROM question_reports qr
     JOIN questions q ON q.id = qr.question_id
     JOIN users u ON u.id = qr.reporter_id
     JOIN question_sets qs ON qs.id = q.set_id
     JOIN challenges c ON c.id = qs.challenge_id
     LEFT JOIN question_bank qb ON qb.id = q.bank_question_id
     WHERE qr.status = 'open'
     ORDER BY qr.created_at DESC
     LIMIT 100`
  );
  return rows.map((r) => ({ ...r, total_reports: Number(r.total_reports) }));
}

export default async function AdminReportsPage() {
  await requireAdmin();
  const reports = await getOpenReports();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1.5">
        <Link href="/dashboard">
          <ArrowLeft className="size-4" />
          Dashboard
        </Link>
      </Button>

      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <h1 className="font-display text-3xl font-extrabold tracking-tighter">
            Moderation queue
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Open reports from players who flagged a question as wrong or unfair.
          Hiding a question removes it from the bank so it won&rsquo;t appear in future matches.
        </p>
      </header>

      {reports.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center">
            <Flag className="size-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No open reports right now.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <ReportCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ r }: { r: ReportRow }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {r.challenge_topic}
          </Badge>
          <div className="flex items-center gap-2">
            {r.total_reports > 1 && (
              <Badge variant="destructive" className="text-xs">
                {r.total_reports} reports
              </Badge>
            )}
            {r.hidden_in_bank && (
              <Badge variant="secondary" className="text-xs gap-1">
                <EyeOff className="size-3" /> hidden
              </Badge>
            )}
            {!r.bank_question_id && (
              <Badge variant="outline" className="text-[10px]">
                not in bank
              </Badge>
            )}
          </div>
        </div>
        <p className="font-medium leading-snug">{r.question_text}</p>
        <p className="text-sm">
          <span className="text-muted-foreground">Stated answer:</span>{" "}
          <span className="font-semibold">{r.correct_answer}</span>
        </p>
        <div className="bg-muted/50 rounded-lg p-3 border">
          <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-1">
            @{r.reporter_username} flagged it
          </p>
          <p className="text-sm">{r.reason}</p>
        </div>
        <div className="flex justify-end gap-2">
          <form action={dismissReport.bind(null, r.id)}>
            <Button type="submit" variant="ghost" size="sm" className="gap-1.5">
              <Check className="size-3.5" />
              Dismiss
            </Button>
          </form>
          <form action={hideReportedQuestion.bind(null, r.id)}>
            <Button type="submit" variant="destructive" size="sm" className="gap-1.5">
              <EyeOff className="size-3.5" />
              Hide question
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
