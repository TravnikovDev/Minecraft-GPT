import { Bot } from "mineflayer";
import { Entity } from "prismarine-entity";

declare module "mineflayer" {
  interface Bot {
    // PVP Plugin
    pvp: {
      attack: (entity: Entity) => void;
      stop: () => void;
      target: Entity | null;
    };

    // Tool Plugin
    tool: {
      equipForBlock: (block: any, options?: any) => Promise<void>;
      equipForEntity: (entity: Entity, options?: any) => Promise<void>;
      equipForMining: (options?: any) => Promise<void>;
    };

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