import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";

// Tiny polling endpoint for the generation-progress UI. Returns the real
// server-side phase plus how long it's been since the last phase change so
// the client can detect stuck generations.
//
// Response shapes:
//   { phase: "drafting"        , phaseAt: "...iso..." }   active
//   { phase: null              , phaseAt: "...iso..." }   done
//   { phase: "failed"          , phaseAt: "...iso...", error: "msg" }   failed
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const user = await requireUser();

  const { rows } = await query<{
    challenger_id: string;
    generation_phase: string | null;
    generation_phase_at: string | null;
  }>(
    `SELECT challenger_id, generation_phase, generation_phase_at
       FROM challenges
      WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.challenger_id !== user.id) {
    // Only the challenger sees their own generation phase — joiners don't
    // need progress updates since they only land on /join/[token] after the
    // match is fully generated.
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const phase = row.generation_phase;
  if (phase && phase.startsWith("failed:")) {
    return NextResponse.json({
      phase: "failed",
      phaseAt: row.generation_phase_at,
      error: phase.slice("failed:".length),
    });
  }
  return NextResponse.json({
    phase,
    phaseAt: row.generation_phase_at,
  });
}
