# Current minecraft-gpt codebase map (as-is baseline)

Scope: HEAD `78e3409` ("Make 'stop' interrupt commands; stop endless wood gathering; clean AI output", committed 2026-11-23) plus uncommitted working-tree changes in `src/actions/ensure.ts`, `src/actions/ensureTools.ts`, `src/commands/CraftStoneTools.ts`, `src/commands/CraftWoodenTools.ts` (bounded retry loops via `shouldGiveUp`, null-aware tool-count defaults). All citations are repository-relative paths in `/Users/travnikov/PetProjects/minecraft-gpt`; line numbers refer to the working tree on 2026-11-24. Source size: about 8,600 lines of TypeScript across 63 `.ts` files (32 command files, 15 action files, 7 managers/progress files, utils, schemas, config).

---

## 1. Entry point and lifecycle (src/index.ts, env and config)

### Takeaway
`src/index.ts` is both the composition root and a mutable global: it exports `let bot`, which is swapped on every reconnect. Plugins, timers and the health listener are attached once per bot instance on its first `spawn`. A 1.5 s `setInterval` drives the command queue. Only four environment variables are read. `src/config/botConfig.json` is never imported.

### Cited Findings
- `loadDb()` is called at module top level **without `await`** before the bot is created — [src/index.ts#L18-L19](src/index.ts)
- Connection options are only `host`, `port`, `username` (from `BOT_USERNAME`, default `"MinecraftGPT"`). No `auth`, `version` or password is passed — [src/index.ts#L21-L25](src/index.ts)
- `export let bot: mineflayer.Bot = createBot();` The comment says other modules see a new instance "through ES module live bindings, so always read `bot` at call time" — [src/index.ts#L33-L38](src/index.ts)
- Reconnect uses exponential backoff: 5 s base, doubling, capped at 60 s (`RECONNECT_BASE_DELAY_MS`, `RECONNECT_MAX_DELAY_MS`). It is triggered from the `end` event, guarded by a single pending `reconnectTimer`, and resets `isProcessing = false` before `bot = createBot()` — [src/index.ts#L27-L31](src/index.ts), [src/index.ts#L129-L151](src/index.ts)
- `reconnectAttempts` is reset to 0 on the first `spawn` of a new instance — [src/index.ts#L92-L95](src/index.ts)
- `initializeBot` (run from `once("spawn")`) does the following:
  - loads 5 plugins: pathfinder, pvp, auto-eat, tool and armor-manager
  - configures pathfinder `Movements`: `allow1by1towers`, `canDig`, `canOpenDoors`, `maxDropDown=5`, and dig/place/entity cost 6
  - configures auto-eat with `startAt: 14`, `healthThreshold: 10` and offhand, then enables it
  - starts `nightDefense(1000)` and `monitorHealth()`

  — [src/index.ts#L48-L88](src/index.ts)
- `relogBot(reason, timeoutMs=60000)` calls `oldBot.quit()`. That triggers `end`, which schedules a reconnect. The function then polls every 500 ms until a new instance with `entity` exists. It is used only by `unstuck.ts` — [src/index.ts#L153-L167](src/index.ts), [src/actions/unstuck.ts#L102-L125](src/actions/unstuck.ts)
- Command loop: `setInterval(..., 1500)` skips while `isProcessing` is set or `!bot.entity` (disconnected), and otherwise awaits `executeCommands()` — [src/index.ts#L169-L181](src/index.ts)
- `env.ts` reads `SERVER_HOST` (default `"localhost"`), `SERVER_PORT` (default `"1024"`, parsed as int) and `OPENAI_API_KEY`. A missing API key **throws at import time** — [src/config/env.ts#L5-L12](src/config/env.ts)
- The only other `process.env` read is `BOT_USERNAME` in index.ts. A grep for `process.env` over `src/` returns 4 hits in total — [src/index.ts#L24](src/index.ts), [src/config/env.ts](src/config/env.ts)
- `src/config/botConfig.json` defines `botName: "Minecraft-GPT"`, `personality: "friendly"`, `defaultTasks: ["gather_resources","build_shelter"]` and `maxIdleTime: 300`. A grep for `botConfig` in `src/` finds **no importer** — [src/config/botConfig.json](src/config/botConfig.json)
- README documents `SERVER_PORT=25565` in `.env`. The code default is 1024 — [README.md](README.md), [src/config/env.ts#L7](src/config/env.ts)
- Scripts: `start` = `bun run src/index.ts`, `tsc` = `tsc --noEmit`. The runtime is Bun, which auto-loads `.env` — [package.json](package.json), [README.md](README.md)

### Inferences
- Because `bot` is a reassigned module export, every module that does `import { bot } from ".."` is coupled to the composition root. That is 40+ files. The live-binding trick works in ESM, but it makes every action implicitly global and single-instance.
- `botConfig.json` is dead configuration. The bot name and personality are hardcoded in the system prompt (`aiManager.ts`) and in the greeting (`index.ts#L113`).
- No `auth` option is passed. This suggests the bot targets offline-mode (cracked or LAN) servers. Inferred from the options object, not tested.
- The un-awaited `loadDb()` creates a small race: a chat-triggered `addCommandToQueue` that ran before the read finished would hit default data. In practice the spawn delay probably hides this.

### Gaps
- Whether the 1.5 s loop and the `isProcessing` flag can deadlock if `executeCommands()` hangs. `processCommand` races against an abort signal, but a command that never settles and is never aborted would keep `isProcessing` true until the 5-minute monitor aborts it. That was not tested at runtime.

---

## 2. Event routes (mineflayer events and timers → reactions)

### Takeaway
There are 8 `bot.on/once` registrations in index.ts and 1 in health.ts, plus 3 interval/timer systems: the command loop, nightDefense and the per-command progress monitor. Only owner chat that produces a tool call (other than `stop`) goes through the command queue. Every reflex runs directly against `bot` and competes with the queued command for the pathfinder, pvp and held item. Those reflexes are the defense, health, eat, greeting, respawn, stop and chat-interrupt reactions.

### Cited Findings
| Event / timer | Registered at | Reaction | Uses queue? |
|---|---|---|---|
| `once("spawn")` | [src/index.ts#L92-L95](src/index.ts) | reset backoff, `initializeBot` (plugins, movements, autoEat, nightDefense, monitorHealth) | no |
| `on("spawn")` (first spawn and every respawn after death) | [src/index.ts#L97-L100](src/index.ts) | `handleBotRejoin()`: aborts the current command's AbortController and clears `currentCommand` but **does not remove it from the queue** | indirect (command re-runs) — [src/managers/actionManager.ts#L243-L253](src/managers/actionManager.ts) |
| `on("chat", username, message)` | [src/index.ts#L102-L108](src/index.ts) | ignores own messages; `await pathfinder.stop()` **for every chat line from anyone**, then fire-and-forget `initiateActionFromAI(username, message)` | AI result is queued, except `stop` |
| `on("playerJoined")` | [src/index.ts#L110-L114](src/index.ts) | `chat("Hello <name>! I am MinecraftGPT...")` | no |
| `on("breath")` | [src/index.ts#L116-L118](src/index.ts) | `currentBot.respawn()` | no |
| `on("kicked")`, `on("error")` | [src/index.ts#L120-L127](src/index.ts) | `console.error` only | no |
| `on("end")` | [src/index.ts#L129-L132](src/index.ts) | `scheduleReconnect()` | no |
| `bot.on("health")` | [src/actions/health.ts#L12-L52](src/actions/health.ts) | if health dropped by 2 or more: chats "Ouch!". With a 3 s cooldown: if health < 7, `emergencyRetreat` (pvp.stop + autoEat.eat; the retreat itself is a TODO), otherwise `defendFromAttack` (equip best melee + `defendSelf(16)`). If health < 10: chats and `autoEat.eat()` | no |
| `setInterval(checkForHostiles, 1000)` (nightDefense) | [src/actions/combat.ts#L339-L378](src/actions/combat.ts), started with `nightDefense(1000)` at [src/index.ts#L81-L82](src/index.ts) | at night (`timeOfDay` 13000–23000), if `getPriorityTargets(16)` is non-empty: chat "Night defense activated!" then `defendSelf(16)`, which equips, applies tactics (pathfinder goals) and calls `bot.pvp.attack`, then chats again. The interval is cleared on `bot.once('end')`. Startup also chats "Enabling night defense system..." | no |
| `setInterval(..., 1500)` command loop | [src/index.ts#L172-L181](src/index.ts) | `executeCommands()` | this *is* the queue |
| `setTimeout(checkActionProgress, 5000)` chain | [src/managers/actionManager.ts#L153-L198](src/managers/actionManager.ts) | 5-min timeout → cancel. Stuck detection → `unstuck()` / relog | queue supervisor |
| Plugin-internal loops | mineflayer-pvp `physicsTick` update (patched from `physicTick`) — [patches/mineflayer-pvp@1.3.2.patch](patches/mineflayer-pvp@1.3.2.patch); auto-eat and armor-manager run their own listeners | eating, armor equip, pvp swings | no |
- `defendSelf` calls `bot.pvp.attack(target)` without `await`, and chats "No hostile entities found nearby to defend against." when there are none — [src/actions/combat.ts#L88-L111](src/actions/combat.ts)
- `useTacticsForTarget` calls `bot.pathfinder.setGoal(null)` and then sets its own `GoalFollow`/`GoalBlock` with a `new Movements(bot)`. This replaces the tuned movements configured in index.ts — [src/actions/combat.ts#L213-L262](src/actions/combat.ts)
- `monitorHealth` keeps `previousHealth` and `lastDamageTime` in module scope, so they persist across bot instances — [src/actions/health.ts#L6-L9](src/actions/health.ts)

### Inferences
- **Reactions that bypass the queue:** stop fast-path, chat-interrupt (`pathfinder.stop` on any chat), the immediate AI text reply, nightDefense, health-based defense and eating, the auto-eat plugin, the armor-manager plugin, playerJoined greeting, breath→respawn, the stuck monitor's unstuck/relog, and reconnect. None of these coordinates with `actionManager`'s `currentCommand`, so a reflex and a queued command can fight over `pathfinder.setGoal`, `pvp` and `equip`.
- Any chat line stops the pathfinder: other players talking, or another bot. That can make a running queued command's `pathfinder.goto` reject. Most actions catch this and report failure. Some, like `collectBlock`, `continue` their loop.
- `breath` fires when the oxygen level changes, for example underwater. Calling `respawn()` there looks like a leftover or mistaken handler, perhaps intended for `death`. This is an inference from the event name; runtime behaviour was not verified.
- nightDefense at a 1 s interval will spam chat ("Night defense activated!" plus "Defending myself against...") every second while a hostile is within 16 blocks at night.
- Reflex handlers run outside the `AsyncLocalStorage` context, so `isCommandCancelled()` is always `false` inside them and "stop" cannot cancel them. `haltBot` does call `pvp.stop()` and `pathfinder.stop()`, but the next nightDefense tick re-engages.

### Gaps
- Exact mineflayer 4.39 semantics of `respawn()` when the bot is alive, and of the `breath` event frequency, were not checked against mineflayer source.

---

## 3. Chat → LLM → command route

### Takeaway
The pipeline is stateless and single-turn. Each chat line becomes one Chat Completions call: model `gpt-6-luna`, `reasoning_effort: "none"`, a fixed system prompt, and all 32 commands offered as strict tools. **Only the first tool call** is used. The text reply is sent to chat immediately. `stop` bypasses the queue. Other tool calls are name-normalized and persisted to the lowdb queue at priority 3. Commands run one at a time with a 5-minute timeout, stuck detection and cooperative cancellation through an `AsyncLocalStorage<AbortSignal>`.

### Cited Findings
**Prompt and model**
- System prompt: "You are MinecraftGPT ... Talk like a friendly, enthusiastic 12-year-old". It instructs the model to:
  - call the *one* tool that best matches the request
  - use exact Minecraft IDs (e.g. `oak_log`)
  - reply in plain text of 1–2 sentences
  - never use JSON or markdown in a reply
  - ask a short clarifying question when unclear

  — [src/managers/aiManager.ts#L15-L23](src/managers/aiManager.ts)
- Request: `model: "gpt-6-luna"`, `reasoning_effort: "none"`, messages = `[system, {role:"user", content: "${username}: ${userMessage}"}]`, `tools`. There is **no conversation history, no world/inventory state, and no tool-result feedback loop** — [src/managers/aiManager.ts#L44-L69](src/managers/aiManager.ts)
- The full OpenAI response object is `console.log`ged. On API error the function returns `null`, and the user is told "I'm having trouble processing that request right now..." — [src/managers/aiManager.ts#L62](src/managers/aiManager.ts), [src/managers/aiManager.ts#L78-L84](src/managers/aiManager.ts)
- Only `message.tool_calls?.[0]` of type `function` is taken. Content text and a tool call may both be present — [src/managers/aiManager.ts#L86-L96](src/managers/aiManager.ts)

**Dispatch in `initiateActionFromAI`**
- `JSON.parse(arguments)`. If the action is `BotCommands.Stop`, it runs `await stopEverything()` and then `executeTool("stop")` directly, which is the queue bypass — [src/managers/aiManager.ts#L126-L139](src/managers/aiManager.ts)
- Otherwise, if `isBotAction`, it normalizes the values of the argument keys in `MINECRAFT_ID_ARGS = {itemName, item_name, blockType, mobType}` with `normalizeMinecraftName`. It then calls `addCommandToQueue({command, id: crypto.randomUUID(), priority: 3, retryCount: 0, args})` — [src/managers/aiManager.ts#L25-L26](src/managers/aiManager.ts), [src/managers/aiManager.ts#L140-L161](src/managers/aiManager.ts)
- The text `response`, if present, is sent with `bot.chat(response)` after queueing, so before the command executes — [src/managers/aiManager.ts#L170-L172](src/managers/aiManager.ts)

**Tools**
- `toolManager.ts` is a thin pass-through. `tools = [...availableCommands]`, and `executeTool(command, args)` looks up `commandRegistry[command].execute(args)` — [src/managers/toolManager.ts](src/managers/toolManager.ts)
- `registry.ts` imports 32 command modules. Each exports `{ description, parameters (zod object), execute(args) }`. `availableCommands` maps every entry through `zodFunction({name, parameters, description})` from `openai/helpers/zod` — [src/commands/registry.ts#L40-L90](src/commands/registry.ts)
- `zodFunction` in the installed openai SDK emits `{type:"function", function:{name, parameters, strict: true, description}}` — [node_modules/openai/helpers/zod.js](node_modules/openai/helpers/zod.js) (lines ~255–268). README confirms the bot "depends on strict tool arguments" and explains why OpenRouter is not used — [README.md](README.md)
- The `BotCommands` enum has 32 values. Naming is inconsistent: `SetBase = "SetBase"` is PascalCase, all others are camelCase — [src/commands/types.ts#L4-L37](src/commands/types.ts)
- Because strict mode requires every property, optional parameters are modelled as `.nullable()`, and commands apply defaults with `||` or `??`. For example, CraftStoneTools and CraftWoodenTools now treat "all fields null" as "use defaults" (uncommitted change) — [src/commands/CraftStoneTools.ts#L16-L51](src/commands/CraftStoneTools.ts), [src/commands/CraftWoodenTools.ts#L13-L49](src/commands/CraftWoodenTools.ts)
- Each command re-validates `args` with `parameters.safeParse` (most) or `.parse` (GoToPlayer and ShowMeBase, which throw on bad input) — [src/commands/GoToPlayer.ts#L24-L28](src/commands/GoToPlayer.ts), [src/commands/ShowMeBase.ts#L24-L28](src/commands/ShowMeBase.ts)

**Queue persistence (persistenceManager)**
- `addCommandToQueue` defaults `retryCount` to 3 when undefined and validates with `CommandSchema`. It then **drops duplicates**, meaning the same `command` with `JSON.stringify(args)`-equal args, pushes the command and writes the whole db — [src/managers/persistenceManager.ts#L66-L103](src/managers/persistenceManager.ts)
- `CommandSchema = {id: string, command: nativeEnum(BotCommands), priority: number default 5, args: any optional, retryCount: number default 3}` — [src/schemas/mainSchemas.ts#L4-L11](src/schemas/mainSchemas.ts)
- `getAllCommands()` returns the live `db.data.commands` array, not a copy — [src/managers/persistenceManager.ts#L130-L133](src/managers/persistenceManager.ts)

**Execution and monitoring (actionManager)**
- Constants: `MAX_ACTION_EXECUTION_TIME = 5 min`, `ACTION_CHECK_INTERVAL = 5 s`, `STUCK_THRESHOLD = 3` consecutive checks, `MAX_RECOVERIES_PER_COMMAND = 2` — [src/managers/actionManager.ts#L17-L21](src/managers/actionManager.ts)
- `executeCommands`:
  - returns early during recovery
  - otherwise, when `currentCommand === null`, it sorts commands by `priority`, where a lower number runs first (default 5)
  - it then awaits `processCommand` on the first one only ("one per cycle")
  - while a command is active, it just logs "Still executing ..."

  — [src/managers/actionManager.ts#L254-L288](src/managers/actionManager.ts)
- `processCommand`:
  - creates a fresh `AbortController`
  - runs `commandSignal.run(abort.signal, () => executeTool(...))` raced against the abort promise
  - on success, removes the command from the db
  - on abort, it returns without removing the command
  - on a thrown error (not aborted, no recovery in progress), it decrements `retryCount` in place and, if the result is ≥ 0, re-adds the command with `priority = max(1, priority-1)`

  — [src/managers/actionManager.ts#L81-L151](src/managers/actionManager.ts)
- `isCommandCancelled()` reads `commandSignal.getStore()?.aborted` — [src/managers/actionManager.ts#L32-L43](src/managers/actionManager.ts)
- `cancelCurrentCommand(reason)` aborts, removes the command from the db and calls `haltBot()`: `pathfinder.stop`, `setGoal(null)`, `pvp.stop`, `stopDigging`, `clearControlStates`. `stopEverything()` does the same and then `removeAllCommands()` — [src/managers/actionManager.ts#L45-L79](src/managers/actionManager.ts)
- `checkActionProgress`:
  - cancels with a chat message ("That took too long...") after 5 minutes
  - counts "stuck" only when the position delta is ≤ 0.1 on all axes **and** `bot.pathfinder.isMoving()`
  - after 3 stuck checks it calls `handleStuckAction`, which runs `unstuck()` up to 2 times per command and then cancels with "I'm stuck, so I gave up..."

  — [src/managers/actionManager.ts#L158-L241](src/managers/actionManager.ts)
- `unstuck()`:
  - stops pathfinding and dismounts any vehicle
  - `moveAway(5)`
  - if that fails, tries jump and strafe control states
  - after 3 failed attempts and with more than 60 s since the last attempt, it relogs through `relogBot` (`relogToServer`)

  — [src/actions/unstuck.ts#L11-L96](src/actions/unstuck.ts)
- Cooperative cancellation checks (`isCommandCancelled`) exist only in `actions/gatherWood.ts`, `actions/ensure.ts` (`shouldGiveUp`, uncommitted), `commands/AvoidEnemies.ts` and `commands/GatherWood.ts` — grep results; [src/actions/ensure.ts#L20-L34](src/actions/ensure.ts), [src/actions/gatherWood.ts#L31-L35](src/actions/gatherWood.ts)
- The `Stop` command itself only calls `pathfinder.stop()`, `removeAllCommands()` and chats "Standing still!" — [src/commands/Stop.ts](src/commands/Stop.ts)

### Inferences
- **Abort is not preemption.** `Promise.race` lets the manager move on, but the abandoned command's promise keeps running unless it polls `isCommandCancelled()` or its pending `pathfinder.goto`/`dig` rejects because of `haltBot`. Long loops with no cancellation check can keep driving the bot after "stop" or a timeout, and then overlap with the next command. Examples: `ensureLocation` (`while(true)`, [src/actions/ensureLocation.ts#L35-L155](src/actions/ensureLocation.ts)), `collectBlock` (`while (collected < num)` with `catch → continue`, [src/actions/collectBlock.ts#L45-L99](src/actions/collectBlock.ts)), `smeltItem`, and `Unstack`.
- **`Unstack` is a synchronous busy loop.** `while(true)` calls `__actionsDelay(1000)` without `await` ([src/commands/Unstack.ts#L43-L66](src/commands/Unstack.ts)). With no awaited code in the normal path, it would block the event loop. In that state chat, physics, the monitor and abort cannot run until `stuckTime` exceeds `maxStuckTime ?? 1000` seconds. This is an inference from code reading and was not run.
- **The retry path likely never re-queues and instead re-runs forever.** On a thrown error, the failed command is not removed. `addCommandToQueue` then sees an identical command already in the queue and skips the "retry". Because `nextCommand` is the live db object, its `retryCount` keeps decreasing while it stays queued, and it is re-picked every 1.5 s. Most commands catch their own errors, which limits how often this happens; `GoToPlayer` and `ShowMeBase` use `.parse()` and can throw. This is an inference from code reading.
- On a respawn after death, `handleBotRejoin` aborts the running command but leaves it in the queue, so it restarts after respawn. The queue also survives process restarts: `db.json` currently holds a pending `craftStoneTools` command.
- Concurrent chats trigger parallel OpenAI calls. Their results are queued in completion order, not message order. All AI commands get the same priority (3), so they run effectively FIFO, with sort-stability caveats. Retries get priority 2→1 and jump ahead.
- `priority` is the only scheduling signal, and nothing ever enqueues at a priority other than 3 (AI) or the retry-derived values.

### Gaps
- Whether OpenAI returns multiple parallel tool calls for this prompt in practice. `parallel_tool_calls` is not set, and extra calls are silently dropped.
- No telemetry exists in the repo on how often the timeout, stuck or relog paths fire.

---

## 4. Commands → actions layering, cycles and the global `bot` singleton

### Takeaway
The intended layering is commands (LLM-facing tool adapters) → actions (skills) → mineflayer and plugins. In practice it is porous:
- 12 command files talk to `bot`/pathfinder/inventory directly with their own helpers
- actions call each other in several mutual-recursion cycles (ensure ↔ crafting ↔ collectBlock ↔ ensureTools)
- low-level actions import `actionManager` for cancellation
- essentially every module imports the mutable `bot` from `src/index.ts`

### Cited Findings
**Command → action dependency map** (from imports):

| Command | Calls into |
|---|---|
| GoToPlayer | movement.goToPlayer/goToPosition, world.getNearbyPlayerNames, unstuck, plus direct `Movements` |
| GoToCoordinates | movement.goToPosition |
| GoToNamedLocation | movement.goToPosition + persistence getters (basement, crafting tables, furnaces, chests, mines; always `[0]`) |
| FollowPlayer | movement.followPlayer, world.getNearbyPlayerNames |
| GoToBlock | own O(r³) `bot.blockAt` scan (default r=50, cap 512) + movement.goToPosition |
| CollectBlocks | collectBlock |
| AttackNearest | combat.attackEntity/getPriorityTargets + direct `bot.entities` filter (substring match on mob name) |
| Hunting | combat.attackEntity, minecraftData.isHuntable, own `getNearestEntityWhere`, direct pathfinder |
| AvoidEnemies | combat.getPriorityTargets + direct pathfinder goals; checks `isCommandCancelled` |
| EquipBestWeapon | combat.equipBestMeleeWeapon/chooseWeaponForTarget/getPriorityTargets + direct inventory/equip |
| Unstack | movement.moveAway (busy loop, see §3) |
| GatherWood | actions/gatherWood; checks `isCommandCancelled` |
| CraftItem | crafting.craftRecipe |
| CraftWoodenTools | ensure.ensurePlanks/ensureSticks, crafting.craftRecipe, inventory.getItemCount |
| CraftStoneTools | ensureTools.ensurePickaxe, ensure.ensureCobblestone/ensureSticks, crafting.craftRecipe, inventory.getItemCount |
| RandomMovement | movement.goToPosition |
| SetBase | persistence get/saveBaseLocation, ensureLocation, ensureTools (axe/shovel/pickaxe), building.clearSite/buildShelter/setupTheShelter, movement |
| SetBasement | building.buildShelter |
| DigDiagonalTunnel | ensureTools.ensurePickaxe, digging.digDiagonalTunnel |
| PickupNearbyItems | worldInteraction.pickupNearbyItems |
| BuildStoneHouse | worldInteraction.placeBlock only |
| FindAndRememberNearChest | direct `bot.findBlocks`/`openChest`; module-local `chestMemory` |
| ReturnToBase / ShowMeBase | movement.goToPosition + persistence.getBaseLocation (+ world.getNearbyPlayerNames) |
| ListInventory | inventory.listInventory + persistence.syncInventory |
| CheckForItem / DiscardItem / GiveItemToAPlayer | inventory.checkForItem / discard / giveToPlayer (+ world) |
| TellLocation | movement.getBotPosition |
| UseNearbyObject / DeployVehicle | worldInteraction.useNearbyObject / deployVehicle |
| Stop | persistence.removeAllCommands + pathfinder.stop |

Sources: import lines in each `src/commands/*.ts` file; see [src/commands/registry.ts](src/commands/registry.ts) for the module list.

**Action-layer internal dependencies** (runtime imports):
- `movement` → `world`, `index`, `utility`; `world` → `minecraftData`, `index` — [src/actions/movement.ts#L3-L7](src/actions/movement.ts), [src/actions/world.ts#L3-L9](src/actions/world.ts)
- `worldInteraction` → `movement`, `world`, `minecraftData` — [src/actions/worldInteraction.ts#L1-L11](src/actions/worldInteraction.ts)
- `collectBlock` → `world`, `worldInteraction`, **`ensureTools`** — [src/actions/collectBlock.ts#L1-L7](src/actions/collectBlock.ts)
- `crafting` → `worldInteraction`, `movement`, **`collectBlock`**, **`ensure`** (ensureCraftingTable), `world`, `minecraftData` — [src/actions/crafting.ts#L3-L16](src/actions/crafting.ts)
- `ensure` → **`collectBlock`**, **`crafting`**, **`ensureTools`**, `gatherWood`, `inventory`, `movement`, **`managers/actionManager`** — [src/actions/ensure.ts#L5-L13](src/actions/ensure.ts)
- `ensureTools` → **`crafting`**, **`ensure`**, `inventory` — [src/actions/ensureTools.ts#L5-L8](src/actions/ensureTools.ts)
- `gatherWood` → `worldInteraction`, `movement`, `world`, **`managers/actionManager`** — [src/actions/gatherWood.ts#L1-L6](src/actions/gatherWood.ts)
- `digging` → `worldInteraction`, `inventory`, `ensure`, **`managers/persistenceManager`** — [src/actions/digging.ts#L1-L11](src/actions/digging.ts)
- `building` → `worldInteraction`, `digging`, `ensure`, `ensureTools`, `movement`, **`managers/persistenceManager`** — [src/actions/building.ts#L1-L30](src/actions/building.ts)
- `health` → `combat`; `unstuck` → `movement`, `index.relogBot` — [src/actions/health.ts#L3-L4](src/actions/health.ts), [src/actions/unstuck.ts#L1-L2](src/actions/unstuck.ts)
- `persistenceManager` imports `type DirectionType` from `actions/digging`. It is type-only and erased at runtime — [src/managers/persistenceManager.ts#L22](src/managers/persistenceManager.ts)

**Runtime import cycles identified:**
1. `index` → `aiManager`/`actionManager`/`combat`/`health` → (every module) → `index` (the `bot` binding). This is a cycle through the composition root.
2. `ensure` ↔ `ensureTools`.
3. `ensure` ↔ `crafting`.
4. `crafting` → `collectBlock` → `ensureTools` → `crafting`.
5. `ensure` → `collectBlock` → `ensureTools` → `ensure`.
6. `actionManager` → `toolManager` → `registry` → `commands/GatherWood` (and `AvoidEnemies`, `CraftStoneTools`, …) → `actions/gatherWood`/`ensure` → `actionManager`.
7. `aiManager` → `actionManager` → … → `index` → `aiManager`.

**Global singleton:**
- `import { bot } from "..", "../index" or "../index.js"` appears in `managers/aiManager`, `actionManager`, `botProgress`; `utils/utility` and `minecraftData`; all 15 action files except `crafting`/`ensure*` use one of the forms (those use `".."`); and 24 of 32 command files. Four helpers instead take `bot: Bot` as a parameter: `pickupNearbyItems`, `viewChest`, `getNearestBlock` in minecraftData, and the local helpers in GoToBlock/Hunting. The rest read the global — import grep output; [src/actions/worldInteraction.ts#L333-L363](src/actions/worldInteraction.ts)

**Duplicated helpers:**
- Two `isHostile` implementations. [src/actions/combat.ts#L32-L36](src/actions/combat.ts) uses a name allow-list of 11 mobs. [src/utils/minecraftData.ts#L102-L109](src/utils/minecraftData.ts) treats any `type === "mob"` except golems as hostile.
- Three "nearest block" finders: `world.getNearestBlock` (by numeric id), `minecraftData.getNearestBlock` (by name predicate), and GoToBlock's own brute-force scan.
- Two `getNearestEntityWhere`: [src/actions/world.ts#L133-L142](src/actions/world.ts) and [src/commands/Hunting.ts#L21-L31](src/commands/Hunting.ts).
- Stub exports in building.ts: `buildShack`, `buildWoodenHouse`, `buildStoneHouse`, `buildCastle`, `buildFortress`, `buildTower` are empty — [src/actions/building.ts#L315-L322](src/actions/building.ts)
- A large share of the action code comes from mindcraft. README: "heavily inspired by mindcraft and reuses many functions from it". `crafting.ts` still carries the header `// src/agent/library/skills/crafting.ts` — [README.md](README.md), [src/actions/crafting.ts#L1](src/actions/crafting.ts)

### Inferences
- The action modules form one strongly connected cluster (ensure / ensureTools / crafting / collectBlock), and two "managers" leak into it: actionManager for cancellation and persistenceManager for world memory. As a result there is no clean skill layer that could be unit-tested or reused without the queue and db.
- Bun/ESM tolerates these cycles because the cross-module uses happen at call time, not at module-evaluation time. They would become a hazard if any module started using an import at top level.
- `BuildStoneHouse` passes loop indices as absolute world coordinates (`placeBlock("cobblestone", x, y, z)` with x,y,z in 0..width), and `roofY` is absolute while x and z are relative. The house would therefore be attempted near world origin, not at the bot — [src/commands/BuildStoneHouse.ts#L35-L67](src/commands/BuildStoneHouse.ts). This is an inference from code reading.

### Gaps
- A dynamic import graph (for example madge) was not generated. The cycle list above is derived by hand from `grep 'from "\.'` and is complete for runtime imports to the best of that reading.

---

## 5. State and memory (db.json vs live mineflayer state)

### Takeaway
Persistent state is one lowdb JSON file (`db.json` in the current working directory), schema-validated with zod on every write. It holds the command queue, an unused lore log, an inventory snapshot written only by `ListInventory`, and a single base record with POIs (basement, crafting tables, furnaces, chests, mines). Everything a decision actually uses at runtime is read live from mineflayer: inventory, entities, blocks, position, time and health. The stored POIs are never reconciled with the world.

### Cited Findings
- `dbPath = resolve("db.json")`, `new Low<DbSchemaType>(new JSONFile(...), {commands:[], lore:{events:[]}, inventory:[], botProgress:{currentLevel:1, craftableTier:1, unlockedRecipes:[]}})` — [src/managers/persistenceManager.ts#L24-L36](src/managers/persistenceManager.ts)
- `loadDb` reads the file, `DbSchema.safeParse`s it, replaces `db.data` with the parsed result and writes it back. `saveDb` validates and writes the whole file on every mutation — [src/managers/persistenceManager.ts#L38-L64](src/managers/persistenceManager.ts)
- `DbSchema`: `commands[]`, optional `lore{events[]}`, optional `inventory[{name,count}]`, optional `botProgress{currentLevel, craftableTier, unlockedRecipes[]}`. Also optional `baseLocation{baseName, location, basementLocation?, craftTable[], furnace[], chests[{type enum Tools|RawResources|RefinedMaterials|Food|Miscellaneous, location, items[]}], mines[{name, direction, startsAt, endsAt, depth}]}` — [src/schemas/mainSchemas.ts#L13-L72](src/schemas/mainSchemas.ts)
- The `BotProgressType` in `schemas/types.ts` is a hand-written duplicate of `BotProgressSchema` rather than `z.infer` — [src/schemas/types.ts#L22-L26](src/schemas/types.ts)

**Writers and readers:**

| Field | Written by | Read by |
|---|---|---|
| commands | aiManager, actionManager (retry), Stop/stopEverything (clear) | actionManager.executeCommands |
| lore.events | `addLoreEvent` (only from loreManager, which is not imported anywhere) | `getAllLoreEvents` (only loreManager) |
| inventory | `syncInventory` from `commands/ListInventory` only — [src/commands/ListInventory.ts#L14-L17](src/commands/ListInventory.ts) | `getInventory` only from `BotProgress` (never instantiated) |
| botProgress | `saveBotProgress` (BotProgress only) | `getBotProgress` (BotProgress only) |
| baseLocation.location/baseName | `saveBaseLocation` from SetBase (only when no base exists; resets POI arrays) — [src/commands/SetBase.ts#L37-L50](src/commands/SetBase.ts) | SetBase, ReturnToBase, ShowMeBase, building.buildShelter |
| basementLocation | building.buildShelter — [src/actions/building.ts#L168](src/actions/building.ts) | building.setupTheShelter, GoToNamedLocation |
| craftTable / furnace / chests | building.setupTheShelter (fixed offsets from basement; chests always `type: "Miscellaneous", items: []`) — [src/actions/building.ts#L251-L304](src/actions/building.ts), [src/managers/persistenceManager.ts#L262-L282](src/managers/persistenceManager.ts) | GoToNamedLocation (always the first element) |
| mines | digging.digDiagonalTunnel when `tunnelName !== "basementEntrance"` (not awaited; silently skipped if no base exists) — [src/actions/digging.ts#L83-L92](src/actions/digging.ts), [src/managers/persistenceManager.ts#L285-L308](src/managers/persistenceManager.ts) | GoToNamedLocation |

- Current `db.json` contents:
  - 1 pending command (`craftStoneTools`, priority 3, retryCount 0)
  - `lore.events` is empty
  - a 12-entry inventory snapshot
  - a `baseLocation` named "base" at (-53,68,89) with a basement at (-53,64,95), 1 crafting table, 1 furnace, 3 chests (all `Miscellaneous`, `items: []`) and 0 mines
  - **no `botProgress` key**

  — [db.json](db.json)
- `FindAndRememberNearChest` keeps a module-scoped `chestMemory` that is **not persisted** and not linked to `baseLocation.chests` — [src/commands/FindAndRememberNearChest.ts#L17-L18](src/commands/FindAndRememberNearChest.ts), [src/commands/FindAndRememberNearChest.ts#L81-L100](src/commands/FindAndRememberNearChest.ts)
- In-memory (non-persisted) runtime state:
  - actionManager: `currentCommand`, `actionStartTime`, `lastBotPosition`, stuck counters, `currentAbort`
  - unstuck: attempt counters
  - health: `previousHealth`, `lastDamageTime`
  - index: reconnect counters and `isProcessing`
  - minecraftData: `fallbackData` and the item-class cache

  — respective files.
- Live reads dominate decisions: `bot.inventory.items()` (getItemCount, getInventoryCounts), `bot.findBlock(s)`, `bot.entities`/`nearestEntity`, `bot.entity.position`, `bot.time.timeOfDay`, `bot.health`/`food`, `bot.registry`, `bot.world.getBiome` — [src/actions/world.ts](src/actions/world.ts), [src/actions/inventory.ts#L263-L268](src/actions/inventory.ts), [src/actions/combat.ts#L345-L349](src/actions/combat.ts)

### Inferences
- **Stale:** the inventory snapshot is updated only when a player asks "list inventory". Crafting-table, furnace and chest coordinates are never verified, so they go stale if blocks are broken or moved. Chest `items` are always empty. A base can never be re-set because SetBase skips setup when a base exists and no command clears it.
- **Unused:** `lore` (no writer reachable), `botProgress` (no reader or writer reachable), the inventory snapshot (its only reader is unreachable), and `chests[].type`/`items`.
- The command queue is the only persisted field the main loop actually consumes. Persisting it means stale commands survive restarts and resume without fresh owner intent.
- lowdb writes the full JSON on every add/remove. That is acceptable at this scale, but there is no write serialization; concurrent async writes rely on lowdb's internal steno queue.

### Gaps
- Whether lowdb 7 serializes concurrent `db.write()` calls safely in this usage was not verified against lowdb source.

---

## 6. Progression / goal layer (botProgress, botLevels, loreManager)

### Takeaway
All three "higher-level" modules are dead code. Nothing imports `BotProgress`, `botLevels` or `loreManager`. There is no autonomous goal loop: the bot only acts on chat-derived commands and reflexes.

### Cited Findings
- `BotProgress` class:
  - six crafting tiers: Basic Survival, Stone Tools, Iron Working, Advanced Construction, Diamond Tools, Nether Exploration
  - each tier has `requiredItems` and `unlockedRecipes`
  - the constructor loads from the db and starts a 30 s `setInterval` that checks the db *inventory snapshot* for tier advancement and chats "I've learned how to craft N new items!"
  - `canCraftItem` checks recipe existence plus the unlocked set

  — [src/managers/botProgress.ts#L15-L237](src/managers/botProgress.ts)
- A grep for `BotProgress`, `botLevels` and `loreManager` across `src/` finds them only in their own files and in schema/type declarations. No `new BotProgress()` exists anywhere — grep output.
- Tier data uses non-ID names: `"wooden_planks"` and `"planks"` are not real item IDs (real IDs are `oak_planks`, etc.) — [src/managers/botProgress.ts#L21](src/managers/botProgress.ts), [src/managers/botProgress.ts#L38](src/managers/botProgress.ts)
- `src/progress/botLevels.ts` exports 2 levels: level 1 has no requirements, level 2 requires `planks ×20` and `cobblestone ×30`. Levels 3–4 and `requiredTasks` are commented out — [src/progress/botLevels.ts](src/progress/botLevels.ts)
- `loreManager` provides `addNewLoreEvent`, `fetchAllLoreEvents`, `addLoreForAction` and `formatLoreEvents`. It is not imported anywhere, and `db.json` `lore.events` is empty — [src/managers/loreManager.ts](src/managers/loreManager.ts), [db.json](db.json)
- Commit `37e91f8` ("Add bot progress tracking; define BotProgressSchema...") introduced the progress schema. It was never wired into index.ts — `git log --oneline`
- README describes the aspiration that the bot behaves "like a new player—learning, exploring" — [README.md](README.md)

### Inferences
- The only "goal decomposition" in the live code is the hardcoded `ensure*` dependency chains (crafting table → planks → logs → gatherWood; pickaxe → planks/sticks/cobblestone) and the scripted SetBase pipeline. There is no planner, memory-of-goals or idle behaviour. `maxIdleTime` and `defaultTasks` in botConfig.json are unused.
- If BotProgress were instantiated as-is, it would read the stale ListInventory snapshot, not live inventory.

### Gaps
- None on the code side. Design intent beyond the commit messages and README is undocumented.

---

## 7. Identifier handling (strings vs numeric IDs, normalization, substring matching)

### Takeaway
Identifiers are mostly snake_case **string names** compared directly against `item.name`, `block.name` or `entity.name`. They are converted to **numeric IDs** only for:
- `bot.findBlocks({matching: ids})`
- `bot.recipesFor(id)`
- `furnace.putInput`

That conversion goes through `minecraftData.ts`, which prefers the connected server's `bot.registry` (fallback version 1.21.4). Model output is normalized only for four argument keys. Many lookups use `name.includes(...)` substring matching, which silently over-matches. The name→id helpers return `0` for unknown names, and 0 is air.

### Cited Findings
- `gameData()` returns `bot.registry` when `registry.version` is set; otherwise it uses a cached `minecraftData("1.21.4")`. `makeItem` builds a version-matched `prismarine-item` class — [src/utils/minecraftData.ts#L14-L43](src/utils/minecraftData.ts), [src/utils/minecraftData.ts#L276-L284](src/utils/minecraftData.ts). This was introduced in commit `639fd28` ("Use the server's Minecraft version for game data").
- `getItemId(name)` returns `item?.id || 0`, and `getBlockId(name)` returns `block?.id || 0`. Unknown names map to `0` — [src/utils/minecraftData.ts#L111-L125](src/utils/minecraftData.ts)
- Callers test for `null`, not `0`:
  - `world.getNearestBlocks` pushes the id when `block_id !== null`, so an unknown name becomes id 0 — [src/actions/world.ts#L71-L88](src/actions/world.ts)
  - `craftRecipe` checks `itemId === null` — [src/actions/crafting.ts#L51-L55](src/actions/crafting.ts)
- `normalizeMinecraftName`: trim, lowercase, strip `minecraft:`, and collapse whitespace or hyphens to `_` — [src/utils/utility.ts#L14-L24](src/utils/utility.ts)
- It is applied only to the argument keys `itemName`, `item_name`, `blockType` and `mobType` in `initiateActionFromAI` — [src/managers/aiManager.ts#L25-L26](src/managers/aiManager.ts), [src/managers/aiManager.ts#L142-L147](src/managers/aiManager.ts)
- It is not applied to `vehicleType`, `objectType`, `weaponType`, `player_name`, `targetName` and so on.
- `craftRecipe` has its own partial normalization: `replace(" ", "_")` (first space only) plus a `plank`→`planks` fix — [src/actions/crafting.ts#L47-L49](src/actions/crafting.ts)
- `collectBlock` expands short names into variants. `coal/diamond/emerald/iron/gold/lapis_lazuli/redstone/copper` become `X_ore` and `deepslate_X_ore`; `*ore` adds `deepslate_*`; `dirt` adds `grass_block`. The raw short name stays in the list — [src/actions/collectBlock.ts#L19-L41](src/actions/collectBlock.ts)
- **Substring matching on names** occurs in 52 places, the large majority with `.name.includes(`. Notable cases:
  - `getItemCount(name)` sums every item whose name *contains* `name` — [src/actions/inventory.ts#L263-L268](src/actions/inventory.ts). Callers pass `planks`, `coal`, `chest`, `furnace`, `torch`, `stick`, `cobblestone`, `diamond`, `dirt`, … (grep: 21 distinct literals).
  - `ensureTool` counts tools by `item.name.includes(toolType)` — [src/actions/ensureTools.ts#L49-L52](src/actions/ensureTools.ts)
  - `gatherWood`/`getLogsCount`/`ensurePlanks`/`ensureLocation` use `name.includes("log")` — [src/actions/gatherWood.ts#L49-L52](src/actions/gatherWood.ts), [src/actions/gatherWood.ts#L113-L117](src/actions/gatherWood.ts), [src/actions/ensure.ts#L86-L88](src/actions/ensure.ts), [src/actions/ensureLocation.ts#L47-L51](src/actions/ensureLocation.ts)
  - `ensurePlanks` derives the plank ID with `log.name.replace("_log","") + "_planks"` — [src/actions/ensure.ts#L102-L113](src/actions/ensure.ts)
  - `placeBlock` picks the inventory item via `name.includes(blockType)` — [src/actions/worldInteraction.ts#L29-L35](src/actions/worldInteraction.ts)
  - `discard`, `equip`, `putInChest` and `checkForItem` use `includes` — [src/actions/inventory.ts#L16-L63](src/actions/inventory.ts)
  - AttackNearest and AvoidEnemies match mob type with `entity.name.toLowerCase().includes(mobType)` — [src/commands/AttackNearest.ts#L36-L41](src/commands/AttackNearest.ts)
  - combat weapon selection uses `includes("bow")`, `"sword"`, `"axe" && !"pickaxe"` — [src/actions/combat.ts#L135-L188](src/actions/combat.ts)
  - FindAndRememberNearChest categorizes contents by substrings such as `"food"`, `"log"` and `"plank"` — [src/commands/FindAndRememberNearChest.ts#L21-L55](src/commands/FindAndRememberNearChest.ts)
- `isHuntable` uses an allow-list of 7 animals and `!mob.metadata[16]` as its "not baby" check. The metadata index is version-dependent — [src/utils/minecraftData.ts#L88-L100](src/utils/minecraftData.ts)
- Hardcoded name tables: `WOOD_TYPES` (6 woods, missing mangrove/cherry/bamboo/pale_oak), the door list, the smelting map, the animal-source map and the `attackDamageMap` — [src/utils/minecraftData.ts#L45-L86](src/utils/minecraftData.ts), [src/actions/movement.ts#L149-L161](src/actions/movement.ts), [src/utils/utility.ts#L52-L76](src/utils/utility.ts)

### Inferences
- **Unknown names alias to air.** For example, `collectBlock("iron")` includes the non-block name `"iron"`. Through `getBlockId` → 0 that adds air to the `findBlocks` matching set. Under modern registries block id 0 is `air`. The likely result is the bot "collecting" air blocks: `breakBlockAt` skips air but `collected++` still runs, so it could report success falsely. This is an inference from code reading and was not run.
- **Substring over-matching:**
  - `ensureTool("axe")` counts pickaxes as axes, so `ensureAxe()` returns early when the bot holds only a pickaxe.
  - `getItemCount("diamond")` counts diamond tools and armour as raw diamonds in `hasResourcesForTool`.
  - `"stick"` matches `sticky_piston`, `"coal"` matches `charcoal`/`coal_block`, `"furnace"` matches `blast_furnace`/`furnace_minecart`, and `"chest"` matches `trapped_chest`/`chest_minecart`.
  - `ensurePlanks` builds invalid IDs from `stripped_*_log` (`stripped_oak_planks`).
  - `includes("log")` ignores nether stems (`crimson_stem`).
- The identifier contract is implicit. The prompt asks the model for exact IDs, but nothing validates arguments against `bot.registry` before execution. Validation is a zod `string()` only, and unknown names fail late, deep in an action.

### Gaps
- The exact block/item at id 0 in the server's registry was not verified (expected `air` for 1.13+).

---

## 8. Owner / permission concept

### Takeaway
There is no owner, allow-list or permission model. Any player whose chat reaches the bot (any username other than the bot's own) can trigger the LLM and every command, including `stop`, which clears the queue, and `giveItemToAPlayer`/`discardItem`.

### Cited Findings
- The chat handler's only filter is `if (username === currentBot.username) return;` — [src/index.ts#L103-L108](src/index.ts)
- `grep -niE "owner|permission|whitelist|allowlist|admin|trusted" src` returns no matches — grep output.
- The username is passed to the model only as text (`"${username}: ${message}"`) for context — [src/managers/aiManager.ts#L57](src/managers/aiManager.ts)
- Commands default the target player to "the nearest player" (`getNearbyPlayerNames(1000)[0]`) when `player_name` is null, not to the requester — [src/commands/FollowPlayer.ts#L36-L42](src/commands/FollowPlayer.ts), [src/commands/GiveItemToAPlayer.ts#L35-L41](src/commands/GiveItemToAPlayer.ts), [src/commands/GoToPlayer.ts#L39-L49](src/commands/GoToPlayer.ts), [src/commands/ShowMeBase.ts#L37-L43](src/commands/ShowMeBase.ts)
- README advertises "Bot-to-Bot Interaction" — [README.md](README.md)

### Inferences
- Because the requesting username is not carried into the queued command (`CommandType` has no `requestedBy`), "come here", "follow me" and "give me" resolve to the *nearest* player unless the model fills in `player_name` from the `username:` prefix.
- Bots chatting with each other would each trigger an OpenAI call per line, and each line also stops the other's pathfinder. There is no rate limiting.

### Gaps
- None.

---

## 9. Output channels (chat and console)

### Takeaway
Player-facing output is raw `bot.chat` scattered across all layers: 127 call sites, including deep action code. There is no central message/notification service, no verbosity control and no rate limiting. Diagnostics go to `console.log/error`, about 430 call sites with no logger abstraction or levels.

### Cited Findings
- `bot.chat(` call sites by directory:
  - `src/commands`: 80
  - `src/actions`: 41
  - `src/managers`: 4 (aiManager 1, actionManager 2, botProgress 1)
  - `src/utils`: 1 (`utility.log(..., sendToChat)`)
  - `src/index.ts`: 1 (`currentBot.chat` greeting)
  - Total ≈ 127 — grep output.
- Heaviest emitters: `commands/EquipBestWeapon.ts` (13), `actions/combat.ts` (13), `actions/health.ts` (9), `commands/GoToPlayer.ts` (7), `actions/ensure.ts` (7), `commands/SetBase.ts` (6), `commands/BuildStoneHouse.ts` (6) — grep output.
- Console calls (`console.log|error|warn`) total 428 across `src` — grep output.
- The AI reply is sent verbatim through `bot.chat(response)`. The prompt forbids JSON/markdown because "it is shown as-is in Minecraft chat" — [src/managers/aiManager.ts#L22](src/managers/aiManager.ts), [src/managers/aiManager.ts#L170-L172](src/managers/aiManager.ts)
- Some messages include emoji or CJK glyphs ("⾕", ✅/❌) and multi-line text — [src/commands/SetBase.ts#L68](src/commands/SetBase.ts), [src/actions/ensureLocation.ts#L123-L150](src/actions/ensureLocation.ts)

### Inferences
- Because actions chat directly, a single command can emit many lines: for example the ensure chains plus combat equips. Reflexes such as nightDefense and health also chat independently. This makes chat noisy and hard to localize or route to one owner, for instance as whispers.
- Multi-line `bot.chat` strings (ensureLocation) are likely split or rejected by the server's chat length limits. This was not verified.

### Gaps
- Server-side chat limits and spam-kick thresholds were not tested.

---

## 10. Third-party library dependencies

### Takeaway
The bot depends on:
- **mineflayer 4.39** and four plugins, with mineflayer-pvp patched
- **minecraft-data** and the prismarine-\* packages for registry, items and blocks
- **openai 7.x** Chat Completions with the `zodFunction` strict-tools helper
- **zod 4**
- **lowdb 7**

The OpenAI coupling is concentrated in two files. The mineflayer coupling is everywhere.

### Cited Findings
- Declared dependencies: lowdb ^7.0.1, mineflayer ^4.39.0, mineflayer-armor-manager ^2.0.1, mineflayer-auto-eat 4.0.0 (pinned), mineflayer-pathfinder ^2.4.5, mineflayer-pvp ^1.3.2, mineflayer-tool ^1.2.0, openai ^7.62.0, zod ^4.6.7. Dev dependencies: @types/bun 1.3.14, typescript 7.0.2. `patchedDependencies` patches mineflayer-pvp@1.3.2 — [package.json](package.json)
- The patch changes `this.bot.on('physicTick', ...)` to `'physicsTick'` in `lib/PVP.js`. Without it the pvp update loop would never fire on the new mineflayer — [patches/mineflayer-pvp@1.3.2.patch](patches/mineflayer-pvp@1.3.2.patch)
- External import counts across `src` (from `from "..."` lines):

| Package | Imports |
|---|---|
| zod | 36 |
| vec3 | 11 |
| mineflayer-pathfinder | 9 |
| prismarine-entity | 8 |
| mineflayer | 7 |
| prismarine-item | 5 |
| prismarine-block | 4 |
| minecraft-data, prismarine-recipe, openai, openai/helpers/zod, lowdb, lowdb/node, mineflayer-pvp, mineflayer-auto-eat, mineflayer-tool, mineflayer-armor-manager, node:async_hooks, path | 1 each |

  — grep output.
- OpenAI usage is limited to `aiManager.ts` (client and `chat.completions.create`) and `registry.ts` (`zodFunction`) — [src/managers/aiManager.ts#L3](src/managers/aiManager.ts), [src/commands/registry.ts#L3](src/commands/registry.ts)
- Plugin APIs used directly in code:
  - `bot.pathfinder.goto/setGoal/stop/isMoving/getPathTo/setMovements` with `goals.GoalNear/GoalFollow/GoalBlock/GoalXZ/GoalGetToBlock`
  - `bot.pvp.attack/stop`
  - `bot.tool.equipForBlock`
  - `bot.autoEat.options/enable/eat/disable`
  - `armorManager` (loaded only)

  — [src/actions/movement.ts](src/actions/movement.ts), [src/actions/combat.ts](src/actions/combat.ts), [src/actions/collectBlock.ts#L58-L60](src/actions/collectBlock.ts), [src/index.ts#L50-L79](src/index.ts)
- A custom type augmentation declares `autoEat`, `armorManager` and `vehicle` on `Bot`. The autoEat shape declared there (`setOpts`, `enableAuto`, …) differs from what index.ts actually calls (`options`, `enable`) — [src/types/mineflayer.d.ts](src/types/mineflayer.d.ts), [src/index.ts#L68-L79](src/index.ts)
- Recent dependency churn: commit `ced4490` ("Upgrade dependencies: mineflayer 4.39, openai 7, zod 4, TypeScript 7") — `git log --oneline`

### Inferences
- Swapping the LLM provider affects about two files, plus the strict-schema assumptions in every command's `.nullable()` parameter design. Swapping or abstracting mineflayer would touch nearly every file because of the global `bot` and direct plugin calls.
- The pinned auto-eat 4.0.0 and the pvp patch are fragile points on future mineflayer upgrades.

### Gaps
- Whether `tsc` currently passes cleanly with the uncommitted changes was not run in this session.

---

## 11. Data-flow diagram and module dependency summary

### Takeaway
There are two kinds of path from the game to actions. One is a **deliberative path**: chat → OpenAI (one tool call) → persisted queue → 1.5 s loop → command → action skills → mineflayer. The other is a set of **reflex paths**: event and timer handlers calling actions or plugins directly. They share one mutable `bot`, and nothing arbitrates between them.

### Cited Findings
Diagram synthesized from §1–§10; every edge cites the files listed there.

```mermaid
flowchart TD
  subgraph Server["Minecraft server"]
    EV[(mineflayer events:<br/>chat, spawn, end, error, kicked,<br/>playerJoined, breath, health, physicsTick)]
  end

  subgraph Root["src/index.ts (composition root, exports mutable `bot`)"]
    CB[createBot / registerBotEvents]
    RC[scheduleReconnect<br/>5s→60s backoff]
    INIT[initializeBot on first spawn<br/>plugins + Movements + autoEat]
    LOOP[[setInterval 1.5s<br/>executeCommands]]
    RELOG[relogBot]
  end

  subgraph AI["Deliberative path"]
    AIM[aiManager.initiateActionFromAI]
    OAI[(OpenAI chat.completions<br/>gpt-6-luna, strict tools)]
    TM[toolManager.executeTool]
    REG[commands/registry.ts<br/>32 zodFunction tools]
  end

  subgraph Q["Queue + persistence"]
    PM[persistenceManager<br/>lowdb db.json]
    AM[actionManager<br/>priority sort, AbortController+ALS,<br/>5-min timeout, stuck monitor]
    UN[actions/unstuck]
  end

  subgraph CMD["src/commands/* (32 tool adapters)"]
    C[execute(args)]
  end

  subgraph ACT["src/actions/* skills"]
    MV[movement / world]
    WI[worldInteraction]
    EN[ensure ⇄ ensureTools ⇄ crafting ⇄ collectBlock]
    GW[gatherWood]
    BD[building / digging / ensureLocation]
    INV[inventory]
    CBT[combat]
    HL[health]
  end

  subgraph LIB["mineflayer + plugins"]
    MF[(bot API, pathfinder, pvp,<br/>tool, auto-eat, armor-manager)]
    MD[(utils/minecraftData<br/>bot.registry / minecraft-data 1.21.4)]
  end

  EV -->|chat| CB
  CB -->|pathfinder.stop on ANY chat| MF
  CB --> AIM
  AIM --> OAI
  OAI -->|text| CHAT[(bot.chat)]
  OAI -->|tool_calls 0| AIM
  AIM -->|stop: bypass queue| AM
  AIM -->|stop| TM
  AIM -->|other: normalize ids, priority 3| PM
  LOOP --> AM
  AM -->|getAllCommands/removeCommand| PM
  AM --> TM --> REG --> C
  AM -->|stuck| UN --> RELOG --> RC
  C --> MV & WI & EN & GW & BD & INV & CBT
  C -->|direct bot/pathfinder use in 12 commands| MF
  C -->|POI read/write| PM
  BD -->|save basement/table/furnace/chest/mine| PM
  EN & GW -->|isCommandCancelled| AM
  MV & WI & EN & GW & BD & INV & CBT --> MF
  WI & EN & BD --> MD

  EV -->|spawn| INIT
  INIT -->|nightDefense 1s interval| CBT
  INIT -->|monitorHealth| HL
  EV -->|health| HL --> CBT
  EV -->|spawn| AM
  EV -->|end| RC --> CB
  EV -->|playerJoined greet| CHAT
  EV -->|breath → respawn| MF
  CBT & HL & C & EN --> CHAT
```

ASCII summary of the module dependency layers. Arrows mean "imports"; `*` means it also imports `bot` from index.

```
index.ts* ──► managers/aiManager* ──► managers/toolManager ──► commands/registry ──► commands/*  (24/32 import bot)
   │               │                                                                     │
   │               └──► managers/actionManager* ──► actions/unstuck* ──► index.relogBot  │
   │                          ▲          ▲                                                ▼
   │                          │          └──────────── actions/ensure*, gatherWood* ◄── actions/*
   │                          │                         (isCommandCancelled)            │
   │               managers/persistenceManager ◄──── actions/building*, digging*,      │
   │                          ▲                       commands/SetBase, ReturnToBase,   │
   │                          │                       ShowMeBase, GoToNamedLocation,    │
   │                          │                       ListInventory, Stop               │
   ├──► actions/combat*, actions/health*                                                │
   └──► config/env                                                                      ▼
                                       utils/minecraftData* ◄── world*, crafting*, ensure*, worldInteraction*, ensureLocation*
                                       utils/utility*  ◄── most actions and commands
Dead (no importer): managers/botProgress*, managers/loreManager, progress/botLevels, config/botConfig.json
Cycles: ensure⇄ensureTools; ensure⇄crafting; crafting→collectBlock→ensureTools→crafting;
        actionManager→toolManager→registry→commands→actions→actionManager; everything→index→everything
```

### Inferences
- Gaps worth carrying into the architecture proposal (observations only):
  - no owner or permission model
  - no arbitration between reflexes and queued commands
  - cooperative-only cancellation with several unbounded loops (`ensureLocation`, `collectBlock`, `Unstack`, `smeltItem`)
  - a single-turn LLM with no state, history or tool-result feedback
  - an unvalidated identifier contract, with substring matching and id 0 aliasing to air
  - world memory (POIs) that is write-mostly and never reconciled
  - dead progression and lore modules and an unused botConfig
  - chat output scattered across every layer
  - a mutable global `bot` coupling all modules

### Gaps
- No runtime trace was captured. All flows are derived from static reading of HEAD plus the working-tree diff, so behaviours marked as inferences (busy loop, air aliasing, retry loop, breath→respawn) should be confirmed in-game before relying on them.
