import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { NewChallengeForm } from "./new-challenge-form";

export default async function NewChallengePage() {
  await requireUser();

  return (
    <div className="max-w-2xl mx-auto">
      <Button variant="ghost" size="sm" asChild className="-ml-3 mb-4 gap-1.5">
        <Link href="/dashboard">
          <ArrowLeft className="size-4" />
          Back
        </Link>
      </Button>

      <div className="mb-8">
        <h1 className="font-display text-4xl font-extrabold tracking-tighter">
          New match
        </h1>
        <p className="text-muted-foreground mt-2">
          Pick a topic, dial the difficulty, share the invite link with anyone you want to play.
        </p>
      </div>

      <NewChallengeForm />
    </div>
  );
}
