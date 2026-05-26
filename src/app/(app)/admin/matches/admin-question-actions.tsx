"use client";

import { useState, useTransition } from "react";
import { EyeOff, Eye, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toggleBankHidden, deleteBankQuestion } from "./actions";

/**
 * Per-question admin controls shown on /admin/matches/[id]. For bank-linked
 * questions, gives the admin a Hide/Unhide toggle (soft purge) and a
 * Delete-from-bank action (hard purge). Hide is the recommended action —
 * it removes the question from future draws but leaves historical matches
 * intact.
 */
export function AdminBankActions({
  bankQuestionId,
  currentlyHidden,
}: {
  bankQuestionId: string;
  currentlyHidden: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (confirmDelete) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <span className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="size-3" />
          Remove from bank permanently?
        </span>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          className="h-6 text-xs px-2"
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await deleteBankQuestion(bankQuestionId);
              if ("error" in res) {
                setError(res.error);
                setConfirmDelete(false);
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
          className="h-6 text-xs px-2"
          onClick={() => setConfirmDelete(false)}
        >
          No
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 text-xs gap-1 px-2"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await toggleBankHidden(bankQuestionId, !currentlyHidden);
            if ("error" in res) setError(res.error);
          });
        }}
      >
        {currentlyHidden ? (
          <>
            <Eye className="size-3" /> Unhide
          </>
        ) : (
          <>
            <EyeOff className="size-3" /> Hide from bank
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 text-xs gap-1 px-2 text-destructive hover:text-destructive"
        disabled={pending}
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 className="size-3" />
        Delete
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
