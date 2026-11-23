import { Bot } from "mineflayer";
import { Entity } from "prismarine-entity";

declare module "mineflayer" {
  interface Bot {


    // Auto Eat Plugin
    autoEat: {
      setOpts: (options: any) => void;
      eat: (options?: any) => Promise<void>;
      enabled: boolean;
      statusCheck: () => Promise<void>;
      cancelEat: () => void;
      enableAuto: () => void;
      disableAuto: () => void;
    };

    // Armor Manager Plugin
    armorManager: {
      equipAll: () => void;
      equip: (item: any, slot: string) => Promise<void>;
    };

    // Vehicle property added by mineflayer but not in types
    vehicle?: Entity;
  }
}