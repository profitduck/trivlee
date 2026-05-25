import Link from "next/link";
import { Swords, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
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
          404
        </p>
        <h1 className="font-display text-5xl font-extrabold tracking-tighter mb-4">
          We couldn&rsquo;t find that.
        </h1>
        <p className="text-muted-foreground mb-8 text-balance">
          Maybe the match closed, or the invite link is wrong. Try heading back
          to your dashboard.
        </p>
        <Button asChild size="lg" className="gap-2">
          <Link href="/dashboard">
            Dashboard
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </main>
  );
}
