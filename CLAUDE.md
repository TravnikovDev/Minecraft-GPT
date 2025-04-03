# minecraft-gpt Development Guidelines

## Project Overview
minecraft-gpt is an AI-powered Minecraft bot built with Mineflayer and OpenAI's GPT APIs. It allows natural language interactions in-game, with the bot autonomously responding to commands and performing complex actions.

## Build Commands
```bash
# Start the bot
bun run src/index.ts
# Type checking
bun run tsc
# Install dependencies
bun install
```

## Environment Setup
The project requires the following environment variables:
- `BOT_USERNAME` - Username for the bot in Minecraft
- `OPENAI_API_KEY` - OpenAI API key for AI communication
- `SERVER_HOST` - Minecraft server hostname/IP
- `SERVER_PORT` - Minecraft server port

## Code Style Guidelines
- **Imports**: Group imports by source (internal/external). Use named imports for specific functions.
- **Naming**: camelCase for variables/functions, PascalCase for classes/types/interfaces, UPPER_CASE for constants.
- **Types**: Use TypeScript strictly. Define schemas with Zod. Use enums for constants.
- **Error Handling**: Use try/catch with specific error types. Log errors with console.error().
- **Functions**: Use arrow functions with explicit return types. Organize related functions in feature-specific files.
- **Comments**: Document file purpose, complex operations, and function parameters.
- **Async Code**: Use async/await pattern consistently. Handle promises with proper error catching.
- **Documentation**: Add descriptive comments to explain complex logic and expected behavior.

## Project Structure
- `/src/actions/` - Core bot capabilities (building, digging, crafting, etc.)
  - `building.ts` - Construction-related actions
  - `combat.ts` - Combat and fighting mechanics
  - `crafting.ts` - Item crafting functionality
  - `digging.ts` - Block mining and excavation
  - `ensure*.ts` - Verification and preparation utilities
  - `movement.ts` - Navigation and position control
  - `inventory.ts` - Item management and organization
  - `world.ts` - World interaction and environment sensing
- `/src/commands/` - High-level commands that users can trigger
  - Each file represents a discrete command the bot can execute
  - `registry.ts` - Command registration and lookup system
  - `types.ts` - Command interfaces and type definitions
- `/src/schemas/` - Zod schemas for validation
  - `mainSchemas.ts` - Core data validation schemas
  - `types.ts` - TypeScript type definitions
- `/src/managers/` - System components that coordinate functionality
  - `actionManager.ts` - Executes and coordinates bot actions
  - `aiManager.ts` - Handles communication with OpenAI APIs
  - `botProgress.ts` - Tracks bot skills and capabilities
  - `persistenceManager.ts` - Manages data persistence with LowDB
  - `toolManager.ts` - Defines and handles AI tool interactions
- `/src/utils/` - Shared utility functions
  - `minecraftData.ts` - Game data references and access
  - `utility.ts` - General helper functions

## Plugin Integration
The bot leverages several Mineflayer plugins:
- `mineflayer-pathfinder` - Advanced navigation
- `mineflayer-pvp` - Combat capabilities
- `mineflayer-auto-eat` - Automatic food consumption
- `mineflayer-tool` - Tool selection and management
- `mineflayer-armor-manager` - Automatic armor equipment

## Command System
Bot commands follow a priority-based queue system:
1. Commands are added to the queue with a unique ID and priority level
2. The action manager processes commands based on priority
3. New AI responses may generate additional commands

## OpenAI Integration
The bot communicates with OpenAI through:
- `aiManager.ts` - Handles message processing and API communication
- Function calling with GPT models to execute specific actions
- Tools API for structured action handling

## Development Workflow
1. Create new features in the appropriate module directory
2. Ensure proper TypeScript typing and validation
3. Register new commands in the command registry
4. Test functionality in-game with natural language commands
5. Document changes in code comments

## Best Practices
- Use Zod schemas for all data validation
- Keep functions small and focused on a single responsibility
- Leverage TypeScript's type system for safety and documentation
- Handle Minecraft-specific edge cases (disconnects, respawns, etc.)
- Log important events and errors with appropriate detail
- Ensure graceful error handling for all user interactions