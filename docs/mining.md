# Mining guide

How the bot's mine is laid out and dug (the owner's design). Code: `src/skills/mine.ts`.

## The stairs

- A diagonal staircase down from the shelter's back wall: one block forward and one down per step, 4 blocks of headroom.
- Every step is a closed tube: floor, both side walls and a roof are kept solid. Where the stairs cross a cave, the gaps are filled with dirt or cobblestone on the way down.
- Once there are 200 cobblestone, the steps get cobblestone stair blocks. They're made at home, one per bare step plus 10%.
- Blocked going down (water or lava at the next step, something built, a drop it can't floor), the stairs **turn**:
  1. back at the floor they came down from, the old way down is capped with 4 blocks in the tunnel floor;
  2. new stairs go down to the **right** of the way the stairs came in;
  3. if those are blocked too, to the **left**;
  4. if both are blocked, the same one floor higher, and so on up.
- A direction whose sleeve at that floor already hit water or lava is never tried for new stairs.
- The stairs go down to just over bedrock: no floor below y -54.

## Floors

A floor every **10 steps** down, the first at the bottom of the first 10 steps. Each floor has:

- a **room**, 3 by 3 and 3 high, with a solid floor, **beside the stairs**: the stairs run along its left column (the step coming in at the back, the landing in the middle, the step going on down at the front). The middle and right columns are flat, so you can run freely from one sleeve to another;
- a **sign** on the room's right wall by the back corner: "1st floor", "2nd floor", ...;
- **four sleeves**, each 50 blocks long, 1 wide and 2 high:

```
odd floors (1st, 3rd...)               even floors (2nd, 4th...)
[   ][   ][ F ][   ][   ]              [   ][   ][   ][ F ][   ]
[   ][ S↓][ X ][ X ][   ]              [   ][ S↓][ X ][ X ][   ]
[ L ][ S ][ X ][ X ][ R ]              [ L ][ S ][ X ][ X ][ R ]
[   ][ S↑][ X ][ X ][   ]              [   ][ S↑][ X ][ X ][   ]
[   ][   ][ B ][   ][   ]              [   ][   ][   ][ B ][   ]
S: the stairs (↑ the step coming in, ↓ the step going on down)
```

- Left and right sleeves always leave from the middle row: left from the stairs' landing, right from the room's right column.
- Forward and back sleeves alternate: from the middle column on odd floors, from the right column on even floors.
- They're dug in this order: forward, right, left, back.
- The floors dug before this layout (the room round the stairs) keep their old shape.
- The rooms, sleeves and pokeholes are the bot's own passages: walks never put a block down in them, and blocks left standing there are taken out when the floor is mended.

## Pokeholes

Along every sleeve, every **4 blocks**, a pokehole **1 wide, 3 high, 5 long**:

- off the left and right sleeves, on both sides;
- off the forward and back sleeves, only on the side away from the stairs.

Every ore seen from a fresh sleeve or pokehole is mined (strip mining). Holes that ore leaves in the floor under the room, the sleeves and the pokeholes are filled again with dirt or cobblestone. The stairs going on down are left open.

## When it can't go deeper

With every way down blocked, or at the bottom, it digs side routes off its lowest floor's sleeves: every 3 blocks, 10 long.

## Safety rules that hold in the mine

- Never break a block with water or lava at its sides or on top. Only the drowning reflex, digging up for air, may.
- Water in a sleeve is plugged; water at the next stair step makes the stairs turn.
- Out of the mine by its own stairs, never a new way dug up through the rock. Beside the stairs in a cave, it opens a way in through their wall.
- It goes down only with enough health and food.
- **Closed to the outside**: where a floor's room, sleeve or pokehole (or the stairs) opens into open air that reaches the sky (a canyon, a ravine), the opening is blocked with cobblestone, at the start of every trip and after every stretch it digs. Caves that stay underground are left open.
- Gravel or sand falling into its head is dug out at once (the suffocation reflex).
