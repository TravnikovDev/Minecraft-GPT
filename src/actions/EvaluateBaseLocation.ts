import { z } from "zod";
import { bot } from "../index";

export const description = `When user asks the bot to evaluate a location for a base, the bot will search the 
area around it for resources and determine if it is suitable for a base. Example: 
"Evaluate this location for a base.", "Find a place for a base.", "Find a good spot".
If no parameters are provided we'll use default values: radius=120, wood=36, coal=24, iron=16.`;

// Define parameters for EvaluateBaseLocation action
export const parameters = z.object({
  radius: z.number().describe("Radius to search for base resources"),
  requiredResources: z
    .object({
      wood: z.number().describe("Minimum wood blocks required"),
      coal: z.number().describe("Minimum coal blocks required"),
      iron: z.number().describe("Minimum iron blocks required"),
    })
    .describe(
      "Minimum resource requirements to consider a location suitable for a base"
    ),
});

// Implement the EvaluateBaseLocation action
export async function execute(args: any) {
  console.log(`Executing EvaluateBaseLocation with args:`, args);

  // Validate arguments
  const parsed = parameters.safeParse(args);
  if (!parsed.success) {
    console.error(`Invalid parameters for EvaluateBaseLocation:`, parsed.error);
    return;
  }

  let { radius, requiredResources } = parsed.data;
  let { wood, coal, iron } = requiredResources;

  // Default values for radius and resource requirements
  radius = radius || 120;
  wood = wood || 36;
  coal = coal || 24;
  iron = iron || 16;

  const evaluateLocation = async () => {
    // Initialize resource counters
    let woodCount = 0;
    let coalCount = 0;
    let ironCount = 0;

    // Scan the area around the bot
    const blocks = bot.findBlocks({
      matching: (block) => {
        if (block.name.includes("log")) woodCount++;
        else if (block.name === "coal_ore") coalCount++;
        else if (block.name === "iron_ore") ironCount++;
        return false;
      },
      maxDistance: radius,
      count: 100,
    });

    console.log(
      `Found resources - Wood: ${woodCount}, Coal: ${coalCount}, Iron: ${ironCount}`
    );

    // Check if resource requirements are met
    if (woodCount >= wood && coalCount >= coal && ironCount >= iron) {
      bot.chat(
        "This location is suitable for a base. It has enough wood, coal, and iron."
      );
    } else {
      bot.chat(
        "This location is not suitable for a base. It lacks sufficient resources."
      );
      setTimeout(evaluateLocation, 5000); // Retry after 5 seconds
    }
  };

  evaluateLocation();
}
