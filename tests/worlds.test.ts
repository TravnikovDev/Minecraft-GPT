// Memory is kept per world: the server's hashed seed names the world; each
// world has its own file, and going back to a world brings its memory back.
// Nothing is saved before a world is known.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
const ROOT = `${import.meta.dir}/..`;
const P = require(`${ROOT}/src/managers/persistenceManager.ts`);

test("the world id comes from the hashed seed, however protodef hands it over", () => {
  expect(P.worldIdFrom([0x12345678, 0x9abcdef0 | 0])).toBe("123456789abcdef0");
  expect(P.worldIdFrom([-1, -1])).toBe("ffffffffffffffff"); // a negative seed is the same 64 bits
  expect(P.worldIdFrom(5n)).toBe("0000000000000005");
  expect(P.worldIdFrom(undefined)).toBeNull();
});

test("each world remembers its own things; going back brings them back", async () => {
  await P.useWorld("aaaa000000000001");
  await P.addPlace({ kind: "base", name: "base", x: 1, y: 64, z: 1 });
  expect(P.getBaseLocation()).toMatchObject({ x: 1 });

  await P.useWorld("bbbb000000000002");
  expect(P.getBaseLocation()).toBeUndefined(); // a new world starts empty
  await P.addPlace({ kind: "base", name: "base", x: 99, y: 70, z: -5 });

  await P.useWorld("aaaa000000000001");
  expect(P.getBaseLocation()).toMatchObject({ x: 1, y: 64, z: 1 });
  expect(P.currentWorldId()).toBe("aaaa000000000001");
  const dir = join(dirname(process.env.DB_PATH!), "worlds");
  expect(existsSync(join(dir, "aaaa000000000001.json"))).toBe(true);
  expect(existsSync(join(dir, "bbbb000000000002.json"))).toBe(true);
});
