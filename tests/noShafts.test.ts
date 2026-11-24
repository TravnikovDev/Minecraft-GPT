// The bot digs like a player: stairs, never a 1x1 shaft straight down or up.
// Runs the real pathfinder search (A*) through solid stone with our walking
// rules and checks every move of the path it finds.
import { expect, test } from "bun:test";
const ROOT = `${import.meta.dir}/..`;
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);
const pf = require(`${ROOT}/node_modules/mineflayer-pathfinder`);
const AStar = require(`${ROOT}/node_modules/mineflayer-pathfinder/lib/astar.js`);
const Move = require(`${ROOT}/node_modules/mineflayer-pathfinder/lib/move.js`);
const { safeMovements } = await import(`${ROOT}/src/core/movements.ts`);

// Flat ground: air above y=64, stone at y=63 and below
const SURFACE = 64;
const stone = registry.blocksByName.dirt.defaultState; // cheap to dig without a tool
const air = registry.blocksByName.air.defaultState;
const bot: any = {
  registry,
  version: "1.20.4",
  supportFeature: () => false,
  entities: {},
  inventory: { items: () => [] },
  pathfinder: { bestHarvestTool: () => null },
  heldItem: null,
  effects: {},
  entity: { effects: {} },
  game: { gameMode: "survival", minY: -64 },
  blockAt: (p: any) => {
    const b = Block.fromStateId(p.y < SURFACE ? stone : air, 0);
    b.position = p.floored ? p.floored() : p;
    return b;
  },
};
bot.world = { getBlock: (p: any) => bot.blockAt(p) };

type Step = { x: number; y: number; z: number; toBreak: unknown[] };

// The pathfinder's default think timeout in the game
const THINK_MS = 5000;

/** Our walking rules as a collect task uses them (cheap digging). */
function miningRules(): any {
  const moves = safeMovements(bot);
  moves.digCost = 1; // collectBlock's MINING_DIG_COST
  return moves;
}

/** The path the pathfinder plans from `from` to `goal`, within the game's time limit. */
function plan(moves: any, goal: any, from = { x: 0, y: SURFACE, z: 0 }): Step[] {
  const start = new Move(from.x, from.y, from.z, 0, 0);
  const result = new AStar(start, moves, goal, THINK_MS, THINK_MS).compute();
  expect(result.status).toBe("success");
  return result.path;
}

/** Moves that dig and go straight down or up (same column). */
function shaftMoves(path: Step[]): Step[] {
  let prev = { x: 0, y: SURFACE, z: 0 };
  const shafts: Step[] = [];
  for (const step of path) {
    if (step.x === prev.x && step.z === prev.z && step.y !== prev.y && step.toBreak.length > 0) shafts.push(step);
    prev = step;
  }
  return shafts;
}

test("the pathfinder's own rules dig a shaft (so the check below means something)", () => {
  const raw = new pf.Movements(bot);
  raw.allowParkour = false;
  expect(shaftMoves(plan(raw, new pf.goals.GoalBlock(0, SURFACE - 6, 0))).length).toBeGreaterThan(0);
});

test("to reach a spot below and ahead, it digs stairs, not a shaft", () => {
  const path = plan(miningRules(), new pf.goals.GoalBlock(0, SURFACE - 6, 8));
  expect(shaftMoves(path)).toEqual([]);
  expect(path.at(-1)!.y).toBe(SURFACE - 6);
});

test("even straight below, it goes down by stairs", () => {
  const path = plan(miningRules(), new pf.goals.GoalBlock(0, SURFACE - 6, 0));
  expect(shaftMoves(path)).toEqual([]);
});

test("from underground it climbs back up by stairs, not through the ceiling", () => {
  const from = { x: 0, y: SURFACE - 8, z: 0 };
  const path = plan(miningRules(), new pf.goals.GoalY(SURFACE), from);
  let prev = from;
  for (const step of path) {
    expect(step.x === prev.x && step.z === prev.z && step.y !== prev.y && step.toBreak.length > 0).toBe(false);
    prev = step;
  }
});
