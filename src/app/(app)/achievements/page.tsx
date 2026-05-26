import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
  Flame,
  Mountain,
  Globe,
  BookOpen,
  Trophy,
  Zap,
  Target,
  Timer,
  Crown,
  Award,
  Lock,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { getUserAchievements, type Achievement } from "@/lib/achievements";

// Map the icon-name strings in achievement defs back to actual components.
// Keeping the def file pure server data means we can later cache or transmit
// it without bundling lucide.
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles, Flame, Mountain, Globe, BookOpen, Trophy, Zap, Target, Timer, Crown, Award,
};

const TIER_STYLES: Record<Achievement["tier"], { ring: string; icon: string; badge: string }> = {
  common: {
    ring: "border-chart-2/30",
    icon: "bg-chart-2/15 text-chart-2",
    badge: "bg-chart-2/15 text-chart-2",
  },
  rare: {
    ring: "border-primary/40",
    icon: "bg-primary/15 text-primary",
    badge: "bg-primary/15 text-primary",
  },
  legendary: {
    ring: "border-accent/60 bg-gradient-to-br from-accent/10 to-card",
    icon: "bg-gradient-to-br from-accent to-primary text-primary-foreground",
    badge: "bg-gradient-to-r from-accent to-primary text-primary-foreground",
  },
};

export default async function AchievementsPage() {
  const user = await requireUser();
  const { unlocked, locked, recentlyUnlocked } = await getUserAchievements(user.id);
  const total = unlocked.length + locked.length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1.5">
        <Link href="/dashboard">
          <ArrowLeft className="size-4" />
          Back
        </Link>
      </Button>

      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Award className="size-7 text-primary" />
          <h1 className="font-display text-4xl font-extrabold tracking-tighter">
            Achievements
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">
          {unlocked.length} of {total} unlocked.
        </p>
      </header>

      {unlocked.length > 0 && (
        <section>
          <h2 className="font-display text-xl font-bold mb-3">Unlocked</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {unlocked.map((a) => (
              <AchievementCard
                key={a.id}
                achievement={a}
                unlocked
                fresh={recentlyUnlocked.has(a.id)}
              />
            ))}
          </div>
        </section>
      )}

      {locked.length > 0 && (
        <section>
          <h2 className="font-display text-xl font-bold mb-3 text-muted-foreground">
            Locked
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {locked.map((a) => (
              <AchievementCard key={a.id} achievement={a} unlocked={false} fresh={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AchievementCard({
  achievement: a,
  unlocked,
  fresh,
}: {
  achievement: Achievement;
  unlocked: boolean;
  fresh: boolean;
}) {
  const Icon = ICON_MAP[a.icon] ?? Sparkles;
  const tierStyle = TIER_STYLES[a.tier];
  return (
    <Card className={cn("border", unlocked ? tierStyle.ring : "opacity-60")}>
      <CardContent className="p-4 flex items-start gap-3">
        <div
          className={cn(
            "size-12 rounded-xl grid place-items-center shrink-0",
            unlocked ? tierStyle.icon : "bg-muted text-muted-foreground"
          )}
        >
          {unlocked ? <Icon className="size-6" /> : <Lock className="size-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-bold">{a.name}</h3>
            {unlocked && fresh && (
              <Badge className="text-[10px] gap-1 bg-primary text-primary-foreground">
                <Sparkles className="size-2.5" /> New!
              </Badge>
            )}
            {unlocked && !fresh && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <CheckCircle2 className="size-2.5" />
                {a.tier}
              </Badge>
            )}
            {!unlocked && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {a.tier}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{a.description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
