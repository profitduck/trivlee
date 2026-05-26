"use client";

import { useEffect, useState } from "react";

interface Particle {
  id: number;
  left: number;     // % across viewport
  delay: number;    // s before this particle starts falling
  duration: number; // s for the full fall
  color: string;
  rotate: number;   // initial degrees
  drift: number;    // horizontal travel in vw during the fall
  size: number;     // px
}

const COLORS = [
  "var(--color-primary)",
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-accent)",
];

// Pseudo-random but deterministic given the seed — keeps SSR/hydration
// consistent. The seed cycles per mount via Date.now() inside useEffect.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Pure-CSS confetti burst. Spawns N particles, each with a randomized fall
 * trajectory + rotation. After ~5 seconds they finish and the component
 * unmounts itself (so it doesn't keep eating layout space).
 *
 * Use it when something celebratory happens — winning, tying for first, etc.
 */
export function WinConfetti({ count = 60 }: { count?: number }) {
  // Defer particle generation to client mount: Math.random() during SSR would
  // produce hydration mismatches. Particles start empty (no SSR DOM cost),
  // then populate on the first effect tick.
  const [particles, setParticles] = useState<Particle[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const rand = rng(Date.now());
    const ps: Particle[] = Array.from({ length: count }, (_, i) => ({
      id: i,
      left: rand() * 100,
      delay: rand() * 0.4,
      duration: 3 + rand() * 2.5,
      color: COLORS[Math.floor(rand() * COLORS.length)],
      rotate: rand() * 360,
      drift: (rand() - 0.5) * 30,
      size: 6 + Math.floor(rand() * 6),
    }));
    setParticles(ps);
    const t = setTimeout(() => setDone(true), 6000);
    return () => clearTimeout(t);
  }, [count]);

  if (done) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 overflow-hidden z-50"
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute top-[-20px] block rounded-sm"
          style={{
            left: `${p.left}vw`,
            width: `${p.size}px`,
            height: `${p.size * 0.4}px`,
            backgroundColor: p.color,
            transform: `rotate(${p.rotate}deg)`,
            animation: `confetti-fall ${p.duration}s ease-out ${p.delay}s forwards`,
            // Custom property used by the keyframes for horizontal drift.
            ["--drift" as string]: `${p.drift}vw`,
          }}
        />
      ))}
      <style jsx global>{`
        @keyframes confetti-fall {
          0% {
            transform: translate3d(0, -20px, 0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translate3d(var(--drift), 105vh, 0) rotate(720deg);
            opacity: 0.2;
          }
        }
      `}</style>
    </div>
  );
}
