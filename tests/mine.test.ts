// The mine under the shelter: stairs 10 levels down from the exit to a hub;
// from each hub three tunnels, forward, right, left, 50 blocks each (a
// blocker ends one); then the stairs go 20 steps deeper to the next hub.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { mineBottom, MINE_DEPTH, nextArm, armDirection, hubStep, ARM_LENGTH, LEVEL_STEP, stepsToPave, mineStairCells } = await import(`${ROOT}/src/skills/mine.ts`);

test("the stairs end MINE_DEPTH down and on from the exit (owner: the first floor 20 down)", () => {
  const b = mineBottom({ x: 10, y: 65, z: -17 }, "north");
  expect(MINE_DEPTH).toBe(20);
  expect([b.x, b.y, b.z]).toEqual([10, 65 - MINE_DEPTH, -17 - MINE_DEPTH]);
});

const arm = (dug: number, blocked = false) => ({ dug, blocked });

const full = { dug: ARM_LENGTH, blocked: false };
test("forward first, then right, then left, then back, each up to 50 blocks", () => {
  expect(nextArm({ forward: arm(0), right: arm(0), left: arm(0), back: arm(0) })).toBe("forward");
  expect(nextArm({ forward: arm(35), right: arm(0), left: arm(0), back: arm(0) })).toBe("forward");
  expect(nextArm({ forward: full, right: arm(0), left: arm(0), back: arm(0) })).toBe("right");
  expect(nextArm({ forward: full, right: full, left: arm(20), back: arm(0) })).toBe("left");
  expect(nextArm({ forward: full, right: full, left: full, back: arm(0) })).toBe("back");
  // All four done: time to go deeper
  expect(nextArm({ forward: full, right: full, left: full, back: full })).toBeNull();
});

test("a blocker ends that tunnel; the next one is dug", () => {
  expect(nextArm({ forward: arm(12, true), right: arm(0), left: arm(0), back: arm(0) })).toBe("right");
  expect(nextArm({ forward: arm(12, true), right: arm(3, true), left: arm(40, true), back: arm(0) })).toBe("back");
  expect(nextArm({ forward: arm(12, true), right: arm(3, true), left: arm(40, true), back: arm(1, true) })).toBeNull();
});

test("right and left are the stairs' right and left; back is behind", () => {
  expect(["forward", "right", "left", "back"].map((a) => armDirection(a, "north"))).toEqual(["north", "east", "west", "south"]);
  expect(["forward", "right", "left", "back"].map((a) => armDirection(a, "east"))).toEqual(["east", "south", "north", "west"]);
});

test("floors (owner, older room round the stairs): left and right sleeves from the middle; forward and back from the left column on odd floors, the right on even", async () => {
  const { sleeveColumn, pokeSides, floorName } = await import(`${ROOT}/src/skills/mine.ts`);
  expect([sleeveColumn("left", 0, false), sleeveColumn("right", 1, false)]).toEqual([0, 0]);
  expect([sleeveColumn("forward", 0, false), sleeveColumn("back", 0, false)]).toEqual([-1, -1]); // 1st floor: left column
  expect([sleeveColumn("forward", 1, false), sleeveColumn("back", 1, false)]).toEqual([1, 1]); // 2nd floor: right column
  // Pokeholes both sides off left and right; only the outer side off forward and back (the stairs are inside)
  expect(pokeSides("left", 0, false)).toEqual([1, -1]);
  expect(pokeSides("forward", 0, false)).toEqual([-1]);
  expect(pokeSides("back", 0, false)).toEqual([1]);
  expect([0, 1, 2, 3, 10].map(floorName)).toEqual(["1st floor", "2nd floor", "3rd floor", "4th floor", "11th floor"]);
});

test("floors (owner): the room beside the stairs, not round them, so the middle is free to run from sleeve to sleeve", async () => {
  const { sleeveColumn, pokeSides, roomColumns, floorCells, roomBeside } = await import(`${ROOT}/src/skills/mine.ts`);
  // The stairs along the room's left column; the middle and right columns flat
  expect(roomColumns(true)).toEqual([0, 1, 2]);
  // Left from the stairs' landing, right from the right column (both the middle row)
  expect([sleeveColumn("left", 1), sleeveColumn("right", 1)]).toEqual([0, 2]);
  // Forward and back alternate between the middle and the right column
  expect([sleeveColumn("forward", 0), sleeveColumn("back", 0)]).toEqual([1, 1]);
  expect([sleeveColumn("forward", 1), sleeveColumn("back", 1)]).toEqual([2, 2]);
  // Pokeholes off forward and back only away from the stairs (their right)
  expect([pokeSides("forward", 1), pokeSides("back", 1)]).toEqual([[1], [-1]]);
  // The floors dug before keep the older room: the first floor here was
  expect([roomBeside(0, 1), roomBeside(1, 1)]).toEqual([false, true]);
  // No room cell in the stairs' own column but the landing, the step in and the step down
  const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
  const hub = new Vec3(0, 40, 0);
  const cells = floorCells(hub, "south", 1);
  const has = (x: number, y: number, z: number) => cells.some((c: { x: number; y: number; z: number }) => c.x === x && c.y === y && c.z === z);
  // South: right is west (-x). The room spans x 0..-2, z -1..1
  expect(has(-1, 40, 0) && has(-2, 40, 1) && has(-2, 40, -1)).toBe(true);
  // Nothing on the stairs' left but the left sleeve leaving the landing (east, +x)
  expect(has(1, 40, 0)).toBe(true);
  expect(has(1, 40, 1) || has(1, 40, -1)).toBe(false);
});

test("floors: at the stairs' bottom, then every 10 steps deeper (owner)", () => {
  expect([0, 1, 2].map(hubStep)).toEqual([MINE_DEPTH, MINE_DEPTH + LEVEL_STEP, MINE_DEPTH + 2 * LEVEL_STEP]);
});

test("paving: every step below the doorway, hubs and the bottom step too", () => {
  // Owner: a flat hub between paved steps is a step and a half up, which no one can walk
  // Stairs down to the first hub (steps 0..10): steps 1..10 (10 is the hub, paved from its forward tunnel)
  expect(stepsToPave(11)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // Dug on to the second hub (steps 0..30): both hubs paved, the doorway's step never
  const deep = stepsToPave(31);
  expect(deep).not.toContain(0);
  expect(deep).toContain(10);
  expect(deep).toContain(30);
  expect(deep.length).toBe(30);
});

test("the stairs' floors and side walls are kept; hubs stay open to the sides; the doorway is the shelter's", () => {
  // Stairs south from (0, 64, 0): step i stands at (0, 64 - i, i)
  const H = MINE_DEPTH;
  const { keep, walk } = mineStairCells({ x: 0, y: 64, z: 0 }, "south", H + 2, 0);
  const has = (cells: Array<{ x: number; y: number; z: number }>, x: number, y: number, z: number): boolean => cells.some((c) => c.x === x && c.y === y && c.z === z);
  // Step 5: floor under it, walls east and west from floor to the top of its 4-high space
  expect(has(keep, 0, 58, 5)).toBe(true);
  for (const dy of [-1, 0, 1, 2, 3]) {
    expect(has(keep, 1, 59 + dy, 5)).toBe(true);
    expect(has(keep, -1, 59 + dy, 5)).toBe(true);
  }
  // The roof over each step, all the way down (owner: sealed off from
  // caves); past the hub it sits above the 2-high forward tunnel, not in it
  expect(has(keep, 0, 63, 5)).toBe(true);
  expect(has(keep, 0, 64 - (H + 1) + 4, H + 1)).toBe(true);
  expect(has(keep, 0, 64 - H, H + 1) || has(keep, 0, 65 - H, H + 1)).toBe(false); // the tunnel's own space
  // Never the step's own cells (it walks there) nor the doorway
  expect(has(keep, 0, 59, 5)).toBe(false);
  expect(has(keep, 0, 63, 0)).toBe(false);
  // The hub (the first floor's step): floor kept, sides open for the right and left tunnels
  expect(has(keep, 0, 63 - H, H)).toBe(true);
  expect(has(keep, 1, 64 - H, H)).toBe(false);
  expect(has(walk, 0, 59, 5)).toBe(true);
  expect(has(walk, 0, 62, 5)).toBe(true); // 4 high (owner: 3 was too low)
});

test("the ground over its home is protected up to over the surface, its own open cells never", async () => {
  const { overburden } = await import(`${ROOT}/src/actions/building.ts`);
  const { Vec3 } = await import(`${ROOT}/node_modules/vec3`);
  // A room cell at y 57 with its roof at 60; the surface at 62
  const open = [new Vec3(7, 57, 8), new Vec3(7, 58, 8), new Vec3(7, 59, 8)];
  const shell = [new Vec3(7, 60, 8)];
  const cells = overburden(open, shell, 63);
  expect(cells.map((c: any) => c.y)).toEqual([61, 62, 63]);
  expect(cells.some((c: any) => c.y <= 59)).toBe(false);
});

test("not down the mine hurt or without food", async () => {
  const { fitForTheMine } = await import(`${ROOT}/src/skills/mine.ts`);
  expect(fitForTheMine(20, 20).ok).toBe(true);
  expect(fitForTheMine(12, 6).ok).toBe(true);
  const hurt = fitForTheMine(9, 20);
  expect(hurt.ok).toBe(false);
  expect(hurt.detail).toContain("hurt");
  const hungry = fitForTheMine(20, 3);
  expect(hungry.ok).toBe(false);
  expect(hungry.reason).toBe("missing_items");
});

test("the stairs down to the shelter are part of its shell: floor, side walls and roof below the surface", async () => {
  const { stairsShell } = await import(`${ROOT}/src/actions/building.ts`);
  const { Vec3 } = await import(`${ROOT}/node_modules/vec3`);
  // Two steps going +x from the surface at y=64, 2 cells tall
  const stairs = [new Vec3(0, 64, 0), new Vec3(0, 65, 0), new Vec3(1, 63, 0), new Vec3(1, 64, 0)];
  const shell = stairsShell(stairs, [], new Vec3(0, 0, 1), 64);
  const has = (x: number, y: number, z: number) => shell.some((p: { x: number; y: number; z: number }) => p.x === x && p.y === y && p.z === z);
  expect(has(0, 63, 0)).toBe(true); // floor under the top step
  expect(has(1, 62, 0)).toBe(true); // floor under the second step
  expect(has(1, 63, 1) && has(1, 63, -1)).toBe(true); // side walls below the surface
  expect(has(0, 64, 1)).toBe(false); // at the surface: the open world, not a wall
  expect(has(1, 64, 0)).toBe(false); // a stair cell is never part of the shell
});

test("the shelter's shell keeps its doorways' floors but never closes the way through", async () => {
  const { shelterPlan } = await import(`${ROOT}/src/actions/building.ts`);
  const plan = shelterPlan({ x: 0, y: 64, z: 0 }, "south");
  const key = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
  const shell = new Set(plan.shell.map(key));
  // Nothing it walks through is ever a wall to build
  for (const c of plan.cells) expect(shell.has(key(c))).toBe(false);
  // The doorways stand on kept floor
  expect(shell.has(key(plan.entrance.offset(0, -1, 0)))).toBe(true);
  expect(shell.has(key(plan.exit.offset(0, -1, 0)))).toBe(true);
  // Beyond the exit is the mine's first step: open, not a wall
  const along = plan.exit.minus(plan.exit.offset(0, 0, -1)); // south: +z
  expect(shell.has(key(plan.exit.plus(along)))).toBe(false);
});

test("stair care digs out fallen gravel, never its own paving or anything built", async () => {
  const { fillsStep } = await import(`${ROOT}/src/skills/mine.ts`);
  expect(fillsStep({ name: "gravel", boundingBox: "block" })).toBe(true);
  expect(fillsStep({ name: "stone", boundingBox: "block" })).toBe(true);
  expect(fillsStep({ name: "cobblestone_stairs", boundingBox: "block" })).toBe(false); // its paving
  expect(fillsStep({ name: "oak_planks", boundingBox: "block" })).toBe(false); // built
  // Its own blocks left in a step (a plug, one put under its feet) make it 2 high: dug out (owner)
  expect(fillsStep({ name: "cobbled_deepslate", boundingBox: "block" })).toBe(true);
  expect(fillsStep({ name: "air", boundingBox: "empty" })).toBe(false);
  expect(fillsStep({ name: "torch", boundingBox: "empty" })).toBe(false);
});

test("a long trip to the surface from down in its home starts up its stairs", async () => {
  // Game test: off to a chicken in a field it went down its mine and dug along at y 5
  const { startsOutByTheFront } = await import(`${ROOT}/src/actions/movement.ts`);
  const top = { x: 0, y: 64, z: 0 };
  // Down in its mine, off to a field 100 blocks away
  expect(startsOutByTheFront({ x: 5, y: 40, z: 10 }, top, { x: 100, y: null, z: 0 }, 100)).toBe(true);
  // Already on the surface: no
  expect(startsOutByTheFront({ x: 5, y: 64, z: 10 }, top, { x: 100, y: null, z: 0 }, 100)).toBe(false);
  // Going somewhere deep (its mine's tunnels): no
  expect(startsOutByTheFront({ x: 5, y: 40, z: 10 }, top, { x: 30, y: 10, z: 0 }, 40)).toBe(false);
  // A short way: no
  expect(startsOutByTheFront({ x: 5, y: 40, z: 10 }, top, { x: 20, y: null, z: 0 }, 15)).toBe(false);
});

test("the way up from down in its mine starts at the nearest step of its stairs", async () => {
  const { nearestStairStep } = await import(`${ROOT}/src/skills/mine.ts`);
  // Stairs south from (0, 64, 0): step i at (0, 64 - i, i)
  expect(nearestStairStep({ x: 0, y: 44, z: 20 }, { x: 0, y: 64, z: 0 }, "south", 40)).toBe(20);
  // In a side tunnel off step 30, 10 blocks out
  expect(nearestStairStep({ x: 10, y: 34, z: 30 }, { x: 0, y: 64, z: 0 }, "south", 40)).toBe(30);
  // No stairs: none
  expect(nearestStairStep({ x: 0, y: 0, z: 0 }, { x: 0, y: 64, z: 0 }, "south", 0)).toBeNull();
});

test("paving: every bare step and 10% spare, at least one (owner)", async () => {
  const { stairsToMake } = await import(`${import.meta.dir}/../src/skills/mine.ts`);
  expect(stairsToMake(0)).toBe(0);
  expect(stairsToMake(10)).toBe(11);
  expect(stairsToMake(47)).toBe(52);
  expect(stairsToMake(3)).toBe(4);
});

test("stairs that turn at a hub go the new way from there (owner: blocked, turn at the crossroad)", async () => {
  const { stepAt, dirAt, hubStep } = await import(`${ROOT}/src/skills/mine.ts`);
  const start = { x: 0, y: 64, z: 0 };
  const h = hubStep(1); // 30
  const turns = [{ at: h, dir: "east" as const }];
  // Up to the hub: straight south and down
  expect(stepAt(start, "south", h, turns).toArray()).toEqual([0, 64 - h, h]);
  expect(dirAt("south", h, turns)).toBe("south");
  // After it: east and down
  expect(dirAt("south", h + 1, turns)).toBe("east");
  expect(stepAt(start, "south", h + 3, turns).toArray()).toEqual([3, 64 - h - 3, h]);
});

test("blocked stairs: right, then left from the same crossroad, then one crossroad higher (owner)", async () => {
  const { nextTurn, hubStep } = await import(`${ROOT}/src/skills/mine.ts`);
  // Going south; level 1 hub's stairs south hit the sea
  let t = nextTurn("south", [], {}, 1, "south");
  expect(t).toEqual({ level: 1, dir: "west", out: "south" }); // right of south is west
  // That's blocked too: the left
  t = nextTurn("south", [{ at: hubStep(1), dir: "west" }], { [String(hubStep(1))]: ["south", "west"] }, 1, "west");
  expect(t).toEqual({ level: 1, dir: "east", out: "west" });
  // Left blocked as well: one crossroad higher, its right
  t = nextTurn("south", [{ at: hubStep(1), dir: "east" }], { [String(hubStep(1))]: ["south", "west", "east"] }, 1, "east");
  expect(t).toEqual({ level: 0, dir: "west", out: "south" });
  // Every way from every crossroad tried: none
  const all = { [String(hubStep(0))]: ["south", "west", "east"], [String(hubStep(1))]: ["south", "west", "east"] };
  expect(nextTurn("south", [{ at: hubStep(0), dir: "east" }], all, 0, "east")).toBeNull();
});

test("a turn's record: stairs end at the hub, the new way from it, tried kept above (review)", async () => {
  const { planTurn, hubStep } = await import(`${ROOT}/src/skills/mine.ts`);
  const h0 = hubStep(0);
  const h1 = hubStep(1);
  // Level 1's stairs south blocked: right (west) from hub 1
  let p = planTurn({ direction: "south", turns: [], tried: {} }, 1, "south");
  expect(p).toMatchObject({ level: 1, dir: "west", hubAt: h1, stairs: h1 + 1, turns: [{ at: h1, dir: "west" }] });
  expect(p!.tried[String(h1)]).toEqual(["south", "west"]);
  // West and east blocked there too: back to hub 0; what was tried at hub 1 is forgotten (it moves)
  p = planTurn({ direction: "south", turns: [{ at: h1, dir: "east" }], tried: { [String(h1)]: ["south", "west", "east"] } }, 1, "east");
  expect(p).toMatchObject({ level: 0, dir: "west", hubAt: h0, stairs: h0 + 1, turns: [{ at: h0, dir: "west" }] });
  expect(Object.keys(p!.tried)).toEqual([String(h0)]);
});

test("one turn: the steps after it have side walls along the way the stairs came in (review)", async () => {
  const { mineStairCells, hubStep, stepAt } = await import(`${ROOT}/src/skills/mine.ts`);
  const start = { x: 0, y: 64, z: 0 };
  const h = hubStep(0);
  const turns = [{ at: h, dir: "east" as const }];
  const { keep } = mineStairCells(start, "south", h + 3, 0, turns);
  const s = stepAt(start, "south", h + 2, turns);
  const has = (x: number, y: number, z: number) => keep.some((c: { x: number; y: number; z: number }) => c.x === x && c.y === y && c.z === z);
  // Going east: its side walls are north and south of it
  expect(has(s.x, s.y, s.z - 1) && has(s.x, s.y, s.z + 1)).toBe(true);
  // ... and not east or west of it (that's the way along the stairs)
  expect(has(s.x + 1, s.y + 1, s.z)).toBe(false);
});

test("no way deeper: side routes every 3 blocks off each tunnel, both sides (owner)", async () => {
  const { sideRoutes, ARM_LENGTH } = await import(`${ROOT}/src/skills/mine.ts`);
  const r = sideRoutes();
  expect(r[0]).toEqual({ arm: "forward", at: 3, side: "right" });
  expect(r[1]).toEqual({ arm: "forward", at: 3, side: "left" });
  expect(r.length).toBe(4 * Math.floor(ARM_LENGTH / 3) * 2);
});

test("the stairs are roofed all the way down, but never where a hub's tunnel runs over them (owner: seal them off from caves)", async () => {
  const { mineStairCells, hubStep, stepAt } = await import(`${ROOT}/src/skills/mine.ts`);
  const start = { x: 0, y: 64, z: 0 };
  const h = hubStep(0);
  // (the older room round the stairs: sideFrom past every floor)
  const { keep } = mineStairCells(start, "south", h + 12, 0, [], Infinity);
  const has = (p: { x: number; y: number; z: number }) => keep.some((c: { x: number; y: number; z: number }) => c.x === p.x && c.y === p.y && c.z === p.z);
  // Deep below the hub: roofed
  const deep = stepAt(start, "south", h + 10);
  expect(has(deep.offset(0, 4, 0))).toBe(true);
  // The floor's room (3 by 3, 3 high round the stairs) is never part of the shell
  const hub = stepAt(start, "south", h);
  for (const [dx, dz] of [[1, 0], [-1, 0], [1, 1], [-1, -1]]) expect(has(hub.offset(dx, 1, dz))).toBe(false);
  // The forward sleeve leaves from the left column (1st floor): its space isn't shell either
  expect(has(hub.offset(1, 0, 3)) || has(hub.offset(1, 1, 3))).toBe(false); // south: left is east (+x)
});

test("water or lava at the next step stops the stairs (they turn: owner)", async () => {
  const { liquidAtStep } = await import(`${ROOT}/src/skills/mine.ts`);
  const s = { x: 0, y: 10, z: 0 };
  const at = (wx: number, wy: number, wz: number, name: string) => (x: number, y: number, z: number) => (x === wx && y === wy && z === wz ? name : "stone");
  expect(liquidAtStep(s, () => "stone")).toBeNull();
  expect(liquidAtStep(s, at(1, 12, 0, "water"))).toBe("water"); // beside its walking space
  expect(liquidAtStep(s, at(0, 14, 0, "lava"))).toBe("lava"); // over its roof cell
  expect(liquidAtStep(s, at(0, 9, 0, "water"))).toBe("water"); // under its floor
  expect(liquidAtStep(s, at(2, 10, 0, "water"))).toBeNull(); // two blocks off: fine
});

test("the mine's openings to the outside are found (a canyon), a cave that stays underground isn't (owner)", async () => {
  const { outsideOpenings } = await import(`${ROOT}/src/skills/mine.ts`);
  const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
  // A sleeve along x at y 10..11, z 0
  const open = [];
  for (let x = 0; x < 10; x++) open.push(new Vec3(x, 10, 0), new Vec3(x, 11, 0));
  const inOpen = (p: { x: number; y: number; z: number }) => p.z === 0 && p.x >= 0 && p.x < 10 && (p.y === 10 || p.y === 11);
  // A canyon at z = 1 for x 6..8, open up to the sky from y 10
  const canyon = (p: { x: number; y: number; z: number }) => p.z === 1 && p.x >= 6 && p.x <= 8 && p.y >= 10;
  // A closed cave at z = -1 for x 1..2, y 10..11
  const cave = (p: { x: number; y: number; z: number }) => p.z === -1 && p.x >= 1 && p.x <= 2 && p.y >= 10 && p.y <= 11;
  const look = (p: { x: number; y: number; z: number }) => {
    if (inOpen(p)) return { solid: false, liquid: false, sky: false };
    if (canyon(p)) return { solid: false, liquid: false, sky: p.y >= 20 };
    if (cave(p)) return { solid: false, liquid: false, sky: false };
    return { solid: true, liquid: false, sky: false };
  };
  const found = outsideOpenings(open, look).map((p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`).sort();
  expect(found).toEqual(["6,10,1", "6,11,1", "7,10,1", "7,11,1", "8,10,1", "8,11,1"]);
});

test("every ore the tunnels uncovered is found, in walls and ceilings (owner: coal left in the ceiling)", async () => {
  const { exposedOres } = await import(`${ROOT}/src/skills/mine.ts`);
  const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
  const open = [new Vec3(0, 10, 0), new Vec3(0, 11, 0), new Vec3(1, 10, 0), new Vec3(1, 11, 0)];
  const names: Record<string, string> = { "0,12,0": "coal_ore", "1,11,1": "iron_ore", "2,10,0": "deepslate_copper_ore", "0,13,0": "coal_ore" };
  const found = exposedOres(open, (p: { x: number; y: number; z: number }) => names[`${p.x},${p.y},${p.z}`] ?? "stone").map((p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`).sort();
  // The ceiling coal, the wall iron, the copper ahead; the coal behind the ceiling one waits until it's uncovered
  expect(found).toEqual(["0,12,0", "1,11,1", "2,10,0"]);
});
