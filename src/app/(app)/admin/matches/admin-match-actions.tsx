"use client";

import { useState, useTransition } from "react";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteMatchAsAdmin } from "./actions";

/**
 * Admin delete button for the matches list. Two-step inline confirm,
 * stays on /admin/matches afterwards (revalidate, no redirect).
 */
export function AdminDeleteMatchButton({ matchId }: { matchId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (confirming) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <span className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="size-3" />
          Delete match + all related rows?
        </span>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          className="h-7 text-xs px-2"
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await deleteMatchAsAdmin(matchId);
              if ("error" in res) {
                setError(res.error);
                setConfirming(false);
              }
            });
          }}
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : "Yes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          className="h-7 text-xs px-2"
          onClick={() => setConfirming(false)}
        >
          No
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
      onClick={() => setConfirming(true)}
    >
      <Trash2 className="size-3" />
      Delete match
    </Button>
  );
}
