// Path: src/roles/hauler.ts
// The hauler (Phase 8): sorts the chests around its post so each kind of
// thing has its own chest (tools and armour, food, ores, wood, farming,
// mob drops, stone and earth, the rest), keeping the chest index current
// (every chest it opens is remembered with what's inside). One chest's
// misplaced things are moved per shift.

import { Vec3 } from "vec3";
import type { Block } from "prismarine-block";
import { bot } from "../core/body";
import { catalog } from "../core/catalog";
import { isCommandCancelled } from "../core/commandContext";
import { depositInto, withdrawFrom } from "../core/containers";
import { fail, ok } from "../core/result";
import { loadChests } from "../core/session";
import type { Role } from "./role";
import type { Shift } from "./guard";

/** The kind of thing an item is, for sorting chests. Pure over the catalog. */
export function itemCategory(name: string): string {
  const c = catalog();
  if (c.toolKind(name) || c.armorSlot(name) || /^(bow|crossbow|shield|trident|fishing_rod|flint_and_steel|shears|arrow)$/.test(name)) return "tools and armour";
  if (c.isFood(name)) return "food";
  if (/^(raw_|coal|charcoal|diamond|emerald|redstone|lapis_lazuli|quartz|amethyst_shard)|_ingot$|_nugget$|_ore$/.test(name)) return "ores";
  if (c.isLog(name) || c.isPlanks(name) || /(_sapling|^stick|_wood|_slab|_stairs|_fence|_door)$|^stick$/.test(name)) return "wood";
  if (/(_seeds|^wheat|^sugar_cane|^cactus|^bone_meal|^pumpkin|^melon|^hay_block|^egg)$/.test(name)) return "farming";
  if (/^(string|bone|rotten_flesh|gunpowder|spider_eye|leather|feather|ender_pearl|slime_ball|ink_sac|blaze_rod|phantom_membrane)$/.test(name)) return "mob drops";
  if (/^(dirt|coarse_dirt|cobblestone|cobbled_deepslate|stone|deepslate|andesite|diorite|granite|tuff|gravel|sand|red_sand|netherrack|calcite|clay_ball|flint)$/.test(name)) return "stone and earth";
  return "other";
}

export type ChestContents = { key: string; contents: Record<string, number> };
export type Move = { from: string; to: string; name: string; count: number };

/**
 * Which chest each kind of thing belongs in (the chest that already has the
 * most of it; one kind per chest), and the moves that get everything there.
 * Kinds without a chest of their own stay where they are. Pure.
 */
export function sortPlan(chests: ChestContents[], categoryOf: (name: string) => string = itemCategory): { home: Map<string, string>; moves: Move[] } {
  const amounts: { cat: string; key: string; n: number }[] = [];
  for (const chest of chests) {
    const byCat = new Map<string, number>();
    for (const [name, n] of Object.entries(chest.contents)) byCat.set(categoryOf(name), (byCat.get(categoryOf(name)) ?? 0) + n);
    for (const [cat, n] of byCat) amounts.push({ cat, key: chest.key, n });
  }
  amounts.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  const home = new Map<string, string>(); // category -> chest
  const taken = new Set<string>();
  for (const a of amounts) {
    if (home.has(a.cat) || taken.has(a.key)) continue;
    home.set(a.cat, a.key);
    taken.add(a.key);
  }
  const moves: Move[] = [];
  for (const chest of chests) {
    for (const [name, count] of Object.entries(chest.contents)) {
      const to = home.get(categoryOf(name));
      if (to && to !== chest.key) moves.push({ from: chest.key, to, name, count });
    }
  }
  return { home, moves };
}

const keyOf = (p: { x: number; y: number; z: number }): string => `${p.x},${p.y},${p.z}`;

/** One shift: look in the chests around its post, then move one chest's misplaced things. */
export async function haulerShift(role: Role): Promise<Shift> {
  const centre = role.anchor ?? bot.entity.position;
  const near = loadChests().filter((c) => new Vec3(c.x, c.y, c.z).distanceTo(new Vec3(centre.x, centre.y, centre.z)) <= role.radius);
  const blocks = near.map((c) => bot.blockAt(new Vec3(c.x, c.y, c.z))).filter((b): b is Block => b !== null && /chest|barrel/.test(b.name));
  if (blocks.length < 2) return { result: fail("not_found", "there are fewer than two chests I know here to sort"), restMs: 5 * 60_000 };
  const { lookInChest, withChest } = await import("../actions/storage");
  const chests: ChestContents[] = [];
  for (const b of blocks) {
    if (isCommandCancelled()) return { result: fail("aborted", "stopped"), restMs: 0 };
    chests.push({ key: keyOf(b.position), contents: Object.fromEntries(await lookInChest(b)) });
  }
  const { moves } = sortPlan(chests);
  if (moves.length === 0) return { result: ok(), restMs: 5 * 60_000 };
  // One source chest per shift: take what's misplaced (as much as fits)...
  const from = moves[0]!.from;
  const source = blocks.find((b) => keyOf(b.position) === from)!;
  const mine = moves.filter((m) => m.from === from);
  await withChest(source, async (open) => {
    for (const m of mine) {
      if (bot.inventory.emptySlotCount() === 0) break;
      const item = open.containerItems().find((i) => i.name === m.name);
      if (item) await withdrawFrom(open, item, Math.min(m.count, item.count));
    }
  });
  // ...then into the chest each kind belongs in
  for (const to of new Set(mine.map((m) => m.to))) {
    if (isCommandCancelled()) break;
    const target = blocks.find((b) => keyOf(b.position) === to);
    if (!target) continue;
    const names = new Set(mine.filter((m) => m.to === to).map((m) => m.name));
    await withChest(target, async (open) => {
      for (const item of bot.inventory.items().filter((i) => names.has(i.name))) await depositInto(open, item, item.count);
    });
  }
  console.log(`Hauler: sorted the chest at ${from} (${mine.length} kinds moved).`);
  return { result: ok(), restMs: 10_000 };
}
