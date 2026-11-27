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

test("floors (owner's plan): the room ahead of the stairs' end, sleeves off its middle line and its side rows, pokes every 3 both sides", async () => {
  const { ROOM_CELLS, sleeveStart, sleeveBase, POKE_SIDES, POKE_EVERY, POKE_LENGTH, SLEEVE_HEIGHT, ROOM_HEIGHT, floorCells, floorName, STAIR_HEADROOM } = await import(`${ROOT}/src/skills/mine.ts`);
  const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
  // 3 by 3, from the stairs' end (along 0) forward (along 2), across -1..1
  expect(ROOM_CELLS.length).toBe(9);
  expect(ROOM_CELLS.every(([a, b]: number[]) => Math.abs(a) <= 1 && b >= 0 && b <= 2)).toBe(true);
  // Left and right from the middle line; back along the left row, forward along the right row
  expect([sleeveStart("left"), sleeveStart("right"), sleeveStart("back"), sleeveStart("forward")]).toEqual([[-1, 1], [1, 1], [-1, 0], [1, 2]]);
  expect([POKE_SIDES, POKE_EVERY, POKE_LENGTH, SLEEVE_HEIGHT, ROOM_HEIGHT, STAIR_HEADROOM + 1]).toEqual([[1, -1], 3, 5, 3, 3, 5]);
  // Arriving east at (0, 40, 0): right is south (+z)
  const hub = new Vec3(0, 40, 0);
  expect(sleeveBase(hub, "east", "forward").toArray()).toEqual([2, 40, 1]);
  expect(sleeveBase(hub, "east", "back").toArray()).toEqual([0, 40, -1]);
  const cells = floorCells(hub, "east");
  const has = (x: number, y: number, z: number) => cells.some((c: { x: number; y: number; z: number }) => c.x === x && c.y === y && c.z === z);
  // The room, 3 high; nothing behind the stairs' end on its own line (that's the stairs)
  expect(has(1, 40, 0) && has(1, 42, 0) && !has(1, 43, 0)).toBe(true);
  expect(has(-1, 40, 0)).toBe(false);
  // Forward sleeve on the right row, 3 high; its first poke 3 along, 5 each side
  expect(has(3, 40, 1) && has(3, 42, 1)).toBe(true);
  expect(has(5, 40, 6) && has(5, 40, -4)).toBe(true);
  // Back sleeve on the left row, back past the stairs; a poke 3 back
  expect(has(-1, 40, -1) && has(-3, 40, -6)).toBe(true);
  // Left and right from the middle line
  expect(has(1, 40, -2) && has(1, 40, 2)).toBe(true);
  expect([0, 1, 2, 3, 10].map(floorName)).toEqual(["1st floor", "2nd floor", "3rd floor", "4th floor", "11th floor"]);
  // What's mended (owner: the sleeves' floor, never the pokeholes'): no pokes
  const mended = floorCells(hub, "east", 0, true, undefined, false);
  const inMended = (x: number, y: number, z: number) => mended.some((c: { x: number; y: number; z: number }) => c.x === x && c.y === y && c.z === z);
  expect(inMended(3, 40, 1) && inMended(1, 40, 0)).toBe(true);
  expect(inMended(5, 40, 6) || inMended(5, 40, -4)).toBe(false);
});

test("floors: at the stairs' bottom, then every 10 blocks deeper; the stairs cross each room flat (owner)", async () => {
  const { stepAt, isFlatStep, FLAT_STEPS } = await import(`${ROOT}/src/skills/mine.ts`);
  const start = { x: 0, y: 64, z: 0 };
  expect(hubStep(0)).toBe(MINE_DEPTH);
  expect(hubStep(1)).toBe(MINE_DEPTH + LEVEL_STEP + FLAT_STEPS);
  expect(stepAt(start, "south", hubStep(1)).y).toBe(stepAt(start, "south", hubStep(0)).y - LEVEL_STEP);
  // The two after the stairs' end are flat (the room's middle and front), then down again
  const h = hubStep(0);
  expect([isFlatStep(h), isFlatStep(h + 1), isFlatStep(h + 2), isFlatStep(h + 3)]).toEqual([false, true, true, false]);
  expect([h, h + 1, h + 2, h + 3].map((i) => stepAt(start, "south", i).y)).toEqual([64 - h, 64 - h, 64 - h, 63 - h]);
});

test("paving: every step below the doorway, hubs and the bottom step too, never the flat part across a room", () => {
  const H = MINE_DEPTH;
  expect(stepsToPave(H + 1)).toEqual(Array.from({ length: H }, (_, i) => i + 1));
  const deep = stepsToPave(hubStep(1) + 1);
  expect(deep).not.toContain(0);
  expect(deep).toContain(H);
  expect(deep).toContain(hubStep(1));
  expect(deep).not.toContain(H + 1);
  expect(deep).not.toContain(H + 2);
});

test("the stairs' floors and side walls are kept; hubs and the room stay open; the doorway is the shelter's", () => {
  // Stairs south from (0, 64, 0): step i stands at (0, 64 - i, i) down to the first floor
  const H = MINE_DEPTH;
  const { keep, walk } = mineStairCells({ x: 0, y: 64, z: 0 }, "south", H + 6, 0);
  const has = (cells: Array<{ x: number; y: number; z: number }>, x: number, y: number, z: number): boolean => cells.some((c) => c.x === x && c.y === y && c.z === z);
  // Step 5: floor under it, walls east and west from floor to the top of its 5-high space, roof over
  expect(has(keep, 0, 58, 5)).toBe(true);
  for (const dy of [-1, 0, 1, 2, 3, 4]) {
    expect(has(keep, 1, 59 + dy, 5)).toBe(true);
    expect(has(keep, -1, 59 + dy, 5)).toBe(true);
  }
  expect(has(keep, 0, 64, 5)).toBe(true);
  // Never the step's own cells nor the doorway
  expect(has(keep, 0, 59, 5)).toBe(false);
  expect(has(keep, 0, 63, 0)).toBe(false);
  // The hub (the stairs' end): floor kept, sides open (the room)
  expect(has(keep, 0, 63 - H, H)).toBe(true);
  expect(has(keep, 1, 64 - H, H)).toBe(false);
  // On down past the room (step H+3, a block lower): its east wall kept;
  // its west side is the forward sleeve (south: right is west), open
  expect(has(keep, 1, 63 - H, H + 3)).toBe(true);
  expect(has(keep, -1, 64 - H, H + 3)).toBe(false);
  expect(has(walk, 0, 59, 5) && has(walk, 0, 63, 5)).toBe(true); // 5 high (owner)
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
  const { stepAt } = await import(`${ROOT}/src/skills/mine.ts`);
  const s30 = stepAt({ x: 0, y: 64, z: 0 }, "south", 30);
  expect(nearestStairStep({ x: 10, y: s30.y, z: 30 }, { x: 0, y: 64, z: 0 }, "south", 40)).toBe(30);
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
  const h = hubStep(1);
  const turns = [{ at: h, dir: "east" as const }];
  // Up to the hub: straight south and down (flat across the first floor's room)
  const y = 64 - (h - 2);
  expect(stepAt(start, "south", h, turns).toArray()).toEqual([0, y, h]);
  expect(dirAt("south", h, turns)).toBe("south");
  // After it: east (flat two, then down)
  expect(dirAt("south", h + 1, turns)).toBe("east");
  expect(stepAt(start, "south", h + 3, turns).toArray()).toEqual([3, y - 1, h]);
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
  const { keep } = mineStairCells(start, "south", h + 5, 0, turns);
  const s = stepAt(start, "south", h + 4, turns);
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

test("the stairs are roofed all the way down, but never where a floor's room or tunnels are (owner: seal them off from caves)", async () => {
  const { mineStairCells, hubStep, stepAt, STAIR_HEADROOM } = await import(`${ROOT}/src/skills/mine.ts`);
  const start = { x: 0, y: 64, z: 0 };
  const h = hubStep(0);
  const { keep } = mineStairCells(start, "south", h + 12, 0);
  const has = (p: { x: number; y: number; z: number }) => keep.some((c: { x: number; y: number; z: number }) => c.x === p.x && c.y === p.y && c.z === p.z);
  // Deep below the room: roofed over its 5-high space
  const deep = stepAt(start, "south", h + 10);
  expect(has(deep.offset(0, STAIR_HEADROOM + 1, 0))).toBe(true);
  // The floor's room (3 by 3 ahead of the stairs' end) is never part of the shell
  const hub = stepAt(start, "south", h);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [1, 2], [-1, 2]]) expect(has(hub.offset(dx, 1, dz))).toBe(false);
  // The forward sleeve (right row: west, -x) isn't shell either
  expect(has(hub.offset(-1, 0, 3)) || has(hub.offset(-1, 1, 3))).toBe(false);
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

test("caves (owner): a pokehole meeting a cave ends there plugged; a sleeve crosses a short gap as a tube and ends at a big cave", async () => {
  const { caveAt, BIG_CAVE } = await import(`${ROOT}/src/skills/mine.ts`);
  const key = (p: any) => `${p.x},${p.y},${p.z}`;
  const east = { x: 1, y: 0, z: 0 };
  const across: any = [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
  const col = { x: 5, y: 40, z: 0 };
  // A cave ahead (the next column is open air)
  const caveCols = (from: number, to: number) => {
    const s = new Set<string>();
    for (let x = from; x <= to; x++) for (let y = 39; y <= 43; y++) for (let z = -3; z <= 3; z++) s.add(key({ x, y, z }));
    return s;
  };
  const small = caveCols(5, 7); // 3 columns across
  const big = caveCols(5, 30);
  const openIn = (s: Set<string>) => (p: any) => s.has(key(p));
  // Pokehole: stops at once, its face (3 high and the floor) to plug
  const poke = caveAt("poke", col, east, across, 3, openIn(small));
  expect(poke.stopBefore).toBe(true);
  expect(poke.before.length).toBe(4);
  // Sleeve, short gap: goes on (a tube); big cave: stops, face plugged
  expect(caveAt("sleeve", col, east, across, 3, openIn(small)).stopBefore).toBe(false);
  const sleeveBig = caveAt("sleeve", col, east, across, 3, openIn(big));
  expect(sleeveBig.stopBefore).toBe(true);
  expect(BIG_CAVE).toBe(7);
  // After a column: cave beside or above. A pokehole stops, a sleeve plugs walls and roof and goes on
  const beside = new Set([key({ x: 5, y: 41, z: 1 }), key({ x: 5, y: 43, z: 0 })]);
  const p2 = caveAt("poke", col, east, across, 3, openIn(beside));
  expect([p2.around.length, p2.stopAfter]).toEqual([2, true]);
  const s2 = caveAt("sleeve", col, east, across, 3, openIn(beside));
  expect([s2.around.length, s2.stopAfter]).toEqual([2, false]);
  // Solid rock all round: nothing
  const none = caveAt("poke", col, east, across, 3, () => false);
  expect([none.stopBefore, none.around.length]).toEqual([false, 0]);
});
