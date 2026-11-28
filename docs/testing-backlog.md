# Testing backlog

Everything built or fixed that **has not yet been seen working in the real game**, in one list. Work through it in your own world (see the setup in [real-game-checklist.md](real-game-checklist.md)), tick what passes, and move failures into a new run table in the checklist. Newest work first.

How to read a row: **do this** in the game, **expect** this in chat or in the log (`Owner says` / `Bot says` lines and the reason the bot gives).

## Architect review fixes (2026-11-26, not yet run)

- [ ] Pave the stairs, then send it mining: the paving is still there after the trip (stair care no longer digs it out)
- [ ] A trapdoor or lantern of yours on its shelter's stairs: still there after a night and a shelter repair
- [ ] A lighting spot it can't reach (across water): the grade finishes without it, and its day goes on
- [ ] No weapon and a creeper chasing it: it keeps running (no "leaving it be"); a creeper left be that comes round the wall in sight is noticed again
- [ ] At night with no planks or sticks, making torches: it never walks out to chop trees
- [ ] A table or furnace placed in the mine: in a side wall niche, never where a hub's tunnel starts
- [ ] Farm: a fence or lantern of yours on the plot is left; your farmland is never claimed
- [ ] Out of lava and burning with a water bucket: water poured at its feet and scooped back up

## Reflexes and progression from the "Great Test" deaths (2026-11-26, not yet run)

Each death in the game test that led to these is in the commit messages (9fabd7c, 65cbbca, 48b7af1 and after).

- [ ] Out of air in a two-high water pocket under a ceiling → `Drowning reflex: a ceiling over me; swimming to air at ...` and it surfaces to the side
- [ ] Out of air in a tunnel dug into an aquifer (flowing water) → it swims back the way it came; near a shipwreck it never pushes into waterlogged stairs
- [ ] A creeper flickering in and out of sight while it swims → one `Creeper reflex: creeper ...` line, not hundreds; walks home don't fail with "the goal was changed"
- [ ] Drops into a lava pocket under a shaft → `Lava reflex: touching lava ...`, out along the pool to the corridor (never jumping at the 2-high shaft); later walks go round the spot
- [ ] Out of lava, still burning, with water within a few blocks → `Lava reflex: on fire; to the water ...`; with none near it lets go at once
- [ ] Walks past lava diagonally behind the rock in a tunnel corner → no lava reflex at all
- [ ] Dies in lava → "I died in lava; my things burned, so I won't go back for them." (no walk back down)
- [ ] Hurt (under 12 health) or with under 6 food when a mining milestone comes up → "healing before I go down the mine" / "too little food", tried again 2 minutes later
- [ ] Coal found → torches made (16) before going for iron; first iron goes to a shield (off hand), then a bucket filled with water, then iron armour, then the iron sword, axe and shovel

## Phase 9: the Nether and the End (2026-11-26, not yet run; see Log Entry 18)

After diamonds, living its own life, it goes on to the Nether and the End. Best tried one milestone at a time in a creative test world first (give it what the milestone needs).

- [ ] Shield (worn in the off hand), bucket, flint and steel (flint from gravel)
- [ ] Portal: obsidian in sight mined (never off a lava pool's top), or a lava pool's top turned to obsidian with a bucket of water (the water taken back); a frame near home with cobblestone corners; "My Nether portal is lit at ..."
- [ ] Into the Nether with flint and steel, a gold helmet on (it stays on there), blocks; the portal on the Nether side remembered; a portal blasted out is relit on the way home
- [ ] Zombified piglins and piglins left alone unless they attack; endermen never first
- [ ] A fortress found by walking out in legs; by the spawner it waits for blazes (no "I'm stuck" while it waits), backs off and eats when hurt; rods up to what the eyes need
- [ ] Pearls from endermen at night (and a top-up from piglins with 32+ gold)
- [ ] Eyes crafted at home; throws saved (worlds/<id>.json "endgame.throws"); a second throw from the side; "My eye of ender went down: the stronghold is under ..." (check with `/locate structure stronghold`)
- [ ] Digging down, following stone bricks to the portal room; an eye in every empty frame; up onto a frame and into the End
- [ ] In the End: onto the island, crystals shot if it has a bow, the dragon hit when it perches by the exit portal, never near the edge, away from dragon breath
- [ ] The dragon dead → "I freed the End!", then into the exit portal; the credits don't hang it; "I'm home from the End!"
- [ ] Dying in the Nether → back through its portal for its things; in the End → "my things there are out of reach"
- [ ] `bun run test` never calls the model (no "LLM plan" lines; usage.json unchanged)

## Phase 8: companion roles (2026-11-26, not yet run; see Log Entry 17)

Each role is a standing order ("be my guard", "be my farmer here, put the wheat in the chest next to me", "mine iron for me", "sort my chests", "build a hut here"); "what's your job?" and "you're off duty" are answered in code.

- [ ] Guard: follows you; a zombie or skeleton near you → it fights it, then follows again; never a creeper, an enderman, a zombified piglin, a villager, a wolf or another player
- [ ] Guard at low health → the combat reflex retreats and the guard doesn't walk it back into the mobs
- [ ] "stop" while guarding → it stops; a minute later it goes on; "off duty" → it stops for good
- [ ] Guard "stay here" / "patrol here" → it stays at (or walks round) the spot, back there after a fight
- [ ] Farmer: harvests the ripe crops of the field only (not the village's), replants, puts the crops in the chest you showed, keeps seeds; nothing ripe → no shift; at night it rests
- [ ] Farmer on a keep-out field → "As your farmer: the field is in a keep-out area ..."
- [ ] Miner "mine iron for me" → mining trips, the ore in the chest; "mine bananas" → "I don't know ... as something to mine"
- [ ] Hauler with 3+ chests around → each kind of thing ends in one chest; its own tools and food stay with it; a double chest is sorted once
- [ ] Builder "build a hut here" → materials got (chests, mine, trees), terrain cleared, walls then roof; your chest in the footprint is reported, never broken; "The hut is finished" and it goes off duty
- [ ] New job while one runs ("be my miner" while farming) → the farming shift stops at once
- [ ] Friend: "how was your day?" → an answer from its diary
- [ ] `SERVER_AUTOMATION=forbidden` → "go live your life" and jobs are refused; `SERVER_CHAT_SPACING_MS` slows its chat

## Phase 7: the diary and the day planner (2026-11-26, not yet run; see Log Entry 16)

Past its first day, living its own life ("go live your life"), the bot plans its days with the model: at dusk, when it has nothing left to do, after a death and when you join.

- [ ] Dusk → log "Planner: planning the day (dusk)", then in chat its plan ("… Next: …, then … (0 of N done)"); in the morning it works through it ("plan: …" tasks)
- [ ] "what's your plan?" → the plan in chat at once (answered in code)
- [ ] "skip mining today, get food instead" → "Okay, let me plan my day around that.", the running step stops, a new plan with food first
- [ ] "what did you do today?" → the last lines of today's diary (in code); "what happened yesterday?" → yesterday's summary
- [ ] "how much have you spent?" → "This month (…): $… of $10 in N calls (chat …, day plans …)"; `usage.json` grows
- [ ] A step it can't do any more when it starts → "Skipped … from my plan: …" in the diary; two failures in a row → a new plan
- [ ] "stay with me" while a plan step runs → it stops, nothing new starts
- [ ] Network off (or `LLM_MONTHLY_CAP_USD=0`) → no plan; it follows its milestones as before; "what's your plan?" says why
- [ ] Restart while a plan step runs → the step is done again, not skipped
- [ ] Night → plan steps only under ground, after it's home; the rest wait for the morning
- [ ] You online but quiet for 5 minutes, a plan made while you were away → it tells you the plan once
- [ ] Its mine in a keep-out area ("keep out of here" at the mine) → mining steps left out of the plan ("my mine is in a keep-out area")
- [ ] `/time set day` in the evening, or a trip to the Nether → its day count doesn't jump or freeze (worlds/<id>.json "dayCount")
- [ ] 3–5 game days alone → the diary reads well (worlds/<id>.json "diary"), the plans make sense, the cost stays around a cent a day

## Past the first day: mine, iron, and the hang at open steps (2026-11-25 to 26, see Log Entry 15)

**Seen working in the owner's game**
- [x] First day 6 of 6 in a new world, then on into the mine by itself
- [x] Coal, 10 raw iron, smelted at home, an iron pickaxe, iron tools
- [x] Hub mine: forward 50, right blocked, left 50, then "digging the stairs 20 steps deeper", and the next level's forward tunnel
- [x] Water next to a tunnel is plugged and it digs on; scaffolding comes down after a trip; it works on in the mine at night
- [x] Up a tree at spawn → onto the trunk and chops it from the top down
- [x] Shelter checked after a restart and mended (holes over the doorway, the door to the mine)
- [x] After the face fix (`4e219f0`): long walks, hunting 55–80 blocks out and the mine stairs with no "Walk stalled" lines; "server moved me back" stays near 0
- [x] After a death with a shelter and a bed: "Home. Putting things away, cooking and checking my tools." then "Done at home."
- [x] No pickaxe, cobblestone in its chests → takes it from the chest and makes stone tools (no "I don't know how to get cobblestone")

**Not yet seen**
- [ ] Stairs deeper over water or a cave two blocks from anything solid → "Filled the hole … (2 support blocks from … first)" and the stairs go on
- [ ] Start of a mining trip with coal → holes in the stairs' floor or side walls filled, a torch every 6 dark steps (log: "Mine: looked after my stairs: N holes filled, M torches put up.")
- [ ] Stuck on a step in its own stairs → never digs into the stairs' floor or side walls; never wanders off through the caves
- [ ] Out of air in water on a walk → swims up but never forward off a drop; the next walk goes another way
- [ ] Hunting far from home with raw meat → walks home and cooks in the shelter's furnace, with coal or wood from its chests; no new table or furnace out there
- [ ] Owner beside it when it dies → no "Got …, thanks!" for its own things; a real toss still thanked
- [ ] Monsters near its bed all night → "There are monsters nearby, so I can't sleep." once, not every 30 s
- [ ] 200 cobblestone in its chests → the stairs made a block higher and paved with cobblestone stairs
- [ ] Iron armour, 3 diamonds, a diamond pickaxe (Tier 3 milestones)
- [ ] Berry bushes → walks around them at one block, never through
- [ ] The owner's commands by their names after the one command list (`ed9151d`): "set base here" (now `setBase`), "go home and tidy up" (`homeChores`)

## Fixes from the 2026-11-25 hillside game test (not yet re-tested)

The shelter was built into a hill under a tree and its mine came out into a ravine. Re-check in a world with hills and caves:

- [ ] Shelter under a tree → logs and leaves in its walls or roof are broken out and replaced with dirt or stone (log: "Placed dirt at …" where the leaves were)
- [ ] Mine stairs that cross a cave or ravine → every step gets a floor; where nothing is next to it, a support block goes under the previous step first ("Filled the hole … (a support block at … first)"), and the step gets side walls
- [ ] Mine stairs over a cave with no dirt or cobblestone carried → the mine stops there and says it needs dirt or cobblestone; next time it carries on from that step
- [ ] Craft from inside the shelter with the only table 16+ blocks away → it walks there (the long way if needed); never a second table within 50 blocks ("There's a crafting table at … already")
- [ ] Walk out of the shelter → no dirt scaffold left inside the room, stairs or doorways
- [ ] Close the LAN world while it works → no "Task started" lines until it's back

## Phase 6: skills and the first day (2026-11-25, first run 2026-11-25: 5 of 6 milestones, see Log Entry 14)

The bot can now live its own life when the owner lets it: it works through a player's first day (wooden tools, a shelter, stone tools, food, a bed, two chests) and goes into its shelter at night. It's **off until you say so**. Every "make me X" now goes through one planner that gets the materials, a table and the tools first.

Best in a **fresh world**: open it to LAN and start the bot; it greets you and starts its own life after 30 seconds without an order.

**The plan's checks**
- [x] (5 of 6 in the first run; 6 of 6 in the hillside world, Log Entry 15) Fresh world, "go live your life" → within a game day: "Milestone: wooden tools (1 of 6 …)", then a shelter, stone tools, food, a bed, chests, and finally "I've got everything for my first day …"
- [ ] Give it an order halfway ("come here") → it comes; a few seconds after, it goes back to the milestone it was on
- [ ] "stop" while it works on a milestone → it stops, and doesn't start the next one for a minute

**Autonomy and progress**
- [x] Before "go live your life": it stands and waits; no tree cutting near your base (older builds; now it starts on its own after the 30-second greeting)
- [ ] Joining: "I'm here. Anything you need? …30 seconds…", then its first milestone; an order in those 30 seconds runs first; "stay with me" keeps it waiting, also after a restart
- [ ] "what's your progress?" → "First day: N of 6 done (…); still to do: …"
- [ ] "stay with me" / "take a break" → "Okay, I'll wait for your orders."; the current milestone finishes or you say stop, no new one starts
- [x] Restart the bot after "go live your life" → it carries on by itself (the choice is remembered)

**The planner (acquire)**
- [ ] Empty inventory, "make a stone pickaxe" → chops a tree, makes a table, a wooden pickaxe, mines stone, then the stone pickaxe; no back-and-forth loop
- [ ] No trees within reach (a desert or the ocean) → gives up within a minute or two with "couldn't get … logs", not forever
- [x] Its pickaxe breaks while mining → it makes a new one (stone, from its chests' cobblestone; never wood once it has had stone)

**The progression tree**
- [ ] Fresh world, no coal in sight, "make 4 torches" → wood, a table, a wooden pickaxe, cobblestone, a furnace put down, charcoal from logs, then torches
- [ ] With coal ore in view → it mines the coal instead (no furnace)
- [ ] With only a wooden pickaxe, "get me iron" → it makes a stone pickaxe first, mines raw iron, smelts it into ingots
- [ ] "get me a diamond" with nothing → it works up the whole tree (stone pickaxe, iron, furnace, iron pickaxe) or says which step it couldn't do

**The shelter and the night**
- [x] First dusk → "Digging a shelter for the night.": stairs 5 down, a 3x3 room 2 high at the bottom; dug in the open (not inside your house), never into water or lava
- [ ] Cut the dig off ("come here") and let it go back → it finishes the same stairs, no second staircase
- [x] (after fix 821aad5; before it, it sealed itself out and died) Inside at night → the stairs are closed with 3 blocks from inside; no mob gets in
- [x] Morning → it opens the stairs and comes out by itself, and goes on with its milestones
- [ ] Ask it to "come here" at night → it digs out of the shelter (its own blocks) and comes

**Bed and chests**
- [ ] With sheep around: it hunts 3 of one colour (only as many as needed), crafts a bed, puts it in the shelter and sleeps (spawn point set; "where is your bed?" answers)
- [x] No sheep around → "I couldn't get a bed yet: … no sheep around. I'll try again later." and it moves on to the chests
- [x] Chests → two chests in the far corners of the room, not in the walkway
- [ ] (every deposit reported "refused" in the first run; fixed in 525d05a, not re-run) The cheap stuff (dirt, cobblestone…) goes in the chests, tools and food stay with it
- [ ] Your own bed nearby → it never takes yours; its bed goes in the middle of its room

**Found in the first run (fixed, re-check)**
- [ ] Nothing to hunt near the shelter → "No animals around here; I'll look farther …", walks off and hunts there (worked for food: pigs south-east; re-check for sheep)
- [ ] On its own errands it never asks "(yes/no)" in chat; the log says "Deciding on my own …"
- [ ] "come here" while you walk about → it sets off at once (it used to stand 20 s, then "stuck")
- [ ] "gather 20 cobblestone" → it mines stone (it used to say "I couldn't collect any cobblestone")
- [ ] "make an iron pickaxe" with stone tools → "(iron ingot: smelted from raw iron in a furnace; raw iron needs a stone pickaxe) Should I go get them?", then the whole chain
- [ ] A furnace or table put down on grass → on solid ground, never where the bot stands
- [ ] Two worlds: memory of one never shows in the other (worlds/<id>.json); back in the first world it remembers its shelter
- [ ] Gathering wood and digging tunnels: no pause between blocks (log timestamps show under a second)
- [x] A whole night inside → no "I'm stuck" after two minutes; the seal stays closed until morning

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
- [ ] Craft at a table it can't reach → it walks the long way to it; it never places a second table within 50 blocks (owner's rule, replaces the old "uses its own table")

## Owner's priorities (2026-11-27)

- [ ] New world in a snowy/icy/desert/ocean biome: "This isn't a good place for my home (...)", it walks on (up to 500 blocks) and builds where the biome is good, with 24 logs and 3 animals near and a dry way down for its mine
- [ ] Day one order: wooden tools, shelter, stone tools, 20 logs, chests (furnace, table), bed; then the mine; the first field after the mine starts; lit home and food stock never hold the mine up
- [ ] Rotten flesh picked up and kept; eaten when there's nothing better
- [ ] At dusk down in the mine it keeps working; with armour, an iron sword and a bow with 16 arrows it works outside at night too
- [ ] A floor with one sleeve done and no iron for a pickaxe and sword: "on down to the next floor"
- [ ] In the woods, after stone tools: "a clearing round my home": every tree within 16 blocks of the shelter's entrance felled (not replanted there)
- [ ] Starving with no food: no more breaking oak leaves for apples (switched off)
- [ ] Trees felled from the top: it gets on top of a straight trunk (pillaring beside it if needed), breaks the log under its feet down to the ground; acacia, 2x2 and 1-2 log trees from the bottom
- [ ] Shelter dug through gravel: what falls into the room or a doorway is dug out (top first, again while more comes down) and the roof hole above patched; gravel already lying in a room counts as "fixing my shelter"
- [ ] Night with no stone tools yet but the stone and wood for them in its bag: the shelter's table goes in its spot, the tools are crafted inside, then the furnishing
- [ ] Giant 2x2 trees (jungle, dark oak, big spruce) and jungle trees over 6 logs are never cut, for wood or for the clearing (the clearing counts as done with only those left); with no other tree near it goes further for wood
- [ ] At night, not well equipped: no idle chores (taking down scaffolding, replanting, tidying); they wait for the morning
- [ ] Bridge: after swimming twice into the river within 24 blocks of home ("Bridge: in the water near my home" in the log), by day after the mine: "Built a bridge over the river by my home (N blocks)", 2 wide, bank to bank, torches at the ends and every 6; walks use it; a hole in it is mended; a river over 12 wide: "too wide for a bridge"
- [ ] Every mine floor's room gets a crafting table in its front-left corner and a furnace in its back-right corner ("Put a crafting table and a furnace in the 1st floor's room of my mine"), old floors too; crafting and smelting underground use them
- [ ] Mine stairs dug over a cave: "Cave under the step at …: its floor put in first" before the step is dug; the bot never falls in, even with a mob coming up
- [ ] A mine trip that starts up top ("Down to my mine by its stairs: to step N"): in by the shelter and down its stairs, never a shaft dug down from the grass
- [ ] Its bag full and something it needs in its chests: it makes room (cheap stuff into the chests) and takes it, never off to the trees or the rock instead
- [ ] Stairs blown open or crossing a cave: "Mine: looked after my stairs: N holes filled" fills floor, both walls (5 high) and roof; "step N closed in" after each new step; with stairs still open: "my mine's stairs aren't whole yet", no mining below
- [ ] A spider in its mine or a cave by day is fought ("Combat reflex: fighting spider"); one that bites it in the light is fought back too
- [ ] A field's path: the ring outside its fence dug down to the field's level (banks, tall grass), an opening on the side facing home (no gate: one from before taken out), torches on the corner and middle posts (made from coal it has)
- [ ] With a lot of wood (64 planks' worth beyond its 20 logs, bag and chests): its furnaces burn planks (workshop, cooking, smelting ore), coal kept for torches
- [ ] At night it works on (milestones, trees, chores); a mob hurts it: "Attacked at night (zombie): off to my shelter", the night routine, in its shelter till morning
- [ ] A new field never on the way of its mine's stairs (34 ahead of the shelter's back door, 2 either side); walks never go over its bed
- [ ] With 40 copper (raw, ingots, blocks; chests and bag): copper ore in sight and in its tunnels' walls is left
- [ ] Taking down scaffolding: walks to it never place blocks; a pillar too tall to reach from the ground gets a column of its own beside it, then both come down on the way back (no loop)
- [ ] Coal drought: two coal trips that dug 60+ blocks and no coal ore ("Coal: a dry trip … 2 in a row"); with plenty of wood (bag+chests or 40 tree logs by home) the next coal goes "made N charcoal from spare wood" (logs from chests first, its 20 kept); torches use it too; at night with no spare logs, a mine trip instead; coal ore dug ends it
- [ ] Hurt and backing off: a mob right on it (any kind) is fought ("cornered by cave_spider"); spiders and cave spiders within 4 are fought, not run from
- [ ] No way home up its broken stairs: "putting them back as planned, from step N up", each step cleared and closed in, up to the shelter; pokeholes open to a cave: "my pokeholes open into a cave … plugged" (tips and floors too)
- [ ] A zombie on it while a creeper is 5+ blocks off: the fight goes on (no "stepping aside" every half second); cave openings plugged only standing in its own tunnel beside each ("plugged N of M from inside"), never while hurt or with mobs near
- [ ] The day plan's coal step makes charcoal in a coal drought too; sealing cave openings stocks filler blocks first
- [ ] Ore uncovered by a sleeve or pokehole column is mined at once ("Mine: mined N ore my tunnel uncovered"), the vein behind it too, floor holes filled; diamond/gold with only a stone pickaxe: "needs a better pickaxe … waits"
- [ ] Restocking food (not hungry): "Cooking: left N beef cooking in the furnace; back for it after my next job", it walks off at once; after its next task "checking the furnace I left cooking" takes it out ("took N done items"); hungry, it still waits for the food
- [ ] Its new bed in the evening: it lies down to set the spawn point and gets straight back up while it's working time; any walk while in bed: "In bed with somewhere to go: getting up first"
- [ ] After the clearing cuts trees, with 32+ spare logs (beyond its 20; bag and chests) and its light under 128 torches' worth: "Workshop: left N oak log smelting into charcoal" in its home furnace (planks burnt, never coal), checked after its next task; torches topped up to 64 from coal or charcoal
