// Phase 8: companion roles. A role is a standing order with each job's
// usual radius and stance; the guard never fights a player, a pet, a
// villager, a golem or a creeper; outdoor jobs rest at night; the hauler
// gives each kind of thing one chest; the builder clears top-down and
// builds bottom-up, and says what it's short of.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { makeRole, describeRole } = await import(`${ROOT}/src/roles/role.ts`);
const { mayFight } = await import(`${ROOT}/src/roles/guard.ts`);
const { onShiftNow, backoffMs } = await import(`${ROOT}/src/roles/runner.ts`);
const { cropBlocksFor } = await import(`${ROOT}/src/roles/farmer.ts`);
const { oreFor } = await import(`${ROOT}/src/roles/miner.ts`);
const { sortPlan, distinctContainers } = await import(`${ROOT}/src/roles/hauler.ts`);
const { blueprintFor, workLeft, materialsShort } = await import(`${ROOT}/src/roles/builder.ts`);

test("a role takes each job's usual radius and stance unless the owner said otherwise", () => {
  const guard = makeRole("guard", { at: 1 });
  expect([guard.radius, guard.stance, guard.anchor]).toEqual([16, "follow", null]);
  const farmer = makeRole("farmer", { anchor: { x: 1, y: 64, z: 2, dimension: "overworld" }, radius: 20, target: "wheat", storage: { x: 3, y: 64, z: 2 }, at: 1 });
  expect(farmer.radius).toBe(20);
  expect(describeRole(farmer)).toBe("I'm your farmer (wheat) at 1, 64, 2: I harvest and replant the field and put the crops in the chest; results go in the chest at 3, 64, 2.");
  expect(describeRole(null)).toBe("I have no job right now.");
});

test("the guard fights hostile mobs only: never players, pets, villagers, golems, creepers or neutral mobs", () => {
  const hostile = (n: string) => ["zombie", "skeleton", "creeper", "spider", "enderman", "zombified_piglin", "piglin", "warden"].includes(n);
  expect(["zombie", "skeleton", "spider"].every((n) => mayFight(n, hostile, true))).toBe(true);
  expect(["creeper", "player", "wolf", "cat", "villager", "iron_golem", "cow", undefined].some((n) => mayFight(n as any, hostile, true))).toBe(false);
  // Neutral: attacking one starts a war (a pigman war in the Nether)
  expect(["enderman", "zombified_piglin", "piglin", "warden"].some((n) => mayFight(n, hostile, true))).toBe(false);
  // Spiders leave players alone by day
  expect(mayFight("spider", hostile, false)).toBe(false);
});

test("failed shifts back off: 30 s, doubling, at most 10 minutes", () => {
  expect([0, 1, 2, 3, 10].map(backoffMs)).toEqual([0, 30_000, 60_000, 120_000, 600_000]);
});

test("a double chest is one container (its second half left out)", () => {
  const kept = distinctContainers([
    { x: 0, y: 64, z: 0, double: true },
    { x: 1, y: 64, z: 0, double: true },
    { x: 5, y: 64, z: 0, double: false },
    { x: 6, y: 64, z: 0, double: false },
  ]);
  expect(kept.map((c: any) => c.x)).toEqual([0, 5, 6]);
});

test("outdoor jobs rest at night; the guard and the miner work on", () => {
  expect(onShiftNow("farmer", true)).toBe(false);
  expect(onShiftNow("builder", true)).toBe(false);
  expect(onShiftNow("guard", true)).toBe(true);
  expect(onShiftNow("miner", true)).toBe(true);
  expect(onShiftNow("farmer", false)).toBe(true);
});

test("crops and ores by the owner's words; a word it doesn't know is refused, never guessed", () => {
  expect(cropBlocksFor("carrot")).toEqual(["carrots"]);
  expect(cropBlocksFor(null)).toBeNull();
  expect(cropBlocksFor("bananas")).toBe("unknown");
  const drops = (i: string) => ["redstone", "lapis_lazuli", "raw_copper"].includes(i);
  expect([oreFor("iron", drops), oreFor("diamonds", drops), oreFor(null, drops), oreFor("redstone", drops), oreFor("copper", drops), oreFor("unobtainium", drops)]).toEqual([
    "raw_iron", "diamond", "raw_iron", "redstone", "raw_copper", null,
  ]);
});

test("sorting: each kind goes to the chest that has the most of it; one kind per chest", () => {
  const cat = (n: string) => (n.endsWith("_log") ? "wood" : n === "bread" || n === "apple" ? "food" : "stone");
  const { home, moves } = sortPlan(
    [
      { key: "A", contents: { oak_log: 30, bread: 2 } },
      { key: "B", contents: { bread: 10, cobblestone: 5 } },
      { key: "C", contents: { cobblestone: 60, birch_log: 4 } },
    ],
    cat
  );
  expect(Object.fromEntries(home)).toEqual({ stone: "C", wood: "A", food: "B" });
  expect(moves).toEqual([
    { from: "A", to: "B", name: "bread", count: 2 },
    { from: "B", to: "C", name: "cobblestone", count: 5 },
    { from: "C", to: "A", name: "birch_log", count: 4 },
  ]);
  expect(sortPlan([{ key: "A", contents: { oak_log: 3 } }, { key: "B", contents: { bread: 1 } }], cat).moves).toEqual([]);
});

test("the hut has a doorway; the builder clears terrain top-down, builds bottom-up, outer edge first, and counts what it's short of", () => {
  const { plan } = blueprintFor("hut");
  const at = (dx: number, dy: number, dz: number) => plan.blocks.find((b: any) => b.dx === dx && b.dy === dy && b.dz === dz)?.name;
  expect([at(0, 0, -2), at(0, 1, -2), at(0, 2, -2), at(2, 0, 0), at(0, 3, 0)]).toEqual(["air", "air", "cobblestone", "cobblestone", "oak_planks"]);
  expect(blueprintFor("castle").name).toBe("hut");
  // An empty field with a stone in the middle of the hut
  const left = workLeft(plan, (b: any) => (b.dx === 0 && b.dz === 0 && b.dy === 0 ? "stone" : "air"));
  expect(left.clear.map((b: any) => [b.dx, b.dy, b.dz])).toEqual([[0, 0, 0]]);
  expect(left.place[0].dy).toBe(0);
  const roof = left.place.filter((b: any) => b.dy === 3);
  expect(Math.max(Math.abs(roof[0].dx), Math.abs(roof[0].dz))).toBe(2); // the roof's edge first
  expect([roof.at(-1).dx, roof.at(-1).dz]).toEqual([0, 0]);
  const short = materialsShort(left.place, (n: string) => (n === "cobblestone" ? 10 : 0));
  expect(short.get("oak_planks")).toBe(25);
  // Built already: nothing left
  expect(workLeft(plan, (b: any) => b.name)).toEqual({ clear: [], fill: [], place: [], blocked: [] });
});

test("the builder never breaks what isn't terrain: the owner's chest in the way is reported, water is filled", () => {
  const { plan } = blueprintFor("hut");
  const natural = (n: string) => n === "dirt" || n === "stone";
  const left = workLeft(
    plan,
    (b: any) => (b.dx === 2 && b.dz === 0 && b.dy === 0 ? "chest" : b.dx === -2 && b.dz === 0 && b.dy === 0 ? "water" : b.dx === 0 && b.dz === 0 && b.dy === 0 ? "short_grass" : "air"),
    natural
  );
  expect(left.blocked.map((x: any) => x.name)).toEqual(["chest"]);
  expect(left.place.some((b: any) => b.dx === 2 && b.dz === 0 && b.dy === 0)).toBe(false); // nothing goes in its spot
  expect(left.fill.map((b: any) => [b.dx, b.dz])).toEqual([[-2, 0]]);
  expect(left.clear.map((b: any) => [b.dx, b.dz])).toEqual([[0, 0]]); // grass is cleared
});
