// Path: src/core/catalog.ts
// The Catalog: the one place that knows how names map to IDs and how things
// group together ("any log", "the planks this log makes", "a pickaxe of stone
// tier or better", "hostile mob"). Everything is derived from the connected
// server's registry plus small tables, never from guessing with
// name.includes(), so new versions (pale oak in 26.1...) work by themselves.
//
// Rules (architecture: identifiers):
// - Names like `oak_planks` are the contract between code, memory and the LLM.
// - Numeric IDs are looked up at call time and never stored or shown.
// - An unknown name is "not found" (null), never 0 (air).
// - Display names are for chat only.

import { bot } from "./body";

/** The slice of a prismarine registry the Catalog reads. */
export type Registry = {
  itemsByName: Record<string, { id: number; name: string; displayName: string }>;
  itemsArray: Array<{ id: number; name: string; displayName: string }>;
  items: Record<number, { name: string }>;
  blocksByName: Record<string, { id: number; name: string; displayName: string; harvestTools?: Record<string, boolean>; drops?: unknown[]; material?: string }>;
  blocksArray: Array<{ id: number; name: string; drops?: unknown[] }>;
  blocks: Record<number, { name: string }>;
  entitiesByName: Record<string, { name: string; type?: string; displayName?: string }>;
  foodsByName?: Record<string, { foodPoints: number; saturation: number }>;
};

export type Kind = "item" | "block" | "entity";
export type ToolKind = "pickaxe" | "axe" | "shovel" | "hoe" | "sword";
export type Validation = { ok: true; name: string } | { ok: false; input: string; suggestions: string[] };

// Tool and armor materials, weakest first (gold mines fast but breaks fast and
// harvests only what wood can)
const TOOL_TIERS = ["wooden", "golden", "stone", "iron", "diamond", "netherite"] as const;
const ARMOR_TIERS = ["leather", "golden", "chainmail", "iron", "diamond", "netherite"] as const;
const ARMOR_SLOTS = { helmet: "head", chestplate: "torso", leggings: "legs", boots: "feet" } as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[keyof typeof ARMOR_SLOTS];

// Wood: logs, stems and their "wood"/"hyphae" blocks, stripped or not, make planks
const WOOD_BLOCK = /^(?:stripped_)?([a-z_]+?)_(log|wood|stem|hyphae)$/;

export interface Catalog {
  /** Lower case, spaces to underscores, no "minecraft:" prefix. */
  normalize(text: string): string;
  itemId(name: string): number | null;
  blockId(name: string): number | null;
  itemName(id: number): string | null;
  blockName(id: number): string | null;
  isItem(name: string): boolean;
  isBlock(name: string): boolean;
  isEntity(name: string): boolean;
  /** "Oak Planks": for chat only. */
  display(name: string): string;
  /** Checks a name; on a miss, offers the closest real names. */
  validate(text: string, kind?: Kind): Validation;
  /** Closest real names for a text ("iron" -> raw_iron, iron_ingot, iron_ore). */
  suggest(text: string, kind?: Kind, max?: number): string[];
  /** Matches a loose name ("plate", "planks") against names the bot has: exact first, then "<anything>_<name>". */
  resolveLoose(text: string, among: string[]): string[];

  /** Every wood type with planks in this version (oak ... cherry, bamboo, crimson, warped, pale_oak). */
  woodTypes(): string[];
  /** Logs, stems, wood and hyphae (stripped too) and bamboo blocks: anything that makes planks. */
  isLog(name: string): boolean;
  logs(): string[];
  isPlanks(name: string): boolean;
  planks(): string[];
  /** The planks a log makes (stripped_cherry_log -> cherry_planks), or null. */
  planksFor(log: string): string | null;

  /** pickaxe / axe / shovel / hoe / sword, by exact suffix (an axe is never a pickaxe). */
  toolKind(name: string): ToolKind | null;
  /** 0 wooden ... 5 netherite, or -1 when it isn't a tiered tool. */
  toolTier(name: string): number;
  /** The tool kind that mines a block faster, or null when the hand is fine. */
  toolKindFor(block: string): ToolKind | null;
  /** True when this item can harvest the block (gets its drop). */
  canHarvest(block: string, tool: string | null): boolean;
  /** The best tool among `carried` for a block, or null. */
  bestToolFor(block: string, carried: string[]): string | null;

  isArmor(name: string): boolean;
  armorSlot(name: string): ArmorSlot | null;
  armorTier(name: string): number;

  isFood(name: string): boolean;
  foodPoints(name: string): number;

  isHostile(entity: string): boolean;
  /** Animals the bot may hunt for food or materials. */
  isHuntable(entity: string): boolean;

  /** Items a block drops when mined with the right tool (iron_ore -> raw_iron). */
  dropsOf(block: string): string[];
  /** Ore blocks that drop this item (raw_iron -> iron_ore, deepslate_iron_ore). */
  oresFor(item: string): string[];
}

/** Builds a Catalog over one registry (the connected server's version). */
export function createCatalog(registry: Registry): Catalog {
  const items = registry.itemsByName;
  const blocks = registry.blocksByName;
  const entities = registry.entitiesByName;

  const isOre = (block: string): boolean => /(_ore|^ancient_debris)$/.test(block) && block in blocks;
  // Everything ores drop (raw_iron, diamond, coal...), computed once
  let oreDropSet: Set<string> | null = null;
  const oreDrops = (): Set<string> => (oreDropSet ??= new Set(Object.keys(blocks).filter(isOre).flatMap((b) => dropsOf(b))));

  const normalize = (text: string): string =>
    text.trim().toLowerCase().replace(/^minecraft:/, "").replace(/[\s-]+/g, "_");

  const namesOf = (kind: Kind): string[] =>
    kind === "item" ? Object.keys(items) : kind === "block" ? Object.keys(blocks) : Object.keys(entities);
  const has = (kind: Kind, name: string): boolean =>
    kind === "item" ? name in items : kind === "block" ? name in blocks : name in entities;

  // Plural to singular, only when the singular is a real name ("glass" stays)
  const singular = (name: string, kind: Kind): string | null => {
    for (const cut of [/ies$/, /es$/, /s$/]) {
      if (!cut.test(name)) continue;
      const candidate = cut.source === "ies$" ? name.replace(/ies$/, "y") : name.replace(cut, "");
      if (has(kind, candidate)) return candidate;
    }
    return null;
  };

  const editDistance = (a: string, b: string): number => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = row[j]!;
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[b.length]!;
  };

  const suggest = (text: string, kind: Kind = "item", max = 3): string[] => {
    const input = normalize(text);
    const words = input.split("_").filter(Boolean);
    const names = namesOf(kind);
    // Names containing every word of the input as whole words. Raw materials
    // first (ores, what they drop, ingots), tools and armor last, then shortest:
    // "iron" -> raw_iron, iron_ore, iron_ingot rather than iron_axe
    const rank = (n: string): number =>
      isOre(n) || oreDrops().has(n) || /_ingot$/.test(n) ? 0 : toolKind(n) || armorSlot(n) ? 2 : 1;
    const byWords = names
      .filter((n) => {
        const parts = n.split("_");
        return words.every((w) => parts.includes(w) || parts.includes(singular(w, kind) ?? w));
      })
      .sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b));
    if (byWords.length > 0) return byWords.slice(0, max);
    // Otherwise typos: smallest edit distance
    return names
      .map((n) => ({ n, d: editDistance(input, n) }))
      .filter(({ d }) => d <= Math.max(2, Math.floor(input.length / 3)))
      .sort((a, b) => a.d - b.d || a.n.length - b.n.length)
      .slice(0, max)
      .map(({ n }) => n);
  };

  const validate = (text: string, kind: Kind = "item"): Validation => {
    const name = normalize(text);
    if (has(kind, name)) return { ok: true, name };
    const one = singular(name, kind);
    if (one) return { ok: true, name: one };
    return { ok: false, input: name, suggestions: suggest(name, kind) };
  };

  const resolveLoose = (text: string, among: string[]): string[] => {
    const name = normalize(text);
    const set = [...new Set(among)];
    if (set.includes(name)) return [name];
    const forms = [name, ...(["item", "block"] as const).map((k) => singular(name, k)).filter((s): s is string => !!s)];
    for (const form of forms) if (set.includes(form)) return [form];
    // "plate" -> heavy_weighted_pressure_plate, "planks" -> oak_planks, birch_planks
    const stripped = name.replace(/s$/, "");
    return set.filter((n) => forms.some((f) => n.endsWith(`_${f}`)) || n.endsWith(`_${stripped}`));
  };

  const woodTypes = (): string[] =>
    Object.keys(items)
      .filter((n) => n.endsWith("_planks"))
      .map((n) => n.slice(0, -"_planks".length));

  const planksFor = (log: string): string | null => {
    if (log === "bamboo_block" || log === "stripped_bamboo_block") return items["bamboo_planks"] ? "bamboo_planks" : null;
    const match = WOOD_BLOCK.exec(log);
    if (!match) return null;
    const planks = `${match[1]}_planks`;
    return planks in items ? planks : null;
  };
  const isLog = (name: string): boolean => planksFor(name) !== null && (name in items || name in blocks);

  const toolKind = (name: string): ToolKind | null => {
    const match = /^[a-z]+_(pickaxe|axe|shovel|hoe|sword)$/.exec(name);
    return match && name in items ? (match[1] as ToolKind) : null;
  };
  const toolTier = (name: string): number => {
    if (!toolKind(name)) return -1;
    return TOOL_TIERS.findIndex((t) => name.startsWith(`${t}_`));
  };

  const harvestToolNames = (block: string): string[] | null => {
    const tools = blocks[block]?.harvestTools;
    if (!tools) return null; // anything harvests it, the hand too
    return Object.keys(tools).map((id) => registry.items[Number(id)]?.name).filter((n): n is string => !!n);
  };
  const toolKindFor = (block: string): ToolKind | null => {
    const material = blocks[block]?.material ?? "";
    const match = /mineable\/(pickaxe|axe|shovel|hoe)/.exec(material);
    if (match) return match[1] as ToolKind;
    if (material.includes("sword") || block === "cobweb") return "sword";
    return null;
  };
  const canHarvest = (block: string, tool: string | null): boolean => {
    const needed = harvestToolNames(block);
    return needed === null || (tool !== null && needed.includes(tool));
  };
  const bestToolFor = (block: string, carried: string[]): string | null => {
    const kind = toolKindFor(block);
    const usable = carried
      .filter((n) => (kind ? toolKind(n) === kind : false) && canHarvest(block, n))
      .sort((a, b) => toolTier(b) - toolTier(a));
    if (usable[0]) return usable[0];
    // No tool of the right kind: anything that still harvests it
    return carried.find((n) => toolKind(n) && canHarvest(block, n) && harvestToolNames(block) !== null) ?? null;
  };

  const armorSlot = (name: string): ArmorSlot | null => {
    const match = /^[a-z]+_(helmet|chestplate|leggings|boots)$/.exec(name);
    return match && name in items ? ARMOR_SLOTS[match[1] as keyof typeof ARMOR_SLOTS] : null;
  };

  const dropsOf = (block: string): string[] =>
    (blocks[block]?.drops ?? [])
      .map((d) => (typeof d === "number" ? d : (d as { drop?: number | { id: number } })?.drop))
      .map((d) => (typeof d === "number" ? d : d?.id))
      .map((id) => (id === undefined ? undefined : registry.items[id]?.name))
      .filter((n): n is string => !!n);


  return {
    normalize,
    itemId: (name) => items[name]?.id ?? null,
    blockId: (name) => blocks[name]?.id ?? null,
    itemName: (id) => registry.items[id]?.name ?? null,
    blockName: (id) => registry.blocks[id]?.name ?? null,
    isItem: (name) => name in items,
    isBlock: (name) => name in blocks,
    isEntity: (name) => name in entities,
    display: (name) =>
      items[name]?.displayName ?? blocks[name]?.displayName ?? entities[name]?.displayName ?? name.replace(/_/g, " "),
    validate,
    suggest,
    resolveLoose,
    woodTypes,
    isLog,
    logs: () => Object.keys(items).filter(isLog),
    isPlanks: (name) => name.endsWith("_planks") && name in items,
    planks: () => woodTypes().map((w) => `${w}_planks`),
    planksFor,
    toolKind,
    toolTier,
    toolKindFor,
    canHarvest,
    bestToolFor,
    isArmor: (name) => armorSlot(name) !== null,
    armorSlot,
    armorTier: (name) => (armorSlot(name) ? ARMOR_TIERS.findIndex((t) => name.startsWith(`${t}_`)) : -1),
    isFood: (name) => Boolean(registry.foodsByName?.[name]),
    foodPoints: (name) => registry.foodsByName?.[name]?.foodPoints ?? 0,
    isHostile: (entity) => entities[entity]?.type === "hostile",
    isHuntable: (entity) => entities[entity]?.type === "animal",
    dropsOf,
    oresFor: (item) => Object.keys(blocks).filter((b) => isOre(b) && dropsOf(b).includes(item)),
  };
}

// One Catalog per registry (a reconnect to another version gets a new one)
const cache = new WeakMap<object, Catalog>();

/** The Catalog for the connected server's version. */
export function catalog(): Catalog {
  const registry = bot.registry as unknown as Registry;
  let found = cache.get(registry);
  if (!found) {
    found = createCatalog(registry);
    cache.set(registry, found);
  }
  return found;
}
