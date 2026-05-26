import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Swords, Zap } from "lucide-react";

export default function Home() {
  return (
    <main className="flex-1 bg-confetti">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Swords className="size-5" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight">
              Trivlee
            </span>
          </div>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/sign-up">Get started</Link>
            </Button>
          </nav>
        </header>

        <section className="mt-24 sm:mt-32 max-w-3xl">
          <Badge variant="secondary" className="mb-6 gap-1.5">
            <Sparkles className="size-3.5" />
            AI-generated trivia on anything
          </Badge>
          <h1 className="font-display text-5xl sm:text-7xl font-extrabold tracking-tighter text-balance leading-[0.95]">
            Challenge your friends on{" "}
            <span className="text-primary">any topic</span>.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl text-balance">
            Type a TV show, a sport, a video game, a niche obsession — anything.
            We&rsquo;ll spin up calibrated trivia and put you head to head with
            a friend.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Button size="lg" asChild className="text-base">
              <Link href="/sign-up">Start a match</Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="text-base">
              <Link href="#how">How it works</Link>
            </Button>
          </div>
        </section>

        <section id="how" className="mt-28 sm:mt-36 grid gap-6 sm:grid-cols-3">
          <FeatureCard
            icon={<Sparkles className="size-5" />}
            title="Pick a topic"
            body="Anything that has facts. Always Sunny references. 1990s NBA. Python internals. Your pick."
            hue="bg-accent text-accent-foreground"
          />
          <FeatureCard
            icon={<Zap className="size-5" />}
            title="Dial the difficulty"
            body="From casual to obsessive. The AI calibrates every question to the level you pick."
            hue="bg-primary text-primary-foreground"
          />
          <FeatureCard
            icon={<Swords className="size-5" />}
            title="Invite anyone"
            body="Share a link. 2 players or 20. Live or async. Whoever scores highest wins."
            hue="bg-chart-2 text-primary-foreground"
          />
        </section>

        <footer className="mt-32 border-t pt-8 text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Trivlee. Built for fun.</p>
        </footer>
      </div>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  body,
  hue,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  hue: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm transition hover:shadow-md">
      <div className={`mb-4 grid size-10 place-items-center rounded-xl ${hue}`}>
        {icon}
      </div>
      <h3 className="font-display text-xl font-bold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
