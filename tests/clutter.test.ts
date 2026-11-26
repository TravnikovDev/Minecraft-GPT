// Path: tests/clutter.test.ts
// Full pockets: the mining clutter goes first, never what it uses (owner:
// it left a sheep's wool and meat on the ground, full of andesite).
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
const ROOT = `${import.meta.dir}/..`;
useFakeBot({});
const { CLUTTER } = await import(`${ROOT}/src/actions/pickup.ts`);

test("clutter: andesite, diorite, granite, tuff, gravel, rotten flesh; never cobblestone, dirt, ores or food", () => {
  for (const n of ["andesite", "diorite", "granite", "tuff", "gravel", "rotten_flesh", "dripstone_block"]) expect(CLUTTER.test(n)).toBe(true);
  for (const n of ["cobblestone", "cobbled_deepslate", "dirt", "raw_iron", "coal", "white_wool", "mutton", "wheat_seeds", "flint"]) expect(CLUTTER.test(n)).toBe(false);
});
