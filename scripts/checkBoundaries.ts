// Path: scripts/checkBoundaries.ts
// Keeps calls that change the game from spreading. Outside src/core/, code may
// still call these bot methods directly only as often as the frozen allow-list
// says (today's count per file). The counts may only go down: Phase 3 moves
// these calls into checked primitives and Phase 4 puts them behind leases.
// Reads (bot.entity, bot.inventory, bot.blockAt...) are not limited.
//
//   bun run scripts/checkBoundaries.ts            check (fails on new calls)
//   bun run scripts/checkBoundaries.ts --update   re-freeze after removing calls

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ALLOWLIST = join(import.meta.dir, "boundaryAllowlist.json");

// bot methods that change the game, plus direct plugin handles (on `bot`, or a
// connection's `currentBot` in per-connection setup code)
const CHANGING_CALL =
  /\b(?:bot|currentBot)\.(dig|placeBlock|activateBlock|activateEntity|activateItem|equip|unequip|toss|tossStack|craft|openContainer|openFurnace|openChest|openBlock|clickWindow|closeWindow|setControlState|clearControlStates|lookAt|look|sleep|wake|attack|consume|mount|dismount|stopDigging)\(|\b(?:bot|currentBot)\.(pathfinder|pvp|tool|autoEat|armorManager)\./g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const counts: Record<string, number> = {};
for (const file of sourceFiles(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  if (rel.startsWith("src/core/")) continue; // the Body and adapters own these calls
  const n = (readFileSync(file, "utf8").match(CHANGING_CALL) ?? []).length;
  if (n > 0) counts[rel] = n;
}

if (process.argv.includes("--update")) {
  writeFileSync(ALLOWLIST, JSON.stringify(counts, Object.keys(counts).sort(), 2) + "\n");
  console.log(`Froze ${Object.values(counts).reduce((a, b) => a + b, 0)} direct calls in ${Object.keys(counts).length} files.`);
  process.exit(0);
}

const allowed: Record<string, number> = JSON.parse(readFileSync(ALLOWLIST, "utf8"));
const grown = Object.entries(counts).filter(([file, n]) => n > (allowed[file] ?? 0));
if (grown.length > 0) {
  console.error("New direct calls that change the game (go through core/ instead):");
  for (const [file, n] of grown) console.error(`  ${file}: ${n} (allowed ${allowed[file] ?? 0})`);
  process.exit(1);
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`Boundaries OK: ${total} direct game-changing calls left outside core/ (may only go down).`);
