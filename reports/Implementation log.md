# Implementation Log

This log runs alongside the [Implementation plan](Implementation%20plan.md). The plan says what we *intend* to build. This log records what *actually happened* in each step.

Each entry has four parts:
1. **Planned:** what this step set out to do, quoting the plan.
2. **What happened:** events from the real game, reviews and surprises.
3. **How we handled it:** the fix or decision for each event, with the commit.
4. **Outcome and what follows:** where it left the bot and what changes next.

In-game test results are recorded in detail in [docs/real-game-checklist.md](../docs/real-game-checklist.md). This log keeps the story and the decisions.

**Adding an entry:** add it at the bottom. Keep events factual ("the bot dug into a village house after hunting"), not judgements. Every fix names its commit. Anything left open goes under "Outcome and what follows".

---

## Entry 1: Before the plan (2026-11-23 to 24)

**Planned.** Nothing yet: the plan didn't exist. The aim was to bring an old codebase (last touched April 2025) back to life and decide how the bot should be built.

**What happened**
- The dependencies were years behind (mineflayer, openai, zod, TypeScript).
- "stop" didn't interrupt commands, and wood gathering never ended.
- The npm release of mineflayer-pathfinder was stale and buggy.
- The owner rejected generic "app" advice and set the design positions:
  - the LLM is a slow, diary-driven day planner, at about $10/month
  - real-time behavior lives in code
  - the bot obeys only its owner
  - testing happens in the owner's real game

**How we handled it**

| Event | Handling | Commit |
|---|---|---|
| Old dependencies | Upgraded to mineflayer 4.39, openai 7, zod 4, TypeScript 7 | `ced4490` |
| Game data didn't match the server | Use the server's version; reconnect after disconnects | `639fd28` |
| Stop and endless gathering | Stop interrupts commands; gathering ends | `78e3409` |
| Stale pathfinder | Pinned mineflayer-pathfinder to GitHub commit `0eb15c1` | `69e51bb` |
| No direction | Architecture research report, then a 10-phase plan | `15b0d97` |

**Outcome and what follows.** We had the [architecture](Minecraft%20AI%20bot%20architecture.md) and a phased plan, Phases 0 to 9, each ending in something visible in the real game.

---

## Entry 2: Phase 0, real-game baseline and owner control (2026-11-24)

**Planned.** "The bot obeys only you, in your real world, and stop always works." This meant:
- a validated config
- owner-only chat
- a fast path without the LLM for `stop`, `come`, `follow me` and `status`
- the queue cleared on restart
- four suspected bugs confirmed and fixed
- a checklist for real-game tests

**What happened**
- The bot joined the owner's 1.20.4 LAN world with offline login; the plan had expected that LAN would need a real account.
- Crafting made the wrong count: bot.craft's count is how many times to run the recipe, not how many items to make.
- A crash in the stuck watcher showed up during a server kick.
- "come here" failed on a trip of about 1,400 blocks.

**How we handled it**

| Event | Handling | Commit |
|---|---|---|
| All of the planned Phase 0 work | Owner-only control, fast path, validated config, the four bugs fixed | `4d22144` |
| Craft count, stuck-watcher crash | Fixed while testing | `6316b97` |
| Long trips | Deferred to Phase 3 (trips split into legs) | n/a |

**Outcome and what follows.** 12 of 15 checks passed in the real game; 3 weren't run (Wi-Fi off, "you're stuck", drowning). Results: `eb10806`. Phase 0 was accepted.

---

## Entry 3: Owner feedback, second real-game session (2026-11-24)

**Planned.** Nothing new: this was a play session after Phase 0.

**What happened.** The owner asked for things from later phases:
- instant answers to "where are you"
- describing its surroundings
- long trips
- personal updates
- crafting that makes its own sticks and picks the better material

In the game:
- The bot got kicked for chat spam.
- It couldn't find the owner once the owner was out of sight.
- It died to a creeper.

**How we handled it**

| Event | Handling | Commit |
|---|---|---|
| Owner wishes | Instant answers, surroundings, trips in legs with progress, updates, smart crafting | `44a9731`, `abaef90` |
| Chat spam kicks | Chat paced to one line every 1.2 s | `abaef90` |
| Owner out of sight | Remember the owner's last position; ask for F3 coordinates | `f87c8e0` |
| "Pickaxe" built from wood | Generic tool names pick the best material it can make | `01ada8e` |
| Nearby table unreachable | It places its own table | `e9b87dd` |
| Creeper deaths, lost items | Recovery mode: creeper reflex, death recovery, starter kit, hang watchdog | `048ecfa` |
| "Move away" waited behind gathering | Movement and unstuck requests interrupt the current task | `f2fbf24` |

**Outcome and what follows.**
- **First pull-forward:** reflexes (Phase 4) and long travel (Phase 3) arrived early.
- **Plan change:** the plan gained persisted recovery state and conversation memory for Phase 1 (`5e9a0a8`), because both proved necessary in play.

---

## Entry 4: Phase 1, Session and Body, plus the third and fourth real-game sessions (2026-11-24)

**Planned.** "One object owns the connection; reconnects leave no stale state; it remembers recent chat and its death spot." This meant:
- a Body (one connection) and a Session (memory that survives restarts)
- all `bot.*` calls going through the Body
- per-connection resets
- a version check
- a typed event bus
- plugin adapters
- breaking the import cycles
- persisted death spot and owner position
- conversation memory

**What happened.** The planned core was built first (`e163b40`, `9e61d97`). Then two long sessions in the owner's world produced a stream of events, almost all from features belonging to later phases.

*Third session:*
- The bot didn't use a bed, then claimed "I set my spawn point" when it hadn't.
- It drowned twice: mineflayer's `oxygenLevel` is overwritten by any nearby fish or mob.
- Mobs hit it while it was busy, and its task cancelled the fight.
- The owner asked for boats on long trips and for harvesting and cooking.
- It sat stuck as a passenger in the owner's boat.
- It used only one of three campfires.
- "Give me X" gave only one.
- It broke the owner's wall (and a dragon egg) to reach the nearest bed, and couldn't use doors.

*Fourth session:*
- "Craft armor" made leather horse armor.
- "Helmet" quietly picked iron over leather.
- It left a crafting table next to the house.
- There was no way to wear armor.
- After hunting, it dug into a village house: mineflayer-pvp swaps in its own dig-anything walking rules on every attack.
- It stood in an open doorway: the pathfinder aimed at the top of the open door leaf.
- It flapped a double door open and shut while following.
- It answered "Gave 1 iron_chestplate" three times while giving nothing.

**How we handled it**

| Event | Handling | Commit |
|---|---|---|
| Planned Phase 1 core | Body, Session, adapters, event bus, per-connection resets, cycles | `e163b40`, `9e61d97` |
| Bed and false spawn claim | Use the bed by day and repeat the server's own answer; remember its own bed | `550603a`, `1f8ba54`, `0551e0f` |
| Owner position checks | Every 5 s at first, then 3 times a minute at the owner's request | `97470bf`, `0548038` |
| Drowning | Reflex reads the bot's own air; treads water when idle | `376962a`, `adf464a`, `d674adb` |
| Mobs while busy | Combat reflex pauses the task and fights back | `cc1bea7` |
| Boats | Crafts a boat, rows across water, lands before the next command | `0562009`, `f1d1f6c`, `29bd1d3`, `7ef626d` |
| Harvest, cooking | Harvests and replants; cooks on every campfire at once | `909fafa`, `6824cf2`, `4fdcb12` |
| Give only one | No amount means all of it | `434e4a0` |
| Broken wall and dragon egg | Walks only through natural terrain; opens doors | `0551e0f` |
| Horse armor, silent "iron" choice | Armor and tool sets; asks before odd matches and when several kinds can be made | `2084f7a`, `6684ee2` |
| Crafting table left behind | Tries reachable tables; takes its own table back | `c48938f` |
| Can't wear armor | Wear command; puts on carried armor by itself | `7445ed2`, `418a499` |
| Village house dug after hunting | pvp gets the safe rules; a backstop restores them; every broken block logged | `f135ad1` |
| Stuck in the open doorway | Doors put in the pathfinder's doorway set | `8621c0b` |
| Door flapping | Opens only doors on its route; closes only once through | `95d80b3` |
| False "Gave" | Gives the exact item, reports what was really given, can hand over worn armor | `0b0a880`, `bfa797d`, `418a499` |

**Outcome and what follows**
- **Confirmed in the owner's game:**
  - creeper reflex
  - respawn at the bed
  - death recovery (148 items)
  - rowing 258 blocks
  - harvest
  - cooking on 3 campfires
  - give-all
  - wearing the helmet by itself
  - walking through the door
- **Planned Phase 1:** mostly met. The exception is "all `bot.*` calls go through the Body": about 72 files still call the bot directly.
- **Branch:** 36 commits on `phase-1/session-body`, not merged to master. The plan asked for small commits on master.
- **Lesson:** every serious bug came from a feature built ahead of the layer it depended on.
  - reflexes without the Phase 4 arbiter
  - names guessed without the Phase 2 Catalog
  - success claimed without Phase 3 checked actions

---

## Entry 5: Architecture review and the direction from here (2026-11-24)

**Planned.** Get a senior architect's independent view of the branch against the plan, and decide two things:
- whether to follow the phases strictly
- whether to move everything behind the Body

**What happened**
- A `technical-architect` review agent was added (`.claude/agents/technical-architect.md`) and reviewed `master..HEAD`. Full text: [Architecture review 2026-11-24](Architecture%20review%202026-11-24.md).
- Its findings:
  - **Critical, confirmed against the code and library sources:**
    - "stop" doesn't reach the walk-retry loop that waits out reflexes.
    - mineflayer-pvp's `stop()` leaves a delayed pathfinder stop that silently drops following the owner, and can cancel the next command's walk.
  - **Major:** the combat reflex can freeze for 30 s; reflexes only pause walking (no leases on hands, windows or keys); a task from an old connection can drive the new one; two door-opener bugs.
- An audit of the 72 files found about 365 state reads, 165 chat calls and about 100 calls that change the game.

**How we handled it.** No code changes at this point; the owner chose to commit the working state first and decide the direction.

| Question | Decision |
|---|---|
| Follow the phases strictly? | **No, but follow the order between foundations.** A feature may come early only if the foundation it leans on comes with it, at least in a thin form. The plan is a map of dependencies, not a schedule. |
| Move everything behind the Body? | **No.** Reads stay direct (the singleton is accepted). The ~100 game-changing calls go through a gate in Phase 3 (server confirmation) and Phase 4 (leases). Chat goes through the Narrator in Phase 5. Phase 1's deliverable becomes "the Body owns connections and plugins, and a script blocks new direct calls that change the game". |
| Alignment with the settled design | **Held:** slow LLM, cost, code-driven behavior, owner-only, one bot. **Drifted:** no arbiter (about six informal flags instead), no Catalog (three loose matchers), only some actions confirmed by the server, no automated tests in the repo. |

**Outcome and what follows.** This order was proposed:
1. **Close Phase 1 (small).**
   - Reword the Body deliverable.
   - One set of walking rules per connection.
   - Remove dead code and `.DS_Store`.
   - Move the tests into the repo.
   - Add the script that blocks new direct calls.
   - Merge to master.
2. **Phase 4a: control layer.**
   - Leases on movement, hands and windows.
   - One reflex scheduler, where each reflex re-asserts what it wants every tick.
   - This absorbs the stop and follow bugs and the armor/give race.
   - Decide here whether to keep mineflayer-pvp or write our own melee loop.
3. **Phase 2: Catalog.** One loose-name resolver and proper categories.
4. **Phase 3: checked actions.** Game-changing calls go through the gate and are confirmed by the server.
5. **Back to features:** Phases 5, 6 and 7.

**Rule until step 2 lands:** no new features that move the bot or use its hands. Small fixes from real games are still fine.

**Open questions for the owner**
- Should "stop" end a fight (but never fleeing or drowning)?
- Keep mineflayer-pvp, or replace it?
- Should the bot close a door behind it while the owner follows through it?

**The owner's decisions (2026-11-24)**
- **Order:** close Phase 1, push to master, then **Phase 2 (Catalog) next**. Phase 4a (the control layer) is not pulled ahead of it.
- **Stop:** "stop" also ends fighting and creeper dodging. The owner's base has a creeper farm, where penned-in creepers are no danger, so the owner decides what's dangerous, not the bot.
- **mineflayer-pvp:** stays. Guard it rather than replace it.
- **Doors:** the bot always closes doors behind itself, even with the owner following through. A door left open lets zombies in; a door shut in the owner's face is a small price.

---

## Entry 6: Closing Phase 1 (2026-11-24)

**Planned.** Entry 5's step 1, plus the review's F1–F7, within the owner's decisions:
- reword the Body deliverable
- one set of walking rules
- dead code out
- tests into the repo
- the boundary check
- merge and push

**What happened**
- The fixes went in as planned (`b1bd968`, `1498411`).
- Moving the tests into the repo exposed two test-harness problems:
  - Bun copies a mocked module's exports once, so the fake bot is now a proxy (`tests/fakeBody.ts`).
  - The door test's "won't open" list leaked into the walking-rules test.
- Both were test problems only; no source code changed because of them.

**How we handled it**

| Item | Handling | Commit |
|---|---|---|
| F1: stop doesn't reach paused walks | `goto` and long trips check the cancel signal; waiting for reflexes can be cancelled | `b1bd968` |
| Owner's stop vs reflexes | Stop ends fighting and creeper dodging and mutes both for 60 s. Drowning is never muted. A mob that actually hits the bot is still fought | `b1bd968` |
| F2: deferred pathfinder and pvp stops | Never called. `pathing.stop` clears the goal; `fighting.stop` uses `pvp.forceStop` | `b1bd968` |
| F3: combat reflex freeze | It re-asserts its target every tick | `b1bd968` |
| F5: stale task drives the new connection | A disconnect aborts the running command at once; a follow paused on the old connection is forgotten | `b1bd968` |
| F6: doors | Follows the pathfinder's live route; confirms the door opened; a door the server refuses becomes a wall | `b1bd968` |
| F7 and housekeeping | One walking-rules object per connection; one cleanup list per connection (instead of `setMaxListeners`); dead combat code removed; `.DS_Store` untracked | `b1bd968` |
| Tests and boundary check | `bun run check` = type check + boundary check (122 direct calls frozen) + 13 tests | `1498411` |
| Body deliverable | Reworded in the plan | this entry |

**Outcome and what follows**
- **Phase 1 is closed in code.**
- **Not yet seen in the owner's game:**
  - stop during a fight, then "come"
  - following resumes after a mob flees
  - the 60 s mute at the creeper farm
  - a door that won't open
  - a reconnect during a reflex

  These are added to the checklist.
- **Next:** merge to master, push, and start Phase 2 (Catalog).

---

## Entry 7: Phase 2, Catalog and identifiers (2026-11-24)

**Planned.** "Item and block names are validated and categorised in one place." This meant:
- a Catalog over `bot.registry`
- categories derived from game data, never `name.includes()`
- replacing the substring matches
- validating names at the gateway
- storing only names
- fixing the known naming errors (tier names, `stripped_oak_planks`, the incomplete wood list)

**What happened**
- **The count was off:** an audit found 80 name substring checks, not the plan's 52.
- **Many were live bugs, not style:**
  - finding a bed matched **bedrock**
  - "bow" matched **bowls**
  - "chest" counted chestplates, "diamond" diamond tools, "furnace" blast furnaces, "torch" redstone torches
  - discarding "stone" could toss a stone pickaxe
  - `ensureTools` counted pickaxes as axes
  - wood gathering ignored nether stems
- **Duplicates:** four separate "best weapon" pickers had grown up across combat, both reflexes and the owner updates.
- **Data available:** the 1.20.4 registry carries all the needed data (entity type, food values, harvest tools, ore drops, every wood with planks). Derived from it, the categories work for newer versions too, such as pale oak in 26.1.

**How we handled it**

| Item | Handling | Commit |
|---|---|---|
| The Catalog | `src/core/catalog.ts`. Names ↔ IDs (unknown is null, never air), validation with closest matches (raw materials first), plural handling that keeps "glass", loose matching, every wood and `planksFor`, tool kind and tier by exact suffix, harvest tools from game data, armor, food, hostile and huntable mobs by entity type, ore drops | `706eab0` |
| Gateway validation | `src/managers/nameGate.ts` checks names before a command is queued. Real names pass normalised. Generic kinds pass ("bed", "planks", "iron armor", "diamonds" from ores). Anything else gets "I don't know the block 'iron'. Did you mean raw iron, iron ore…?" `collectBlock` finds ores from game data | `b2f93d1` |
| Known naming errors | Counting by exact name or category; `ensurePlanks` makes the right planks for every wood; `WOOD_TYPES` deleted; mobs by entity type with "baby" read by registry key (not index 16); tier names fixed and tested | `7ba5a10` |
| Substring matches | 80 → 13 deliberate ones; one `bestMeleeWeapon` | `ddb82f6` |
| Names only in `db.json` | Checked: no numeric IDs are stored | none needed |

**Outcome and what follows**
- **Tests:** 28 tests pass, 15 of them new (Catalog, name gate, counting and tiers), all against real 1.20.4 data.
- **Boundary count:** unchanged at 122 direct game-changing calls; Phase 3 starts on those.
- **Not yet run in the owner's game:** the plan's Phase 2 in-game checks ("collect 5 iron" asks a question; wood in a cherry or mangrove forest; "how many axes" ignores pickaxes), plus a bed search near bedrock. They are added to the checklist.
- **Branch:** `phase-2/catalog`, to merge to master after the in-game run.


## Entry 8: Playing like a player: mining, storage, cleanup, survival (2026-11-25)

**Asked for**
- No vertical shafts: mine with the owner's diagonal and straight tunnels, and a reverse diagonal tunnel to get out
- Dig out visible ore first; torches every 7 blocks
- Hunting as a group (look around 60 blocks, report, ask to continue); collect every drop after kills and wood gathering
- Replant felled trees with the saplings; take down pillars and bridges built while gathering
- Inventory management: chests near the bed, remembered chests, storing duplicates or resources; on overflow make a chest and put away the less valuable stuff

**How it works**

| Area | Where |
|---|---|
| Walking rules: no shafts, own scaffolding may be dug, pillaring only to reach a block | `core/movements.ts`, `core/scaffold.ts`, `core/plugins.ts` (`withRules`, `setReflexGoal`) |
| Sight (open faces, raycasts) for visible ore and animals | `actions/sight.ts` |
| Tunnels to buried ore, torches, dig out, water and lava stops | `actions/digging.ts` (`tunnelTo`, `digDiagonalTunnelUp`, `digOutToSurface`), `commands/DigToSurface.ts` |
| Drops: tracked tosses, collect everything visible, idle tidy-up | `actions/pickup.ts` |
| Trees: whole trunks, replanting, planting saplings | `actions/forestry.ts`, `commands/PlantSaplings.ts` |
| Scaffolding cleanup | `actions/scaffolding.ts` |
| Chests: value ranking, store/take/check, remembered contents | `actions/storage.ts`, `core/containers.ts`, `commands/StoreItems.ts`, `TakeFromChest.ts`, `CheckChest.ts` |
| Overflow: make room (cheapest ~4 stacks), make a chest, wall niche underground | `actions/overflow.ts`, `actions/placement.ts` |
| Hunting plan and report | `actions/hunting.ts`, `commands/Hunting.ts` |
| Survival: back off at 4 hearts; recover items from a cave below | `actions/combatReflex.ts`, `commands/RecoverItems.ts` |
| Broken tools replaced mid-dig | `actions/worldInteraction.ts` (`replaceBrokenTool`) |
| Several tools per message; gifts only when thrown by the owner | `managers/aiManager.ts`, `core/body.ts`, `actions/ownerUpdates.ts` |

**Outcome**
- **Tests:** 83 pass (55 new across 11 files: shafts with the real A*, sight, tunnels and torches, pickup, forestry, storage, overflow, chest niche, scaffolding, hunting, stopping collection).
- **Boundary count:** 117 direct game-changing calls outside `core/` (was 122).
- **In the game:** results are in `docs/real-game-checklist.md` (2026-11-25). Mining through tunnels, torches, making and filling a chest, scaffolding cleanup, replanting, beds and exact giving worked. The fixes made during the run are listed there under "Next run: re-test these".
- **Known gaps:** the felled-trees list is lost on restart; one chest at a time (no sorting across chests); hunting doesn't yet skip fenced pens.


## Entry 9: "stop" ends idle chores too (2026-11-25)

**Found.** The architect review of Entry 8 (`32d0952`) found that `stop` didn't reach the idle chores (tidying up, replanting, taking down scaffolding): they ran outside any command, so the cancel signal read "not cancelled", and their timers started them again 3–5 s later. Seen in the game that day: `stop` during replanting, then "Going back to replant 1 tree(s)" again. That broke Phase 0's "stop always works".

**How we handled it**

| Item | Handling |
|---|---|
| One runner for chores | `src/core/chores.ts`: one chore at a time, each with its own abort signal in the same async context as commands |
| What ends a chore | `stop` (and keeps chores quiet for 60 s, like the reflexes), any command starting, a disconnect |
| A chore that never settles | Waited for at most 3 s, then cleared, so a walk cut off by a disconnect can't block chores until restart |
| Big steps from a chore | A chore no longer makes room (chest, tossing junk) or crafts a replacement tool; those stay inside owner tasks |
| Tests | `tests/chores.test.ts` (4): stop mid-walk, a new command, a chore that never settles, chore context. The first two fail without the abort |

**Still open from the review**
- `makeRoom`'s and `replaceBrokenTool`'s busy flags are still module-level (a disconnect mid-way can leave them set)
- scaffolding is still remembered by position only
- whether `stop` should also end fleeing at low health (the owner's call)
- splitting the branch: Phase 2 commits to master after the Phase 2 checks; `32d0952` waits

## Entry 10: Phase 3, verified actions (2026-11-25)

**Planned.** The plan's Phase 3:
- a result type with failure reasons that reach chat
- checked primitives (walk, break, place, equip, eat, craft, containers) with a precondition check, a time limit, abort support and a check afterwards
- "unknown is unknown"
- paced clicks
- the most-used actions moved onto them

The owner can't test in the game right now, so everything is checked by tests only; the in-game checks are in `docs/testing-backlog.md`.

**What happened**
- The primitives went in, and the actions moved onto them: walking, breaking, placing, chests, crafting, smelting, cooking, farming, inventory, doors, beds, weapons and riding (`da14972`, `5b9beba`).
- The architect review found the checks could still be fooled:
  - **Digs:** mineflayer writes air into its own world copy the moment a dig ends, so "is the block gone?" passed before the server could refuse.
  - **Containers and tosses:** mineflayer counts a click as done before the server answers.
  - **Abandoned work:**
    - A timed-out walk could resume after a reflex and fight the next walk.
    - A walk that timed out cleared a reflex's goal.
    - A craft at a table that never opened left mineflayer waiting for a window, and that wait could grab the next window opened.
  - **Wrong "stopped":** a changed goal or a reset path counted as the owner's stop, so long trips ended with "I stopped".
  - **Arrival check:** stricter than the pathfinder's own; standing on farmland or a slab failed.
  - **Mining count:** collectBlock counted blocks it never broke.
- **A test-harness surprise:** in Bun, removing the last listener of an `AbortSignal.timeout` signal cancels its timer. Real stop signals come from an `AbortController` and are not affected; the tests now use one.

**How we handled it**

| Item | Handling |
|---|---|
| Result type | `src/core/result.ts`: `ok`, or one of aborted, interrupted, timeout, disconnected, unreachable, out_of_reach, unknown_block, not_found, no_tool, refused, occupied, no_support, full, missing_items, error; `describeFailure` for chat; `ActionError`/`expectOk` for code that works with exceptions |
| No call can hang | `src/core/guard.ts`: each call ends on success, the command's or chore's stop, a time limit, a watchdog or a dropped connection. The call gets its own signal, so the work it started (a walk) ends too |
| Walking | `goTo`: arrival checked the way the pathfinder checks it; a no-progress watchdog (20 s, not counting time a reflex holds it) instead of a fixed limit; on giving up it clears only its own goal |
| Breaking | `breakBlock`: the time limit comes from the dig time; it waits one server round trip (at least 100 ms) and only then judges whether the block is gone, so a protected area that puts it back is "refused" |
| Placing | `placeBlockAt`: free spot, support, reach; success means a different block that isn't air, and it stayed after a round trip. Torches count though they have no collision box |
| Crafting | `craftWith`: batches of 8 runs with paced clicks; a 25 s limit, longer than mineflayer's own 20 s window wait, so no stale wait is left; the items must appear |
| Containers | `src/core/containers.ts`: opening with a time limit; deposits and withdrawals paced, then the server is asked for the real contents before recounting; furnace steps guarded |
| Unknown is unknown | `knownBlock` is null for unloaded blocks, and every primitive treats null as "unknown_block", never air |
| Riding, using, looking, sleeping | `mountEntity`, `dismountVehicle`, `useEntity`, `useHeldItem`, `useBlock`, `lookAt`, `sleepIn` (the server's reason when it refuses) |
| Plugin setup | moved from `index.ts` to `src/core/setup.ts`; the boundary check now also catches `currentBot.`, `bot.creative.*` and `deactivateItem` |
| Commands | walking, place, give, discard, store, take and check-chest say why they failed and report real counts ("Gave 12 of 20 coal") |
| Earlier review findings | busy flags after a disconnect: closed (guards end on disconnect); scaffolding remembers what it placed, keeps the water/lava/falling-block checks, and is forgotten when someone else changes the block |
| Fixed on the way | seeds were "planted" under the farmland; the toss listener detached from the wrong bot after a reconnect; precious items matched hay and bone blocks |

**Outcome and what follows**
- **Tests:** 107 pass; 19 test the primitives against a fake server that refuses, never answers, or drops the connection.
- **Direct game calls outside core/:** 117 → 16. The 16 left are the creeper and drowning reflexes and the unstuck routine, which Phase 4 turns into proposals and a service.
- **Not done:**
  - the plan's "every reason reaches chat" holds for the commands above, but not yet for the ensure chains (Phase 6)
  - recent conversation still records text only, not the command and its result (a Phase 1 gap)
  - whether `stop` should also end running from mobs when badly hurt is the owner's decision (today it doesn't)
- **In-game checks:** all in `docs/testing-backlog.md`, newest first.
- **Next:** Phase 4, the arbiter and reflexes.

## Entry 11: Phase 4, the arbiter and reflexes (2026-11-25)

**Planned.** The plan's Phase 4:
- priority buckets
- leases on movement, hands, the window and chat
- cancel before starting, waiting for cleanup
- resume by replanning
- reflexes as proposals
- unstuck as a service
- inertia within a bucket
- no 1.5 s polling loop

The owner can't test in the game right now; the checks are in `docs/testing-backlog.md`.

**What happened**
- **Built:** the arbiter, leases, own upkeep and the stuck watcher (`b77aa9e`). Reflexes now hold the body through leases instead of a flag only walking checked, and nothing outside `core/` calls the game directly any more (16 → 0).
- **Design choice:** reflexes *pause* a task rather than cancel it, because tasks stop at their next action while a reflex holds the body. Only owner commands cut in by cancelling, and the cut-off task resumes with what's left. This keeps one-off tasks (give, store, craft) from being redone or lost when a creeper shows up.
- **Plugins removed:** mineflayer-auto-eat refuses to eat while disabled, so it and armor-manager were replaced by the bot's own upkeep.
- **Found by tests:**
  - the task that cut in and the resumed one could keep cutting each other off;
  - the resume count could be taken before the old task had stopped;
  - eating never found a gap, because the next dig started at once.
- **Found by the architect review:**
  - A resumed task kept the old "cut in" flag: two "go to" commands looped, and "come here" was dropped for the old trip.
  - "stop" during a cut-in's cleanup let the old task resume.
  - mineflayer-pvp stops itself through the pathfinder's deferred stop when its target dies, which drops the next goal (the next mob, the owner to follow again) and can later strip the door opener's listener.
  - Cancelling a task also cleared a reflex's flee goal.
  - Borrowers ate while the pathfinder was digging on its own, and inside open furnace windows.
  - The stuck watcher blamed a spot the bot had already reached.
  - Following ended at once, so it was invisible to everything else.

**How we handled it**

| Item | Handling |
|---|---|
| Arbiter | `src/core/arbiter.ts`: buckets 0 survival … 6 idle; a more urgent task cuts in, and the old one is aborted, the body stopped (except what a reflex holds), and its cleanup waited for (10 s cap) before the next starts; what's left is worked out after it stopped; a resumed task never cuts in again; stop, stuck and "took too long" are never resumed (an epoch guards a cut-in in progress) |
| Commands | `src/managers/actionManager.ts` `queueCommand`: priority 1 cuts in; trips are walked again from where it is, unless a newer trip replaced them; counted work (collect, gather wood, hunt) resumes with what's left (`reportProgress`); one-off commands are not redone; a command still waiting isn't queued twice ("That's already on my list") |
| Following | a lasting task that yields: the next command goes first and following carries on after it ("Back to follow player."); never "stuck" while the owner stands still |
| Leases | `src/core/leases.ts`: reflexes take movement, hands and the window urgently, so the task waits at its next action and a dig cut off by a reflex is tried again; borrowers (eating, armor, weapon in hand) wait for a gap while the bot isn't walking and no window is open, and the task's next action lets a waiting borrower go first |
| Reflexes | creeper, drowning and combat run as their own holders (`asReflex`) and act through primitives; a reflex closes an open window; the door opener works for whoever is walking |
| pvp | its stop is replaced with the immediate one, so a kill no longer drops the next goal or the door opener's listener |
| Upkeep | `src/actions/upkeep.ts`: eats the most filling food (junk only when starving), between actions; starving or badly hurt it stops and eats at once; `src/actions/armor.ts` wears its best armor itself |
| Unstuck | `src/managers/stuckWatch.ts`: 45 s without moving or items changing → a nudge (jump, step aside), then a replan, then giving up; a spot it was walking to when it gave up is unreachable for 10 minutes (`src/core/failures.ts`, exact block), so walking there fails at once |
| Chores | idle chores are bucket-6 tasks; any task cuts in; the owner's stop mutes them for a minute |
| Loop | no polling loop and no command queue in `db.json` |

**Outcome and what follows**
- **Tests:** 126 pass. New ones cover:
  - the arbiter (8): cutting in, cleanup before the next task, resume with what's left, stop, priority order, time limit;
  - leases (6): a reflex pauses a task, a dig cut off by a reflex is retried, eating waits for a gap, urgency order, food choice;
  - commands (5): a newer trip replaces an older one, "come here" mid-gathering, stop during a cut-in, following steps aside and returns, duplicates.
- **Decisions taken (the owner can change them):**
  - a newer trip replaces an older one instead of resuming it;
  - while the owner's stop keeps reflexes quiet, a mob that actually hits the bot is still fought (as decided in entry 6).
- **Open:**
  - the chat lease isn't used yet (the Narrator is Phase 5);
  - leases are waited on by polling every 25–100 ms, not by events;
  - "status" counts waiting tasks but not the ones paused by a reflex.
- **Next:** Phase 5, perception, memory and the Narrator.

## Entry 12: Phase 5, perception, memory and the Narrator (2026-11-25)

**Planned.** The plan's Phase 5:
- sensors writing beliefs with expiry
- a memory store (schema v2: places, a chest index, the death spot, forbidden areas)
- migrating `db.json`
- one rate-limited Narrator for all chat
- "status" from real state

The owner asked for the architect to be consulted during the work: once on the design before building, once on the result.

**What happened**
- **Before any building, a test-isolation bug turned up:** the tests had been writing the bot's real `db.json` (a fake chest at 3, 64, 0 from the overflow test was in it), so earlier runs had replaced the owner's real memory (its bed, its chests). The tests now use a throwaway file (`cc68242`); what was lost can't be recovered from the repository.
- **The design consult changed the plan in five places:**
  - The Narrator *replaces* the chat queue that already existed in `body.ts` (which dropped the oldest line, possibly an answer), rather than wrapping 190 call sites.
  - Typed on-demand reads instead of a belief store that copies live values into stale ones.
  - A server-protected area is noticed only from blocks the server puts back (a new reason, `reverted`), never from any "refused" (bedrock, sleeping by day…).
  - The migration as a pure, tested function with a backup and `.passthrough()`.
  - `roles` and progression stay with Phases 8 and 6.
- **Built:**
  - memory v2 (`91ff985`)
  - the Narrator (`6a8d16c`)
  - perception, keep-out areas and sightings (`6a4d364`)
  - where-is, keep-out, status and place checks (`7dbb4dd`)
- **The result review found:**
  - "where did you die?" forgot the death as soon as the bot went back for its things (recovery cleared it);
  - the legacy `bot.chat` lines became undroppable public reports (a repeated answer was swallowed by de-duplication, and loops piled up);
  - a reconnect emptied the queue into the offline digest before the player list arrived;
  - the reply channel was read when sent, not when said;
  - "stop" dropped late messages only before the task was aborted;
  - an unreadable `db.json` would be overwritten;
  - memory fields a later version adds would be erased;
  - the pathfinder could still pillar inside a keep-out area;
  - falling gravel looked like a protected area.

**How we handled it**

| Item | Handling |
|---|---|
| Narrator | `src/core/narrator.ts`, one process-wide outbox paced at 1.2 s. **Kinds:** `reply` (first, never dropped, back on the channel the owner used, taken when said), `report` (never dropped, de-duplicated for 30 s), `chatter` (by topic: the newest wins, at most 4 wait, dropped when its task ends). **Old `bot.chat` calls:** public reports, at most 6 waiting. **Stop and long lines:** a stopped task says nothing more; long messages are split to fit a chat packet, nothing cuts in between the parts, and newlines are removed. **Offline owner:** replies and reports wait; when they join, every answer plus the last 5 reports come as a digest; questions aren't kept (they expire). **Other:** sending starts at spawn (when the player list is known); only replies and reports go into the LLM's conversation; the chat lease is gone; the boundary check counts chat calls (189 → 118, may only go down) |
| Noisy files converted | combat, the retreat warning, "come here", weapon equipping, the AI's answers, the fast path, inventory and chest answers, crafting, give and discard, the gift and armor notices |
| Perception | `src/actions/perception.ts`: `owner()` (visible / out of range with where last seen / offline), `threats()` (the combat reflex's own classifier), `vitals()`, `sky()`, sightings (ores and logs noticed while working, 10-minute hints), one `currentDimension()`; each read says "unknown" honestly |
| Memory v2 | `memory.places` (base, basement, crafting tables, furnaces, mines), one chest index (`contents: null` = never opened, never "no iron"), a death log (the last 3; recovery never clears it), forbidden areas. **Migration** (`src/managers/migrate.ts`): pure and tested; the old file is kept as `db.json.v1.bak`; the command queue and the inventory snapshot are dropped. **Loading:** an unreadable file is set aside, never written over; one bad entry costs only that entry; fields a newer version adds are kept |
| Keep-out areas | `src/core/forbidden.ts`: marked by the owner ("keep out of here", "you can work here again"), or noticed when the server puts a block back twice within 8 blocks and 2 minutes (30 minutes). Falling blocks and a mob standing in the spot don't count. Every dig and placement, the pathfinder's included, refuses inside one; the path search avoids it; finders (wood, mining, farming) skip it; its own scaffolding inside one is left alone |
| Answers | `whereIs`: where it died, the base, its bed, tables, furnaces, mines, the chests (and how long ago it looked), which chest holds an item. "status": the task, what paused it, what's next, health and food, the sky, threats, where the owner is |
| Place checks | `src/actions/placeCheck.ts`: a remembered table, furnace, chest or bed that's gone is forgotten when seen to change or the first time it comes near (unloaded blocks are unknown) |

**Outcome and what follows**
- **Tests:** 151 pass; new ones cover the Narrator (11), the migration (4), memory and status (6), keep-out and gravel (3).
- **Defaults chosen (the owner can change them):**
  - keep-out means no digging or building (not no entry), and harvesting is skipped too, while opening chests inside is allowed;
  - when the owner is offline, answers and reports wait for a digest;
  - replies go back the way the owner asked;
  - a server area lasts 30 minutes or until cleared.
- **Not done:**
  - 118 old `bot.chat` lines remain, converted as each file is touched;
  - display names still come from scattered `replace(/_/g, " ")` helpers.
- **In-game checks:** `docs/testing-backlog.md`, Phase 5.
- **Next:** Phase 6, skills and progression to Tier 1.

## Entry 13: Phase 6, skills, the progression tree and the first day (2026-11-25)

**Planned.** The plan's Phase 6:
- one planner for getting an item, replacing the recursive ensure helpers;
- capabilities computed from what the bot has;
- milestones toward Tier 1 (a player's first day);
- a curriculum that goes for them when the owner gives no orders.

The architect was consulted on the design before building and reviewed the result.

**What happened**
- **The recursion was cut first:**
  - ensure → tools → crafting → gathering no longer calls itself (`8ae7d9a`);
  - unused progression and lore code was deleted.
- **The design consult settled these choices:**
  - a hybrid `acquire(item, n)` over the existing craft planner, with sources for raw materials;
  - milestones as ordered steps with done-checks;
  - capabilities computed on demand, never cached;
  - autonomy off by default;
  - the night routine as upkeep (bucket 4) over milestones (bucket 5).
- **Built:**
  - the planner (`10e9ad6`);
  - milestones, shelter, curriculum and commands (`d0caf30`).
- **The owner asked mid-phase for the progression tree:** "you can't make a torch without coal first", and so on.
  - Crafting itself is never locked for the bot: mineflayer places the items in the grid by hand, so recipe-book unlocks don't matter unless a server turns on `doLimitedCrafting`.
  - Charcoal comes from a furnace, not a campfire, and a campfire itself needs coal or charcoal.
  - What really gates progress is materials and tools, so that became the tree (`aa72cd2`).
- **The result review found:**
  - furniture landing on the cell that said the shelter existed;
  - the stuck watcher killing the night task after about 2 minutes, then the scaffold cleanup breaking the seal;
  - wool planned from string, so the bed never happened;
  - "stay with me" not stopping anything;
  - stuck milestones retried forever;
  - the night counter using the world age;
  - shelters dug blindly (into a house, half-dug stairs repeated).

  All of these are fixed (`f603843`).

**How we handled it**

| Item | Handling |
|---|---|
| Planner | `src/skills/acquire.ts`: plan → a table first if a recipe needs one → each missing raw material from a source (with what that source needs first) → craft → check again. Bounded: 6 rounds, depth 6; a failing source is set aside for that material for 5 minutes; the owner's orders clear that. An item with a source goes straight to it, never through a recipe for it (wool, not string) |
| Progression tree | `src/skills/techTree.ts`. **Ore tiers:** the pickaxe each ore needs comes from the game's harvest data (coal: wood; iron, copper, lapis: stone; diamond, gold, redstone: iron). **Smelting:** what a furnace makes from what (charcoal, ingots, glass, stone, brick). **Sources** (`src/skills/world.ts`): trees, stone, sheep (an explicit count), any ore with the right pickaxe, smelting. Charcoal stands in for coal when no coal ore is around; fuel never burns the item being smelted |
| Capabilities | `src/skills/capabilities.ts`: tool tiers, food points, table access, shelter, bed, chests, wool, all from the inventory and memory now |
| Milestones | `src/skills/milestones.ts`, Tier 1: wooden tools, a shelter, stone tools, a food stock (20 points), a bed (spawn set), two chests with the cheap stuff. The first time each is reached it's announced, then the whole first day |
| Shelter | `src/skills/shelter.ts`: diagonal stairs 5 down, then a room 3x3x2. **Fixed spots:** the bot stands in row 1, the bed goes in the middle and last row, chests in the far corners. **Site:** open sky, natural ground, no liquids; saved before digging so a cut-off dig carries on. **Seal:** 3 blocks at night; it's a "door" the walking rules may dig through but the scaffold cleanup leaves alone |
| Curriculum | `src/skills/curriculum.ts`. **Turning it on:** off until "go live your life" (remembered; `AUTONOMY=on` also works). **What it proposes:** the next milestone at bucket 5 when nothing at bucket 5 or more urgent runs or waits; the night task at bucket 4 once per world day. **Night task:** no stuck watch, 12 min backstop, resumes after a cut-in. **Limits:** "stop" quiets it for a minute; "stay with me" ends it; failed or stuck milestones are set aside for 10 minutes |
| Commands | `Autonomy` ("go live your life" / "stay with me") and `Progress` ("what's your progress?"), both instant. After a death, the starter kit is skipped when it lives its own life |

**Outcome and what follows**
- **Tests:** 172 pass. New ones cover the planner (7, including torches with and without coal and the chain to diamonds), the tree against real 1.20.4 data (3), and the curriculum and shelter layout (12).
- **Boundary list:** 108 direct calls (from 118).
- **Defaults chosen (the owner can change them):**
  - "stop" pauses its own life for a minute, like the chores;
  - the shelter is dug near the base, in the open.
- **Not done:**
  - Tier 2+ milestones (iron tools, a farm), which the tree already supports;
  - the Sleep and Hunting commands still talk through old `bot.chat` lines.
- **In-game checks:** `docs/testing-backlog.md`, Phase 6.
- **Next:** test the first day in a fresh world; then Phase 7.

## Entry 14: First game test of Phase 6, a fresh world (2026-11-25)

**Planned.**
- Run the first day in a fresh 1.20.4 LAN world: "go live your life", then watch.
- Fix what shows up.

**What happened**
- **Result: 5 of 6 milestones** by itself: wooden tools, a shelter, stone tools, two chests, a food stock.
- **Bed:** no sheep within about 150 blocks in that savanna; it keeps retrying in new directions.
- **Owner requests mid-test:**
  - memory kept separately per world;
  - the bot must decide for itself when it lives its own life ("I won't reply to his questions; he must decide on his own or ask ChatGPT").
- **Problems seen, in order:**
  - "make an iron pickaxe" said "I don't know how to get iron ingot": the craft command didn't use the new planner.
  - "gather cobblestone" never worked: it looked for cobblestone blocks.
  - The scaffold cleanup timer threw every 5 s (`blockAt` given a plain object).
  - "come here" stood 20 s and then got "stuck" (4 of 5 times): a `GoalFollow` loses its path whenever the owner moves 2 blocks.
  - The owner reported heavy lag between actions: fixed pauses from before Phase 3 (1.2 s per log, 2.5 s per tree, 1 s per tunnel block) on top of the per-dig server check.
  - The furnace for food never went down: grass taken for ground, and the bot's own cell offered as a spot.
  - "Keep hunting? (yes/no)" asked on its own errands.
  - **It sealed itself out of its shelter**, owner's screenshot. The "standing in the spot" check measured from the block's corner, so the neighbouring cell counted; it walked back up the stairs and sealed from outside. That night a spider and a zombie killed it.
  - Every deposit into its chests was reported refused: the check counted `bot.inventory`, which mineflayer updates only when the chest window closes.
  - With 0 food and nothing near, it stood idle: no fallback.
  - Two process slips of mine:
    - a commit went in with 6 failing tests, because my command chain didn't stop on the failed check; repaired one commit later;
    - the world memory looked like it loaded after spawn, which was only the log line printing late.

**How we handled it**

| Item | Handling |
|---|---|
| Memory per world | `worlds/<id>.json`, keyed by the hashed seed in the login and respawn packets, loaded before mineflayer handles the login; nothing is saved before a world is known. The old `db.json` is left alone and unused (`d11a43b`, `18a27cb`) |
| Crafting and the tree | `CraftItem` says what the tree needs ("iron ingot: smelted from raw iron in a furnace; raw iron needs a stone pickaxe"), asks once, then runs the planner. "Cobblestone" is mined from stone (`d11a43b`) |
| Walking | "come here" walks fixed legs re-aimed at the owner (`bc39d7f`). A walk that makes no progress now logs where it stands, the goal, the pathfinder's last path and the blocks at its feet (`650ff41`) |
| Pace | The fixed pauses in wood gathering and tunnels are gone; every log line has a timestamp (`00961dc`) |
| Placement | Solid ground only, never the bot's cell (`650ff41`); it steps aside only when its 0.6 x 1.8 body really overlaps the cell (`821aad5`) |
| Chests | Transfers count from the open chest window (`525d05a`) |
| Its own decisions | `askOwner` on its own errands (bucket 3 and up) takes the bot's own answer and logs it. `skills/explore` walks legs of about 48 blocks in an untried direction until animals or sheep are in sight; the food stock and the sheep source use it (`a4e32f9`) |
| Arbiter | A task is recorded as running before its code starts, so code before its first pause sees itself running (`a4e32f9`) |

**Outcome and what follows**
- **Tests:** 179 pass.
- **Seen working after the fixes:**
  - sealed in from inside;
  - a whole night without "stuck";
  - out again in the morning;
  - explored south-east for food, hunted 4 pigs and cooked them;
  - 5 of 6 milestones.
- **Not yet seen:**
  - the bed (sheep);
  - storing in the chests after the fix;
  - "come here" at night through the seal;
  - the craft command's tree path;
  - a second world.
- **Still open:**
  - its first death has no known cause (health was already low before the restarts);
  - "craft one more please" picked the stone-tools set command.
- **In-game checks:** `docs/testing-backlog.md`, Phase 6, with a list of re-checks.
- **Next:** finish the first day (sheep), then Phase 7, where the LLM decides what to do when it's idle or stuck.

## Entry 15: Playing past the first day, and the hang at open steps (2026-11-25 to 26)

**Planned.**
- Finish the first day (Phase 6 deliverable) in the owner's game, then keep the bot playing like a player: shelter, mine, coal, iron.
- Fix what the owner reports from the game, one screenshot at a time.

**What happened**
- **First day 6 of 6** in a new hillside world ("Bubu without Dudu"), then on by itself into the mine: coal, 10 raw iron, 11 ingots smelted at home, an iron pickaxe and iron tools.
- **Owner's direction, in order** (each one implemented):
  - the shelter is the owner's original design: its walls, roof and floor built or mended, never logs or leaves; its furniture set up in the original order (fetch everything, then place from each row so chests pair up); every building has its own crafting table;
  - a door to the mine; after a restart it checks the shelter against its plan and mends it (creeper holes);
  - replanting waits until the first day is done; gathering from the world takes a 10–30% margin (20%), never crafting;
  - up a tree, it stands on the trunk and chops it from the top down;
  - the walking rules stay at the pathfinder's defaults ("less limits, less bugs"), apart from the owner's own rules;
  - at night: cook raw meat in the furnace, and keep mining under ground (home first); keep torches, coal, sticks and wood;
  - mining: scaffolding comes down, iron is smelted once there are 10, worn-out tools are replaced with stone or iron, never wood;
  - the hub mine plan: from the end of the stairs dig forward, right and left 50 blocks each (a blocker ends that one), then the same diagonal stairs 20 steps further down, and repeat;
  - strip mining takes every ore in sight; after 200 cobblestone the stairs are made a block higher and paved with cobblestone stairs;
  - berry bushes are walked around, by one block only;
  - after a death, with a shelter and a bed, it goes home to its chores, not back to the owner.
- **The hang at open steps.** For a day it hung at steps it could plainly climb: its own mine stairs, ledges, grass (owner: "THERE ARE WALKABLE PATH"). Simulating the pathfinder on the real blocks read from the world save, it climbed fine. The stall log was extended step by step (keys, facing, the blocks touching its body, server teleports) until it showed the cause: the server put it back **20–30 times a second**, always to a position like x = -32.3. There its body's side is exactly on a block face, and in floating point -32.3 + 0.3 is -31.999999999999996, a hair inside the block. mineflayer's physics only stops a body at blocks it isn't already in, so it walked 0.02 into the block, the server refused the move and put it back, forever.
- **Side effects of the hang:**
  - a walk stuck on a step dug around it and broke the stairs (owner: "unacceptable"), then wandered through the caves;
  - swimming up a waterfall to get home, it ran out of air at the top; the drowning reflex pushed it forward off the top and it fell, three times, and died.
- **Other problems seen:**
  - it lost its pickaxes and "didn't know how to get cobblestone" with a pile of it in its chests;
  - its deeper stairs stopped over water two blocks from anything solid, and the mine was marked as deep as it goes, so coal and iron stopped for good;
  - a skeleton in its dark mine stairs shot it at its own door, twice;
  - 80 blocks from home it made a spare crafting table and a furnace, then had no fuel;
  - it thanked the owner for its own death drops; it said "can't sleep" every 30 seconds.
- **A question left with the owner:** the side tunnels every few blocks along the main tunnel were dropped when the hub plan replaced them, without asking first. Whether to bring them back is the owner's call.

**How we handled it**

| Item | Handling |
|---|---|
| Shelter, the owner's design | Shell built and mended, tree blocks replaced (`8947753`, `9b6ee38`); furniture in the original order (`1726fef`, `4d65bda`); a door to the mine and a check against the plan after restarts (`8cf2801`, `a653183`) |
| First-day order | Replanting last (`549076e`); a 20% margin for gathering only (`cb3a59c`, `0cd6341`); down a tree from the top (`5f5ba41`, `f56e881`) |
| Walking | Defaults restored (`02dc1ba`); home in legs, around berry bushes (`9c477d1`, `87ff5b1`); longer think for hard paths (`e79cc66`) |
| Mining and iron | Night mining (`77d15a1`, `1353b7c`); scaffolding down, worn pickaxe sends it home (`477cc3c`); iron at 10 (`8a6f95b`); no wooden tools after stone (`aabed8e`); water and lava plugged (`6f8154b`, `b707e9d`); hub plan (`c1454bf`, `cfc2f63`); strip mining (`ae03761`); paving (`cb3b6fd`); Tier 3 milestones (`a2cc30e`) |
| **The hang at open steps** | After every server teleport and physics tick, the bot is pushed a millionth of a block off any face it overlaps by less than 0.0001 (`core/faces.ts`, `4e219f0`). Fuller stall log and a hand step as a fallback (`50d1ee3`, `5a5afe9`, `2b987cc`) |
| Stairs broken by a walk | Each step's floor and side walls are protected like the shelter's shell, and the steps are its own passage (`2b987cc`) |
| Waterfall deaths | The drowning reflex never pushes forward over a drop; water that ran it out of air is avoided for a minute (`2b987cc`) |
| No cobblestone with a chest full | The planner takes raw materials from its own chests within 96 blocks first (`e8910bd`) |
| Stairs stopped over water | Up to three support blocks bridge to a floor with nothing solid beside it (`583cd0f`); the "as deep as it goes" mark was cleared in the world file |
| Dark stairs, spare table and furnace, gifts, can't-sleep | Holes in the stairs mended and a torch every 6 dark steps at the start of each mining trip; the shelter's table counts from 256 blocks; meat cooked at the shelter's furnace with fuel from its chests; no gift within 5 s of its own death or nearer its own hands; the same can't-sleep said once in 10 minutes (`8d4b237`) |
| After a death | Home chores: store, cook, smelt, make missing tools (`d99c50b`) |
| Phase 6 cleanup | One command list (`src/commands/all.ts`) and one `isHostile` (`ed9151d`) |

**Outcome and what follows**
- **Seen working in the game:**
  - the first day, 6 of 6; coal, iron, smelting, an iron pickaxe and iron tools;
  - the hub plan through one level: forward 50, right blocked, left 50, then the stairs 20 steps deeper, and the next level's forward tunnel;
  - water plugged, scaffolding taken down, night mining, the climb down a tree, the shelter mended;
  - after the face fix: long walks, hunting trips and the mine stairs with no stall at all (the server put it back twice in half an hour instead of 20–30 times a second);
  - home chores after a death, and stone tools from the cobblestone in its chests.
- **Not yet seen:** bridging over water, the stairs looked after (holes and torches), cooking at home after a far hunt, the gift and can't-sleep fixes, paving, iron armour and diamonds.
- **Phase 6 cleanup, finished afterwards:** `worldInteraction.ts` split into `blockPlacing`, `blockBreaking`, `objectUse`, `riding` and `vehicleDeploy` (`c5b4617`).
- **Architect's review of the day** (`a821add`):
  - the hand step was removed, now that its cause is fixed: it wrote the movement keys outside the lease model;
  - the drowning reflex counted falling water as a floor, so the waterfall case wasn't really fixed: now a tested pure check;
  - the planner's chest source would have taken from the owner's chests: chests now record `own`, and the planner uses only its own;
  - one lazy seam for running commands; an unknown command fails instead of a quiet "done"; home chores say what didn't work.
  - Recorded as plan changes (Phase 6 status, Phase 7 "Before starting", and a rule under "Throughout"). Left for later: marking an unreachable table, a Narrator "say once" facility, a dimension on protected cells.
- **Tests:** 218 pass.
- **Phase 6 left to close:** only the 2–3 seed run the plan asks for (forest, plains, cherry).
- **Next:** Phase 7, the diary and the LLM day planner.

## Entry 16: Phase 7, the diary and the LLM day planner (2026-11-26)

**Planned.** Phase 7 of the plan: "The LLM becomes the bot's decision maker. Code writes a diary. At dusk, or when the bot is idle, the bot sends the diary, its state and a menu of feasible goals to the model. It wakes up with a plan for the day."

**What happened**
- Built in four steps, each committed with tests: the diary, cost tracking, the goal vocabulary with the planner, and the triggers.
- **A live call** with the plan schema (the Responses API, strict function tools, reasoning effort low) returned a valid plan in 4.7 s for 683 tokens (about $0.0002). The model left required step arguments empty (a `mineFor` with no count, an `explore` with nothing to look for), so each goal got defaults.
- **The architect's review** found the step lifecycle unsafe:
  - a step was known only by its position in whatever plan was stored, so after a re-plan ("skip mining today") the old step ran anyway and marked the new plan's step done;
  - the dusk plan could never fire: at dusk the night routine starts first and runs until dawn;
  - "stay with me" didn't stop plan steps;
  - a goal that threw left its step "running" and was proposed again forever;
  - every planning call deleted today's raw diary;
  - the planning call had the SDK's 10-minute timeout, and "what's your plan?" waited for it;
  - an empty plan was announced every 10 minutes; home chores always reported success.
- **Questions the review left for the owner**, answered with the safe default for now: a change to the plan stops the running step at once; after "stop" the step resumes after the quiet minute; a new plan replaces the old one; it also plans while the owner is offline; questions about its day, plan and spending are answered in code.

**How we handled it**

| Item | Handling |
|---|---|
| Diary | `planner/diary`, `planner/diaryHooks`: one line per event under the game day and part of the day, repeats counted, pickups tallied; written from task outcomes, milestones, deaths (with the mobs near), the owner's words, gifts. "What did you do today?" (`4bf93e5`) |
| Cost | `planner/cost`: every call priced and added to `usage.json` by month and purpose; `LLM_MONTHLY_CAP_USD` (default 10) stops all model calls past it. "How much have you spent?" (`6db630a`) |
| Planner | `planner/goals` (8 goals with a "possible now?" check, the menu), `planner/plan` (strict schema, validator: 3–8 steps enforced in code, topped up with open milestones; rejected steps in the diary), `planner/planner` (context, the call, guards), `planner/runner` (steps in B5); the curriculum falls back to the next milestone without a plan step; "what's your plan?" and changes in the owner's words (`b0e0f2b`) |
| Review fixes | Plan ids; one tested status rule; try/catch; the night gate on resume; dusk planned before the night routine; "stay with me" covers plan steps; raw diary kept, summaries only shorten the request; 20 s timeout and no retries; empty plans back off; home chores a skill with a typed result; diary, plan and spending questions in code (`78837a2`) |

**Outcome and what follows**
- **Tests:** 233 pass.
- **Not yet seen in the game:** all of Phase 7. The plan's in-game check: let the bot live alone for 3–5 in-game days and read the diary; check the plans make sense and get carried out; cut the network for a day and confirm the fallback; check the logged cost.
- **Left from the phase:** a policy check in the validator (keep-out areas, a server profile); deeper feasibility for `craft` (today any recipe passes); sharing the plan when the owner is online but quiet (only on joining today); the bot's own day counter instead of the world clock, which `/time set` and other dimensions can move; the Narrator's "once per N minutes"; marking an unreachable table.
- **Next:** the Phase 7 game test, then Phase 8 (companion roles) or Phase 9.
