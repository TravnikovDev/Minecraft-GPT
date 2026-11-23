# Gameplay Domain Model for a Minecraft Companion Bot: Progression to the Ender Dragon, Survival Needs, Companion Roles and Multiplayer Rules

Scope note: Minecraft Java Edition, current as of November 2026. Java Edition dropped the "1.xx" numbering. 26.1 is the first `<year>.<drop>` release, and its Snapshot 1 came out on 16 Dec 2025 ([Mojang feedback post](https://feedback.minecraft.net/hc/en-us/articles/42011663817357-Minecraft-Java-Edition-26-1-Snapshot-1); [Beebom](https://beebom.com/minecraft-new-version-numbering-system-for-java-edition); [minecraft.wiki 26.1 dev versions](https://minecraft.wiki/w/Java_Edition_26.1/Development_versions)). None of the core progression mechanics below are known to have changed in 26.1. Claims marked **[game knowledge, unverified this session]** come from general domain knowledge and were not re-checked against a source during this research. They are kept only in Inferences sections and should be verified before they are encoded as hard rules.

## Q1. Progression path to beat the game (dependency graph, minimal path, hardest steps to automate)

### Takeaway
"Beating the game" reduces to a short dependency chain: wood → stone → iron (bucket, shield, armour) → Nether access → blaze rods (fortress) plus ender pearls (endermen or piglin bartering) → about 12 eyes of ender → stronghold triangulation → End portal → dragon (10 end crystals, 200 HP). Diamonds are optional on the speedrun path. The steps that are hardest to automate are search and navigation problems: finding a fortress or bastion in the Nether, triangulating the stronghold, and fighting the dragon. Those are dominated by lava, void and fall hazards, not by crafting.

### Cited Findings
**Early game (Overworld tiers)**
- Recommended first-day order: punch about 4 logs → planks → crafting table (3×3 grid needed for most recipes) → wooden pickaxe (wooden sword, shovel and hoe are discouraged) → dig to stone (needs a wooden pickaxe) → about 14 cobblestone → stone pickaxe, stone axe and furnace → mine whole coal, copper and iron veins → hunt pigs, cows, sheep and chickens (about half a stack of raw meat) → shelter with a crafting table, furnace and bed (wool from sheep) — [minecraft.wiki Beginner's guide](https://minecraft.wiki/w/Tutorial:Beginner%27s_guide)
- There are seven tool tiers. Some blocks need a minimum tier, and mining them with a lower tier drops nothing — [Beginner's guide](https://minecraft.wiki/w/Tutorial:Beginner%27s_guide)
- Starting biome matters. Plains and forest are recommended. Dark forest (mobs persist in the shade), desert, badlands and grove are harder. Swamps spawn "bogged" at night — [Beginner's guide](https://minecraft.wiki/w/Tutorial:Beginner%27s_guide)
- Villages offer shelter, beds and trading. Attacking villagers raises prices. Iron golems are neutral but can kill a player in a few hits. Build your own base 50–100 blocks from a village so monsters are not drawn to it — [Beginner's guide](https://minecraft.wiki/w/Tutorial:Beginner%27s_guide)

**Ore distribution (1.18+ world generation, world height -64 to 320)**
- Diamond ore generates from Y=16 down to Y=-63 and becomes more common lower down. Deepslate diamond ore is most common at Y=-58/-59. Diamond ore needs an iron pickaxe or better. Ore next to air may not generate (50–100% skip chance depending on the batch), but water or lava exposure does not reduce it, so diamonds often sit on aquifer walls — [minecraft.wiki Diamond Ore](https://minecraft.wiki/w/Diamond_Ore)
- Diamond generation below Y=0 was increased in 1.20.2. Deepslate variants generate in the deepslate layer — [minecraft.wiki Ore](https://minecraft.wiki/w/Ore)
- Secondary guides put the best diamond levels at Y -54 to -59 — [Sportskeeda](https://www.sportskeeda.com/minecraft/best-height-find-diamonds-minecraft-1-18-update). Iron's best levels are Y=16 and Y=232 (mountains), and it can be found almost anywhere — [Sportskeeda](https://sportskeeda.com/minecraft/5-best-levels-find-ores-minecraft-1-18-update). Treat these as secondary sources, because the wiki Ore table did not extract cleanly.
- Nether: ancient debris peaks at layer 16 and needs a diamond pickaxe. Nether quartz is most common around 114 and needs a wooden pickaxe — [minecraft.wiki Ore](https://minecraft.wiki/w/Ore)

**Nether: fortress and bastion**
- The Nether is divided into 432×432 regions. Each region gets either a fortress or a bastion remnant, never both, and a fortress is chosen 40% of the time (2/5). A bastion that tries to generate in basalt deltas becomes a fortress instead. Fortresses generate in all Nether biomes — [minecraft.wiki Nether Fortress](https://minecraft.wiki/w/Nether_Fortress)
- A fortress has up to two blaze spawner platforms. Wither skeletons and blazes spawn only in fortresses. Nether wart grows in soul-sand gardens and appears in chest loot — [Nether Fortress](https://minecraft.wiki/w/Nether_Fortress)
- Blaze: 20 HP. Drops 0–1 rod (50%) by default, and Looting raises this to 0–4 at Looting III. Rods drop only when a player or tamed wolf makes the kill. It fires three-fireball volleys (5 HP each on Normal, sets the target on fire). Blazes are immune to fire, lava and fall damage, and vulnerable to snowballs (3 HP) and water or rain — [minecraft.wiki Blaze](https://minecraft.wiki/w/Blaze)
- Each blaze rod gives 2 blaze powder, and each eye needs 1 powder. Speedrun guides target 6 rods, with a 7th as margin — [BisectHosting speedrun guide](https://www.bisecthosting.com/blog/beginners-guide-to-speedruns-minecraft-1-17)

**Ender pearls**
- Enderman: 40 HP. Drops 0–1 pearl (50%), and Looting III raises the average to 2. Endermen become hostile when looked at in the eyes within 64 blocks; a carved pumpkin on the head prevents this. They teleport when hit and usually dodge arrows. Water and rain damage them. They spawn most in warped forests in the Nether and in groups of four in the End — [minecraft.wiki Enderman](https://minecraft.wiki/w/Enderman)
- Piglin bartering: give an adult piglin a gold ingot. It examines it for 6 s (120 ticks), then tosses a random item. Ender pearls come in stacks of 2–4, averaging about 15.63 gold ingots per pearl in the current Java table (fractions are over 469). Breaking containers or gold blocks nearby angers piglins. Baby piglins keep the gold, and brutes ignore it. 1.16.2 (20w28a) tweaked barter chances — [minecraft.wiki Bartering](https://minecraft.wiki/w/Bartering)
- Speedruns of 1.16+ are mostly done on 1.16.1 because its bartering pearl rate is higher — [Wikipedia via Wikiwand](https://www.wikiwand.com/en/articles/Minecraft_speedrunning). A guide's claim of a "15% chance of 2–4 pearls per gold bar" conflicts with the wiki's ~15.6 ingots/pearl figure — [BisectHosting](https://www.bisecthosting.com/blog/beginners-guide-to-speedruns-minecraft-1-17) vs [Bartering](https://minecraft.wiki/w/Bartering). Treat the 15% figure as wrong or outdated.

**Eyes of ender and stronghold**
- Eye of ender = blaze powder + ender pearl. Thrown, it flies about 12 blocks toward the nearest stronghold's staircase chunk. If you are closer than 12 blocks, it flies downward, meaning dig down. It works only in the Overworld. Each throw has a 20% chance to shatter. 12 eyes activate a portal — [minecraft.wiki Eye of Ender](https://minecraft.wiki/w/Eye_of_Ender)
- Java has 128 strongholds in 8 rings around (0,0). The first ring has 3 strongholds at 1,280–2,816 blocks from origin, and the second has 6 at 4,352–5,888. Strongholds are never partly above sea level. The portal room has 12 frames, each with a 10% chance of a pre-placed eye (about 1.2 on average). There is a silverfish spawner, plus infested stone bricks — [minecraft.wiki Stronghold](https://minecraft.wiki/w/Stronghold)
- Since November 2021, speedrun.com allows external tools that compute stronghold coordinates from measured eye angles (triangulation) — [Wikipedia via Wikiwand](https://www.wikiwand.com/en/articles/Minecraft_speedrunning)

**End and the Ender Dragon**
- The dragon has 200 HP. Ten obsidian towers carry end crystals, some caged in iron bars. A crystal heals the dragon while it lives. Destroying a crystal while it is healing the dragon deals about 10 HP — [minecraft.wiki Defeating the Ender Dragon](https://minecraft.wiki/w/Tutorials/Defeating_the_Ender_Dragon)
- The dragon is immune to arrows while perched over the portal, where it can be hit in melee. Bed explosions on the portal during a perch can take up to a quarter of its health. The safest method is to stand inside the exit portal, place a bed, put a block beside it, then use the bed. End crystals can replace beds — [Defeating the Ender Dragon](https://minecraft.wiki/w/Tutorials/Defeating_the_Ender_Dragon)
- Recommended kit: diamond or netherite armour, sword, bow with Power/Infinity or 2–3 stacks of arrows (snowballs work on crystals), golden apples, food, slow falling, ender pearls, blocks for pillaring, water bucket, carved pumpkin, optional beds. Hazards: endermen, the void (kills and destroys gear, and a totem does not help), dragon's breath (about 6 HP/s of magic damage that ignores armour), and fall damage from knockback — [Defeating the Ender Dragon](https://minecraft.wiki/w/Tutorials/Defeating_the_Ender_Dragon)
- Killing the dragon activates the exit portal, which is the only way back and plays the credits. You also get up to about 12,000 XP and the dragon egg — [Defeating the Ender Dragon](https://minecraft.wiki/w/Tutorials/Defeating_the_Ender_Dragon)

**Existing automation of these steps**
- Baritone provides `goto`, `mine <ores>` (`legitMine` mines only visible ores), `explore x z` (heads to unseen chunks), `tunnel`, `axis` (go to an axis at y=120, often used for travel), `follow`, `farm`, `build <schematic>`, and waypoints tagged home/death/user. Settings include `allowBreak`/`allowPlace`, `avoidance` (mobs and spawners), `blocksToAvoidBreaking` and `acceptableThrowawayItems` — [Baritone USAGE.md](https://github.com/cabaletta/baritone/blob/master/USAGE.md)

### Inferences
- **Dependency graph** (prerequisite → product). Edges are drawn from the sources above, and recipe and quantity details are **[game knowledge, unverified this session]**:
  - `logs → planks → crafting_table; sticks`
  - `planks+sticks → wooden_pickaxe → cobblestone → stone_pickaxe, stone_sword, furnace`
  - `stone_pickaxe → iron_ore, copper_ore, coal`; `furnace + fuel + raw_iron → iron_ingot`
  - `iron_ingot(3) → bucket` → `water_bucket` (fall/lava/fire safety, portal casting) and `lava_bucket`
  - `iron_ingot + planks → shield`; `iron_ingot → iron_pickaxe, iron_armor`
  - `iron_pickaxe → diamond_ore → diamond_pickaxe`, `iron_pickaxe → gold_ore, redstone`
  - `obsidian` comes from mining with a diamond pickaxe, OR from casting water over lava in a frame (speedrun "bucket portal", which needs no diamonds) → `nether_portal` (minimum 10 obsidian, corners optional) + `flint_and_steel` (iron + flint from gravel)
  - `wool(3) + planks → bed` (spawn point, night skip, dragon damage)
  - `string(3) + sticks → bow`; `flint + stick + feather → arrows`
  - `nether_portal → Nether` → `fortress → blaze_rod(≥6) → blaze_powder(≥12)`; `bastion/gold → bartering → ender_pearl`, or `endermen → ender_pearl(≥12)`
  - `blaze_powder + ender_pearl → eye_of_ender(≈12 + spares for 20% breakage + throws)`
  - `eye throws (2+ positions) → stronghold coordinates → dig down → portal room → fill frames → End`
  - `End: crystals (bow/snowballs/pillar) → dragon (melee on perch / beds) → exit portal`
- **Minimal path (speedrun-style):** skip diamonds. Get iron for a bucket and flint and steel. Make an obsidian portal with a bucket. Get pearls by bartering in a bastion and rods in a fortress. Triangulate the stronghold. Kill the dragon with beds. A "casual robust" path for a bot (iron/diamond armour, bow, shield, food farm) is slower but tolerates mistakes better. The architect should probably model goals as a DAG with alternative producers (OR-nodes) for obsidian and pearls.
- **Hardest steps to automate, in rough order:**
  1. Dragon fight: a moving target, perch timing, void edges, endermen, and breath that ignores armour.
  2. Nether navigation: lava lakes, ghast fireballs, piglin aggression, no water, beds explode, and a fortress-or-bastion search over 432-block regions with no compass.
  3. Stronghold triangulation: needs angle-measuring geometry and 20% eye loss, plus a long journey of 1,280–2,816+ blocks.
  4. Bartering without angering piglins (gold armour is required **[game knowledge, unverified this session]**).
  5. Lava, falls and cave navigation in general.
- The 128-stronghold ring layout lets the bot narrow its search: the nearest ring-1 stronghold is 1.28–2.8k blocks from origin.

### Gaps
- Exact per-ore Y ranges and peaks for iron, gold, copper, coal, redstone, lapis and emerald: the wiki ore table extracted garbled. Only diamonds are wiki-confirmed. Iron Y16/Y232 is from a secondary source.
- Exact current bartering weights (inferred about 10/469 for pearls) and the 1.16.1 vs 1.16.2 difference were not confirmed numerically.
- Speedrun-community specifics (one-eye or "blind travel" techniques, Ninjabrain Bot-style calculators, current 26.x route meta) were not found in reliable form.
- Recipes (bucket, shield, bed, portal size, flint and steel) were not re-verified this session.
- No 26.1-specific changes to progression, mobs or structures were found. The 26.1 notes found cover data-driven villager trades, a lighting rewrite, a `/swing` command and Java 25 ([Beebom](https://beebom.com/minecraft-new-version-numbering-system-for-java-edition)).

## Q2. Survival needs and hazards that must preempt goals

### Takeaway
A bot needs a priority-interrupt layer under its goals: drowning, burning or lava, low health, falling blocks and hostile mobs must pre-empt any task. Mindcraft's mode system (self_preservation > unstuck > cowardice > self_defense > idle behaviours) is a working reference for this ordering. Hunger management (keep food ≥18 to regenerate), the 5-minute item despawn timer after death, and the bed spawn point are the key slower-cycle survival concerns.

### Cited Findings
- Player health is 20 HP. After a hit, there is 10 ticks (0.5 s) of invulnerability, and only higher damage gets through. Armour does not reduce fall, drowning, suffocation, starvation or void damage. Fire Resistance negates fire and lava damage — [minecraft.wiki Damage](https://minecraft.wiki/w/Damage)
- Hunger: the bar holds 20 and drains only after saturation is used up. Health regenerates every 4 s at hunger ≥18 or when saturation > 0. Sprinting is disabled at ≤6. At 0 hunger, you lose 1 HP every 4 s down to a floor of 10 HP on Easy, 1 HP on Normal, or death on Hard. Exhaustion costs: sprint 0.1/m, jump 0.05, swim 0.01/m. Eating takes 1.6 s (dried kelp 0.8 s), and most foods cannot be eaten at full hunger — [minecraft.wiki Hunger](https://minecraft.wiki/w/Hunger)
- Death: inventory drops at the death location, and the player respawns at world spawn or at their bed. The Keep Inventory game rule exists — [Beginner's guide](https://minecraft.wiki/w/Tutorial:Beginner%27s_guide)
- Item entities despawn after 6,000 ticks (5 min) in loaded, entity-ticking chunks, and the timer pauses when the chunk unloads. Lava, fire, cactus and explosions destroy items, but netherite survives fire and lava. Items fall into the void below Y=-128 in the Overworld or Y=-64 in the Nether and End, and vanish — [minecraft.wiki Item (entity)](https://minecraft.wiki/w/Item_(entity))
- Endermen are provoked by eye contact, and a carved pumpkin prevents it. Water and rain hurt them — [minecraft.wiki Enderman](https://minecraft.wiki/w/Enderman)
- Blazes set the target on fire with fireballs — [minecraft.wiki Blaze](https://minecraft.wiki/w/Blaze)
- Mindcraft's priority modes, in check order: `self_preservation` (default on, interrupts all: "Respond to drowning, burning, and damage at low health"), `unstuck`, `cowardice` ("Run away from enemies"), `self_defense` ("Attack nearby enemies"), then idle-only modes `hunting`, `item_collecting`, `torch_placing`, `elbow_room` (move away from players), `idle_staring`, and `cheat` (off). Concretely, self_preservation does four things. It jumps if water is overhead. It moves 2 blocks away if sand or gravel is above. In lava or fire it uses a water bucket, else goes to water within 20 blocks, else moves 5 blocks away. If health is below 5 or the last hit would be lethal, it flees 20 blocks — [mindcraft modes.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/main/src/agent/modes.js)
- Human Companions NPCs warn the player and run away from creepers instead of fighting them — [CurseForge Human Companions](https://www.curseforge.com/minecraft/mc-mods/human-companions)

### Inferences
- Suggested interrupt priority for the architect, adapted from mindcraft:
  1. Imminent death: void, lava, fire or burning, drowning, suffocation or falling block, lethal fall.
  2. Low-health retreat and eat.
  3. Threat response: flee from creepers, fight or kite other hostiles.
  4. Owner-protection duties.
  5. Hunger top-up when food < 18.
  6. Night handling: sleep or shelter.
  7. Inventory full → deposit.
  8. Current goal.
  9. Idle behaviours.
- Death recovery is a time-boxed goal: return to the death waypoint within 5 minutes of game time while the chunk is loaded. Baritone already tags a "death" waypoint ([USAGE.md](https://github.com/cabaletta/baritone/blob/master/USAGE.md)).
- Mob behaviour notes for threat models are **[game knowledge, unverified this session]**:
  - Creepers explode about 1.5 s after getting close, so flee rather than melee.
  - Skeletons are ranged and burn in sunlight; use a shield or cover.
  - Spiders are neutral in daylight and climb walls.
  - Zombies and drowned burn in daylight; drowned can carry tridents.
  - Phantoms appear after 3+ nights without sleep.
  - Nether: ghasts (fireballs), piglins (hostile without gold armour), hoglins.
  - Beds explode in the Nether and the End.
- Other hazard constants are **[game knowledge, unverified this session]**: fall damage = (fall distance − 3) HP; landing in water cancels fall damage, and hay bales reduce it; air supply is about 15 s; lava sets you on fire, and fire continues after you leave. Re-verify these on [minecraft.wiki Fall damage](https://minecraft.wiki/w/Fall_damage) and [Damage](https://minecraft.wiki/w/Damage) (the relevant sections were truncated in fetches).

### Gaps
- Exact fall-damage, drowning, lava/fire and suffocation numbers were not extracted (the pages were truncated).
- Mob spawning rules (light level 0 for most hostiles since 1.18) were not confirmed this session.
- Respawn anchor and bed spawn-point details were not fetched.

## Q3. Companion roles: capabilities, world knowledge, owner inputs, failure risks

### Takeaway
Every companion role is built from the same small set of capabilities: navigate, follow, mine/dig, place, craft/smelt, fight/defend, use containers, farm/breed, and converse. Roles differ mostly in their **standing parameters**: work area, target items or quantities, schematic, protection target, and storage location. Mods and colony systems model a role as a job bound to a place (MineColonies hut, field or guard tower), or as a toggleable mode (Human Companions follow/patrol/guard/hunt/alert).

### Cited Findings
- **Farmer:** MineColonies requires a farmer to be assigned to a field, and each scarecrow (field marker) needs a seed configured — [MineColonies troubleshooting](https://minecolonies.com/wiki/misc/troubleshooting). Baritone `farm` harvests, replants and bone-meals within a range or around a waypoint — [Baritone USAGE.md](https://github.com/cabaletta/baritone/blob/master/USAGE.md)
- **Guard/bodyguard:** Human Companions offers follow, patrol and guard states, a sit toggle, and Hunt and Alert toggles. Companions attack mobs that hurt the owner or that the owner hits (except creepers), eat food from their inventory to heal, and auto-equip the best armour. They level up from kills — [Human Companions](https://www.curseforge.com/minecraft/mc-mods/human-companions). Guard Villagers guards patrol an assigned area. Follow mode unlocks only with Hero of the Village. Guards with a shield block attacks and eat or drink when low — [Guard Villagers](https://www.curseforge.com/minecraft/mc-mods/guard-villagers). A MineColonies guard tower houses one guard, with patrol range from 80 blocks (level 1) to 200 (level 5) — [MineColonies Guard tower](https://minecolonies.com/wiki/buildings/guardtower/)
- **Miner:** MineColonies miners have a skill table and a Nether Miner variant — [MineColonies worker system](https://minecolonies.com/wiki/systems/worker). Baritone `mine` takes an ore list and count, `legitMine` restricts it to visible ores, and `tunnel` digs 1×2 tunnels with lava detours — [Baritone](https://github.com/cabaletta/baritone/blob/master/USAGE.md). Diamond targeting is Y -58/-59 and needs an iron pickaxe — [Diamond Ore](https://minecraft.wiki/w/Diamond_Ore)
- **Builder:** Baritone `build` places a schematic at an origin, and `buildInLayers`, `buildRepeat*` and `acceptableThrowawayItems` tune it — [Baritone](https://github.com/cabaletta/baritone/blob/master/USAGE.md). A MineColonies builder must first build their own hut and cannot build above that hut's level — [MineColonies getting started](https://minecolonies.com/wiki/tutorials/getting-started)
- **Hauler/organiser:** MineColonies has couriers among 30+ jobs, per a fan guide — [Gurugamer](https://gurugamer.com/pc-console/a-complete-guide-to-play-minecraft-minecolonies-mod-24564). Human Companions warns that companions die easily, so they should not carry valuables — [Human Companions](https://www.curseforge.com/minecraft/mc-mods/human-companions)
- **Friend/chat:** mindcraft profiles are JSON (e.g. `andy.json`) that set LLM models (chat, code, vision, embedding, speech), prompts and examples. The bot name must exactly match the account name, or it will "spam talk to itself" — [mindcraft README](https://github.com/mindcraft-bots/mindcraft). Its `elbow_room` and `idle_staring` modes are social behaviours: it keeps distance from players and looks at entities — [modes.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/main/src/agent/modes.js)

### Inferences
Role → capabilities / world knowledge / owner inputs / failure risks. Crop and breeding specifics are **[game knowledge, unverified this session]**.

- **Farmer**
  - Capabilities: till, plant, detect maturity, harvest, replant, bone-meal, breed and pen animals, store produce, craft bread.
  - Knowledge: crop types (wheat, carrots, potatoes, beetroot, melon/pumpkin stems, sugar cane, nether wart on soul sand); crops need water within 4 blocks and light; breeding foods (wheat for cows and sheep, carrots for pigs, seeds for chickens); breeding cooldown about 5 min.
  - Owner inputs: farm bounds, crop list, replant policy, output chest, animal caps.
  - Risks: trampling farmland by jumping, killing breeding stock, leaving gates open, harvesting other players' crops on servers.
- **Guard/bodyguard**
  - Capabilities: follow at a set distance, threat detection (hostile-mob list plus "whoever hurts the owner"), melee, bow, shield, retreat and heal, creeper avoidance.
  - Knowledge: mob behaviours, line of fire.
  - Owner inputs: who to protect, aggression level (defensive vs hunt), allowed targets (never players unless PvP is enabled), patrol zone.
  - Risks: friendly fire against the owner, pets, villagers or golems (angering golems or the village); provoking endermen or neutral mobs; attacking players on non-PvP servers; dying and losing gear.
- **Miner**
  - Capabilities: branch or strip mining at the target Y, vein mining, torch placement, lava and water handling, tool durability management, returning loot.
  - Knowledge: ore Y-levels, tool tier per ore, tunnel safety.
  - Owner inputs: target ores and quantity, mine entrance or area, depth, where to deposit, whether to dig outside claims.
  - Risks: lava, falls into ravines or caves, getting lost, breaking tools, mining inside other players' builds or claims.
- **Builder**
  - Capabilities: parse a schematic or blueprint, compute a bill of materials, source materials (gather or request), prepare terrain (clear and level), place in layers, verify against the schematic.
  - Knowledge: block placement rules (support, orientation, gravity blocks).
  - Owner inputs: the schematic, origin and rotation, material policy (use chest X), whether terrain may be modified.
  - Risks: wrong orientation, destroying existing structures, running out of blocks partway through.
- **Gatherer/hauler/organiser**
  - Capabilities: collect named items, chest discovery and indexing, sorting rules, inventory capacity planning.
  - Knowledge: an index of which chest holds what.
  - Owner inputs: chest locations or roles, sorting scheme, which chests are off-limits.
  - Risks: taking from other players' chests, despawning items while carrying too much, losing items on death.
- **Friend/chat companion**
  - Capabilities: conversation, persona, memory of the owner, gifts (give items), emotes (look, follow, wave via `/swing` in 26.1 if operator permissions allow — [Beebom](https://beebom.com/minecraft-new-version-numbering-system-for-java-edition)).
  - Owner inputs: persona, chat frequency limits, who it may talk to.
  - Risks: chat spam (Q4), talking to itself (name mismatch), leaking information.
- **Cross-cutting abstractions** suggested by the mods and Baritone: `Area` (bounds/waypoint), `Role` = (mode + area + targets + storage), `Stance` (follow / patrol / guard / sit), `Allowlist` (who can command), `Storage` (chest registry), `Blueprint` (schematic + origin).

### Gaps
- No primary-source documentation was fetched for crop growth times, breeding cooldowns or farm water radius.
- The MineColonies full job list was only confirmed via a fan guide.
- No reliable source was found on how existing mods prevent friendly fire. The Guard Villagers page does not say.

## Q4. Multiplayer considerations: permissions, griefing, claims, server rules, spam, PvP etiquette

### Takeaway
On shared servers the bot has two kinds of exposure. Server-enforced limits (packet and spam kicks, claim plugins) mechanically block or kick it. Social rules (anti-bot and anti-AFK policies, claim etiquette, no-PvP) can get its owner banned. The bot therefore needs a command allowlist, claim awareness (treat "can't break or open here" as a hard constraint), chat rate limits, and an explicit "is automation allowed on this server" setting.

### Cited Findings
- GriefPrevention trust levels:
  - `/trust` (build in the claim)
  - `/containertrust` (containers, crafting gear, animals, plus access)
  - `/accesstrust` (buttons, levers, beds)
  - `/permissiontrust` (lets a player share their own permission level with others)
  - `/untrust` and `/trustlist`
  - It also has soft-mute and `/ignore` for chat
  — [GriefPrevention Commands wiki](https://github.com/GriefPrevention/GriefPrevention/wiki/Commands). It runs on Paper, Spigot, Purpur and other Bukkit implementations, and v17+ is in alpha — [GriefPrevention docs](https://docs.griefprevention.com/)
- Paper `spam_limiter` defaults: `incoming-packet-threshold` 300, `recipe-spam-limit` 20 (kick), `tab-spam-limit` 500 (kick). `packet_limiter.all-packets` defaults to KICK at more than 500 packets per 7 s — [Paper global configuration](https://docs.papermc.io/paper/reference/global-configuration)
- Spigot has a built-in chat and command spam filter, with optional `spam-exclusions` (default `/skill`, disabled by default) — [Paper docs: spigot.yml](https://docs.papermc.io/paper/reference/spigot-configuration)
- Server rule sets often ban "pathfinding bots" alongside x-ray and kill aura — [Supercraft rules template](https://supercraft.host/wiki/minecraft/server_rules_template/). Some servers ban anti-AFK devices and set idle kicks (e.g. 30 min); others allow AFK fishing — per the search results above (several individual server rule pages; low authority, illustrative only)
- mindcraft warns: "Do not connect this bot to public servers with coding enabled". Code generation is off by default (`allow_insecure_coding`), and Docker is recommended — [mindcraft README](https://github.com/mindcraft-bots/mindcraft)
- Guard Villagers gates follow mode behind Hero of the Village, and inventory access behind reputation or ownership. This is an in-game analogue of command permission — [Guard Villagers](https://www.curseforge.com/minecraft/mc-mods/guard-villagers)

### Inferences
- **Ownership model:** one owner, an optional allowlist of trusted players with per-capability scopes (mirroring GriefPrevention's access, container and build tiers), and everyone else ignored or chat-only. Commands from others should never trigger destructive actions.
- **Claim awareness:** a failed break, place or open inside a claim should be treated as a permanent "forbidden area" signal (blacklist the area), not retried. Retrying could also trip the packet limiter.
- **Chat:** throttle well below spam thresholds, never echo LLM output in bursts, and avoid tab-completion spam. Exact vanilla chat spam kick thresholds are unverified (see Gaps).
- **Etiquette defaults:** do not take from unowned or unknown chests; do not harvest without replanting; do not attack players or named or tamed animals; leave no floating pillars or 1×1 holes; respect PvP opt-in.
- The bot should model a server profile: `automationAllowed`, `pvpAllowed`, `claimPlugin`, `chatRateLimit`, `afkPolicy`.

### Gaps
- Vanilla and Spigot chat-spam kick thresholds (the vanilla per-message counter) were not confirmed from a primary source.
- WorldGuard flag semantics (build, chest-access, pvp, mob-damage) were not fetched.
- No authoritative statement was found from Mojang or major networks specifically about Mineflayer-style bots. Policies vary by server.

## Q5. Existing reference implementations of roles

### Takeaway
Existing systems split into three families. Player-automation tools (Baritone) expose primitives: goto, mine, farm, build, follow, explore. LLM agents (mindcraft) combine a profile (persona plus models) with prioritised reactive modes and task JSON. NPC mods (Human Companions, Guard Villagers, MineColonies) configure roles via hiring, toggled stances and buildings or areas. A bot architecture can borrow a layer from each: Baritone's primitives, mindcraft's interrupt modes, and the mods' role plus area binding.

### Cited Findings
- **Baritone** processes: goto/goal/path, mine, farm, build/schematica, explore, follow, tunnel, axis, click, wp (waypoints), surface, come, invert — [Baritone USAGE.md](https://github.com/cabaletta/baritone/blob/master/USAGE.md)
- **mindcraft**:
  - Profiles in JSON configure models (`model`, `code_model`, `vision_model`, `embedding`, `speak_model`), prompts and examples.
  - Tasks are JSON with `goal`, `initial_inventory`, `target`, `number_of_target` and `timeout`.
  - It supports Java up to 1.21.11 (1.21.6 recommended).
  - It has 10 modes with interrupt scopes (see Q2).
  — [mindcraft README](https://github.com/mindcraft-bots/mindcraft); [modes.js](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/main/src/agent/modes.js)
- **Human Companions**: knight, archer, axeguard and arbalist classes. You hire them by giving food they request. Shift-right-click toggles sit. They have follow, patrol and guard stances, and Hunt/Alert toggles. Archers can be set stationary. They level up from kills — [CurseForge](https://www.curseforge.com/minecraft/mc-mods/human-companions)
- **Guard Villagers**: guards spawn in villages in groups of six, or are made by converting a nitwit or unemployed villager with a sword or crossbow. They have patrol areas, follow mode with Hero of the Village, shield and food handling, and clerics and smiths that heal and repair them — [CurseForge](https://www.curseforge.com/minecraft/mc-mods/guard-villagers)
- **MineColonies**: 30+ citizen jobs (builder, farmer, miner, fisher, courier, guard…). Jobs are bound to huts or fields. The builder hut gates other buildings. Guard towers have patrol radii. Guard towers are recommended at about 7 citizens because of raids — [MineColonies getting started](https://minecolonies.com/wiki/tutorials/getting-started); [Guard tower](https://minecolonies.com/wiki/buildings/guardtower/); [Gurugamer](https://gurugamer.com/pc-console/a-complete-guide-to-play-minecraft-minecolonies-mod-24564)

### Inferences
- A common role configuration pattern is **Role = Job type + Anchor (area/hut/waypoint) + Stance + Targets + Supplies (food/tools) + Storage**. Mods expose role choice through simple toggles. LLM bots can map natural-language requests onto the same structured parameters, which is a good fit for Zod-validated tool schemas in this codebase.
- Mindcraft's version ceiling (1.21.11) suggests the Mineflayer ecosystem lags behind 26.x. Protocol support for 26.1 should be checked separately (out of scope here).

### Gaps
- Mindcraft's in-repo profile examples (e.g. per-role prompts) and its whitelisting or command-permission mechanism were not documented on the README fetched.
- Voyager's skill-library and curriculum approach, and other bots, were not researched within this budget.
- Exact Human Companions and Guard Villagers configuration keys are not listed on their CurseForge pages.
