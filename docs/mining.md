# Mining guide

How the bot's mine is laid out and dug (the owner's design). Code: `src/skills/mine.ts`.

## The stairs

- A diagonal staircase down from the shelter's back wall: one block forward and one down per step, **5 blocks high** (room for stair blocks).
- Every step is a closed tube: floor, both side walls and a roof are kept solid. Where the stairs cross a cave, the gaps are filled with dirt or cobblestone on the way down.
- Once there are 200 cobblestone, the steps get cobblestone stair blocks (made at home, one per bare step plus 10%). The flat part across a floor's room gets none.
- Blocked going down (water or lava at the next step, something built, a drop it can't floor), the stairs **turn**: right, then left, from the floor they came down from, then one floor higher.
- The stairs go down to just over bedrock: no floor below y -54.

## Floors (owner's plan)

The **first floor 20 steps down**, then a floor every **10 blocks** deeper.

```
            L                       L: left sleeve,  R: right sleeve
            L                       B: back sleeve,  F: forward sleeve
 B B B B B [x][x][x]                S: the stairs coming in (5 high)
 S S S S S [s][x][x]   ...          s: the stairs' end, in the middle of
           [x][x][x] F F F F F         the room's back side
                R                   [x]: the room, 3 by 3, 3 high, flat
                R
```

- The **room** is 3 by 3, 3 high, ahead of the stairs' end; the stairs end in the middle of its back side, so its middle stays free to run from sleeve to sleeve. The stairs to the next floor go on from its front side, after crossing it flat.
- **Left and right sleeves** leave from the room's middle line.
- The **back sleeve** runs along the room's left row, back beside the stairs; the **forward sleeve** along its right row.
- Every sleeve is **50 blocks long and 3 high**. Dug in this order: forward, right, left, back.
- **Iron first** (owner): once one sleeve of a floor is done, if it's still short of iron for an iron pickaxe and an iron sword, or has under 32 coal, it goes on down to the next floor instead of the floor's other sleeves. With enough, every floor is finished in order.
- A **sign** on the room's right wall: "1st floor", "2nd floor", ...

## Pokeholes

Along every sleeve, every **3 blocks**, a pokehole **1 wide, 3 high, 5 long, on both sides**.

Every tunnel (sleeve or pokehole) is dug from inside itself: it steps back into the last block it dug and digs the next column from there. No ordinary walk breaks a wall, floor or ceiling block of the mine's tunnels. Only gathering ore it sees may dig through the walls to the ore; afterwards the sleeves' and room's floor is mended, a block per hole. Pokeholes and roofs are never restored.

## Looking after it

- Damaged paths are mended **only under the feet** (the floor of the stairs, rooms and sleeves; not pokeholes); never walls or ceilings.
- Every ore seen is mined at once, **once the stretch is secured**: its floor mended and any way out to the sky blocked first.

## Caves its tunnels meet

- A **pokehole** that meets a cave (ahead, beside, above or below) ends at that block; the opening is filled with cobblestone. It counts as a finished pokehole, and the sleeve goes on.
- A **sleeve** crosses a short gap (under 7 blocks of cave) as a closed tube: floor, both walls and the roof built as it goes. At a big cave the sleeve ends at the cave's edge, its face plugged, and it's done.
- Before plugging, the ore it can see in the cave within reach is mined from inside the tunnel; it never steps into the cave.
- Every plug it puts in a cave's opening is remembered; each trip puts back any that were broken.
- Caves are not sealed otherwise (only openings to the sky are).

## When it can't go deeper

With every way down blocked, or at the bottom, it digs side routes off its lowest floor's sleeves: every 3 blocks, 10 long.

## Safety rules that hold in the mine

- Never break a block with water or lava at its sides or on top. Only the drowning reflex, digging up for air, may.
- Lava ahead: the face is filled and the tunnel ends. Lava down in a gap: no bridge over it, the tunnel ends there.
- Water or lava in the block a tunnel would dig next (a pool, a lake): its face is filled and that sleeve or pokehole ends there, marked blocked; never a tube plugged through the water. Water only in a wall beside it is plugged and the tunnel goes on. Water at the next stair step makes the stairs turn.
- Ore underground comes from the mine only: "ore in the open" round its home means a face the sky lights (a ravine, a cliff), never a dark cave it would dig its own way down to.
- Out of the mine by its own stairs, never a new way dug up through the rock: from a floor's tunnels it walks back to that floor's room first, then up the stairs; digging on that walk is too dear to choose. Beside the stairs in a cave, it opens a way in through their wall.
- It goes down only with enough health and food.
- A mine trip ends only for low food or a full bag; dusk doesn't pull it out (down in its mine it's home for the night).
- **Closed to the outside**: where a floor's room, sleeve or pokehole (or the stairs) opens into open air that reaches the sky (a canyon, a ravine), the opening is blocked with cobblestone, at the start of every trip and after every stretch it digs. Caves that stay underground are left open.
- Gravel or sand falling into its head is dug out at once (the suffocation reflex).
- **Walled in** (no way anywhere for 2 minutes from one spot, e.g. a pocket shut by its own seals with the way back under water): for 5 minutes its walks may break the cobblestone and dirt it put down beside its own passages. Never its shelter's or mine's shell, never with water or lava behind.
