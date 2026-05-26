import Link from "next/link";
import { Swords } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-redirect";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  // Already signed in — skip the form.
  const existing = await getCurrentUser();
  if (existing) redirect(next);

  return (
    <main className="flex-1 bg-confetti">
      <div className="mx-auto max-w-md px-6 py-16 sm:py-24">
        <Link href="/" className="inline-flex items-center gap-2 mb-12">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Swords className="size-5" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">
            Trivlee
          </span>
        </Link>

        <Card className="border-2 shadow-lg">
          <CardHeader>
            <CardTitle className="font-display text-3xl">Create an account</CardTitle>
            <CardDescription>
              {next !== "/dashboard"
                ? "Pick a username to accept your invite."
                : "Pick a username and you’re in."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignUpForm next={next} />

            <p className="mt-6 text-sm text-center text-muted-foreground">
              Already have an account?{" "}
              <Link
                href={`/sign-in${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
                className="font-medium text-primary underline underline-offset-4"
              >
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
