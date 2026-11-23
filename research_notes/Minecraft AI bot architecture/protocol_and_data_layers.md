# Minecraft Java protocol and data layers for a bot client (server to world model to action)

Scope note: research done 2026-11-24. Sources are minecraft.wiki (which now hosts the old wiki.vg protocol docs), PrismarineJS READMEs, Paper docs, bug trackers, and the PrismarineJS packages installed in this repo (`/Users/travnikov/PetProjects/minecraft-gpt/node_modules`, inspected directly; cited as "local:" paths). Facts from my background knowledge that I could not re-verify this session are labelled **[unverified]** and kept in Inferences or Gaps.

Headline version facts:
- Current releases: 26.1 (protocol 775), 26.2 (776), 26.3 (777). 26.4 snapshots are in progress.
- The installed mineflayer 4.39.0 supports **1.8.8 through 26.1 only**. Its `latestSupportedVersion` is `'26.1'`. A 26.2 or 26.3 server is outside its supported range.

---

## 1. Server side: tick model, authority, validation, and what Paper/Spigot/Fabric add

### Takeaway
The server runs the authoritative simulation. It accepts client-predicted movement, digging, placement and inventory clicks only after checking them, and it corrects the client by sending authoritative state: a teleport/position sync, block updates acknowledged by sequence number, or a full container resync. Paper and Spigot add configurable packet-rate limits, spam kicks, anti-xray and item obfuscation, and expose the vanilla movement thresholds. Any of these can kick or desync a bot that acts faster or less exactly than a human client would.

### Cited Findings
- **Movement validation.** The server checks each player's movement distance against how many move packets it received that tick. If the limit is exceeded it logs "moved too quickly!" and rubber-bands the player. A later report gives the vanilla check as `(Δx²+Δy²+Δz²) − (Vx²+Vy²+Vz²) > limit² × packetCount`. — [MC-258862](https://bugs.mojang.com/browse/MC-258862); [MC-271185](https://bugs.mojang.com/browse/MC-271185)
- Spigot and Paper expose `moved-wrongly-threshold` (default 0.0625) and `moved-too-quickly-multiplier` (default 10.0). Setting moved-wrongly-threshold above about 0.7 has broken all movement. — [Skynode help article](https://help.skynode.pro/en/article/12lca08) (secondary source); [SPIGOT-2055](https://hub.spigotmc.org/jira/browse/SPIGOT-2055)
- Teleports, dimension changes and high latency are known triggers for false "moved too quickly" and teleport-back. — [MC-112430](https://bugs-legacy.mojang.com/browse/MC-112430); [MC-120008](https://bugs-legacy.mojang.com/browse/MC-120008)
- 1.21.2 added the `disablePlayerMovementCheck` game rule, which controls the player movement speed restriction. It also added the serverbound `client_tick_end` packet, sent when the client "finishes processing its current tick". — [Java Edition 1.21.2](https://minecraft.wiki/w/Java_Edition_1.21.2)
- **Correction channel: Synchronize Player Position.** The server sends Synchronize Player Position (clientbound 0x49 in protocol 777) and the client must reply with Confirm Teleportation (serverbound 0x00). Teleport Flags is a 4-byte bitfield of relative x/y/z/yaw/pitch/velocity bits; bit 0x0100 rotates velocity. — [Java Edition protocol/Packets](https://minecraft.wiki/w/Java_Edition_protocol/Packets)
  - mineflayer's physics plugin writes a `position` packet every physics tick. On a server `position` packet it writes `teleport_confirm`. — local: `node_modules/mineflayer/lib/plugins/physics.js` lines 112, 374, 423
- **Digging and placement reconciliation.** The protocol's "Sequence" is a counter for local block changes. It increments on left-clicking a block, right-clicking with an item, and starting or finishing digging. It exists to "avoid stale block changes" and to revert ghost blocks from placing, bucket use or breaking. The server answers with Acknowledge Block Change (clientbound 0x04); the client sends Player Action (serverbound 0x29). — [Java Edition protocol/Packets](https://minecraft.wiki/w/Java_Edition_protocol/Packets)
  - mineflayer keeps a `sequence` counter in its inventory plugin for use-item. For block placement it sends `sequence: 0`. — local: `node_modules/mineflayer/lib/plugins/inventory.js` lines 30, 122, 136; `generic_place.js` line 83
- **Inventory transactions.** Click Container (serverbound 0x12) is answered or corrected by Set Container Content (clientbound 0x12) and Set Container Slot (clientbound 0x14). — [Java Edition protocol/Packets](https://minecraft.wiki/w/Java_Edition_protocol/Packets)
  - Serverbound item stacks use a "Hashed Slot": "similar to Slot, but with the data component values being sent as a hash instead of their actual contents". — same source
- **Vanilla server.properties knobs that affect bots:**
  - `online-mode` = true. Only players verified with the Minecraft account database can join.
  - `enforce-secure-profile` = true (since 1.19). Only players with a Mojang-signed public key can join.
  - `view-distance` = 10. Chunks of world data sent to each player, in each direction.
  - `simulation-distance` = 10 (1.18+). Chunks around players within which entities are updated.
  - `entity-broadcast-range-percentage` = 100. Scales how far away entities are sent.
  - `rate-limit` = 0. Maximum packets a player can send before being kicked; 0 disables.
  - `player-idle-timeout` = 0. Minutes before an idle player is kicked; 0 means never.
  - `spawn-protection` = 16.
  - `white-list` default became **true in 26.3 snapshot 2**.
  - `pause-when-empty-seconds` = 60 (1.21.2+).
  - `accepts-transfers` = false.
  - `management-server-*` (25w35a+).
  - Source: [Server.properties](https://minecraft.wiki/w/Server.properties)
- **Paper `paper-global.yml` defaults:**
  - Spam limiter: `incoming-packet-threshold` 300. `recipe-spam-limit` 20, which kicks. `tab-spam-limit` 500, which kicks.
  - Packet limiter: KICK action, 500 packets per 7.0 s per player, with optional per-packet overrides (the documented example is `minecraft:place_recipe`).
  - Kick message for flying players: `multiplayer.disconnect.flying`.
  - `item-validation` limits on book, name and lore lengths.
  - `anticheat.obfuscation.items` (off by default) hides enchantments and lore from other clients.
  - Per-player chunk rates: `player-max-chunk-send-rate` 75/s, `player-max-chunk-load-rate` 100/s.
  - `misc.client-interaction-leniency-distance`: extra range allowed when validating interact packets.
  - `max-joins-per-tick` 5.
  - Proxy settings: Velocity/BungeeCord `online-mode`.
  - Source: [Paper global configuration](https://docs.papermc.io/paper/reference/global-configuration/)

### Inferences
- **Authority map:**
  - The client predicts movement and physics, and the server validates and corrects with teleports.
  - The server is authoritative for block state, through ack-by-sequence and block updates.
  - The server is authoritative for inventory, through state ID and full resync.
  - The server is authoritative for health, food, entity state, and combat damage and cooldown.
- A bot's action layer must treat every outgoing action as a *request*. Success is known only when an authoritative update comes back: a block_update or ack, a slot or window update, or no position correction.
- The Paper packet limiter (500 per 7 s ≈ 71 packets/s) sits well above mineflayer's normal rate of 20 position packets/s. Spam-clicking windows or recipes can still hit `recipe-spam-limit` or the packet limit.

### Gaps
- **[unverified]** 20 TPS (50 ms per tick) is the vanilla tick rate. Since 1.20.3 it can be changed with `/tick`. I did not fetch the minecraft.wiki Tick page this session.
- **[unverified]** Current vanilla reach validation uses the `block_interaction_range` and `entity_interaction_range` attributes (1.20.5+, defaults 4.5 and 3) plus a server-side tolerance. I did not confirm the exact tolerance.
- **[unverified]** Click Container has carried a "state ID" since 1.17.1. On mismatch the server resends the whole container. The fetched excerpt did not include these field details.
- **[unverified]** Digging validation details were not confirmed: the server compares elapsed dig time against expected break time and rejects early "finish digging".
- **[unverified]** Spigot `entity-tracking-range` defaults (players/animals/monsters 48, misc 32, other 64) and Paper anti-xray engine modes were not fetched.
- No primary source was found for Fabric-server specifics. Fabric is vanilla plus mods; anti-cheat mods vary.
- Third-party anti-cheat plugins (Grim, Vulcan and others) were not researched.

---

## 2. Connection lifecycle and auth (including LAN)

### Takeaway
The state sequence is Handshake → (Status | Login) → Configuration (1.20.2+) → Play. Online-mode servers send an Encryption Request that requires Mojang/Microsoft session authentication. Offline-mode servers skip it, and a bot then needs only a username (`auth: 'offline'`). Registries are synchronized in Configuration. Keep-alive must be answered or the connection times out.

### Cited Findings
- **Login sequence:** Login Start, then optional Encryption Request/Response, then optional Set Compression, then Login Success, then Login Acknowledged, then Configuration, then Play. — [Java Edition protocol/FAQ](https://minecraft.wiki/w/Java_Edition_protocol/FAQ)
- **Offline mode:** The server sends no Encryption Request and no encryption or authentication happens. The client can detect offline mode when Login Success arrives without an Encryption Request. Since 1.20.5 the protocol supports encryption in offline mode, but vanilla cannot be configured to use it. — same source
- **Keep-alive:** The server sends Keep Alive every 1–15 s and the client must echo it. The client times out if no keep-alive arrives within 20 s of entering Play. Keep Alive packet IDs in protocol 777: configuration 0x04 in both directions; play clientbound 0x2D and serverbound 0x1C. — [FAQ](https://minecraft.wiki/w/Java_Edition_protocol/FAQ); [Packets](https://minecraft.wiki/w/Java_Edition_protocol/Packets)
- **Spawn gating:** Since 1.21.4 the client needs Game Event 13 ("Start waiting for chunks") and must be in a loaded chunk to spawn. It falls back after 30 s. Player Loaded is sent after the loading screen closes, or skipped after 60 ticks. — [FAQ](https://minecraft.wiki/w/Java_Edition_protocol/FAQ)
  - mineflayer sends `player_loaded` when the feature flag `sendsPlayerLoadedPacket` is set. — local: `node_modules/mineflayer/lib/plugins/health.js` line 14
- **Registry Data in Configuration:**
  - The order of Registry Data packets defines the numeric IDs used for the rest of the session.
  - Known-pack negotiation lets the server omit NBT for vanilla entries.
  - Update Tags is sent in both Configuration and Play.
  - Source: [FAQ](https://minecraft.wiki/w/Java_Edition_protocol/FAQ); [Packets](https://minecraft.wiki/w/Java_Edition_protocol/Packets)
- **Disconnect packets:** login 0x00 (JSON text component reason), configuration 0x02, play 0x20. — [Packets](https://minecraft.wiki/w/Java_Edition_protocol/Packets)
- **Kick and throttle reasons** in Paper (translation keys): `multiplayer.disconnect.flying`, `disconnect.exceeded_packet_rate`, `multiplayer.disconnect.authservers_down`, and "Connection throttled!". — [Paper global configuration](https://docs.papermc.io/paper/reference/global-configuration/)
- **minecraft-protocol client modules** cover each lifecycle concern:
  - `autoVersion`, `setProtocol`, `encrypt`, `compress`, `keepalive`, `microsoftAuth`, `mojangAuth`, `chat`, `pluginChannels`, `play`, `versionChecking`, `tcp_dns`.
  - Signature and chat-session logic lives in `encrypt.js`, `chat.js`, `play.js` and `setProtocol.js`.
  - Source: local: `node_modules/minecraft-protocol/src/client/`
- **mineflayer auth options:** `auth: 'microsoft'` for real accounts; `'offline'` for offline-mode servers. — [mineflayer README](https://cdn.jsdelivr.net/npm/mineflayer@4.37.1/docs/README.md)
- **LAN worlds:**
  - The host broadcasts UDP multicast to 224.0.2.60:4445 every 1.5 s.
  - The port is random unless the host sets one, and it is shown in chat.
  - The host chooses the game mode for joining players, Allow Commands, and the port, from the menu or with `/publish`.
  - In 26.2-pre4 the menu was renamed back to "Open to LAN". Peer-to-peer invites were added in 26.2 snapshot 7 and removed before the 26.2 release.
  - Source: [Open to LAN](https://minecraft.wiki/w/Open_to_LAN)
- The third-party "OfflineLAN" Fabric mod exists to set online-mode to false on the integrated (LAN) server. This implies vanilla LAN worlds run in online mode. — [OfflineLAN (Modrinth)](https://modrinth.com/mod/offlinelan)

### Inferences
- **Requirements for a bot to connect:**
  - A server version within mineflayer's supported range (≤ 26.1 for 4.39.0).
  - Either a real Microsoft-authenticated account (online mode) or an offline-mode server.
  - If `enforce-secure-profile=true`, a Mojang-signed chat key. Offline bots cannot have one, so this usually applies only when online-mode is on.
  - Whitelist membership, now default-on as of 26.3.
  - Passing proxy forwarding (Velocity/Bungee) on networks.
- A vanilla "Open to LAN" world needs either a licensed Microsoft account for the bot or a mod such as OfflineLAN. This rests on the mod's stated purpose; the vanilla behavior is not confirmed by an official source.

### Gaps
- No official Mojang or minecraft.wiki statement was found on whether vanilla LAN enforces online-mode or enforce-secure-profile. The inference rests on a mod description.
- **[unverified]** The Set Compression default threshold is 256 (`network-compression-threshold`). This was confirmed in server.properties, but per-packet compression behavior was not studied.
- **[unverified]** Transfer packets (1.20.5+, `accepts-transfers`) and cookies were not researched.

---

## 3. What the server sends vs withholds (limits of client knowledge)

### Takeaway
The client sees only what is streamed to it:
- Chunks within the server's view distance around the player.
- Entities within tracking range, scaled by `entity-broadcast-range-percentage` and Spigot or Paper tracking ranges.
- Its own inventory, plus container contents only while a window is open.
- Chat filtered by the client's chat mode.

Everything else is unknown or stale. Paper can deliberately falsify data, such as hidden ores (anti-xray) and obfuscated item data.

### Cited Findings
- `view-distance` (default 10) sets the chunks sent per player. `simulation-distance` (default 10) sets where entities tick. `entity-broadcast-range-percentage` scales entity send range. — [Server.properties](https://minecraft.wiki/w/Server.properties)
- Chunks arrive as Chunk Data and Update Light packets in a circle around the player, preceded by Set Center Chunk. The vanilla client renders only chunks surrounded by loaded chunks on all sides. — [FAQ](https://minecraft.wiki/w/Java_Edition_protocol/FAQ)
- Paper rate-limits chunk sending to 75 chunks/s per player by default. A freshly joined or teleported bot therefore has an incomplete world for some time. — [Paper global configuration](https://docs.papermc.io/paper/reference/global-configuration/)
- Entity state arrives through Set Entity Metadata (clientbound 0x65 in protocol 777). Its contents are documented on the Entity metadata page. — [Packets](https://minecraft.wiki/w/Java_Edition_protocol/Packets)
- **Chat types:**
  - Player Chat Message is sent only in Full chat mode.
  - System Chat (command feedback) is sent in Full and Commands-only modes.
  - Overlay system chat is always sent.
  - Disguised Chat covers non-player `/say`-style output.
  - Blocking of social interactions happens on the client.
  - Source: [Java Edition protocol/Chat](https://minecraft.wiki/w/Java_Edition_protocol/Chat)
- **Chat packets in protocol 777:**
  - Clientbound: Player Chat Message 0x42.
  - Serverbound: Chat Message 0x09, Acknowledge Message 0x06, Player Session 0x0A (chat session), Chat Command 0x07, Signed Chat Command 0x08.
  - Source: [Packets](https://minecraft.wiki/w/Java_Edition_protocol/Packets)
- prismarine-registry derives chat formatting (`chatFormattingById` / `ByName`) from the server-sent `chat_type` registry. Since 1.21 the player-chat chat-type index is offset by 1 (`incrementedChatType`). — local: `node_modules/prismarine-registry/lib/pc/index.js`; [prismarine-registry README](https://github.com/PrismarineJS/prismarine-registry)
- Paper's `enable-item-obfuscation` (off by default) hides enchantments and lore on other players' items from clients. — [Paper global configuration](https://docs.papermc.io/paper/reference/global-configuration/)
- `hide-online-players` hides the player list in status responses. — [Server.properties](https://minecraft.wiki/w/Server.properties)

### Inferences
- **The world model is a partial, lagging mirror of server state.** Pathfinding and search must treat unloaded chunks as unknown, not as air.
- Other players' inventories are never sent; only held and armor equipment is visible. Chest contents exist in the model only while that window is open.
- With Paper anti-xray enabled, ores seen client-side may be fake.

### Gaps
- **[unverified]** Vanilla per-entity-type tracking ranges (from `EntityType.clientTrackingRange`, in chunks) were not fetched.
- **[unverified]** Signed-chat internals were not documented by the fetched Chat page: 1.19 introduced signing, 1.19.3 added chat sessions with last-seen acknowledgements, and kick reasons include "chat validation failed" and out-of-order chat. A dedicated source such as the minecraft.wiki "Chat signing" or Packets sections is still needed.
- **[unverified]** Sound, time/weather, health/food and player-info packet specifics were not fetched. They are well-known clientbound packets (Set Health, Update Time, Game Event for rain, Player Info Update), but no packet IDs were confirmed.

---

## 4. Identifier layers (numeric IDs, namespaced IDs, display names, states, components, tags, recipes)

### Takeaway
The same item appears in several forms:
- On the wire: numeric item registry ID **36** (stable 1.21.4 through 26.1, but 13 in 1.13.2 and `planks:5`+metadata in 1.12).
- As a namespaced key: `minecraft:oak_planks`, the stable identifier.
- Localized for display: "Oak Planks", from translation keys and the language file.

Blocks additionally have numeric *block-state IDs* that encode properties. Item data moved from NBT to data components in 1.20.5. Recipes since 1.21.2 reach the client only as recipe-book "displays" for unlocked recipes. mineflayer instead uses static recipe JSON from minecraft-data.

### Cited Findings
- **ID drift for oak planks in minecraft-data:**

  | Version | Item | Block |
  |---|---|---|
  | 1.12 | id 5 `planks` "Wooden Planks", variants via metadata | id 5 "Wood Planks" |
  | 1.13.2 | id 13 `oak_planks` "Oak Planks" | id 13, state ID 15 |
  | 1.21.4, 1.21.11, 26.1 | id **36** `oak_planks` "Oak Planks" | id 13, minStateId = maxStateId = defaultState = 15 |

  Source: local: `node_modules/minecraft-data/minecraft-data/data/pc/{1.12,1.13.2,1.21.4,1.21.11,26.1}/items.json`, `blocks.json`
- **Block states example:** oak_log in 26.1 is block id 49, "Oak Log", with state IDs 136–138 (default 137) for property `axis` ∈ {x, y, z}. Other fields: `material: "mineable/axe"` (tag-derived) and `drops: [134]` (item IDs). — local: `.../pc/26.1/blocks.json`
- **minecraft-data recipes** are keyed by numeric result item ID with numeric ingredient IDs. For example, 26.1 recipe for item 36 is `{"ingredients":[134],"result":{"id":36,"count":4}}`. — local: `.../pc/26.1/recipes.json`
- **Registries:** They have both namespaced identifiers and signed 32-bit numeric IDs. "Some are synchronized at runtime, while others are hardcoded." For synchronized registries, the order of Registry Data packets defines the numeric IDs. — [Packets](https://minecraft.wiki/w/Java_Edition_protocol/Packets); [FAQ](https://minecraft.wiki/w/Java_Edition_protocol/FAQ)
- **Data components (1.20.5+) replaced item NBT:**
  - Command form: `item_id[component=value]`, with `!component` to remove.
  - Storage form: `{id, count, components}`, holding only non-default components.
  - Each item type has default (prototype) components that are not saved per stack.
  - Bot-relevant components: `damage`, `max_damage`, `max_stack_size`, `custom_name` (highest display priority), `item_name`, `enchantments`, `food`, `consumable`, `tool`.
  - Source: [Data component format](https://minecraft.wiki/w/Data_component_format)
- **prismarine-item:**
  - Stores network components as a `components` array plus `componentMap`.
  - Encodes them back with `addedComponentCount` and `removeComponents`.
  - Takes `displayName` from the item enum. `customName` reads the `custom_name` component.
  - Source: local: `node_modules/prismarine-item/index.js` lines 23–55, 88–95, 155–211
- **Tag churn in 26.1:** `#dirt` was split into `#mud`, `#moss_blocks` and `#grass_blocks`. New item tags include `#dyes` and `#metal_nuggets`. — [Java Edition 26.1](https://minecraft.wiki/w/Java_Edition_26.1)
- **Recipes on the wire (current):**
  - Recipes are sent as **Recipe Display** structures, each prefixed by a VarInt from the `minecraft:recipe_display` registry.
  - Recipe Display types: `crafting_shapeless`, `crafting_shaped` (width × height), `furnace` (with cooking time and XP), `stonecutter`, `smithing`.
  - Ingredients are **Slot Displays** from the `minecraft:slot_display` registry. Types include `item`, `item_stack`, `tag`, `any_fuel`, `with_remainder`, `composite`, and `smithing_trim`.
  - Packets: Recipe Book Add 0x4B, Recipe Book Remove 0x4C, Update Recipes 0x88.
  - Source: [Java Edition protocol/Recipes](https://minecraft.wiki/w/Java_Edition_protocol/Recipes); [Packets](https://minecraft.wiki/w/Java_Edition_protocol/Packets)
- "Starting in Minecraft 1.21.2, the server keeps the full recipe list and sends only the recipes a player has unlocked." — [Client Recipe Fix (Modrinth)](https://modrinth.com/project/zpdSKKul) (secondary source)
  - Some servers send empty recipe-book syncs. — [Recipe Improvements (Modrinth)](https://modrinth.com/project/ULed1RnI)
- **mineflayer's crafting does not use server-sent recipes.** `prismarine-recipe` reads `registry.recipes` (static minecraft-data), and `bot.recipesFor` and `bot.recipesAll` call `Recipe.find(itemType, metadata)`. Crafting is done by individual window clicks. — local: `node_modules/prismarine-recipe/lib/recipe.js` line 8; `node_modules/mineflayer/lib/plugins/craft.js` lines 8, 59–139, 206–221
- **Entity IDs:** 1.21.2 split boat and chest-boat entity types per wood (for example `oak_boat`), replacing the `Type` field. 1.21.2 also added `crafting_transmute`, which replaced `crafting_special_shulkerboxcoloring`. — [Java Edition 1.21.2](https://minecraft.wiki/w/Java_Edition_1.21.2)

### Inferences
- **Where each identifier form appears:**
  - Numeric item ID (`36`) and block-state ID (`15`) appear in packets and in minecraft-data and the prismarine objects (`item.type`, `block.stateId`).
  - `oak_planks` is the cross-version key: `item.name`, `registry.itemsByName`, and commands. It is also what an LLM should be given and should return.
  - "Oak Planks" (`displayName`) is for humans only. It is not unique historically ("Wood Planks" vs "Wooden Planks" in 1.12) and is localized in the vanilla client.
  - A `custom_name` component can override what players see in-game.
- **Stability ranking:** Namespaced IDs are mostly stable, but renames and splits happen: `planks` → `oak_planks` (1.13), boat entity split (1.21.2), `#dirt` tag split (26.1). Numeric IDs are per-version and must never be persisted or shown to the AI. State IDs are the least stable of all.
- The bot's crafting knowledge (static JSON) can diverge from the server's real recipes when data packs or plugins add or remove recipes. The server then rejects the craft simply by not producing a result in the slot.

### Gaps
- **[unverified]** The exact contents of Update Recipes since 1.21.2 were not on the fetched pages. My understanding is that it carries item "property sets" and stonecutter recipes, not the full crafting list.
- **[unverified]** Since 1.21.5 the serverbound Hashed Slot hashes component values (CRC32C). The fetched text confirms hashing but not the algorithm.
- Whether minecraft-data's `recipes.json` includes tag-based ingredients, or expands tags into item IDs, was not checked.
- **[unverified]** Translation keys (e.g. `block.minecraft.oak_planks`) are in minecraft-data's `language` data. The language file exists in dataPaths, but the key format was not inspected.

---

## 5. Version churn 1.20.x → 1.21.x → 26.x affecting bots

### Takeaway
Protocol numbers change on almost every release. Major structural breaks for bots:
- 1.20.2: configuration state.
- 1.20.5: data components and split registry data.
- 1.21.2: recipe displays, `client_tick_end`, movement-check game rule, boat entity split.
- 1.21.4: spawn gating, Player Loaded.
- 1.21.5: hashed slots.
- 26.1: new year-based numbering, unobfuscated jars, Java 25, tag splits, data-driven trades.

26.2 and 26.3 are already out and are newer than what mineflayer 4.39 supports.

### Cited Findings
- **Release protocol and data versions** (minecraft-data `protocolVersions.json`):

  | Version | Protocol | Data version |
  |---|---|---|
  | 1.20 / 1.20.1 | 763 | |
  | 1.20.2 | 764 | |
  | 1.20.3 / 1.20.4 | 765 | |
  | 1.20.5 / 1.20.6 | 766 | |
  | 1.21 / 1.21.1 | 767 | |
  | 1.21.2 / 1.21.3 | 768 | |
  | 1.21.4 | 769 | |
  | 1.21.5 | 770 | |
  | 1.21.6 | 771 | |
  | 1.21.7 / 1.21.8 | 772 | |
  | 1.21.9 / 1.21.10 | 773 | |
  | 1.21.11 | 774 | 4671 |
  | 26.1 / 26.1.1 / 26.1.2 | 775 | 4786–4790 |
  | 26.2 | 776 | 4903 |
  | 26.3 | 777 | 5023 |
  | 26.4 snapshots | 0x40000000-range snapshot numbers | |

  Source: local: `node_modules/minecraft-data/minecraft-data/data/pc/common/protocolVersions.json`
- **26.1:**
  - Released March 24, 2026 ("Tiny Takeover"); protocol 775; data version 4786.
  - First release on the year.drop.hotfix numbering (announced December 2025).
  - First fully unobfuscated release; requires Java 25.
  - New data-driven `villager_trade` and `trade_set` registries, and a `world_clock` registry.
  - New components `additional_trade_cost` and `dye`. Invalid stacks (count above `max_stack_size`) are often treated as empty.
  - `#dirt` tag split.
  - `/time` is clock-based. Banner and sign `rotation` default changed to 8.
  - Source: [Java Edition 26.1](https://minecraft.wiki/w/Java_Edition_26.1)
- **mineflayer 4.39.0** has `testedVersions` 1.8.8 … 1.21.11 and 26.1, with `latestSupportedVersion: '26.1'`. — local: `node_modules/mineflayer/lib/version.js`
- **minecraft-data** lists PC support through 1.21.10 and 26.1 in its README. Installed minecraft-data 3.119.0 has `dataPaths` entries for 26.1 (protocol mapped to `pc/latest`) but none for 26.2 or 26.3. — [minecraft-data README](https://github.com/PrismarineJS/minecraft-data); local: `.../data/dataPaths.json`
- **1.21.2:** `client_tick_end` packet, `disablePlayerMovementCheck` game rule, new item components (`consumable`, `equippable`, `use_cooldown`, `use_remainder`, `damage_resistant`; `fire_resistant` removed), boat entity split. — [Java Edition 1.21.2](https://minecraft.wiki/w/Java_Edition_1.21.2)
- **1.21.4:** Game Event 13 and Player Loaded spawn flow. — [FAQ](https://minecraft.wiki/w/Java_Edition_protocol/FAQ)
- **1.20.5:** Segmented registry data. prismarine-registry's code comment: "1.20.5+ dimension data is now separated outside the NBT and is sent through multiple registry_data packets". — local: `node_modules/prismarine-registry/lib/pc/index.js` lines 68–72
- **26.3:** `white-list` default changed to true (snapshot 2). — [Server.properties](https://minecraft.wiki/w/Server.properties)

### Inferences
- The project should pin its test server to 26.1 or older, or wait for mineflayer to add 26.2 and 26.3 support. Joining a 26.2+ server with 4.39 is expected to fail the version check or misparse packets.
- Code that stores numeric IDs, or assumes tag membership such as `#dirt`, breaks across these versions. Name-based lookups through `bot.registry` are the right boundary.

### Gaps
- **[unverified]** Configuration state introduced in 1.20.2, and data components in 1.20.5 (protocol 766), were inferred from linked page titles and PrismarineJS code rather than fetched changelogs.
- Specific network packet changes in 26.1, 26.2 and 26.3 were not read; the changelog pages were truncated.
- Whether mineflayer has a release newer than 4.39 supporting 26.2 or 26.3 was not checked.

---

## 6. PrismarineJS stack mapped onto the layers

### Takeaway
The stack splits into these layers, bottom to top:
1. **minecraft-protocol** (wire): framing, compression, encryption, auth, keepalive, packet (de)serialization from minecraft-data's `protocol.json`. Packets come out as JS objects with numeric IDs.
2. **minecraft-data** (static per-version JSON): items, blocks, states, recipes, entities, language, collision shapes, and more.
3. **prismarine-registry**: wraps minecraft-data as `bot.registry` and overlays server-sent dynamic registries (chat types, dimension types, biomes).
4. **prismarine-\* object libraries**: Item, Block, Entity, Chunk, Windows, Physics, Recipe, Chat, NBT, turning numeric IDs into named objects.
5. **mineflayer** (world model plus action API).

Conversion from numeric ID to name happens in layers 3–4: `registry.items[id].name`, `blocksByStateId`, and the Item and Block constructors.

### Cited Findings
- **Installed versions:**

  | Package | Version |
  |---|---|
  | mineflayer | 4.39.0 |
  | minecraft-protocol | 1.68.0 |
  | minecraft-data | 3.119.0 |
  | prismarine-registry | 1.12.0 |
  | prismarine-item | 1.18.0 |
  | prismarine-block | 1.23.0 |
  | prismarine-entity | 2.6.0 |
  | prismarine-chunk | 1.41.0 |
  | prismarine-windows | 2.10.0 |
  | prismarine-physics | 1.11.1 |
  | prismarine-recipe | 1.5.0 |
  | prismarine-chat | 1.13.0 |
  | prismarine-nbt | 2.8.0 |
  | mineflayer-pathfinder | 2.4.5 |

  Source: local: `node_modules/*/package.json`
- **minecraft-data** provides Biomes, Blocks, Effects, Enchantments, Entities, Foods, Instruments, Items, Language, Map icons, Materials, Particles, Protocol, Protocol Versions, Recipes, Windows, Block collision shapes, Commands, Legacy (1.12 ↔ 1.13+ ID mapping), Features and Sounds. It is generated by tools such as minecraft-data-generator (a Fabric mod) and burger, run through an auto-updater. — [minecraft-data README](https://github.com/PrismarineJS/minecraft-data)
  - Per-version `dataPaths` also include attributes, tints, loginPacket and blockLoot. — local: `.../data/dataPaths.json`
- **prismarine-registry** "creates a dynamic, version-specific instance of node-minecraft-data" with lookups such as `blocksByName`. It adds `loadDimensionCodec` and `writeDimensionCodec` (login or registry_data), `chatFormattingById/ByName` (1.19+) and `dimensionsById/ByName` (1.19+). — [prismarine-registry README](https://github.com/PrismarineJS/prismarine-registry)
  - Handlers exist only for `chat_type`, `dimension_type` and `worldgen/biome`. — local: `node_modules/prismarine-registry/lib/pc/index.js`
- mineflayer's plugin list maps to world-model and action concerns: blocks, entities, inventory, simple_inventory, chest, craft, furnace, anvil, villager, enchantment_table, digging, place_block, generic_place, physics, health, chat, game, time, rain, kick, settings, scoreboard, tablist, team, sound, particle, ray_trace, spawn_point, resource_pack, and others. — local: `node_modules/mineflayer/lib/plugins/`

### Inferences
- **Proposed layer diagram:**
  1. Server game event (tick).
  2. Clientbound packet (numeric IDs, state IDs, component patches).
  3. minecraft-protocol parsed object.
  4. prismarine-\* objects resolved through `bot.registry`: `Block{name, stateId, properties}`, `Item{type, name, count, components}`, `Entity{name, metadata}`.
  5. mineflayer world model (`bot.world` chunk columns, `bot.entities`, `bot.inventory`, `currentWindow`, health and food, chat events).
  6. **Bot / LLM decision layer, which should see only namespaced names and coordinates.**
  7. mineflayer action API (`dig`, `placeBlock`, `craft`, `clickWindow`, pathfinder goals).
  8. Serverbound packets (position each tick, player_action with sequence, use_item_on, container_click with state ID and hashed slots).
  9. Server validation, then an ack or correction back into step 2.
- **Ownership rule:**
  - Numeric IDs and state IDs belong to the protocol and registry layers only.
  - Namespaced names are the contract between the world model and the AI.
  - Display names and translation keys are presentation only.
  - Recipes come from static minecraft-data, not the server, so they are a "best-known" model that the server can overrule.

### Gaps
- prismarine-chunk, prismarine-windows, prismarine-physics and prismarine-entity READMEs were not fetched. Their roles above come from package names and the mineflayer plugin structure. **[unverified]** prismarine-physics reimplements vanilla player physics so that mineflayer's predicted positions pass the server's movement check.
- **[unverified]** mineflayer uses Update Tags data for anything beyond static minecraft-data materials. This was not checked; grep found no direct `tags` packet handler in `mineflayer/lib/plugins`.
