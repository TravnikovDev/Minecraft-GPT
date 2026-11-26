// Path: src/commands/DescribeSurroundings.ts

import { z } from "zod";
import { bot } from "../core/body";
import { daylight } from "../core/daylight";

export const description = `Describes where the bot is: biome, time of day, weather, and what's nearby (trees, ores,
water, lava, useful blocks, animals, monsters, players). Answers immediately, even while busy.
Example: "What biome are you in?", "What's around you?", "Describe your surroundings", "Anything interesting nearby?"`;

export const parameters = z.object({});

const SCAN_RADIUS = 24;

// Blocks worth mentioning, grouped by the label used in chat
const BLOCK_GROUPS: Array<{ label: string; match: (name: string) => boolean }> = [
  { label: "trees", match: (n) => n.endsWith("_log") || n.endsWith("_stem") },
  { label: "diamond ore", match: (n) => n.endsWith("diamond_ore") },
  { label: "iron ore", match: (n) => n.endsWith("iron_ore") },
  { label: "coal ore", match: (n) => n.endsWith("coal_ore") },
  { label: "gold ore", match: (n) => n.endsWith("gold_ore") },
  { label: "copper ore", match: (n) => n.endsWith("copper_ore") },
  { label: "water", match: (n) => n === "water" },
  { label: "lava", match: (n) => n === "lava" },
  { label: "crafting table", match: (n) => n === "crafting_table" },
  { label: "furnace", match: (n) => n === "furnace" },
  { label: "chest", match: (n) => n === "chest" },
  { label: "bed", match: (n) => n.endsWith("_bed") },
];

function nearestOf(match: (name: string) => boolean): number | null {
  const ids = bot.registry.blocksArray.filter((b) => match(b.name)).map((b) => b.id);
  if (ids.length === 0) return null;
  const found = bot.findBlock({ matching: ids, maxDistance: SCAN_RADIUS });
  return found ? Math.round(found.position.distanceTo(bot.entity.position)) : null;
}

export async function execute(): Promise<void> {
  const pos = bot.entity.position;
  const biome = bot.blockAt(pos)?.biome?.name?.replace(/_/g, " ") || "unknown";
  const dimension = String(bot.game.dimension).replace("minecraft:", "").replace(/_/g, " ");
  const time = daylight() ? "daytime" : "night";
  const weather = bot.thunderState > 0 ? "thunderstorm" : bot.isRaining ? "raining" : "clear";

  const blocks = BLOCK_GROUPS.map((g) => ({ label: g.label, dist: nearestOf(g.match) }))
    .filter((b): b is { label: string; dist: number } => b.dist !== null)
    .sort((a, b) => a.dist - b.dist)
    .map((b) => `${b.label} ${b.dist}m`);

  // Count creatures by name within the scan radius
  const counts = new Map<string, number>();
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity || !entity.name) continue;
    if (entity.position.distanceTo(pos) > SCAN_RADIUS) continue;
    // Entity type names vary by version ("mob", "hostile", "animal", ...)
    const kind = String(entity.type);
    if (kind !== "mob" && kind !== "hostile" && kind !== "animal" && kind !== "passive") continue;
    counts.set(entity.name, (counts.get(entity.name) ?? 0) + 1);
  }
  const creatures = [...counts.entries()].map(([name, n]) => `${n} ${name.replace(/_/g, " ")}`);

  const players = Object.values(bot.players)
    .filter((p) => p.entity && p.username !== bot.username)
    .map((p) => `${p.username} ${Math.round(p.entity!.position.distanceTo(pos))}m`);

  bot.chat(
    biome === "unknown"
      ? `I can't tell the biome here (${dimension}). It's ${time}, ${weather}.`
      : `I'm in a ${biome} biome (${dimension}). It's ${time}, ${weather}.`
  );
  const parts = [
    blocks.length ? `Nearby: ${blocks.join(", ")}` : "No trees, ores or water within 24 blocks",
    creatures.length ? `creatures: ${creatures.join(", ")}` : "",
    players.length ? `players: ${players.join(", ")}` : "",
  ].filter(Boolean);
  bot.chat(parts.join("; ") + ".");
}
