"use client";

import { useState } from "react";
import { growthStage, MAX_STAGE, FULL_GROWTH_CENTS } from "@/lib/growth";
import { formatCents } from "@/lib/money";

export type Plant = {
  slug: string;
  label: string;
  bubbleKey: string;
  totalCents: number;
  entryCount: number;
};

/**
 * One pre-rendered sculpture per bubble_key in categories.
 *
 * These are raster renders rather than drawn SVG on purpose: the look is
 * inflated translucent vinyl — internal refraction, soft studio speculars,
 * real thickness — and SVG has no refraction and no lighting model, so it
 * can only ever approximate it. The intrinsic sizes are recorded here so the
 * markup can reserve the right box and avoid layout shift.
 *
 * `lilac` is derived from `teal` (mirrored, hue-rotated) because the source
 * render only covered five of the six keys.
 *
 * Each file is trimmed to its opaque bounds and then padded so the ALPHA
 * CENTROID sits at the canvas centre. These silhouettes are asymmetric, so
 * centring the image box is not the same as centring the visible mass — a
 * plain centre leaves the lavender one visibly off its column axis.
 */
const SCULPTURES: Record<
  string,
  { src: string; width: number; height: number }
> = {
  teal: { src: "/bubbles/teal.webp", width: 238, height: 239 },
  magenta: { src: "/bubbles/magenta.webp", width: 214, height: 272 },
  lime: { src: "/bubbles/lime.webp", width: 240, height: 228 },
  crimson: { src: "/bubbles/crimson.webp", width: 103, height: 104 },
  jade: { src: "/bubbles/jade.webp", width: 148, height: 145 },
  lilac: { src: "/bubbles/lilac.webp", width: 240, height: 239 },
};

/** Accent per bubble_key — still CSS tokens, still the app's own palette.
 *  `fill` colours the stage pips; `spill` is the very faint pastel light the
 *  sculpture bounces onto the shelf beneath it, under two neutral shadows. */
const PALETTE: Record<string, { fill: string; spill: string }> = {
  teal: { fill: "var(--teal)", spill: "var(--teal-spill)" },
  magenta: { fill: "var(--magenta)", spill: "var(--magenta-spill)" },
  lime: { fill: "var(--lime)", spill: "var(--lime-spill)" },
  crimson: { fill: "var(--crimson)", spill: "var(--crimson-spill)" },
  jade: { fill: "var(--jade)", spill: "var(--jade-spill)" },
  lilac: { fill: "var(--lilac)", spill: "var(--lilac-spill)" },
};
const FALLBACK = { fill: "var(--teal)", spill: "var(--teal-spill)" };
const FALLBACK_SCULPTURE = SCULPTURES.teal;

/** Share of its column a sculpture fills, at nothing-spent and at a full
 *  month. Size IS the quantity here, which is why the caption under the row
 *  says so.
 *
 *  The sculpture is fitted into a SQUARE box and letterboxed inside it
 *  (object-contain). The six renders have different aspect ratios, so
 *  constraining only one dimension and letting a max-* clamp the other is
 *  what squashes them — the widest render lost 8% of its width that way and
 *  read as deflated. A square box clamps both dimensions together, so the
 *  aspect ratio survives at every size and they still look comparable.
 */
const MIN_PCT = 40;
const MAX_PCT = 100;
/** Ceiling in px so a wide column can't grow a sculpture past the shelf. */
const MAX_BOX = 152;

/** Deterministic per-slug variation (float phase/speed/drift). Math.random()
 *  here would mismatch between the server and client renders. */
function seed(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i++) {
    value = (value * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(value);
}

/** Fixed precision for anything computed that reaches the DOM — same
 *  hydration hazard as before applies to any float math here. */
const snap = (n: number): number => Math.round(n * 1000) / 1000;

/** How full a bubble is: a continuous fraction of the month's target, not a
 *  stepped stage — so it grows on every expense, not just at stage
 *  boundaries. Stage is still used for the pips and the aria-label. */
function progressOf(totalCents: number): number {
  return Math.min(1, Math.max(0, totalCents / FULL_GROWTH_CENTS));
}

function Sculpture({
  slug,
  bubbleKey,
  totalCents,
  spill,
  fresh,
  label,
}: {
  slug: string;
  bubbleKey: string;
  totalCents: number;
  spill: string;
  fresh: boolean;
  label: string;
}) {
  const progress = progressOf(totalCents);
  const pct = snap(MIN_PCT + progress * (MAX_PCT - MIN_PCT));
  const art = SCULPTURES[bubbleKey] ?? FALLBACK_SCULPTURE;
  const s = seed(slug);

  // Two independent transform layers: idle float on the outer element,
  // watering pulse on the inner one, because CSS can't layer two transform
  // animations on a single element.
  //
  // The float is strictly VERTICAL. Any horizontal drift or rotation would
  // move a sculpture off its column's centre axis, and those six axes have to
  // hold at every viewport width; it also read as hovering rather than
  // resting on the shelf.
  const floatStyle = {
    ["--float-dur" as string]: `${snap(3.4 + (s % 9) * 0.3)}s`,
    ["--float-delay" as string]: `${snap(-((s % 45) / 10))}s`,
    ["--bubble-spill" as string]: spill,
    width: `${pct}%`,
    maxWidth: `${MAX_BOX}px`,
  } as React.CSSProperties;

  return (
    <span className="sculpture-float sculpture-fx" style={floatStyle}>
      <span
        className={
          fresh ? "sculpture-pulse sculpture-box" : "sculpture-box"
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- these are
            fixed-size pre-optimised WebP assets served straight from /public;
            next/image would add a runtime optimisation pass that can only
            make them larger. */}
        <img
          src={art.src}
          width={art.width}
          height={art.height}
          alt={`${label}: ${formatCents(totalCents)} spent this month`}
          className="block h-auto max-h-full w-auto max-w-full select-none"
          draggable={false}
        />
      </span>
    </span>
  );
}

/** Nothing spent yet this month: the dashed slot from the design, not a
 *  colourless copy of a grown sculpture — and deliberately still, so
 *  "dormant" reads as dormant next to the ones that are alive. */
function EmptySlot({ label }: { label: string }) {
  return (
    <span
      className="empty-slot"
      role="img"
      aria-label={`${label}: nothing spent this month`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
        <path
          d="M12 6v12M6 12h12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function Droplets() {
  // Five drops on staggered delays, landing on the sculpture. Purely
  // decorative — the alt text on the image already carries the new total.
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="drop absolute block rounded-full"
          style={{
            left: `${34 + i * 8}%`,
            top: `${2 + (i % 3) * 5}%`,
            width: i % 2 === 0 ? 5 : 4,
            height: i % 2 === 0 ? 8 : 6,
            background: "var(--water)",
            opacity: 0,
            ["--fall" as string]: `${70 + (i % 3) * 16}px`,
            animationDelay: `${i * 95}ms`,
          }}
        />
      ))}
    </div>
  );
}

function BubbleView({
  plant,
  watering,
}: {
  plant: Plant;
  /** The nonce of the render this bubble's total went up on, if it just did. */
  watering: number | undefined;
}) {
  const stage = growthStage(plant.totalCents);
  const { fill, spill } = PALETTE[plant.bubbleKey] ?? FALLBACK;

  return (
    <li className="flex min-w-0 flex-col">
      {/* Centred, not left-aligned: the label block and the sculpture below it
          share one horizontal centre axis, which is the whole point of the
          six-column grid this sits in. */}
      <div className="flex flex-col items-center gap-1.5 px-1 pb-4 text-center">
        <span className="max-w-full truncate text-[0.8125rem] font-medium text-ink">
          {plant.label}
        </span>
        <span className="tnum text-[1.0625rem] font-medium tracking-tight text-ink">
          {formatCents(plant.totalCents)}
        </span>
        <span
          className="mt-0.5 flex gap-[5px]"
          title={`Stage ${stage} of ${MAX_STAGE}`}
        >
          {Array.from({ length: MAX_STAGE }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="garden-progress-dot h-[7px] w-[7px] rounded-full transition-colors duration-500"
              data-active={i < stage}
              style={{ "--dot-fill": fill } as React.CSSProperties}
            />
          ))}
        </span>
        <span className="text-xs text-ink-faint">
          {plant.entryCount === 0
            ? "nothing yet"
            : `${plant.entryCount} ${plant.entryCount === 1 ? "entry" : "entries"}`}
        </span>
      </div>

      <div className="relative flex h-[180px] items-end justify-center px-2 pb-9 sm:h-[224px]">
        {plant.totalCents > 0 ? (
          <span
            aria-hidden="true"
            className="sculpture-ground"
            style={{ "--bubble-spill": spill } as React.CSSProperties}
          />
        ) : null}
        {watering !== undefined ? <Droplets key={watering} /> : null}
        {plant.totalCents <= 0 ? (
          <EmptySlot label={plant.label} />
        ) : (
          <Sculpture
            key={watering !== undefined ? `w-${watering}` : "still"}
            slug={plant.slug}
            bubbleKey={plant.bubbleKey}
            totalCents={plant.totalCents}
            spill={spill}
            fresh={watering !== undefined}
            label={plant.label}
          />
        )}
      </div>
    </li>
  );
}

/** Slug -> the nonce of the render its total went up on. The nonce is the
 *  whole payload: one pulse fires for any increase, so there is nothing else
 *  to know about the event. */
type Watered = Record<string, number>;

/** Which bubbles had their total go UP between two renders of the same
 *  garden. Same event-driven logic as before — state, not a ref, diffed
 *  during render, so StrictMode's double render can't lose the event. */
function wateredBetween(
  before: Map<string, number>,
  after: Map<string, number>,
  nonce: number,
): Watered {
  const watered: Watered = {};
  for (const [slug, total] of after) {
    const was = before.get(slug);
    if (was === undefined || total <= was) continue;
    watered[slug] = nonce;
  }
  return watered;
}

function sameTotals(a: Map<string, number>, b: Map<string, number>) {
  if (a.size !== b.size) return false;
  for (const [slug, total] of a) if (b.get(slug) !== total) return false;
  return true;
}

export function Garden({ plants }: { plants: Plant[] }) {
  const totals = new Map(plants.map((p) => [p.slug, p.totalCents]));

  const [seen, setSeen] = useState(() => ({
    totals,
    watered: {} as Watered,
    version: 0,
  }));

  let watering = seen.watered;

  if (!sameTotals(seen.totals, totals)) {
    const next = {
      totals,
      watered: wateredBetween(seen.totals, totals, seen.version + 1),
      version: seen.version + 1,
    };
    setSeen(next);
    watering = next.watered;
  }

  const stageValue = formatCents(FULL_GROWTH_CENTS / MAX_STAGE);

  return (
    <div className="flex flex-col gap-3">
      <div className="garden-card overflow-x-auto">
        <div className="relative min-w-[660px]">
          {/* The shelf is one element spanning the whole card, not a strip per
              column: abutting per-column gradients seam visibly at subpixel
              column boundaries, and stop short of the card's padding. */}
          <div
            aria-hidden="true"
            className="chamber-band absolute inset-x-0 bottom-0 h-[180px] sm:h-[224px]"
          />
          {/* One grid, six equal tracks. minmax(0, 1fr) rather than flex-1 so
              a long label can never widen its own column and push the six
              centres out of step at some viewport width. */}
          <ol
            className="relative grid items-stretch px-5 pt-7"
            style={{
              gridTemplateColumns: `repeat(${plants.length}, minmax(0, 1fr))`,
            }}
          >
            {plants.map((plant) => (
              <BubbleView
                key={plant.slug}
                plant={plant}
                watering={watering[plant.slug]}
              />
            ))}
          </ol>
        </div>
      </div>

      <p className="max-w-[68ch] text-xs text-ink-faint">
        Size is what you spent. Each bubble fills a little more with every{" "}
        {stageValue} and reaches full size at {formatCents(FULL_GROWTH_CENTS)}{" "}
        in a month, then starts again empty on the first of the next one.
      </p>
    </div>
  );
}

/**
 * A few sculptures with no figures attached — for the sign-in pages, where
 * the point is to show what the app looks like rather than report anyone's
 * spending. Same component and assets, so nothing here can drift away from
 * the real thing.
 */
export function GardenVignette() {
  const cast = [
    { key: "teal", progress: 0.4 },
    { key: "jade", progress: 0.8 },
    { key: "magenta", progress: 0.6 },
    { key: "lime", progress: 1 },
    { key: "lilac", progress: 0.55 },
    { key: "crimson", progress: 0.75 },
  ];

  return (
    <div
      aria-hidden="true"
      className="chamber-band grid items-end px-3 pb-4 pt-6"
      style={{ gridTemplateColumns: `repeat(${cast.length}, minmax(0, 1fr))` }}
    >
      {cast.map(({ key, progress }) => (
        <div key={key} className="flex min-w-0 justify-center">
          <Sculpture
            slug={key}
            bubbleKey={key}
            totalCents={Math.round(progress * FULL_GROWTH_CENTS)}
            spill={(PALETTE[key] ?? FALLBACK).spill}
            fresh={false}
            label=""
          />
        </div>
      ))}
    </div>
  );
}
