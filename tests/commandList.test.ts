// The one command list (src/commands/all.ts) gives the names, the registry and the model's tools.
import { expect, test } from "bun:test";
import { useFakeBot } from "./fakeBody";
useFakeBot({});
test("every command in commands/all.ts is registered under its camelCase name (loaded the way the app loads it)", async () => {
  for (const m of ["../src/managers/actionManager", "../src/managers/chatGateway", "../src/managers/aiManager"]) await import(m);
  const r = await import("../src/commands/registry");
  const t = await import("../src/commands/types");
  expect(Object.keys(r.commandRegistry).length).toBe(57);
  expect(r.isBotAction("setBase")).toBe(true);
  expect(r.isBotAction("nope")).toBe(false);
  expect(t.BotCommands.HomeChores).toBe("homeChores");
  expect(r.availableCommands.length).toBe(57);
});
