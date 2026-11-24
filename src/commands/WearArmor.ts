// Path: src/commands/WearArmor.ts

import { z } from "zod";
import { bot } from "../core/body";
import { isArmorPiece, wearBestArmor, wornArmor } from "../actions/armor";
import { borrow } from "../core/leases";
import { bodyAtRest } from "../core/plugins";

export const description = `Puts on the best armor the bot carries (helmet, chestplate, leggings, boots), one piece per
slot. Example: "Put on your armor", "Wear the helmet", "Equip your iron armor", "Suit up".`;

export const parameters = z.object({});

const pretty = (name: string): string => name.replace(/_/g, " ");

export async function execute(): Promise<void> {
  const before = wornArmor();
  const carried = bot.inventory.items().some((i) => isArmorPiece(i.name));
  if (!carried && before.length === 0) {
    bot.chat("I don't have any armor to wear.");
    return;
  }
  // Between the running task's actions, never in the middle of one
  const worn = (await borrow({ name: "wearing armor", bucket: 2 }, ["hands"], wearBestArmor, 10_000, bodyAtRest)) ?? wornArmor();
  const added = worn.filter((name) => !before.includes(name));
  if (worn.length === 0) bot.chat("I couldn't put my armor on.");
  else if (added.length === 0) bot.chat(`I'm already wearing my best armor: ${worn.map(pretty).join(", ")}.`);
  else bot.chat(`Now wearing ${worn.map(pretty).join(", ")}.`);
}
