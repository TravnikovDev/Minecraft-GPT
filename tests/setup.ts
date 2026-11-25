// Runs before every test file (bunfig.toml): the bot's memory goes to a
// throwaway file, never the real db.json the owner's bot uses.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "minecraft-gpt-test-")), "db.json");
