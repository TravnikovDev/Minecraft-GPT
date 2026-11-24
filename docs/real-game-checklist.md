# Real-game test checklist

Run this in **your own Minecraft world** after every phase of the [implementation plan](../reports/Implementation%20plan.md). The bot connects to your game; you play as the owner.

Everything not yet seen working in the game is collected in the [testing backlog](testing-backlog.md); start there.

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

### Owner-feedback run: 2026-11-24, second session (same world)

| Check | Result |
|---|---|
| 13: death and respawn | ✅ killed twice (creeper; a fall), respawned by itself and kept listening |
| 6: commands without OpenAI | ✅ on the local server with OpenAI unreachable: stop/status/come instant, AI requests answered with a polite error |
| 10: "you're stuck, move away" | ⬜ the request waited behind wood gathering and was then cleared by `stop`; now fixed to interrupt (commit f2fbf24), needs one more try |
| "where are you" while busy | ✅ instant, with distance and direction |
| Out of sight: asks for coordinates | ✅ whisper asks for F3 coordinates; `X Y Z` starts the trip without the LLM |
| Long trip with progress | ✅ ~1,200 blocks in legs, whispers at 20/40/60/80 %, arrives on the ground |
| Personal updates | ✅ "Got 14 cooked porkchop, thanks!", "I'm wearing golden boots now." |
| Smart crafting | ✅ makes sticks itself, picks stone over wood for "pickaxe", crafts its own table, asks before gathering missing wool |
| Chat pacing | ✅ no more `disconnect.spam` kicks after pacing chat to 1.2 s |

### Phase 1 real-world run: 2026-11-24, third session (same world)

| Check | Result |
|---|---|
| Creeper reflex | ✅ fired and cleared without a death |
| Bed: place, sleep, spawn point | ✅ by day the bot uses the bed and repeats the server's own answer ("Respawn point set" / "only at night"); killed 83 blocks away, it respawned at the bed |
| Death recovery | ✅ walked back 83 blocks and got all 148 items back |
| Drowning | ❌→✅ drowned twice: mineflayer's `oxygenLevel` is overwritten by nearby fish and mobs; the reflex now reads the bot's own air and treads water when idle |
| Mobs while busy | ❌→fixed, not yet re-tested: a spider and a zombie hit the bot while its task cancelled the fight; combat reflex now pauses the task |
| Boat travel | ✅ rowed 258 blocks in one go (the server accepts the bot's own boat moves); a stopped trip now lands and picks up the boat before the next command (not yet re-tested) |
| Riding in the owner's boat | ✅ fixed: come/follow keep it seated; walking gets out of a vehicle first |
| Harvest | ✅ harvested and replanted about 20 crops |
| Cooking | ✅ 9 potatoes on 3 campfires at once, all 9 collected (first version used one campfire and couldn't reach the food) |
| Give with no amount | ❌→fixed, not yet re-tested: "give me dark oak" gave one plank; now gives all |

### Phase 1 real-world run: 2026-11-24, fourth session (same world, village)

| Check | Result |
|---|---|
| Give with no amount | ✅ jungle planks, stone bricks, bricks: each gave everything carried |
| Creeper reflex | ✅ fired and cleared several times while following |
| "Craft armor" | ❌→fixed: made leather horse armor; now "armor"/"iron armor" makes the set, horse armor only on request, odd matches ask "Did you mean ...?" |
| "Craft a helmet" with iron and leather | ❌→fixed: silently picked iron; now asks which one when several can be made |
| Crafting table | ❌→fixed: nearest table was unreachable, so it left its own table next to the house; now tries up to 3 reachable tables and picks its own table back up (not yet re-tested) |
| Wear the helmet | ❌→✅ there was no wear command and crafted armor was never put on; now it puts on carried armor by itself (wore the iron helmet right after reconnecting) and "put on your armor" works |
| Built blocks after hunting | ❌→fixed: after hunting sheep it dug into a village house. mineflayer-pvp swapped in its own dig-anything walking rules on every attack; pvp now gets the safe rules, a 2 s backstop restores them, and every broken block is logged |
| Doors | ❌→✅ stood in the open doorway (the pathfinder aimed at the top of the open door leaf), then flapped a double door open and shut while following; now it walks through the middle of the doorway, opens only doors on its route, and closes them only once through. It passed through the door |
| "Give me the plate" | ❌→fixed: claimed "Gave 1 iron_chestplate" three times while giving nothing; give now tosses the exact item, says when it has none, matches loose names against what it carries, and can hand over worn armor (not yet re-tested) |

### Real-world run: 2026-11-25 (same world; mining, storage, death)

| Check | Result |
|---|---|
| Buried ore | ✅ "No iron_ore in sight; tunnelling": diagonal tunnel down, straight legs along the ore's level, no shafts; 15 iron ore, then 10 + 6 + 6 + 8 coal |
| Tunnel torches | ✅ "Placed a torch … on the east wall"; ❌→fixed: with a full inventory it tried to craft torches every step and said it had no coal; now it makes room first and gives the real reason |
| Dig out to the surface | ✅ reverse diagonal tunnel with a torch; ❌→fixed: broke into gravel under water, digging underwater timed out and it took damage; tunnels now stop at water next to a block as well as lava |
| Full inventory | ✅ made, placed and filled a chest by itself (crafting table put down and picked back up); ❌→fixed: it put the chest in the middle of the tunnel and stored ~21 stacks including all its coal and the iron it was mining. Now: a 2-high niche in the tunnel's side wall, only the cheapest ~4 stacks, and coal, sticks, logs and the job's ore stay (not yet re-tested) |
| "Do you have raw iron?" after storing | ❌→fixed: "My inventory is empty"; now names what it carries and what it put in which chest |
| Following you up high | ❌→fixed: built an 8-block pillar; pillaring is now only for reaching a block up high (a treetop) |
| Scaffolding cleanup | ✅ "Took down 2/1/3 block(s) of my scaffolding" when idle |
| Replanting | ✅ "Replanted 1 tree (1 oak)"; ❌→fixed: it kept walking off to replant right after being called; idle chores now stay within 16 blocks of the owner |
| Beds | ✅ "use this bed" slept there; after dying, "go to sleep" walked back to that bed; with no bed around it said so |
| Give | ✅ "give me 20 coal" gave 20; ❌→fixed: "give me 1/2 of ur coal" only listed the inventory; give now takes a share |
| Broken pickaxe | ❌→fixed: it stood still until the owner stepped in; it now crafts the best pickaxe it can and goes on |
| "stop, craft pickaxe" | ❌→fixed: only stopped; every tool the model calls now runs, in order |
| Collect count | ❌→fixed: "Collected 6" after getting 3; now "Collected 3 of 6" |
| Night fight in a cave | ❌→fixed: died fighting a skeleton and zombie from 16 health to 0; now backs off at 4 hearts and fights again once healed or cornered (not yet re-tested) |
| Getting its things back | ❌→fixed: stopped on the surface 20 blocks above the cave it died in; now walks down or tunnels down to the spot |
| Hunting | "hunt" saw no animals; "hunt cow" saw 1 and left it to breed. Now a named kind asks "Hunt it anyway?", and the log lists animals out of sight |
| Thanks for gifts | ❌→fixed: thanked the owner for its own pickups (rotten flesh, dirt); now only items that appear at the owner's hands (thrown) count |

### Next run: re-test these

| # | Do this | Expect |
|---|---|---|
| 1 | Fill its inventory while it mines underground | A 2-high niche in the tunnel wall holds the chest; about 4 cheap stacks go in; it keeps coal and the ore |
| 2 | "follow me" and climb a cliff | It walks around; no pillar |
| 3 | Let it fight mobs at night until it's hurt | "I'm badly hurt, backing off!", it runs, then comes back |
| 4 | "give me half your coal" | Half of what it carries |
| 5 | "stop, craft a torch" while it's busy | It stops, then crafts |
| 6 | Throw it an item, then let it pick up a zombie's drop | Thanks only for the thrown item |
| 7 | Drop some items near it, and while it walks over to pick them up (or replants, or takes down scaffolding) say `stop` | It stops at once and stays put for about a minute; no chore starts again |

### Phase 1 closing checks (not yet run)

| # | Do this | Expect |
|---|---|---|
| 1 | Let a zombie attack the bot while it walks to you, then say `stop`, then `come` | It stops fighting at once, then walks to you without wandering back to the old task |
| 2 | "follow me", then let a mob chase the bot and run off | After the fight it follows you again |
| 3 | Stand by penned-in creepers (the creeper farm), say `stop` | It stops dodging and stays quiet for about a minute |
| 4 | Lead it through a door it can't open (adventure mode or a protected spot) | "The door … won't open; finding another way", and no digging |
| 5 | Restart the server while it's fighting or dodging a creeper | It rejoins idle; the old task doesn't keep moving it |

## Phase 2: Catalog and identifiers (#1 done: "mine 15 ore" asked which ore, "iron ore" mined; the rest not yet run)

| # | Do this | Expect |
|---|---|---|
| 1 | "collect 5 iron" | A question: "I don't know the block "iron". Did you mean …iron ore…?"; answer "iron ore" and it mines |
| 2 | "collect 3 diamonds" | It mines diamond ore (stone or deepslate), no question |
| 3 | "gather wood" in a cherry or mangrove forest (or by crimson/warped stems) | It cuts those logs and makes the right planks |
| 4 | Give it an iron pickaxe and an iron axe, then "how many axes do you have" | One axe; the pickaxe isn't counted |
| 5 | "craft dimond sword" (typo) | "Did you mean diamond sword?" |
| 6 | "go to bed" in a cave with bedrock nearby | It finds a real bed, never bedrock |
| 7 | "discard stone" while carrying a stone pickaxe | Only stone blocks are dropped |

## Later phases

Each phase in the implementation plan lists its own **In-game check**. Add those rows here as each phase lands.
