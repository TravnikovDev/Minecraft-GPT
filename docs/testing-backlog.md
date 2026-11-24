# Testing backlog

Everything built or fixed that **has not yet been seen working in the real game**, in one list. Work through it in your own world (see the setup in [real-game-checklist.md](real-game-checklist.md)), tick what passes, and move failures into a new run table in the checklist. Newest work first.

How to read a row: **do this** in the game, **expect** this in chat or in the log (`Owner says` / `Bot says` lines and the reason the bot gives).

## Phase 3: verified actions (2026-11-25, not yet run)

Every action now checks the world afterwards and says why it failed: *I can't find a way there*, *it's out of my reach*, *the server didn't let me (a protected area?)*, *it took too long*, *I stopped*, *there's no room*, *I don't have the right tool*.

**The plan's checks**
- [ ] Ask it to break or collect a block it can only reach by crossing lava → "I can't find a way there", not a fake "Collected"
- [ ] On a server with a protected area (spawn protection, a claim plugin), ask it to place a block inside it → "…the server didn't let me (a protected area?)", said once, no retry loop
- [ ] Ask it to craft something at a crafting table, and break the table just as it walks up → it gives up within about 10 s with a reason, and takes the next command

**Walking**
- [ ] "go to x y z" somewhere unreachable (an island, a sealed room) → "I couldn't get to … : I can't find a way there"
- [ ] "go to x y z" far away, then `stop` halfway → it stops at once and says nothing more about the trip
- [ ] "return to base" → "Returning to base!", then "I'm back at the base" only when it arrives
- [ ] "go to the furnace / chest / mine" → "I'm at the …", or "I don't know where the … is"

**Breaking, placing, farming**
- [ ] "collect 10 coal", with its pickaxe nearly broken → when the pickaxe breaks it crafts a new one and goes on; "Collected 10 coal ore", or "Collected 6 of 10 …" if it ran out
- [ ] "place a chest" where there's no room → "I couldn't place the chest: something is in the way" (or "there's nothing to put it against")
- [ ] "place the chest near my bed" → it's placed touching the bed, or a reason
- [ ] "harvest the wheat" on a farm → ripe crops broken, **seeds replanted on top of the farmland** (they used to be "planted" under it)
- [ ] Torches in a tunnel still go on the side walls every 7 blocks (torches have no collision box; the new check had to allow for that)

**Inventory and chests**
- [ ] "give me 20 coal" when it has 12 → "Gave 12 of 20 coal"
- [ ] "discard 64 dirt" when it has 30 → "Discarded 30 dirt"
- [ ] "put the cobblestone in the chest" with the chest full → it says the chest is full and what it still has; nothing lost
- [ ] "take 10 iron from the chest" with its inventory full → "My inventory is full now"
- [ ] "what's in the chest" while the chest is somewhere it can't reach → "I couldn't look in the chest: I can't find a way there"

**Crafting, smelting, cooking**
- [ ] "smelt 8 raw iron" → it fuels and fills the furnace, waits, takes the ingots out, and closes the furnace
- [ ] "cook the food" with a campfire nearby → raw food goes on the campfire and comes off cooked
- [ ] "craft sticks" (and any craft) → "Crafted N …" with the real number

**Beds, riding, weapons**
- [ ] "go to sleep" at night → "Good night!"; by day → it uses the bed (spawn point set) and says what the server said
- [ ] "get in the boat" / "ride the minecart" → it really sits in it, or says it couldn't
- [ ] "equip your best weapon" → the sword is in its hand (and a shield in the off-hand if asked)

**Connection**
- [ ] Close the world (or restart the server) while it's walking, digging or crafting → after it rejoins, tidying up, replanting and making room still work (no flag left stuck)

## "stop" and idle chores (2026-11-25, not yet run)

- [ ] Drop some items near it; while it walks over to pick them up (or replants, or takes down scaffolding) say `stop` → it stops at once and stays put for about a minute; no chore starts again
- [ ] Give it a command while it's tidying up → the chore ends and the command starts straight away
- [ ] While idle with a full inventory near loose items → it does **not** start making a chest on its own (only tasks you give it may)

## Gameplay fixes from 2026-11-25 (not yet re-tested)

- [ ] Fill its inventory while it mines underground → a 2-high niche in the tunnel wall holds the new chest; about 4 cheap stacks go in; it keeps its coal, sticks, logs and the ore it's mining
- [ ] "follow me", then climb a cliff → it walks around; no pillar
- [ ] Let it fight mobs at night until it's hurt → "I'm badly hurt, backing off!", it runs about 16 blocks, then carries on once healed
- [ ] "give me half your coal" → half of what it carries
- [ ] "stop, craft a torch" while it's busy → it stops, then crafts (both parts of one message)
- [ ] Throw it an item, then let it pick up a zombie's drop → thanks only for the thrown item
- [ ] "hunt cow" with only one cow around → "Hunt it anyway?"
- [ ] "come here" twice while it's walking to you → "On my way, N blocks to go!" (the walk doesn't restart)
- [ ] Let it die in a cave, then watch → it walks (or tunnels) down to its things instead of stopping on the surface above
- [ ] "let's get out from here" underground near water → it turns another way instead of digging into the water

## Phase 2: Catalog and identifiers (not yet run)

- [ ] "collect 3 diamonds" → it mines diamond ore (stone or deepslate), no question
- [ ] "gather wood" in a cherry or mangrove forest (or by crimson/warped stems) → those logs, the right planks
- [ ] Give it an iron pickaxe and an iron axe, then "how many axes do you have" → one
- [ ] "craft dimond sword" (typo) → "Did you mean diamond sword?"
- [ ] "go to bed" in a cave with bedrock nearby → a real bed, never bedrock
- [ ] "discard stone" while carrying a stone pickaxe → only stone blocks are dropped

## Phase 1: Session and Body (not yet run)

- [ ] Restart your server while it's gathering → it reconnects, stays idle, nothing fires twice
- [ ] Kill and restart the bot process → it comes back the same
- [ ] Kill the bot (in game), then restart the bot process straight away → after rejoining it still goes back for its items
- [ ] Send coordinates, restart the bot, then `come here` while it can't see you → it heads to those coordinates
- [ ] Ask for something, then "do that again" or "no, the other one" → it understands
- [ ] A zombie attacks it while it walks to you, then `stop`, then `come` → it stops fighting at once, then comes without wandering back to the old task
- [ ] "follow me", let a mob chase it, run off → after the fight it follows again
- [ ] Stand by penned-in creepers, `stop` → it stops dodging and stays quiet for about a minute
- [ ] Lead it through a door it can't open (adventure mode or a protected spot) → "The door … won't open; finding another way", no digging
- [ ] Restart the server while it's fighting or dodging a creeper → it rejoins idle

## Phase 0 and older fixes (not yet run)

- [ ] Turn Wi-Fi off, then `stop`, `come here`, `status` → all three still work
- [ ] "you're stuck, move away" → it walks about 10 blocks away and stays responsive
- [ ] Mobs hit it while it's busy → it fights back (the task pauses), then carries on
- [ ] `stop` during a boat trip → it lands and picks up its boat before the next command
- [ ] Craft at a table it can't reach → it uses its own table and picks it back up
