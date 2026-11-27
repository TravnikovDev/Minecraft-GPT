// Runs before every test file (bunfig.toml): the bot's memory goes to a
// throwaway file, never the real db.json the owner's bot uses, and no test
// ever calls the model.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "minecraft-gpt-test-"));
process.env.DB_PATH = join(dir, "db.json");
// Never a real model call from a test: a cap of $0 stops every call (the
// planner made real calls from the curriculum tests before), and spending is
// counted in a throwaway file, never the owner's usage.json
process.env.LLM_MONTHLY_CAP_USD = "0";
// Its own life is on by default in the game; tests turn it on themselves when they need it
process.env.AUTONOMY = "off";
process.env.USAGE_PATH = join(dir, "usage.json");
