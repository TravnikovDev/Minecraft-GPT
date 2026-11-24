# Real-game test checklist

Run this in **your own Minecraft world** after every phase of the [implementation plan](../reports/Implementation%20plan.md). The bot connects to your game; you play as the owner.

## Setup

- [ ] **Version.** The world runs Minecraft **26.1 or older**. mineflayer 4.39 does not support 26.2 or 26.3 yet; the bot refuses to connect to them.
- [ ] **How the bot joins.** Pick one:
  - **Local server** with `online-mode=false` in `server.properties`. Use `AUTH=offline`, and add the bot to the whitelist if one is on (it is on by default from 26.3).
  - **LAN world ("Open to LAN").** Vanilla LAN likely requires a real account: use `AUTH=microsoft` with a second Minecraft account, or a mod that turns online mode off. *(unconfirmed)*
- [ ] **`.env` is filled in** (see `.env.example`): `OPENAI_API_KEY`, `OWNER_USERNAME` (your exact Minecraft name), `BOT_USERNAME`, `SERVER_HOST`, `SERVER_PORT`, `AUTH`. A missing or invalid value stops the bot with a clear message.
- [ ] **Start the bot:** `bun run src/index.ts`. The log prints `Owner: <your name>` and `Bot spawned and initialized successfully (Minecraft <version>)`.

## Phase 0: owner control and baseline

| # | Do this | Expect |
|---|---|---|
| 1 | Another player (or a second account) types "come here" | The bot ignores it; the log says `Ignoring chat from …` |
| 2 | You type `status` | An instant reply: what it's doing, health, food, position. No LLM call in the log |
| 3 | You type `come here` | "Coming!", and it walks to you |
| 4 | You type `follow me`, then walk around | "Following you!", and it keeps up |
| 5 | You type `stop` | "Standing still!" within about a second |
| 6 | Turn Wi-Fi off, then `stop`, `come here`, `status` | All three still work (fast path, no internet needed) |
| 7 | Wi-Fi back on: "gather 3 wood" | It gathers 3 logs and reports it |
| 8 | "craft wooden tools" | It crafts a pickaxe and an axe (making a table and planks as needed) |
| 9 | "gather 10 wood", then `stop` after a few seconds | It stops at once and doesn't post a late "failed" message |
| 10 | "you're stuck, move away" | It walks about 10 blocks away and stays responsive (old freeze is gone) |
| 11 | "collect 5 iron" | It does **not** start digging air; it asks or fails clearly (full clarifying replies arrive in Phase 2) |
| 12 | Give it a command that will fail, e.g. craft something impossible | It reports failure once and moves on (no endless retries in the log) |
| 13 | Let it drown or get killed | It respawns by itself and keeps listening |
| 14 | Restart the bot process while it has queued work | On restart nothing resumes by itself; remembered base and chests are kept |
| 15 | Restart your server while the bot is online | The log shows `Reconnecting in 5s…`, and it rejoins on its own |

### Phase 0 run: 2026-11-24 (Minecraft 1.20.4 LAN world, `AUTH=offline`)

| # | Result |
|---|---|
| 1 | ✅ chat from a non-owner name was ignored |
| 2 | ✅ instant, no LLM call; reports the owner's distance |
| 3 | ✅ "You have reached Travnikov" (only within walking range; a ~1,400-block trip times out, see Phase 3) |
| 4 | ✅ followed the owner about 45 blocks |
| 5 | ✅ instant |
| 6 | ⬜ not run (Wi-Fi off) |
| 7 | ✅ gathered logs (5 of 12 before the stop test) |
| 8 | ✅ crafted an iron pickaxe, axe and sword (after fixing the craft-count bug); `craftItem` does not make missing sticks by itself yet (Phase 6) |
| 9 | ✅ "Wood gathering cancelled", no late message |
| 10 | ⬜ not run in the real world (passed on the local test server) |
| 11 | ✅ an unknown name (`bed`) fails cleanly instead of searching for air |
| 12 | ✅ failed once, no retry loop |
| 13 | ⬜ not run |
| 14 | ✅ queue empty on every restart |
| 15 | ✅ reconnected after a server kick (a crash in the stuck-watcher was found and fixed) |

**Notes:** the offline login works on this LAN world. After a restart the bot may be far from the owner; `come here` only works within walking range until long trips are split into legs (Phase 3).

## Later phases

Each phase in the implementation plan lists its own **In-game check**. Add those rows here as each phase lands.
