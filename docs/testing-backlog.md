# Testing backlog

Everything built or fixed that **has not yet been seen working in the real game**, in one list. Work through it in your own world (see the setup in [real-game-checklist.md](real-game-checklist.md)), tick what passes, and move failures into a new run table in the checklist. Newest work first.

How to read a row: **do this** in the game, **expect** this in chat or in the log (`Owner says` / `Bot says` lines and the reason the bot gives).

## Phase 6: skills and the first day (2026-11-25, not yet run)

The bot can now live its own life when the owner lets it: it works through a player's first day (wooden tools, a shelter, stone tools, food, a bed, two chests) and goes into its shelter at night. It's **off until you say so**. Every "make me X" now goes through one planner that gets the materials, a table and the tools first.

Best in a **fresh world**: open it to LAN, start the bot, and say "go live your life".

**The plan's checks**
- [ ] Fresh world, "go live your life" → within a game day: "Milestone: wooden tools (1 of 6 …)", then a shelter, stone tools, food, a bed, chests, and finally "I've got everything for my first day …"
- [ ] Give it an order halfway ("come here") → it comes; a few seconds after, it goes back to the milestone it was on
- [ ] "stop" while it works on a milestone → it stops, and doesn't start the next one for a minute

**Autonomy and progress**
- [ ] Before "go live your life": it stands and waits; no tree cutting near your base
- [ ] "what's your progress?" → "First day: N of 6 done (…); still to do: …"
- [ ] "stay with me" / "take a break" → "Okay, I'll wait for your orders."; the current milestone finishes or you say stop, no new one starts
- [ ] Restart the bot after "go live your life" → it carries on by itself (the choice is remembered)

**The planner (acquire)**
- [ ] Empty inventory, "make a stone pickaxe" → chops a tree, makes a table, a wooden pickaxe, mines stone, then the stone pickaxe; no back-and-forth loop
- [ ] No trees within reach (a desert or the ocean) → gives up within a minute or two with "couldn't get … logs", not forever
- [ ] Its pickaxe breaks while mining → it makes a new one from what it carries (no trip to gather)

**The progression tree**
- [ ] Fresh world, no coal in sight, "make 4 torches" → wood, a table, a wooden pickaxe, cobblestone, a furnace put down, charcoal from logs, then torches
- [ ] With coal ore in view → it mines the coal instead (no furnace)
- [ ] With only a wooden pickaxe, "get me iron" → it makes a stone pickaxe first, mines raw iron, smelts it into ingots
- [ ] "get me a diamond" with nothing → it works up the whole tree (stone pickaxe, iron, furnace, iron pickaxe) or says which step it couldn't do

**The shelter and the night**
- [ ] First dusk → "Digging a shelter for the night.": stairs 5 down, a 3x3 room 2 high at the bottom; dug in the open (not inside your house), never into water or lava
- [ ] Cut the dig off ("come here") and let it go back → it finishes the same stairs, no second staircase
- [ ] Inside at night → the stairs are closed with 3 blocks from inside; no mob gets in
- [ ] Morning → it opens the stairs and comes out by itself, and goes on with its milestones
- [ ] Ask it to "come here" at night → it digs out of the shelter (its own blocks) and comes

**Bed and chests**
- [ ] With sheep around: it hunts 3 of one colour (only as many as needed), crafts a bed, puts it in the shelter and sleeps (spawn point set; "where is your bed?" answers)
- [ ] No sheep around → "I couldn't get a bed yet: … no sheep around. I'll try again later." and it moves on to the chests
- [ ] Chests → two chests in the far corners of the room, not in the walkway; the cheap stuff (dirt, cobblestone…) goes in, tools and food stay with it
- [ ] Your own bed nearby → it never takes yours; its bed goes in the middle of its room
- [ ] A whole night inside → no "I'm stuck" after two minutes; the seal stays closed until morning

## Phase 5: perception, memory and the Narrator (2026-11-25, not yet run)

The bot now remembers places, chests, where it died and where to keep out, across restarts, and answers from memory. Everything it says goes through one Narrator: answers first, task reports never lost, running commentary trimmed. db.json is upgraded on the first start (the old file is kept as `db.json.v1.bak`).

**The plan's checks**
- [ ] Put cobblestone in a chest it opens ("put the cobblestone in the chest"), restart the bot, then ask "do we have cobblestone?" → "… cobblestone in the chest at x, y, z" from memory, without walking there
- [ ] Fight a few mobs (or let it) → chat stays readable: no line repeated, commentary like "Attacking zombie!" doesn't pile up
- [ ] Let it die, then ask "where did you die?" → "I last died at x, y, z (overworld), N min ago."

**Memory**
- [ ] First start after the update → the log says db.json was upgraded and `db.json.v1.bak` exists; its base, mines and chests are still known ("where is the base?", "where are the chests?")
- [ ] Break a crafting table it knows (or a chest), then ask "where are the crafting tables?" → the broken one is gone from the answer
- [ ] Restart, walk it past a remembered chest you broke while it was offline → it forgets it (log: "The chest at … is gone")
- [ ] "where is your bed?", "where is the mine?", "where is the iron?" → answers from memory, or "I don't know …"

**Keep-out areas**
- [ ] Stand by some trees and say "keep out of here", then "gather wood" → it picks other trees; no failure loop
- [ ] "you can work here again" at the same spot → it may use those trees again
- [ ] On a server with a land claim (or spawn protection), ask it to dig inside → after two blocks put back: "… the server put it back (a protected area?)", and it stops trying there for 30 minutes

**The Narrator**
- [ ] Ask "where are you?" while it's busy and chatting → the answer comes first
- [ ] Whisper it a question (`/msg MinecraftGPT where are you`) → the answer is whispered back; ask in public chat → answered in public
- [ ] Log out while it works, log back in → "While you were away:" and up to 5 lines of what happened
- [ ] `stop` in the middle of "come here" → no late "Coming: 60% of the way." after it stopped
- [ ] A long answer from the AI → split over a few lines, nothing cut off

**Status**
- [ ] "status" while it gathers and a creeper is near → "Gather wood (paused: dealing with a creeper); next: …. Health …, food …. Night …. 1 hostile near (creeper 6 blocks). You're N blocks away. I'm at …"

## Phase 4: arbiter and reflexes (2026-11-25, not yet run)

One arbiter now decides what the bot does. Reflexes pause a task instead of fighting it; the owner calling the bot cuts in, and what it was doing carries on afterwards with what's left. The bot eats and puts armor on by itself, between its own actions (the auto-eat and armor plugins are gone).

**The plan's checks**
- [ ] "gather 10 wood", then lead a creeper to it → it deals with the creeper (or runs), then goes back to chopping; in the end it has 10 new logs, not more
- [ ] "gather 10 wood", then `come here` halfway → "Coming!", it comes; then "Back to gather wood." and it gathers only the rest
- [ ] Mid-fight (or while it dodges a creeper) say `stop` → it stops fighting at once and stays quiet for about a minute

**Pausing, not fighting over the body**
- [ ] While it mines, let a zombie attack it → it stops digging, fights, then finishes the same block and carries on (no "failed" in the log)
- [ ] Let it get hungry (food 14 or below) while it mines → it eats between two blocks, never in the middle of one; log "Ate cooked beef (food …)"
- [ ] Hurt it badly while it carries food → it eats straight away even mid-task
- [ ] With only rotten flesh and full-ish food → it doesn't eat it; starving → it does
- [ ] Give it better armor while it works → it puts it on between actions
- [ ] It stands in deep water idle → it treads water; underwater with little air while walking → it swims up, then walks on

**Order and resuming**
- [ ] "craft a chest" then "put the cobblestone in the chest" → the second waits ("Okay, I'll do that after I finish craftItem") and then runs
- [ ] "go to x y z" far away, then "follow me" → it follows; when you say `stop`, it doesn't go back to the old trip
- [ ] "status" while it works and more is waiting → "Doing …, N more queued"
- [ ] It dies while you've queued things → it goes back for its things, makes a starter kit, then comes to you (in that order)

**Getting unstuck**
- [ ] Trap it in a 1-block hole with a task to walk somewhere → after about 45 s it jumps and steps aside; later it plans again; finally "I'm stuck, so I gave up on …"
- [ ] Right after it gave up, ask it to go to the same spot → it says it can't get there at once (it remembers for 10 minutes)
- [ ] Ask it to smelt (a long wait at the furnace) → it does **not** give up as "stuck" while waiting

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
