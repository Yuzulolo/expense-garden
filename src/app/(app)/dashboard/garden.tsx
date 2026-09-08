"use client";

import { useState } from "react";
import { growthStage, MAX_STAGE, FULL_GROWTH_CENTS } from "@/lib/growth";
import { formatCents } from "@/lib/money";

export type Plant = {
  slug: string;
  label: string;
  plantKey: string;
  totalCents: number;
  entryCount: number;
};

/**
 * Every plant is drawn in the same 100x200 box with the soil line at y=200 and
 * growth going up. That shared ground line is the whole point of the bed: six
 * plants on one baseline can be compared by eye, so the garden reads as a chart
 * of the month without anyone having to draw a chart.
 */
const GROUND = 200;
const BASE_H = 40;
const PER_STAGE_H = 36.5;

/** Foliage and the bloom/fruit accent per plant_key, from the categories table
 *  rather than per category. An unknown key falls back rather than rendering
 *  nothing, so a new category row can never blank out the garden. */
const PALETTE: Record<string, { foliage: string; accent: string }> = {
  vine: { foliage: "var(--vine)", accent: "var(--vine-accent)" },
  orchid: { foliage: "var(--orchid)", accent: "var(--orchid-accent)" },
  bamboo: { foliage: "var(--bamboo)", accent: "var(--bamboo-accent)" },
  tomato: { foliage: "var(--tomato)", accent: "var(--tomato-accent)" },
  fern: { foliage: "var(--fern)", accent: "var(--fern-accent)" },
  succulent: { foliage: "var(--succulent)", accent: "var(--succulent-accent)" },
};

const FALLBACK = { foliage: "var(--vine)", accent: "var(--vine-accent)" };

/** Deterministic per-slug variation. Math.random() here would mismatch between
 *  the server and client renders; a hash of the slug gives each plant a settled
 *  lean that is the same on both. */
function seed(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i++) {
    value = (value * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(value);
}

/** The drawn height for a stage, in viewBox units. Shared so anything that
 *  draws these plants grows them on the same curve the bed does. */
export function plantHeight(stage: number): number {
  return stage <= 0 ? 0 : snap(BASE_H + (stage - 1) * PER_STAGE_H);
}

type SpeciesProps = {
  h: number;
  stage: number;
  foliage: string;
  accent: string;
  flip: boolean;
  /** Applied to the part this stage just earned, so it unfurls rather than pops. */
  fresh: string;
};

/**
 * Fixed precision for anything computed that reaches the DOM.
 *
 * Server and client must emit byte-identical attribute strings or React
 * reports a hydration mismatch. Most of the geometry below is plain +-*\/ on
 * doubles, which is exact and deterministic — but Fern's pinnae take a tangent
 * through Math.atan2, and ECMAScript specifies the transcendental functions
 * only as implementation-approximated. Two engines may therefore disagree in
 * the last bit, which surfaced as
 * rotate(-118.83119278424807) against rotate(-118.83119278424809).
 *
 * Three decimals is far below what is visible in a 100x200 viewBox, and
 * rounding makes the emitted string independent of that last bit.
 */
const snap = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Template tag for path and transform strings: every interpolated number is
 * snapped automatically. Using it instead of a bare template literal is what
 * makes the guarantee structural — a new `${...}` inside one of these strings
 * cannot reintroduce full-precision output by being forgotten.
 */
function svg(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    out += (typeof value === "number" ? snap(value) : String(value)) + strings[i + 1];
  }
  return out;
}

const OVATE = "M0 0 C 5 -9, 19 -9, 24 0 C 19 8, 5 8, 0 0 Z";

/** A point on a quadratic bezier, for hanging blooms and pinnae off a stem. */
function onCurve(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  t: number,
) {
  const u = 1 - t;
  return {
    x: snap(u * u * x0 + 2 * u * t * cx + t * t * x1),
    y: snap(u * u * y0 + 2 * u * t * cy + t * t * y1),
  };
}

/* ---- Social: a twining vine that climbs ------------------------------- */
function Vine({ h, stage, foliage, accent, flip, fresh }: SpeciesProps) {
  const segments = 2 + stage;
  const step = snap(h / segments);
  const mirror = flip ? -1 : 1;

  let path = svg`M 50 ${GROUND}`;
  const nodes: { y: number; dir: number }[] = [];
  for (let i = 1; i <= segments; i++) {
    const y = snap(GROUND - step * i);
    const dir = (i % 2 === 1 ? 1 : -1) * mirror;
    path += svg` Q ${50 + dir * 15} ${y + step / 2} 50 ${y}`;
    nodes.push({ y, dir });
  }

  const leaves = nodes.slice(0, Math.min(nodes.length, stage + 1));
  const scale = snap(Math.min(0.95, 0.42 + stage * 0.11));

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={foliage}
        strokeWidth="3"
        strokeLinecap="round"
      />
      {leaves.map((node, i) => (
        <g
          key={i}
          className={i === leaves.length - 1 ? fresh : undefined}
          transform={svg`translate(${50 + node.dir * 12} ${
            node.y + step / 2
          }) rotate(${node.dir > 0 ? -18 : 198}) scale(${scale})`}
        >
          <path d={OVATE} fill={i % 2 === 0 ? foliage : accent} />
        </g>
      ))}
    </g>
  );
}

/* ---- Beauty: an arching orchid spike ---------------------------------- */
function Orchid({ h, stage, foliage, accent, flip, fresh }: SpeciesProps) {
  const mirror = flip ? -1 : 1;
  // An orchid arches hard and carries FEW large flowers. Many small ones on a
  // straight spike is a lupin, which is what the first pass drew.
  const tipX = snap(50 + mirror * Math.min(34, h * 0.26));
  const tipY = snap(GROUND - h);
  const cx = snap(50 - mirror * 6);
  const cy = snap(GROUND - h * 0.72);

  const bloomCount = Math.min(4, stage);
  const bloomR = snap(7.5 + Math.min(4, stage * 0.9));
  const blooms = Array.from({ length: bloomCount }, (_, i) => ({
    ...onCurve(50, GROUND, cx, cy, tipX, tipY, 0.96 - i * 0.19),
    i,
  }));

  return (
    <g>
      {/* Two broad strappy basal leaves. */}
      <path
        d={OVATE}
        fill={foliage}
        transform={svg`translate(50 ${GROUND - 5}) rotate(-166) scale(${
          0.9 + stage * 0.09
        })`}
      />
      <path
        d={OVATE}
        fill={foliage}
        transform={svg`translate(50 ${GROUND - 5}) rotate(-14) scale(${
          0.95 + stage * 0.09
        })`}
      />
      <path
        d={svg`M 50 ${GROUND} Q ${cx} ${cy} ${tipX} ${tipY}`}
        fill="none"
        stroke={foliage}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {blooms.map((bloom) => (
        <g
          key={bloom.i}
          className={bloom.i === blooms.length - 1 ? fresh : undefined}
          transform={svg`translate(${bloom.x} ${bloom.y}) rotate(${mirror * 12})`}
        >
          {/* Three sepals up and out, two petals wide, one labellum hanging
              below — the arrangement is what makes it read as an orchid. */}
          {[-140, -90, -40].map((angle) => (
            <ellipse
              key={angle}
              rx={snap(bloomR * 0.3)}
              ry={snap(bloomR * 0.66)}
              fill={accent}
              opacity="0.85"
              transform={svg`rotate(${angle + 90}) translate(0 ${-bloomR * 0.6})`}
            />
          ))}
          {[-15, 195].map((angle) => (
            <ellipse
              key={angle}
              rx={snap(bloomR * 0.46)}
              ry={snap(bloomR * 0.3)}
              fill={accent}
              transform={svg`rotate(${angle}) translate(${bloomR * 0.55} 0)`}
            />
          ))}
          <path
            d={svg`M ${-bloomR * 0.34} ${bloomR * 0.16} Q 0 ${bloomR * 1.5} ${
              bloomR * 0.34
            } ${bloomR * 0.16} Z`}
            fill={accent}
          />
          <circle r={snap(bloomR * 0.19)} fill="var(--air)" opacity="0.9" />
        </g>
      ))}
    </g>
  );
}

/* ---- Sports: bamboo culms with visible nodes -------------------------- */
function Bamboo({ h, stage, foliage, accent, flip, fresh }: SpeciesProps) {
  const mirror = flip ? -1 : 1;
  const culmCount = stage <= 1 ? 1 : stage <= 3 ? 2 : 3;
  const culms = [
    { x: 50, factor: 1, width: 7 },
    { x: 50 + mirror * 16, factor: 0.74, width: 5.5 },
    { x: 50 - mirror * 15, factor: 0.86, width: 6 },
  ].slice(0, culmCount);

  return (
    <g>
      {culms.map((culm, index) => {
        const culmH = snap(h * culm.factor);
        const top = snap(GROUND - culmH);
        const nodes = Math.max(1, Math.floor(culmH / 26));

        return (
          <g
            key={culm.x}
            className={index === culms.length - 1 && index > 0 ? fresh : undefined}
          >
            <rect
              x={snap(culm.x - culm.width / 2)}
              y={top}
              width={culm.width}
              height={culmH}
              rx={snap(culm.width / 2.4)}
              fill={foliage}
            />
            {Array.from({ length: nodes }, (_, n) => (
              <line
                key={n}
                x1={snap(culm.x - culm.width / 2)}
                x2={snap(culm.x + culm.width / 2)}
                y1={snap(GROUND - ((n + 1) * culmH) / (nodes + 1))}
                y2={snap(GROUND - ((n + 1) * culmH) / (nodes + 1))}
                stroke="var(--air)"
                strokeWidth="1.6"
                opacity="0.55"
              />
            ))}
            {/* Narrow lance leaves, only at the growing tip. */}
            {[-1, 1].map((side) => (
              <path
                key={side}
                d={svg`M ${culm.x} ${top + 4} Q ${culm.x + side * 15} ${
                  top - 4
                } ${culm.x + side * 26} ${top + 8}`}
                fill="none"
                stroke={accent}
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}

/* ---- Food: a tomato plant that fruits -------------------------------- */
function Tomato({ h, stage, foliage, accent, flip, fresh }: SpeciesProps) {
  const mirror = flip ? -1 : 1;
  const tiers = Math.max(1, Math.min(6, stage + 1));
  const fruitCount = Math.max(0, stage - 1);

  return (
    <g>
      <path
        d={svg`M 50 ${GROUND} Q ${50 + mirror * 5} ${GROUND - h * 0.5} 50 ${
          GROUND - h
        }`}
        fill="none"
        stroke={foliage}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      {Array.from({ length: tiers }, (_, tier) => {
        const y = snap(GROUND - (h * (tier + 0.6)) / (tiers + 0.15));
        const scale = snap(0.58 - tier * 0.045);
        return [-1, 1].map((side) => (
          <g
            key={`${tier}-${side}`}
            transform={svg`translate(50 ${y}) rotate(${
              side > 0 ? -24 : 204
            }) scale(${scale})`}
          >
            {/* A compound leaf: three leaflets off one rachis. */}
            <path d={OVATE} fill={foliage} />
            <path d={OVATE} fill={foliage} transform="translate(6 -3) rotate(-38) scale(0.6)" />
            <path d={OVATE} fill={foliage} transform="translate(6 3) rotate(38) scale(0.6)" />
          </g>
        ));
      })}
      {Array.from({ length: fruitCount }, (_, i) => {
        const y = snap(GROUND - h * (0.34 + i * 0.13));
        const side = i % 2 === 0 ? mirror : -mirror;
        const r = 5.4;
        return (
          <g
            key={i}
            className={i === fruitCount - 1 ? fresh : undefined}
            transform={svg`translate(${50 + side * 11} ${y})`}
          >
            <circle r={r} fill={accent} />
            <circle
              cx={snap(-r * 0.3)}
              cy={snap(-r * 0.34)}
              r={snap(r * 0.26)}
              fill="var(--air)"
              opacity="0.4"
            />
            <path
              d={svg`M -3 ${-r} L 0 ${-r - 2.6} L 3 ${-r}`}
              fill="none"
              stroke={foliage}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </g>
        );
      })}
    </g>
  );
}

/* ---- Transport: fern fronds, a fiddlehead when barely grown ----------- */
const PINNA = "M0 0 C 3 -4.2, 10 -4, 13.5 0 C 10 4, 3 4.2, 0 0 Z";

function Fern({ h, stage, foliage, accent, flip, fresh }: SpeciesProps) {
  const mirror = flip ? -1 : 1;

  // A single tight fiddlehead reads "just beginning" far better than one
  // undersized frond does.
  if (stage <= 1) {
    const top = snap(GROUND - h);
    return (
      <g>
        <path
          d={svg`M 50 ${GROUND} Q ${50 + mirror * 10} ${
            GROUND - h * 0.6
          } ${50 + mirror * 3} ${top + 8}`}
          fill="none"
          stroke={foliage}
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <path
          d={svg`M ${50 + mirror * 3} ${top + 9} a 7 7 0 1 ${
            mirror > 0 ? 1 : 0
          } ${mirror * 7} 6 a 3.4 3.4 0 1 ${
            mirror > 0 ? 0 : 1
          } ${-mirror * 3.4} -3.4`}
          fill="none"
          stroke={accent}
          strokeWidth="3.4"
          strokeLinecap="round"
        />
      </g>
    );
  }

  const frondCount = Math.min(5, stage);

  return (
    <g>
      {Array.from({ length: frondCount }, (_, i) => {
        const spread = frondCount === 1 ? 0 : (i / (frondCount - 1)) * 2 - 1;
        const lean = snap(spread * 52 * mirror);
        const frondH = snap(h * (1 - Math.abs(spread) * 0.2));
        // The tip droops outward — a frond is an arc, not a spoke. The first
        // pass drew straight spokes, which read as a thistle.
        const tipX = snap(50 + lean);
        const tipY = snap(GROUND - frondH);
        const cx = snap(50 + lean * 0.15);
        const cy = snap(GROUND - frondH * 0.78);

        const pinnae = Array.from({ length: 8 }, (_, p) => {
          const t = 0.2 + p * 0.1;
          const point = onCurve(50, GROUND, cx, cy, tipX, tipY, t);
          // Tangent of the rachis, so pinnae splay off the stem it grows on.
          const dx = 2 * (1 - t) * (cx - 50) + 2 * t * (tipX - cx);
          const dy = 2 * (1 - t) * (cy - GROUND) + 2 * t * (tipY - cy);
          const tangent = snap((Math.atan2(dy, dx) * 180) / Math.PI);
          // Leaflets taper toward the tip, which is what gives a frond its
          // silhouette.
          const scale = snap((1 - t * 0.72) * (0.42 + frondH / 300));
          return { ...point, tangent, scale, p };
        });

        return (
          <g key={i} className={i === frondCount - 1 ? fresh : undefined}>
            <path
              d={svg`M 50 ${GROUND} Q ${cx} ${cy} ${tipX} ${tipY}`}
              fill="none"
              stroke={foliage}
              strokeWidth="2"
              strokeLinecap="round"
            />
            {pinnae.map((pinna) => (
              <g key={pinna.p} transform={svg`translate(${pinna.x} ${pinna.y})`}>
                {[-1, 1].map((side) => (
                  <path
                    key={side}
                    d={PINNA}
                    fill={pinna.p % 2 === 0 ? foliage : accent}
                    transform={svg`rotate(${
                      pinna.tangent + side * 58
                    }) scale(${pinna.scale})`}
                  />
                ))}
              </g>
            ))}
          </g>
        );
      })}
    </g>
  );
}

/* ---- Other: a clustering succulent ----------------------------------- */

/**
 * One rosette, squashed vertically so it reads as fleshy leaves seen from
 * above rather than the flat asterisk a radial fan of thin petals produces.
 */
function Rosette({
  cx,
  cy,
  outer,
  rings,
  flip,
  foliage,
  accent,
  fresh,
}: {
  cx: number;
  cy: number;
  outer: number;
  rings: number;
  flip: boolean;
  foliage: string;
  accent: string;
  fresh?: string;
}) {
  return (
    <g transform={svg`translate(${cx} ${cy}) scale(1 0.6)`}>
      {/* Outer rings first: each inner ring overlaps the one outside it,
          which is what gives the rosette depth. */}
      {Array.from({ length: rings }, (_, index) => {
        const ring = rings - 1 - index;
        const leaves = 7 + ring * 2;
        const length = snap(outer * (0.48 + ring * 0.26));
        const width = snap(length * 0.36);
        const rotate = ring * 26 + (flip ? 14 : 0);

        return (
          <g
            key={ring}
            className={ring === rings - 1 && rings > 1 ? fresh : undefined}
          >
            {Array.from({ length: leaves }, (_, p) => (
              <path
                key={p}
                d={svg`M 0 0 C ${length * 0.34} ${-width}, ${
                  length * 0.78
                } ${-width * 0.5}, ${length} 0 C ${length * 0.78} ${
                  width * 0.5
                }, ${length * 0.34} ${width}, 0 0 Z`}
                fill={ring === 0 ? accent : foliage}
                stroke="var(--air)"
                strokeWidth="0.7"
                transform={svg`rotate(${rotate + (p * 360) / leaves})`}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}

function Succulent({ h, stage, foliage, accent, flip, fresh }: SpeciesProps) {
  // A succulent spends most of its growth on width, which would break the one
  // thing the shared baseline promises: that a taller plant cost more. So this
  // one grows the way a clustering echeveria actually does — a thickening
  // trunk that gains offsets — and its crown still tops out at the full
  // height, keeping it honest against the other five.
  const rings = stage === 0 ? 1 : Math.min(3, 1 + Math.floor(stage / 2));
  const outer = snap(15 + h * 0.17);
  const crownSpan = snap(outer * (0.48 + (rings - 1) * 0.26) * 0.6);
  const crownY = snap(GROUND - h + crownSpan);
  const mirror = flip ? -1 : 1;

  const pups = Math.max(0, Math.min(3, stage - 1));

  return (
    <g>
      <path
        d={svg`M ${50 - 3.2} ${crownY} L ${50 + 3.2} ${crownY} L ${
          50 + 6.4
        } ${GROUND} L ${50 - 6.4} ${GROUND} Z`}
        fill={foliage}
      />
      {Array.from({ length: pups }, (_, i) => {
        // Branches leave the trunk and turn upward, each ending in its own
        // rosette — the aeonium habit. A branch has to carry a rosette big
        // enough to read as one, or it is just a speck on a pole.
        const t = snap(0.32 + i * 0.21);
        const side = i % 2 === 0 ? mirror : -mirror;
        const baseY = snap(GROUND - h * t);
        const tipX = snap(50 + side * (15 + outer * 0.3));
        const tipY = snap(baseY - 14 - outer * 0.2);
        const pupOuter = snap(outer * (0.62 + i * 0.06));

        return (
          <g key={i} className={i === pups - 1 ? fresh : undefined}>
            <path
              d={svg`M 50 ${baseY} Q ${50 + side * 12} ${baseY - 2} ${tipX} ${tipY}`}
              fill="none"
              stroke={foliage}
              strokeWidth="5"
              strokeLinecap="round"
            />
            <Rosette
              cx={tipX}
              cy={tipY}
              outer={pupOuter}
              rings={Math.max(2, rings - 1)}
              flip={!flip}
              foliage={foliage}
              accent={accent}
            />
          </g>
        );
      })}
      <Rosette
        cx={50}
        cy={crownY}
        outer={outer}
        rings={rings}
        flip={flip}
        foliage={foliage}
        accent={accent}
        fresh={fresh}
      />
    </g>
  );
}

const SPECIES: Record<string, (props: SpeciesProps) => React.ReactElement> = {
  vine: Vine,
  orchid: Orchid,
  bamboo: Bamboo,
  tomato: Tomato,
  fern: Fern,
  succulent: Succulent,
};

/** Nothing spent in this category this month: a sown seed, not a greyed plant. */
function Seed({ foliage }: { foliage: string }) {
  return (
    <g opacity="0.6">
      <path
        d={svg`M 50 ${GROUND} L 50 ${GROUND - 24}`}
        stroke={foliage}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d={svg`M 50 ${GROUND - 22} C 40 ${GROUND - 22}, 33 ${GROUND - 28}, 31 ${
          GROUND - 36
        } C 42 ${GROUND - 37}, 49 ${GROUND - 30}, 50 ${GROUND - 22} Z`}
        fill={foliage}
      />
      <path
        d={svg`M 50 ${GROUND - 24} C 60 ${GROUND - 25}, 67 ${GROUND - 32}, 69 ${
          GROUND - 40
        } C 58 ${GROUND - 40}, 51 ${GROUND - 33}, 50 ${GROUND - 24} Z`}
        fill={foliage}
      />
    </g>
  );
}

function Droplets() {
  // Five drops on staggered delays. Purely decorative, hidden from the reader
  // that matters — the aria-label on the plant already carries the new total.
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="drop absolute block rounded-full"
          style={{
            left: `${28 + i * 11}%`,
            top: `${8 + (i % 3) * 6}%`,
            width: i % 2 === 0 ? 5 : 4,
            height: i % 2 === 0 ? 8 : 6,
            background: "var(--water)",
            opacity: 0,
            ["--fall" as string]: `${96 + (i % 3) * 22}px`,
            animationDelay: `${i * 95}ms`,
          }}
        />
      ))}
    </div>
  );
}

function PlantView({
  plant,
  watering,
}: {
  plant: Plant;
  watering: { nonce: number; grew: boolean } | undefined;
}) {
  // Derived on every render from the number the database returned. Nothing
  // about this plant's size is stored, anywhere.
  const stage = growthStage(plant.totalCents);
  const { foliage, accent } = PALETTE[plant.plantKey] ?? FALLBACK;
  const height = plantHeight(stage);
  const Species = SPECIES[plant.plantKey] ?? Vine;
  const flip = seed(plant.slug) % 2 === 1;

  return (
    <li className="flex min-w-[104px] flex-1 flex-col">
      <div className="relative flex h-[186px] items-end justify-center sm:h-[236px]">
        {watering ? <Droplets key={watering.nonce} /> : null}
        <svg
          viewBox="0 0 100 200"
          preserveAspectRatio="xMidYMax meet"
          className={`h-full w-full overflow-visible ${
            watering ? "watered-plant" : ""
          }`}
          key={watering ? `w-${watering.nonce}` : "still"}
          role="img"
          aria-label={`${plant.label}: ${formatCents(
            plant.totalCents,
          )} spent this month, growth stage ${stage} of ${MAX_STAGE}`}
        >
          {stage === 0 ? (
            <Seed foliage={foliage} />
          ) : (
            <Species
              h={height}
              stage={stage}
              foliage={foliage}
              accent={accent}
              flip={flip}
              fresh={watering?.grew ? "unfurl" : ""}
            />
          )}
        </svg>
      </div>

      {/* Transparent: the soil under every column is one continuous band
          painted by .bed-soil on the row. This spacer only reserves its slice
          of that band so a watered plant can darken its own patch of it. */}
      <div className="relative h-9 sm:h-11">
        {watering ? (
          <div
            key={`soak-${watering.nonce}`}
            aria-hidden="true"
            className="soil-soak absolute inset-x-1 inset-y-0 rounded-sm bg-soil-deep"
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1 px-1 pt-2.5">
        <span className="truncate text-[0.8125rem] font-medium text-ink">
          {plant.label}
        </span>
        <span className="tnum text-sm text-ink-soft">
          {formatCents(plant.totalCents)}
        </span>
        {/* Five pips for five stages. The scale really is five steps, so the
            marker earns its place; it replaces a "stage 3/5" caption. */}
        <span
          className="mt-0.5 flex gap-[3px]"
          title={`Stage ${stage} of ${MAX_STAGE}`}
        >
          {Array.from({ length: MAX_STAGE }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="h-[5px] w-[5px] rounded-full transition-colors duration-500"
              style={{
                background: i < stage ? foliage : "var(--rule)",
              }}
            />
          ))}
        </span>
        <span className="text-xs text-ink-faint">
          {plant.entryCount === 0
            ? "nothing yet"
            : `${plant.entryCount} ${
                plant.entryCount === 1 ? "entry" : "entries"
              }`}
        </span>
      </div>
    </li>
  );
}

type Watered = Record<string, { nonce: number; grew: boolean }>;

/** Which plants had their total go UP between two renders of the same garden. */
function wateredBetween(
  before: Map<string, number>,
  after: Map<string, number>,
  nonce: number,
): Watered {
  const watered: Watered = {};

  for (const [slug, total] of after) {
    const was = before.get(slug);
    if (was === undefined || total <= was) continue;
    watered[slug] = { nonce, grew: growthStage(total) > growthStage(was) };
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

  // The previous totals live in STATE, not a ref, and the comparison happens
  // during render — React's "adjust state when a prop changes" path. An effect
  // would repaint once before watering anything, and a ref would be read twice
  // under StrictMode's double render and lose the event.
  //
  // This holds no authority over plant size: every render still derives that
  // from the incoming prop via growthStage(). All this remembers is that a
  // number went up, which is what makes the watering an event rather than a
  // state.
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

  // Nothing is cleared on a timer: every watering animation ends on a neutral
  // frame (the drops at opacity 0, the plant back at scale 1), so the markup
  // can simply stay until the next expense lands and re-keys it.

  const stageValue = formatCents(FULL_GROWTH_CENTS / MAX_STAGE);

  return (
    <div className="flex flex-col gap-3">
      {/* The bed. One band of air over one band of soil, with every plant on
          the same ground line. It scrolls sideways rather than wrapping,
          because a second row would mean a second baseline. */}
      <div className="overflow-x-auto rounded-lg border border-rule bg-air">
        <div className="bed-soil min-w-[660px] px-3">
          <ol className="flex items-stretch">
            {plants.map((plant) => (
              <PlantView
                key={plant.slug}
                plant={plant}
                watering={watering[plant.slug]}
              />
            ))}
          </ol>
        </div>
      </div>

      <p className="max-w-[68ch] text-xs text-ink-faint">
        Height is what you spent. Each plant gains a stage every {stageValue} and
        is fully grown at {formatCents(FULL_GROWTH_CENTS)} in a month, then
        starts again from seed on the first of the next one.
      </p>
    </div>
  );
}

/**
 * A few plants on a strip of soil, with no figures attached — for the sign-in
 * pages, where the point is to show what the app actually is rather than to
 * report anyone's spending. It draws the same six species at the same growth
 * curve as the bed, so nothing here can drift away from the real thing.
 */
export function GardenVignette() {
  const cast = [
    { key: "vine", stage: 2 },
    { key: "fern", stage: 4 },
    { key: "orchid", stage: 3 },
    { key: "bamboo", stage: 5 },
    { key: "succulent", stage: 3 },
    { key: "tomato", stage: 4 },
  ];

  return (
    <div aria-hidden="true" className="flex flex-col">
      <div className="flex items-end">
        {cast.map(({ key, stage }) => {
          const Species = SPECIES[key] ?? Vine;
          const { foliage, accent } = PALETTE[key] ?? FALLBACK;

          return (
            <svg
              key={key}
              viewBox="0 0 100 200"
              preserveAspectRatio="xMidYMax meet"
              className="h-28 w-full flex-1 overflow-visible sm:h-40"
            >
              <Species
                h={plantHeight(stage)}
                stage={stage}
                foliage={foliage}
                accent={accent}
                flip={seed(key) % 2 === 1}
                fresh=""
              />
            </svg>
          );
        })}
      </div>
      <div className="h-7 border-t-[3px] border-soil-deep bg-soil sm:h-9" />
    </div>
  );
}
