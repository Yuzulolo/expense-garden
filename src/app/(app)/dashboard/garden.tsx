"use client";

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
 * Colour per plant_key, read from the categories table rather than hardcoded
 * per category. An unknown key falls back to green rather than rendering
 * nothing, so adding a category to the table can never blank out the garden.
 */
const PLANT_COLOURS: Record<string, string> = {
  vine: "#4f7a3a",
  orchid: "#a3487e",
  bamboo: "#3f8f6d",
  tomato: "#b4402f",
  fern: "#2f6f4f",
  succulent: "#7a8f3a",
};

const FALLBACK_COLOUR = "#4f7a3a";

/** Purely visual: stage 0 is a dormant sprout, stage 5 a full plant. */
const STEM_BASE_PX = 10;
const STEM_PER_STAGE_PX = 24;

function PlantView({ plant }: { plant: Plant }) {
  // Derived on every render from the number the database returned. Nothing
  // about this plant's size is stored, anywhere.
  const stage = growthStage(plant.totalCents);
  const colour = PLANT_COLOURS[plant.plantKey] ?? FALLBACK_COLOUR;

  const stemHeight = STEM_BASE_PX + stage * STEM_PER_STAGE_PX;
  const bloomSize = 12 + stage * 5;
  const dormant = stage === 0;

  return (
    <li className="flex w-28 flex-col items-center gap-2">
      <div
        className="flex h-40 w-full flex-col items-center justify-end"
        // The accessible description carries the same facts the drawing does.
        role="img"
        aria-label={`${plant.label}: ${formatCents(
          plant.totalCents,
        )} spent this month, growth stage ${stage} of ${MAX_STAGE}`}
      >
        <div
          className="rounded-full transition-all duration-500 ease-out motion-reduce:transition-none"
          style={{
            width: bloomSize,
            height: bloomSize,
            backgroundColor: colour,
            opacity: dormant ? 0.35 : 1,
          }}
        />
        <div
          className="w-1.5 rounded-t transition-all duration-500 ease-out motion-reduce:transition-none"
          style={{
            height: stemHeight,
            backgroundColor: colour,
            opacity: dormant ? 0.35 : 1,
          }}
        />
        <div
          className="h-1.5 w-10 rounded"
          style={{ backgroundColor: "#8a6f4a" }}
        />
      </div>

      <div className="flex flex-col items-center text-center">
        <span className="text-sm font-medium">{plant.label}</span>
        <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
          {formatCents(plant.totalCents)}
        </span>
        <span className="text-xs text-zinc-500">
          stage {stage}/{MAX_STAGE}
          {plant.entryCount > 0 ? ` · ${plant.entryCount}` : ""}
        </span>
      </div>
    </li>
  );
}

export function Garden({ plants }: { plants: Plant[] }) {
  return (
    <>
      <ul className="flex flex-wrap items-end gap-6">
        {plants.map((plant) => (
          <PlantView key={plant.slug} plant={plant} />
        ))}
      </ul>
      <p className="text-xs text-zinc-500">
        A plant reaches full growth at {formatCents(FULL_GROWTH_CENTS)} of
        spending in a month, in {MAX_STAGE} stages of{" "}
        {formatCents(FULL_GROWTH_CENTS / MAX_STAGE)}.
      </p>
    </>
  );
}
