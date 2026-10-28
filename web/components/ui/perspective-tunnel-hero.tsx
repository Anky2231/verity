"use client";

import {
  animate,
  motion,
  useTransform,
  useReducedMotion,
  useMotionValue,
  useSpring,
  MotionValue,
} from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// A hero that flies the visitor through a 3D corridor of cards. Adapted for Verity:
//  - the cards describe what Verity checks (pictures from real VisualGuard output, or an icon panel);
//  - the headline and the real sign-in controls are passed in, so nothing about the page's behaviour lives here;
//  - the corridor stops capturing the mouse wheel at both ends, so the page below still scrolls;
//  - for touch screens and for visitors who ask for reduced motion there is no 3D at all: the same cards are shown as a plain grid;
//  - the cards are decoration, so a screen reader gets the same information as a plain list instead.

export interface TunnelItem {
  id: string;
  title: string;
  caption: string;
  /** A picture for the card. Without one, the card is an icon panel. */
  src?: string;
  icon?: LucideIcon;
  /** Colour of an icon panel. */
  tone?: "indigo" | "emerald" | "amber" | "rose" | "sky" | "violet";
}

export interface PerspectiveTunnelHeroProps {
  items: TunnelItem[];
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  scrollHint?: string;
  /** Rendered once, above the corridor, always clickable: the sign-in controls and any status message. */
  children?: ReactNode;
}

const TONES: Record<NonNullable<TunnelItem["tone"]>, string> = {
  indigo: "from-indigo-600 to-indigo-900",
  emerald: "from-emerald-600 to-emerald-900",
  amber: "from-amber-600 to-amber-900",
  rose: "from-rose-600 to-rose-900",
  sky: "from-sky-600 to-sky-900",
  violet: "from-violet-600 to-violet-900",
};

interface TunnelCardData {
  item: TunnelItem;
  angleCos: number;
  angleSin: number;
  radiusFactorX: number;
  radiusFactorY: number;
  rotationZ: number;
  index: number;
}

function layoutCards(items: TunnelItem[]): TunnelCardData[] {
  return items.map((item, i) => {
    const goldenAngle = i * 137.5 * (Math.PI / 180);
    return {
      item,
      angleCos: Math.cos(goldenAngle),
      angleSin: Math.sin(goldenAngle),
      radiusFactorX: 0.28 + (i % 3) * 0.08,
      radiusFactorY: 0.26 + (i % 2) * 0.09,
      rotationZ: (i % 2 === 0 ? 1 : -1) * (3 + (i % 5) * 2),
      index: i,
    };
  });
}

const SPRING_CONFIG = { stiffness: 60, damping: 25, mass: 0.5 };
const INTRO_PROGRESS = 0.38; // how far the corridor flies by itself on load, so the first screen is not empty

interface StageDimensions {
  width: number;
  height: number;
  isMobile: boolean;
}

function useCameraParallax(enabled: boolean) {
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, SPRING_CONFIG);
  const y = useSpring(rawY, SPRING_CONFIG);

  useEffect(() => {
    if (!enabled) return;
    const onMove = (e: PointerEvent) => {
      rawX.set((e.clientX / window.innerWidth - 0.5) * 2);
      rawY.set((e.clientY / window.innerHeight - 0.5) * 2);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [enabled, rawX, rawY]);

  return { x, y };
}

/** What a card shows. Used in the corridor and in the plain grid. */
function CardFace({ item, compact = false }: { item: TunnelItem; compact?: boolean }) {
  const Icon = item.icon;
  if (item.src) {
    return (
      <div className="relative box-border h-full w-full overflow-hidden rounded-2xl bg-neutral-200 shadow-2xl shadow-neutral-950/20 ring-1 ring-black/10 dark:bg-neutral-900 dark:shadow-black/90 dark:ring-white/15">
        {/* The picture is decoration (the title and caption carry the meaning), a small local file, and it sits inside 3D
            transforms, so next/image's optimiser adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.src} alt="" draggable={false} className="h-full w-full object-cover" />
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/20 to-transparent p-4">
          <span className="font-mono text-xs uppercase tracking-widest text-white">{item.title}</span>
          <span className={`mt-1 text-white/85 ${compact ? "text-xs" : "text-[11px] sm:text-xs"}`}>{item.caption}</span>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`relative box-border flex h-full w-full flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br ${TONES[item.tone ?? "indigo"]} p-4 text-white shadow-2xl shadow-neutral-950/20 ring-1 ring-black/10 dark:shadow-black/90 dark:ring-white/15 sm:p-5`}
    >
      {Icon ? <Icon aria-hidden="true" className="h-8 w-8 text-white/90" strokeWidth={1.5} /> : null}
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-white">{item.title}</p>
        <p className={`mt-2 leading-snug text-white/90 ${compact ? "text-sm" : "text-[11px] sm:text-xs"}`}>{item.caption}</p>
      </div>
    </div>
  );
}

interface TunnelCardProps {
  card: TunnelCardData;
  progress: MotionValue<number>;
  pointer: { x: MotionValue<number>; y: MotionValue<number> };
  total: number;
  stage: StageDimensions;
}

function TunnelCard({ card, progress, pointer, total, stage }: TunnelCardProps) {
  const staggerSpan = 0.55;
  const start = (card.index / total) * (1 - staggerSpan);
  const end = start + staggerSpan;

  const localProgress = useTransform(progress, [start, end], [0, 1]);

  const farZ = stage.isMobile ? -1200 : -1700;
  const nearZ = stage.isMobile ? 350 : 500;
  const z = useTransform(localProgress, [0, 1], [farZ, nearZ]);

  const opacity = useTransform(localProgress, [0, 0.18, 0.82, 0.98], [0, 1, 1, 0]);

  const cardWidth = stage.isMobile
    ? Math.max(130, Math.min(180, stage.width * 0.38))
    : Math.max(190, Math.min(270, stage.width * 0.18));

  const baseX = card.angleCos * (stage.width * card.radiusFactorX);
  const baseY = card.angleSin * (stage.height * card.radiusFactorY);
  const panStrength = stage.isMobile ? 20 : 45;

  const transform = useTransform([z, pointer.x, pointer.y], ([currZ, px, py]: number[]) => {
    const offsetX = baseX - px * panStrength;
    const offsetY = baseY - py * panStrength;
    return `translate3d(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px), ${currZ}px) rotateZ(${card.rotationZ}deg)`;
  });

  return (
    <motion.div
      style={{ width: cardWidth, transform, opacity, zIndex: card.index + 1 }}
      className="pointer-events-none absolute left-1/2 top-1/2 aspect-[4/5] select-none will-change-transform"
    >
      <CardFace item={card.item} />
    </motion.div>
  );
}

export default function PerspectiveTunnelHero({
  items,
  eyebrow,
  title,
  description,
  scrollHint = "Scroll to explore",
  children,
}: PerspectiveTunnelHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const cards = useMemo(() => layoutCards(items), [items]);

  const [stage, setStage] = useState<StageDimensions>({ width: 1440, height: 900, isMobile: false });
  const [coarse, setCoarse] = useState(false);
  const [mounted, setMounted] = useState(false);
  // No 3D for touch screens (no wheel to fly with), narrow windows, or visitors who asked for less motion: the cards become a plain grid.
  // It is decided only after mounting, so the first client render matches the server's HTML and hydration is clean.
  const flat = mounted && (Boolean(reduce) || coarse || stage.width < 768);   // narrow windows too: the corridor needs room

  useEffect(() => {
    const update = () =>
      setStage({ width: window.innerWidth, height: window.innerHeight, isMobile: window.innerWidth < 768 });
    update();
    window.addEventListener("resize", update);
    const mq = window.matchMedia("(pointer: coarse)");
    const onChange = () => setCoarse(mq.matches);
    onChange();
    setMounted(true);
    mq.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("resize", update);
      mq.removeEventListener("change", onChange);
    };
  }, []);

  const rawProgress = useMotionValue(0);
  const smoothProgress = useSpring(rawProgress, { stiffness: 80, damping: 30, restDelta: 0.0001 });

  // A gentle fly-in on load, so the first screen shows cards. The first wheel turn takes over.
  useEffect(() => {
    if (flat) return;
    const intro = animate(rawProgress, INTRO_PROGRESS, { duration: 4, ease: "easeOut", delay: 0.4 });
    return () => intro.stop();
  }, [flat, rawProgress]);

  // The wheel flies the corridor only while the hero is what the visitor is looking at (page at the top) and the corridor
  // has somewhere to go. At the far end, or anywhere further down the page, the wheel scrolls the page as usual.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || flat) return;
    const handleWheel = (e: WheelEvent) => {
      if (window.scrollY > 8) return;
      const current = rawProgress.get();
      if ((e.deltaY > 0 && current >= 1) || (e.deltaY < 0 && current <= 0)) return;
      e.preventDefault();
      rawProgress.stop();
      rawProgress.set(Math.min(1, Math.max(0, current + e.deltaY * 0.0008)));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [flat, rawProgress]);

  const pointer = useCameraParallax(!flat);

  const titleScale = useTransform(smoothProgress, [0, 0.5, 1], [0.92, 1, 1.12]);
  const titleOpacity = useTransform(smoothProgress, [0, 0.1, 0.9, 1], [0.6, 1, 1, 0.55]);
  const promptOpacity = useTransform(smoothProgress, [0, 0.12], [1, 0]);

  return (
    <section
      ref={containerRef}
      aria-labelledby="verity-hero-title"
      className={`relative box-border flex w-full select-none flex-col items-center justify-center overflow-hidden bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-white ${
        flat ? "min-h-0 px-4 py-14" : "h-[calc(100svh-3.5rem)] min-h-[600px] pb-44"
      }`}
      style={{ perspective: stage.isMobile ? "900px" : "1200px", transformStyle: "preserve-3d" }}
    >
      {/* Background grid and glow */}
      <div className="pointer-events-none absolute inset-0 [background-size:28px_28px] [mask-image:radial-gradient(ellipse_70%_70%_at_50%_50%,#000_60%,transparent_100%)] bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] opacity-70 dark:bg-[radial-gradient(#1e1b4b_1px,transparent_1px)] dark:opacity-65" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.15)_0%,transparent_70%)] dark:bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.2)_0%,transparent_75%)]" />
      {!flat && (
        <>
          <div className="pointer-events-none absolute h-[48vmin] w-[48vmin] rounded-full border border-indigo-500/15 dark:border-indigo-400/10" />
          <div className="pointer-events-none absolute h-[76vmin] w-[76vmin] rounded-full border border-dashed border-neutral-300/60 dark:border-white/10" />
        </>
      )}

      {/* The 3D corridor. Decoration only: a plain list below gives screen readers the same information. */}
      {!flat && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
          {cards.map((card) => (
            <TunnelCard key={card.item.id} card={card} progress={smoothProgress} pointer={pointer} total={cards.length} stage={stage} />
          ))}
        </div>
      )}

      {/* Headline and the real controls, above the corridor so they are always readable and clickable. */}
      <motion.div
        style={flat ? undefined : { scale: titleScale, opacity: titleOpacity }}
        className="relative z-40 flex max-w-2xl flex-col items-center px-4 text-center"
      >
        <div className="rounded-3xl bg-neutral-50/85 px-4 py-6 backdrop-blur-sm dark:bg-neutral-950/80 sm:px-8">
          <p className="mb-4 font-mono text-xs uppercase tracking-[0.4em] text-indigo-700 dark:text-indigo-300">{eyebrow}</p>
          <h1 id="verity-hero-title" className="text-4xl font-bold leading-[0.95] tracking-tighter text-neutral-950 dark:text-white sm:text-6xl md:text-7xl">
            {title}
          </h1>
          {description ? (
            <p className="mx-auto mt-4 max-w-[48ch] text-sm font-light text-neutral-700 dark:text-neutral-300 sm:text-base">{description}</p>
          ) : null}
          {children ? <div className="mt-6">{children}</div> : null}
        </div>
      </motion.div>

      {!flat && (
        <motion.div
          style={{ opacity: promptOpacity }}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-6 z-20 flex flex-col items-center gap-2 font-mono text-xs uppercase tracking-[0.3em] text-neutral-600 dark:text-neutral-400"
        >
          <span>{scrollHint}</span>
          <div className="h-6 w-px bg-gradient-to-b from-indigo-500 to-transparent" />
        </motion.div>
      )}

      {/* The same cards for touch screens and reduced motion: a plain grid in the normal flow. */}
      {flat && (
        <ul className="relative z-10 m-0 mx-auto mt-10 grid list-none p-0 w-full max-w-5xl grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {items.map((item) => (
            <li key={item.id} className="min-w-0 aspect-[4/5] md:aspect-[4/3]">
              <CardFace item={item} compact />
            </li>
          ))}
        </ul>
      )}

      {/* For screen readers while the 3D corridor is showing. */}
      {!flat && (
        <ul className="sr-only">
          {items.map((item) => (
            <li key={item.id}>
              {item.title}: {item.caption}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
