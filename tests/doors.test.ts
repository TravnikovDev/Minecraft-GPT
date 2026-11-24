// Runs the real door opener (actions/doors.ts) against a fake bot and one oak door at (0,64,0) facing north.
import { beforeEach, expect, test } from "bun:test";
import { endConnection, useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
const { EventEmitter } = require("events");
const { Vec3 } = require(`${ROOT}/node_modules/vec3`);
const registry = require(`${ROOT}/node_modules/prismarine-registry`)("1.20.4");
const Block = require(`${ROOT}/node_modules/prismarine-block`)(registry);

let doorOpen = false;
const clicks: string[] = [];
function doorBlock(half: "lower" | "upper"): any {
  const b = Block.fromProperties("oak_door", { half, open: doorOpen, facing: "north", hinge: "left", powered: false }, 0);
  b.position = new Vec3(0, half === "lower" ? 64 : 65, 0);
  return b;
}
const bot: any = new EventEmitter();
bot.entity = { position: new Vec3(0.5, 64, 3.5), yaw: 0 };
bot.blockAt = (q: any) => { const p = { x: Math.floor(q.x), y: Math.floor(q.y), z: Math.floor(q.z) }; return p.x === 0 && p.z === 0 && (p.y === 64 || p.y === 65) ? doorBlock(p.y === 64 ? "lower" : "upper") : null; };
bot.activateBlock = async () => { clicks.push(doorOpen ? "close" : "open"); if (!serverRefuses) doorOpen = !doorOpen; };
let moving = true;
let serverRefuses = false;
bot.pathfinder = { isMoving: () => moving };
useFakeBot(bot);
beforeEach(() => { (globalThis as any).__testBot = bot; });
const { registerDoorOpener } = await import(`${ROOT}/src/actions/doors.ts`);
const { safeMovements, clearSolidDoors } = await import(`${ROOT}/src/core/movements.ts`);
registerDoorOpener();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const at = (x: number, z: number) => { bot.entity.position = new Vec3(x, 64, z); };

test("a closed door the route doesn't go through stays shut", async () => {
  bot.emit("path_update", { path: [{ x: 3.5, y: 64, z: 3.5 }, { x: 4.5, y: 64, z: 1.5 }] }); // walking past, east
  at(0.5, 1.6);
  await wait(400);
  expect(clicks).toEqual([]);
});

test("following the owner: opens the door on the route, keeps it open while waiting on this side", async () => {
  bot.emit("path_update", { path: [{ x: 0.5, y: 64, z: 0.5 }, { x: 0.5, y: 64, z: -2.5 }] }); // through the door, north
  at(0.5, 1.6);
  await wait(400);
  expect(clicks).toEqual(["open"]);
  // goal reached short of the door (follow distance), bot waits 3 blocks away: the door stays open
  moving = false; bot.emit("goal_reached");
  at(0.5, 3.5);
  await wait(400);
  expect(clicks).toEqual(["open"]);
});

test("walking through: closes it once clear on the other side", async () => {
  moving = true;
  bot.emit("path_update", { path: [{ x: 0.5, y: 64, z: 0.5 }, { x: 0.5, y: 64, z: -2.5 }] });
  at(0.5, 0.2); // in the doorway
  await wait(400);
  expect(clicks).toEqual(["open"]);
  moving = false; bot.emit("goal_reached");
  at(0.5, -1.5); // 2 blocks past the middle line
  await wait(400);
  expect(clicks).toEqual(["open", "close"]);
});

test("a door the server won't open becomes a wall to the path search", async () => {
  serverRefuses = true;
  clicks.length = 0;
  moving = true;
  bot.emit("path_update", { path: [{ x: 0.5, y: 64, z: 0.5 }, { x: 0.5, y: 64, z: -2.5 }] });
  at(0.5, 1.6);
  await wait(1200);
  expect(clicks[0]).toBe("open"); // it tried
  expect(doorOpen).toBe(false);
  bot.registry = registry;
  bot.version = "1.20.4";
  bot.supportFeature = () => false;
  bot.world = { getBlock: (p: any) => bot.blockAt(p) };
  const rules = safeMovements(bot);
  const b = rules.getBlock(new Vec3(0, 64, 0), 0, 0, 0);
  expect(b.safe).toBe(false); // no longer treated as open air
  endConnection();
  clearSolidDoors();
});
