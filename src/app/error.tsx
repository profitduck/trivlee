"use client";

import Link from "next/link";
import { Swords, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex-1 bg-confetti grid place-items-center">
      <div className="text-center px-6 py-20 max-w-md">
        <Link href="/" className="inline-flex items-center gap-2 mb-12">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Swords className="size-5" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">
            Trivlee
          </span>
        </Link>

        <p className="text-sm uppercase tracking-wider text-muted-foreground font-semibold mb-3">
          Something broke
        </p>
        <h1 className="font-display text-5xl font-extrabold tracking-tighter mb-4">
          That didn&rsquo;t work.
        </h1>
        <p className="text-muted-foreground mb-8 text-balance">
          {process.env.NODE_ENV !== "production" && error.message
            ? error.message
            : "An unexpected error stopped the page from loading. You can try again or head back to your dashboard."}
        </p>
        {error.digest && (
          <p className="text-xs font-mono text-muted-foreground mb-6">
            ref: {error.digest}
          </p>
        )}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Button size="lg" onClick={reset} className="gap-2">
            <RotateCcw className="size-4" />
            Try again
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
