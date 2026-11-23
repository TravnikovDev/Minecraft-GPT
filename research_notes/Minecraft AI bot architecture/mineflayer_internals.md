# Mineflayer internals, event model, plugin ecosystem and limitations (as of Nov 2026)

Method note: most internals below were verified by reading the installed source of mineflayer 4.39.0, mineflayer-pathfinder 2.4.5, minecraft-protocol and the other plugins in this project's `node_modules`. Links point to the matching files on GitHub master; line-level behaviour was checked against the local 4.39.0 copy. Ecosystem status comes from the npm registry metadata (fetched 2026-11-24), the GitHub API (commit lists and issue searches) and the mindcraft repository. Bun-specific claims are mostly gaps (see below).

## 1. Internal structure: bot object, internal plugins, injection, registry

### Takeaway
A mineflayer "bot" is a plain Node `EventEmitter` decorated by about 40 internal plugin functions. Each plugin closes over the bot, subscribes to raw `minecraft-protocol` packets on `bot._client` and adds methods, state and events. Plugin injection is deferred until the server's protocol version is known (`inject_allowed`). `bot.registry` (minecraft-data via prismarine-registry) is derived from that server version. Nothing in the architecture isolates plugins from each other: they share one mutable bot object and one listener namespace.

### Cited Findings
- `createBot()` builds `const bot = new EventEmitter()`, attaches `bot._client` (a `minecraft-protocol` client created with `mc.createClient(options)` unless one is passed in), and forwards the client's `connect`, `error` and `end` events onto the bot. — [mineflayer lib/loader.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/loader.js)
- Internal plugins are listed statically in loader.js: anvil, bed, block_actions, blocks, book, boss_bar, breath, chat, chest, command_block, craft, creative, digging, enchantment_table, entities, experience, explosion, fishing, furnace, game, generic_place, health, inventory, kick, particle, physics, place_block, place_entity, rain, ray_trace, resource_pack, scoreboard, settings, simple_inventory, sound, spawn_point, tablist, team, time, title, villager (the `lib/plugins/` directory). — [mineflayer lib/plugins](https://github.com/PrismarineJS/mineflayer/tree/master/lib/plugins)
- Options control loading. `loadInternalPlugins` defaults to true. `options.plugins[name] = false` disables one internal plugin. A function value under `options.plugins` replaces or adds an external plugin. Internal and external plugins are then passed together to `bot.loadPlugins`. — [loader.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/loader.js)
- `plugin_loader.js` keeps a `pluginList`. `bot.loadPlugin(fn)` asserts that `fn` is a function, dedupes by function identity (`hasPlugin`), and either queues it, or calls `plugin(bot, options)` immediately once `inject_allowed` has fired. `bot.loadPlugins` and `bot.hasPlugin` are exposed too. There is no unload, dependency declaration, ordering contract or versioning. — [lib/plugin_loader.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugin_loader.js)
- Registry and version: after the client connects (or on `connect_allowed` when the client does a version ping), loader.js does `bot.registry = require('prismarine-registry')(bot._client.version)`. It throws if the server version is newer than `latestSupportedVersion` or older than `oldestSupportedVersion`. It then sets `bot.protocolVersion`, `bot.majorVersion`, `bot.version` and `bot.supportFeature = bot.registry.supportFeature`, and emits `inject_allowed` on `setTimeout(0)`. With `version: false` (the default) the version is auto-detected by server ping. — [loader.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/loader.js)
- In 4.39.0, `testedVersions` runs from 1.8.8 to 1.21.11 plus `26.1`, so the latest supported version is 26.1 and the oldest is 1.8.8. — [lib/version.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/version.js); 26.1 support was added in 4.38.0 — [docs/history.md](https://github.com/PrismarineJS/mineflayer/blob/master/docs/history.md)
- An open issue tracks "Mineflayer 26.2" (2026-07-26), which suggests the newest MC release was not yet supported at that time. — [mineflayer#3952](https://github.com/PrismarineJS/mineflayer/issues/3952)
- Version-specific behaviour is handled throughout plugins with `bot.supportFeature('...')` checks (for example `stateIdUsed`, `transactionPacketExists` and `useItemWithOwnPacket` in inventory.js). — [lib/plugins/inventory.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/inventory.js)
- The mineflayer data stack depends on minecraft-protocol ^1.67, prismarine-block, -chunk, -entity, -item, -physics, -recipe, -registry, -windows and -world (installed 4.39.0 package.json). — [mineflayer package.json](https://github.com/PrismarineJS/mineflayer/blob/master/package.json)
- index.js hard-exits if the Node major version is below 18 and tells users to update to 22 or later. It checks `process.versions.node`, which Bun also populates. — [mineflayer index.js](https://github.com/PrismarineJS/mineflayer/blob/master/index.js)

### Inferences
- Since `bot.registry` is fixed per connection from the server ping, everything that resolves item, block or recipe names must go through the bot's registry. A module-level `require('minecraft-data')(someVersion)` is wrong if the server version differs. The project's recent commit "Use the server's Minecraft version for game data" is consistent with this.
- Plugins are untyped monkey-patches on a shared object. Our abstraction layer should treat `bot` as a low-level driver and never let higher layers reach into `bot.*` directly. Version gating should also live in one place (the registry), not be scattered.
- `createBot` creates a fresh bot per connection, and plugin state lives in closures. Reconnecting therefore means building a new bot and re-wiring every listener and plugin. Our layer needs a "session" object that outlives individual bot instances.

### Gaps
- No formal plugin dependency or ordering mechanism exists. I did not verify whether any internal plugin relies on another having been injected first, beyond the static list order.

## 2. Event model: what is emitted, frequency, and single-threaded semantics

### Takeaway
All state changes reach bot code as synchronous `EventEmitter` callbacks running on the same single JS thread as packet parsing and the 50 ms physics timer. Packet handlers mutate the world model and emit events inline. A slow or throwing listener therefore delays or breaks packet processing. Blocking the loop for more than about 30 s triggers the keepalive timeout disconnect. Shorter blocks cause physics catch-up bursts and stale state.

### Cited Findings
- Documented bot events include `chat (username, message, translate, jsonMsg, matches)`, `whisper`, `message (jsonMsg, position, sender, verified)`, `messagestr (message, messagePosition, jsonMsg, sender, verified)`, `login`, `spawn`, `respawn`, `death`, `health`, `kicked (reason, loggedIn)`, `end (reason)`, `error (err)`, `entityHurt`, `playerCollect (collector, collected)`, `entityGone`, `blockUpdate (oldBlock, newBlock)`, `blockPlaced`, `chunkColumnLoad`, `diggingCompleted`, `diggingAborted`, `move`, `forcedMove`, `windowOpen`, `physicsTick`, `rain` and `time`. `spawn` is emitted once after login and again after each respawn. — [docs/api.md](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md)
- The entities plugin emits `entitySpawn`, `entityGone`, `entityMoved` (from several movement packet handlers), `entityUpdate`, `entityHurt`, `entityEquip`, `entitySleep`, `entityAttach`/`entityDetach`, `entityEffect`/`entityEffectEnd`, `entityAttributes`, `entityCrouch`/`entityUncrouch`, `itemDrop`, `playerCollect`, `playerJoined` and `playerUpdated`. — [lib/plugins/entities.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/entities.js)
- The blocks plugin forwards `blockUpdate`, `chunkColumnLoad` and `chunkColumnUnload` from `bot.world`. It also supports per-position events named `blockUpdate:(x, y, z)` by proxying `newListener`/`removeListener` registrations that match a regex onto `bot.world`. — [lib/plugins/blocks.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/blocks.js)
- Physics runs on a timer with a 50 ms step (`PHYSICS_INTERVAL_MS = 50`), using a fixed-timestep accumulator ("fix your timestep"). Each pass runs at most `maxCatchupTicks` ticks (default 4). Each tick runs `prismarine-physics` `simulatePlayer`, emits `physicsTick` plus the deprecated `physicTick`, and sends position/look packets. A tick is skipped when not in the `play` state, when the bot entity has no finite position, or when the chunk under the bot is unloaded (`bot.blockAt(pos) == null`). — [lib/plugins/physics.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/physics.js)
- physics.js contains the warning "THIS IS NOT ACCURATE ON WINDOWS (15.6 Timer Resolution)". — [physics.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/physics.js)
- Subscribing to `physicTick` logs a deprecation warning: "Mineflayer detected that you are using a deprecated event (physicTick)! Please use this event (physicsTick) instead." — [physics.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/physics.js)
- Server teleports (the `position` packet) are confirmed with `teleport_confirm` and emit `forcedMove`. A source comment notes that sending the confirm immediately causes "Invalid move player packet" kicks. — [physics.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/physics.js)
- Keepalive: minecraft-protocol's client keepalive uses `checkTimeoutInterval` (default 30 s). If no keepalive arrives in that window it emits `error` "client timed out after N milliseconds" and calls `client.end('keepAliveError')`. — [node-minecraft-protocol src/client/keepalive.js](https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/src/client/keepalive.js); option documented in [api.md](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md)
- mineflayer's `onceWithCleanup` helper has a source comment stating that `checkCondition` "runs inside emit(), which for client events is the socket read path: throwing there unwinds it and the client silently stops receiving packets". The helper therefore catches and rejects instead. — [lib/promise_utils.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/promise_utils.js)
- By default (`logErrors: true`) mineflayer attaches an `error` listener that `console.log`s errors, so client errors do not crash the process. — [loader.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/loader.js)
- The 4.39.0 changelog fixed sending physics packets during the configuration phase on proxy server transfer (#4005). The 4.38.0 changelog started sending `player_loaded` on spawn "so 1.21.4+ servers accept interactions immediately" (#3986). — [history.md](https://github.com/PrismarineJS/mineflayer/blob/master/docs/history.md)
- Open issue (2026-09-15): the `kicked` event's reason is typed as a string but can be a raw chat-component object. — [mineflayer#4122](https://github.com/PrismarineJS/mineflayer/issues/4122)

### Inferences
- Frequency: `physicsTick` fires at 20 Hz. `entityMoved` can fire many times per tick, once per movement packet per tracked entity, so it is the highest-volume event in a crowded area. `blockUpdate` is bursty (explosions, farms, other players digging). Chat events depend on server traffic. Handlers on `entityMoved`, `blockUpdate` and `physicsTick` must stay O(1) and never await anything heavy.
- Blocking: if bot code (or a synchronous A* search, a large `findBlocks`, or JSON-heavy LLM response parsing) blocks the event loop, then:
  - (a) Packets queue up in the socket buffer, and the world model is stale for the duration.
  - (b) Physics accumulates time. Afterwards it runs 4 ticks per timer pass until the backlog drains, so the bot moves in a fast-forward burst with no way to react in between.
  - (c) If the block exceeds the 30 s keepalive window, the connection is dropped.
  Points (a) and (c) follow directly from the code. Point (b) is my reading of the accumulator logic and was not empirically tested.
- A listener that throws inside a client packet path can stop packet processing entirely (per the source comment above). Our layer should wrap every listener it registers in try/catch and route errors to a logger.
- Events are fire-and-forget. There is no backpressure, ordering guarantee across plugins or replay. Anything subscribing late (for example after a reconnect) misses state. Durable state (the "what do I know" snapshot) should be pulled from `bot.*` on demand, not reconstructed from event streams.

### Gaps
- I found no published measurements of event rates or of mineflayer CPU cost per tracked entity.
- I found no mineflayer issue that specifically documents keepalive disconnects caused by blocking user code (GitHub search for "keepalive timed out" returned nothing). The mechanism is inferred from source.

## 3. World model: chunks, blocks, entities, players; findBlocks cost; staleness

### Takeaway
The world model is a client-side mirror containing only what the server streams to this client: chunk columns within view distance (stored in prismarine-world/prismarine-chunk), entities within the server's tracking range, and a tab-list-driven `bot.players`. It is partial by construction, eventually consistent, and in some places optimistically updated by mineflayer itself (digging).

### Cited Findings
- Chunks: `bot.world` is a prismarine-world holding prismarine-chunk columns. Columns are loaded from map-chunk packets and removed on `unload_chunk`. All columns are unloaded on dimension change or respawn into another world, except when the server indicates the same world with `copyMetadata`. — [blocks.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/blocks.js)
- `bot.findBlocks({ matching, point, maxDistance=16, count=1, useExtraInfo })` walks 16x16x16 sections outward with an `OctahedronIterator` of radius `ceil((maxDistance+8)/16)`. For each loaded section it first checks the section palette (`isBlockInSection`). It scans all 4096 positions only if the palette contains a match (or if `useExtraInfo` is used). It stops after finishing the layer in which `count` results were found, then sorts by distance. — [blocks.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/blocks.js)
- Entities: `bot.entities` is keyed by entity id. On removal the code emits `entityGone`, sets `bot.players[username].entity = null` for players, and deletes the entry. When a player entity spawns and `bot.players[username]` exists without an entity, the entity is linked. — [entities.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/entities.js)
- `bot.players` is populated from player_info (tab list), emitting `playerJoined`/`playerUpdated`, so it lists players who are online but not necessarily near. — [entities.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/entities.js); [api.md bot.players](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md)
- Digging optimistically updates the local world. When the computed dig time elapses, `finishDigging` sends "finish digging" and calls `bot._updateBlockState(block.position, 0)`, setting the block to air locally before any server confirmation. The dig promise resolves on the `blockUpdate:pos` that this local update itself triggers. — [lib/plugins/digging.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/digging.js)
- mindcraft's pathfinder patch also writes into the local world (`bot.world.setBlockStateId(..., 1)`) before placing a scaffold block, so the planner sees the block as present. — [mindcraft patches/mineflayer-pathfinder+2.4.5.patch](https://github.com/mindcraft-bots/mindcraft/blob/main/patches/mineflayer-pathfinder%2B2.4.5.patch)
- Open issues on model correctness: "Incorrect entities cleanup on login packet" (2024-08-04, open) — [mineflayer#3432](https://github.com/PrismarineJS/mineflayer/issues/3432); "Empty effect list on players" (open) — [mineflayer#3646](https://github.com/PrismarineJS/mineflayer/issues/3646).
- mindcraft's modes code needs "hacky fix when blocks are not loaded" fallbacks (treating a null `blockAt` as air). — [mindcraft src/agent/modes.js](https://github.com/mindcraft-bots/mindcraft/blob/main/src/agent/modes.js)

### Inferences
- `players[name].entity` being undefined or null means "online (in the tab list) but not in entity tracking range", or not yet spawned or in another dimension. It does not mean offline. Commands like "come to me" or "follow X" must handle this case explicitly, for example by using last-known positions or asking the player.
- `bot.blockAt` returns null for unloaded chunks. Treating null as air (as mindcraft does) is a known source of wrong decisions. Our perception layer should report "unknown" separately from "air".
- `findBlocks` is cheap when the target block is absent from section palettes, and expensive (full 4096-block scans per section, synchronous on the event loop) for common blocks, `useExtraInfo`, or large `maxDistance`. A radius of 64 covers about a 9x9x(world height) set of sections. It must be bounded and should be cached or summarised by our layer, not called per LLM request with large radii.
- Because digging resolves on a local optimistic update, `bot.dig()` resolving does not prove the server broke the block. A server rejection (protection plugin, wrong dig time) shows up later as a corrective `blockUpdate`. Verification should re-read the block after a short delay, and check item pickup or inventory.

### Gaps
- I did not measure memory per loaded chunk column for 1.18+ (with its larger world height), or the entity tracking ranges per server type. Both are server-configurable (view-distance, entity-tracking-range).

## 4. Action primitives and their failure modes

### Takeaway
mineflayer actions are thin, promise-returning wrappers over packets. They have no cancellation tokens (except via ad hoc `stop*` functions), inconsistent timeouts, and in several cases resolve based on local prediction rather than server acknowledgement. 4.39.0 made `placeBlock` stricter (it rejects on server refusal) and improved inventory resync. Each primitive still needs a verify-and-retry wrapper.

### Cited Findings
- **dig**: throws if the block is null or the dig time is Infinity, and can throw "Block not in view" when `forceLook` is required. It sends start-dig, waits `bot.digTime(block)` via `setTimeout`, swings every 350 ms, then sends finish-dig and optimistically sets air (see section 3). `bot.stopDigging()` sends cancel, emits `diggingAborted` and rejects with "Digging aborted". On `death`, digging is stopped. — [digging.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/digging.js)
- mindcraft patches `digTime` to always pass `isInWater=false` (comment: "water calc is bugged") and to remap material `incorrect_for_wooden_tool` to `mineable/pickaxe`. Wrong dig-time estimates cause early finish packets that the server rejects. — [mindcraft patches/mineflayer+4.33.0.patch](https://github.com/mindcraft-bots/mindcraft/blob/main/patches/mineflayer%2B4.33.0.patch). Upstream 4.37.1 included "Patches isInWater for digSpeed (#3542)", so mindcraft's patch may be partly obsolete on 4.39 (unverified) — [history.md](https://github.com/PrismarineJS/mineflayer/blob/master/docs/history.md)
- **placeBlock (4.39.0)**: after `_genericPlace`, it waits up to 5000 ms for a `blockUpdate` at the destination. It throws `Server refused to place <item> at <dest>: the block is still <name>` once the server has acknowledged the reference block and the destination is unchanged. If no acknowledgement arrives it throws `Server did not answer the placement at <dest>`. Concurrent placements at the same destination share the outcome because replies carry no request id. — [lib/plugins/place_block.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/place_block.js); changelog "placeBlock: reject as soon as the server refuses the placement (#4024)" — [history.md](https://github.com/PrismarineJS/mineflayer/blob/master/docs/history.md)
- `_genericPlace` throws "must be holding an item to place" (or "...in the off-hand...") and calls `bot.lookAt` before placing. — [lib/plugins/generic_place.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/generic_place.js)
- mindcraft's older patch cut the placeBlock wait from 5000 to 500 ms, presumably because the old code waited the full timeout on no-op placements. — [mindcraft mineflayer patch](https://github.com/mindcraft-bots/mindcraft/blob/main/patches/mineflayer%2B4.33.0.patch)
- **Window/inventory transactions**: `WINDOW_TIMEOUT = 5000` ms. On pre-1.17 servers (`transactionPacketExists`) a click waits for the server's transaction confirm and throws "Server didn't respond to transaction..." or "Server rejected transaction...". On 1.17.1+ (`stateIdUsed`) clicks carry a `stateId`. The source notes that such servers "only answer a click when their record of the client is stale, so a click they ignored is never reported". mineflayer added `bot._syncWindow`, which sends a no-op click with an impossible `stateId: -1` to force a full window resend. — [inventory.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/inventory.js)
- Recent inventory desync fixes: "Fix client-side inventory desyncs behind the 26.1 creative test failure (#3974)"; "don't let the trailing-sync path swallow a reused window id's early window_items (#4003)"; "sync the server's inventory bookkeeping after closing a window on pre-1.17 (#4023)"; "fix rejected quick-move clicks on 1.12–1.16 (#3979)". — [history.md 4.39.0](https://github.com/PrismarineJS/mineflayer/blob/master/docs/history.md)
- Open (2026-11-22): "Hotbar selection desync after `bot.equip()` while sleeping". — [mineflayer#4242](https://github.com/PrismarineJS/mineflayer/issues/4242)
- **craft**: `bot.craft(recipe, count, craftingTable)` throws "Recipe requires craftingTable, but one was not supplied" when needed. With a table it calls `bot.activateBlock(craftingTable)` and awaits `windowOpen` with no timeout of its own. It throws "non craftingTable used as craftingTable" and "missing ingredient". `bot.recipesFor(itemType, metadata, minResultCount, craftingTable)` returns only recipes whose ingredients are currently in inventory. `bot.recipesAll` ignores inventory. Passing `null` for the table restricts results to 2x2 recipes. — [lib/plugins/craft.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/craft.js)
- **activateItem**: in 4.33 it sent `use_item` with rotation `{x:0, y:0}` on newer versions. mindcraft patched it to send the real yaw and pitch. Upstream fixed it in 4.37.1 ("Fix activateItem always having the same rotation (#3840)"). — [mindcraft patch](https://github.com/mindcraft-bots/mindcraft/blob/main/patches/mineflayer%2B4.33.0.patch); [history.md](https://github.com/PrismarineJS/mineflayer/blob/master/docs/history.md)
- **consume**: throws "Food is full", and "Consuming cancelled due to calling bot.consume() again" if re-entered. — [inventory.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/inventory.js)
- **look**: physics.js rate-limits sent yaw and pitch per tick (`maxDeltaYaw = PHYSICS_TIMESTEP * physics.yawSpeed`), so a look takes effect over several ticks from the server's perspective. — [physics.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/physics.js)
- **Movement and knockback**: open issues "Bot freezes in mid-air after taking knockback on 1.21.11" (2026-04-10) and "Knockback and pathfinding issue" (2026-06-04). — [mineflayer#3887](https://github.com/PrismarineJS/mineflayer/issues/3887), [mineflayer#3915](https://github.com/PrismarineJS/mineflayer/issues/3915)
- **Pathfinding (mineflayer-pathfinder 2.4.5)**:
  - Defaults are `thinkTimeout = 5000` ms, `tickTimeout = 40` ms of A* per tick, and `searchRadius = -1` (unbounded). — [mineflayer-pathfinder index.js](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/index.js)
  - Paths reset on block updates along the path, chunk loads, goal movement, dig or place errors, `no_scaffolding_blocks`, and `stuck` (no node reached within 3500 ms). — same file
  - `goto()` wraps `setGoal` and rejects with `NoPath`, `Timeout`, `GoalChanged` or `PathStopped`. In 2.4.5 it resolves (not rejects) when a `path_update` arrives with an empty path. — [lib/goto.js](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/lib/goto.js)
  - Master later fixed this: "goto rejects an unreachable goal instead of resolving, and stop() no longer latches while idle (#375)", 2026-09-14. — [pathfinder commits](https://github.com/PrismarineJS/mineflayer-pathfinder/commits/master)
- mindcraft's pathfinder patch adds lava avoidance, door collision handling, clears `placing` when the placement queue empties, sets a local block before scaffolding, tightens the arrival tolerance from 0.35 to 0.175, and adds lava swimming. — [mindcraft patches/mineflayer-pathfinder+2.4.5.patch](https://github.com/mindcraft-bots/mindcraft/blob/main/patches/mineflayer-pathfinder%2B2.4.5.patch)

### Inferences
- Concrete failure semantics our wrappers must normalise:
  - dig: false success (optimistic) and aborts on death or a new dig.
  - placeBlock: rejects with "refused" (good) or "did not answer", and can race with other placements.
  - Window clicks on 1.17+: silent ignore, so verification requires resync.
  - craft: hangs if `windowOpen` never arrives, since there is no timeout.
  - pathfinder `goto`: false success on an empty path in 2.4.5; never settles if the goal is never reached and nothing errors.
- Each primitive should be wrapped as: precondition check, then a timed action with abort, then postcondition verification from fresh state, then a typed failure reason that the LLM or planner can reason about.
- Preferred cancellation path for movement: `bot.pathfinder.stop()` / `setGoal(null)`, plus `bot.clearControlStates()`, `bot.stopDigging()` and closing any open window. mindcraft's action manager follows a similar "stop everything" approach (section 7).

### Gaps
- I did not verify current upstream behaviour of `bot.equip` and `bot.attack` failure modes beyond the open hotbar issue.
- I did not determine whether `bot.craft`'s `windowOpen` wait has a timeout in deeper code paths. Only the top-level `once(bot, 'windowOpen')` was inspected.

## 5. Plugin ecosystem status (Nov 2026)

### Takeaway
Core mineflayer is actively maintained (4.39.0, 2026-09-06; 601 open issues). The classic plugins are mostly unmaintained releases. Pathfinder's npm release is 2023 vintage while master received a burst of significant fixes and a new "createHuman" walker in Sep–Nov 2026 that is not published. pvp still listens to the deprecated `physicTick`. auto-eat has moved to an ESM-only v5. Serious bot projects (mindcraft) rely on patch-package to fix the plugins.

### Cited Findings
- npm latest versions and publish dates (registry, fetched 2026-11-24). None is marked deprecated. — [npm registry](https://registry.npmjs.org/)

  | Package | Latest | Published |
  |---|---|---|
  | mineflayer | 4.39.0 | 2026-09-06 |
  | mineflayer-pathfinder | 2.4.5 | 2023-09-04 |
  | mineflayer-pvp | 1.3.2 | 2022-07-03 |
  | mineflayer-tool | 1.2.0 | 2022-05-11 |
  | mineflayer-armor-manager | 2.0.1 | 2023-07-01 |
  | mineflayer-auto-eat | 5.0.3 | 2025-08-01 |
  | mineflayer-collectblock | 1.6.0 | 2025-01-24 |
  | mineflayer-statemachine | 1.7.0 | 2023-01-23 |
  | prismarine-viewer | 1.33.0 | 2025-02-09 |
  | @miner-org/mineflayer-baritone | 4.6.2 | 2026-08-29 |
  | @nxg-org/mineflayer-pathfinder | 0.0.26 | 2025-12-22 |
  | @nxg-org/mineflayer-physics-util | 1.9.10 | 2026-07-27 |

- mineflayer-pathfinder master commits after 2.4.5 (none released to npm):
  - 2026-09-05: postProcessPath keeps gate/door nodes on the floor (#372).
  - 2026-09-07 to 2026-10-27: a series of "createHuman" commits (walk routes "the way players do", take three-block drops, reject when the goal is unreachable, hold the controller through a setback storm, cap the head-settle wait).
  - 2026-09-14: goto rejects an unreachable goal; stop() no longer latches while idle (#375).
  - 2026-10-03: BinaryHeapOpenSet sift-down off-by-one and GoalCompositeAll heuristic fixes (#369); diagonal corner-cut prevention (#393); water-containing blocks recognised (#384).
  - 2026-11-14: upward swimming and shore exits (#394).
  — [GitHub API: PrismarineJS/mineflayer-pathfinder commits](https://github.com/PrismarineJS/mineflayer-pathfinder/commits/master)
- Open pathfinder issues include "GoalFollow is not working as of server version >1.21.8" (2026-07-05), "Bot stuck on stairs" (2024-12-13), "Bot Constantly Stuck or Halts with GoalFollow" (2023-09-25), "Stuck in dripstone" (2023-07-01), and "postProcessPath leaves every node from the first dig or place onwards on block corners" (2026-11-18). The repo has 76 open issues. — [pathfinder#366](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/366), [#343](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/343), [#332](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/332), [#328](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/328), [#408](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/408)
- mineflayer-pvp 1.3.2 subscribes with `this.bot.on('physicTick', ...)`. Both mindcraft and this project patch that line to `physicsTick`. pvp also constructs its own `Movements` with `require('minecraft-data')(bot.version)`. — [mindcraft patches/mineflayer-pvp+1.3.2.patch](https://github.com/mindcraft-bots/mindcraft/blob/main/patches/mineflayer-pvp%2B1.3.2.patch); local `patches/mineflayer-pvp@1.3.2.patch`
- mineflayer still emits `physicTick` alongside `physicsTick`, with the comment "May be removed in the future". Unpatched pvp therefore works today but prints a warning and will break if the alias is removed. — [physics.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/physics.js)
- mineflayer-auto-eat:
  - v5 is ESM-only ("This package is ESM only and does not support CommonJS"). Its API is `loader` export, `bot.autoEat.enableAuto()/disableAuto()/eat(opts)/cancelEat()/setOpts()`, and events `eatStart`/`eatFinish` on `bot.autoEat`. — [mineflayer-auto-eat README](https://github.com/link-discord/mineflayer-auto-eat)
  - v4.0.0 (installed here) uses `bot.autoEat.options` with `priority`, `healthThreshold` and `bannedFood`. It triggers eating from `bot.on('health')` and `bot.on('playerCollect')`. — local `node_modules/mineflayer-auto-eat/dist`
  - mindcraft pins `^3.3.6`. — [mindcraft package.json](https://github.com/mindcraft-bots/mindcraft/blob/main/package.json)
- mindcraft depends on mineflayer ^4.33.0, armor-manager ^2.0.1, auto-eat ^3.3.6, collectblock ^1.4.1, pathfinder ^2.4.5, pvp ^1.3.2 and prismarine-viewer ^1.32.0. It runs `patch-package` in postinstall. — [mindcraft package.json](https://github.com/mindcraft-bots/mindcraft/blob/main/package.json)
- mindcraft patches six packages: minecraft-data 3.97.0, mineflayer 4.33.0, mineflayer-pathfinder 2.4.5, mineflayer-pvp 1.3.2, prismarine-viewer 1.33.0 and protodef 1.19.0. — [mindcraft patches/](https://github.com/mindcraft-bots/mindcraft/tree/main/patches)
  - The prismarine-viewer patch swallows "Unknown entity" errors (`return;` instead of throw), so new entity types do not crash the viewer.
  - The protodef patch comments out the partial-packet console.log that dumps whole packet buffers as hex.
  - The mineflayer, pathfinder and pvp patches are described in section 4.
  — patch files at the same URL
- PrismarineJS ran a full backlog review (snapshot 2026-09-18) of 1974 open items across the org: mineflayer 521, pathfinder 57, collectblock 26, statemachine 22, pvp 13, tool 10. A companion issue recommends closures. — [mineflayer#4143](https://github.com/PrismarineJS/mineflayer/issues/4143)
- Repo activity: pathfinder last pushed 2026-11-14, pvp 2026-04-17 (no release since 2022), auto-eat 2026-02-16. — GitHub API, [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder), [mineflayer-pvp](https://github.com/PrismarineJS/mineflayer-pvp)

### Inferences
- Pathfinder 2.4.5 from npm misses about 15 months of fixes (door/gate handling, heap off-by-one, unreachable-goal rejection, swimming). We can install from a pinned git commit, vendor it, or carry patches. Each option has maintenance cost; vendoring behind our own navigation interface keeps the option to switch to `@miner-org/mineflayer-baritone` or `@nxg-org/mineflayer-pathfinder` later.
- pvp and tool are effectively frozen. Combat and tool selection are small enough that owning them (or keeping them behind a thin adapter) is lower risk than relying on them.
- auto-eat v5 being ESM-only is fine under Bun, which loads ESM natively. Its API differs from v4, so upgrading needs an adapter change.
- mindcraft's patches show the recurring categories: wrong physics/dig estimates, rotation bugs, path post-processing, deprecated events, and crash-on-unknown-data in new MC versions.

### Gaps
- I did not inspect `@miner-org/mineflayer-baritone` or `@nxg-org/mineflayer-pathfinder` code or issue trackers. Their maturity and API stability are unverified; only npm versions and dates were confirmed.
- I did not determine what "createHuman" exposes as an API, or whether it will ship in a 2.5/3.0 release. Only commit titles were seen.
- Status of mineflayer-collectblock 1.6.0 vs mindcraft's usage, and of mineflayer-statemachine, was not examined beyond publish dates and open-issue counts.

## 6. Known reliability problems reported by bot authors

### Takeaway
The recurring problem classes are:
- pathfinding that stalls or loops (stairs, dripstone, doors, water, GoalFollow on newer versions, knockback);
- client/server desync for dig, place and inventory;
- version-churn breakage when new MC versions ship;
- lifecycle edge cases (death, respawn, login, reconnect).

Several have had upstream fixes in 4.37–4.39, but many remain open.

### Cited Findings
- Pathfinding stuck reports are listed in section 5. Pathfinder's own stuck heuristic is "no node reached in 3500 ms leads to `resetPath('stuck')`". It replans but does not escalate, so a bot can loop indefinitely. — [pathfinder index.js](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/index.js)
- mindcraft runs an `unstuck` mode (interrupts all actions) and a `self_preservation` mode to compensate. Its skills pause `unstuck` around some actions. — [mindcraft modes.js](https://github.com/mindcraft-bots/mindcraft/blob/main/src/agent/modes.js); [skills.js](https://github.com/mindcraft-bots/mindcraft/blob/main/src/agent/library/skills.js)
- Desync: issues #4242 (hotbar after equip while sleeping), #3887 (mid-air freeze after knockback) and #3915 (knockback plus pathfinding). There is also a series of 4.39.0 inventory desync fixes. — links in section 4
- Memory and CPU: "bot.sleep() can make memory leak" (open, 2024-04-07); "partial packet freeze / memory leak explosion packet" (closed 2025-10-03). — [mineflayer#3349](https://github.com/PrismarineJS/mineflayer/issues/3349), [mineflayer#3753](https://github.com/PrismarineJS/mineflayer/issues/3753)
- Death and lifecycle: "Death causes crash. Bot is undefined" (closed), fixed by "Fix crash in digging plugin death handler (#3553) (#3835)" in 4.37.1. — [mineflayer#3553](https://github.com/PrismarineJS/mineflayer/issues/3553); [history.md](https://github.com/PrismarineJS/mineflayer/blob/master/docs/history.md)
- Login compatibility: "Mineflayer doesn't send configuration.settings packet at login, causing some servers to disconnect the user" (closed). — [mineflayer#3623](https://github.com/PrismarineJS/mineflayer/issues/3623)
- Reconnect: mineflayer has no built-in reconnect. The bot ends with `end` and you create a new bot. A user issue "Bot doesn't reconnect to the server" exists (closed). — [mineflayer#3372](https://github.com/PrismarineJS/mineflayer/issues/3372); `bot.end = (reason) => bot._client.end(reason)` in [loader.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/loader.js)
- Non-Node runtimes: "Help to Debug ECONNRESET when Running in a Deno Environment" (open). — [mineflayer#3421](https://github.com/PrismarineJS/mineflayer/issues/3421)
- mineflayer CI targets Node 24 ("Update CI to Node 24 (#3861)"). — [history.md 4.36.0](https://github.com/PrismarineJS/mineflayer/blob/master/docs/history.md)
- Timer accuracy: physics.js notes inaccuracy on Windows because of 15.6 ms timer resolution. — [physics.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/physics.js)
- 4.37.1 updated to "minecraft-protocol ^1.66.0 with sync zlib fix (#3878)". — [history.md](https://github.com/PrismarineJS/mineflayer/blob/master/docs/history.md)

### Inferences
- Bun risk surface: mineflayer and minecraft-protocol depend on Node `net`, `zlib`, `crypto` (online-mode encryption), `events`, `performance.now` and timer precision. The "sync zlib fix" indicates compression is a sensitive area, and Bun's zlib and timer implementations differ from Node's. Upstream tests only on Node, so Bun compatibility is "works in practice, unsupported". Keeping the runtime swappable (and being able to run under Node) is a cheap hedge.
- Reconnect handling must be owned by us: back-off, building a new bot, re-registering plugins and listeners, restoring goals and memory, and suppressing actions while disconnected.

### Gaps
- I found no specific GitHub issues documenting mineflayer failures under Bun (a GitHub search for "mineflayer bun" returned no relevant results). Bun compatibility is unconfirmed either way; the project's own experience on Bun 1.3 is the best evidence.
- I found no quantitative CPU or memory benchmarks for mineflayer bots.

## 7. What mineflayer does NOT provide for an autonomous agent

### Takeaway
mineflayer is a protocol client plus world mirror plus primitive actions. It provides no agent runtime: no goal or task model, scheduler, preemption, uniform cancellation, durable memory, skill composition, perception summarisation, or reconnect/session continuity. Projects like mindcraft build all of these on top, often with blunt mechanisms (global interrupt flags, process kills).

### Cited Findings
- Cancellation is per-primitive and ad hoc. Examples: `bot.stopDigging()` [digging.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/digging.js); `bot.pathfinder.stop()`/`setGoal` [pathfinder index.js](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/index.js); and re-entrancy cancellation in `consume` [inventory.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/inventory.js). The `AbortSignal` parameter exists only on the internal `onceWithCleanup` helper. — [promise_utils.js](https://github.com/PrismarineJS/mineflayer/blob/master/lib/promise_utils.js)
- mindcraft implements preemption with a global `bot.interrupt_code` flag that skills poll inside loops (for example `if (bot.interrupt_code) return false;`). It uses a custom wait helper because "setTimeout is disabled to prevent unawaited code". — [mindcraft skills.js](https://github.com/mindcraft-bots/mindcraft/blob/main/src/agent/library/skills.js)
- mindcraft's ActionManager:
  - runs actions with a label and a timeout in minutes (default 10);
  - `stop()` waits for the current action and, if it "refused stop after 10 seconds", calls `agent.cleanKill(...)`, which kills the process;
  - also detects "Infinite action loop" and kills the process;
  - supports resumable actions.
  — [mindcraft src/agent/action_manager.js](https://github.com/mindcraft-bots/mindcraft/blob/main/src/agent/action_manager.js)
- mindcraft "modes" are a reactive layer polled on update: self_preservation, unstuck, cowardice, self_defense, hunting, item_collecting, torch_placing, elbow_room, idle_staring, cheat. Each mode declares which actions it may interrupt (`interrupts: ['all']` or `['action:followPlayer']`). — [mindcraft modes.js](https://github.com/mindcraft-bots/mindcraft/blob/main/src/agent/modes.js)
- mindcraft's skill library is a hand-written ~2100-line set of composite skills (collectBlock, placeBlock, smelt, crafting-table placement and pickup, combat) built on mineflayer primitives and plugins. — [skills.js](https://github.com/mindcraft-bots/mindcraft/blob/main/src/agent/library/skills.js)

### Inferences
- Layers our architecture needs that mineflayer does not supply:
  - (1) A connection/session supervisor: reconnect, back-off, bot re-creation, single place for version and registry.
  - (2) A perception layer: bounded and cached snapshots (nearby blocks by category, entities in range, players known vs. visible, inventory summary, health and hunger, time and danger), with explicit "unknown" for unloaded areas.
  - (3) An action layer: verified primitives with timeouts, AbortSignal-style cancellation, typed failures, and serialised access to shared resources (movement, hands/hotbar, open window), since concurrent use of pathfinder, pvp, auto-eat and tool all fight over control states and the held item.
  - (4) A skill layer composing actions with pre- and postconditions and retry policy.
  - (5) A task/goal scheduler with priorities and preemption: reflexes such as self-defense and eating preempt LLM tasks, and "stop" cancels everything.
  - (6) Memory and persistence outside the bot object.
  - (7) A plugin adapter layer, so pathfinder, pvp, auto-eat and tool can be replaced or patched without touching skills.
- Specific contention to design for: auto-eat (on `health` and `playerCollect`), armor-manager (on `playerCollect`), pvp (`physicsTick`) and pathfinder (`physicsTick`) all act autonomously on events. They can swap the held item or move the bot mid-skill. They should be started and stopped by our scheduler, or replaced with reflexes the scheduler owns.
- A cooperative cancellation token passed into every skill would be more robust than mindcraft's global flag plus process-kill fallback.

### Gaps
- I did not survey other agent frameworks beyond mindcraft (for example Voyager-style skill libraries, or MCP servers for mineflayer) for alternative patterns. The mineflayer README links a "minecraft-mcp-server" (history.md 4.28.0), which was not examined.
