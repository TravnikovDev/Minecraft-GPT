# Minecraft-GPT

This project was heavily inspired by [mindcraft](https://github.com/kolbytn/mindcraft) and reuses many functions from it. Here are the main differences:

- Focuses solely on one AI mode, specifically ChatGPT.
- Fully written in TypeScript and utilizes the Bun.js ecosystem.
- Strongly typed and uses Zod for data parsing to minimize parsing issues.
- Removed AI coding capabilities.
- All bot actions are hard-coded, with AI determining the appropriate action based on the situation.
- The author (Roman Travnikov) is not an experienced Minecraft player, thus the bot is designed to behave like a beginner exploring the Minecraft world.

## Description

Minecraft-GPT is an intelligent Minecraft bot designed to interact with the Minecraft world and players in an engaging, natural manner. The objective of this project is to create a bot that behaves like a new player—learning, exploring, and interacting with both the environment and other players. The bot is capable of gathering resources, building structures, and engaging in meaningful conversations, all while simulating the actions of a novice Minecraft player.

A standout feature of Minecraft-GPT is its ability to interact naturally with other players, including accepting commands in multiple languages for a more immersive experience. Furthermore, the bot has the ability to interact with other bots, enriching the multiplayer experience by simulating real players and adding dynamic activity to the in-game environment. The bot is powered by OpenAI's ChatGPT, allowing it to understand commands and choose actions appropriate for the situation, making it a unique addition to any Minecraft server.

## Features

- **Autonomous Interaction**: The bot can interact with the Minecraft world, including chatting with players, gathering resources, and building structures.
- **Survival Skills**: It performs essential survival tasks such as finding food, crafting tools, and defending against enemies.
- **Custom Commands**: The bot's capabilities can easily be extended with custom commands.
- **Intelligent Conversations**: Powered by OpenAI's ChatGPT, the bot can engage in meaningful conversations with players.
- **Multilingual Support**: The bot can accept commands in multiple languages, making it accessible to a broader audience.
- **Bot-to-Bot Interaction**: Bots can interact with each other, simulating natural player behavior within the game world.

## Setup Instructions

### Prerequisites

- [Bun](https://bun.sh/) 1.3 or later (Bun loads `.env` automatically; Node.js is not required)
- A Minecraft Java Edition server, version 1.8 – 26.1 (supported by mineflayer 4.39)
- An OpenAI API key (see [AI Model and Providers](#ai-model-and-providers))

### Installation

1. **Clone the repository**:

    ```sh
    git clone https://github.com/yourusername/Minecraft-GPT.git
    cd Minecraft-GPT
    ```

2. **Install dependencies**:

    ```sh
    bun install
    ```

3. **Configure environment variables**:
    - Copy the example environment file:

        ```sh
        cp .env.example .env
        ```

    - Fill in the `.env` file:

        ```sh
        OPENAI_API_KEY=your_openai_api_key
        BOT_USERNAME=MinecraftGPT
        SERVER_HOST=localhost
        SERVER_PORT=25565
        ```

4. **Run the project**:

    ```sh
    bun run src/index.ts
    ```

## Usage

### Starting the Bot

To start the bot, run:

```sh
bun run src/index.ts
```

## Configuration

Configuration files are located in the `src/config` directory. You can modify these files to adjust the bot's behavior.

## AI Model and Providers

The bot uses OpenAI's Chat Completions API with `gpt-6-luna` (`reasoning_effort: "none"`), configured in `src/managers/aiManager.ts`. Every bot command is sent to the model as a tool, and the model picks one per chat message.

The bot depends on **strict tool arguments**. Tool definitions are built with `zodFunction` from `openai/helpers/zod`, which sets `strict: true` so the model's arguments always match each command's Zod schema.

### Why not OpenRouter?

[OpenRouter](https://openrouter.ai) is OpenAI-compatible: the `openai` SDK works by changing `baseURL`, and most models accept the same `tools` format. It is **not used** because strict tool arguments are not guaranteed there:

- `strict: true` is enforced only by OpenAI models.
- For Anthropic models, OpenRouter strips `strict` unless a beta header is sent.
- Other providers may treat the schema as a suggestion and return arguments that don't match it.
- If the selected provider doesn't support tools, the tools are silently dropped and the model replies with plain text. To prevent this, send `provider: { require_parameters: true }` with the request.

Routing OpenAI models through OpenRouter would keep strict mode working. That only adds a 5.5% credit fee and an extra network hop, and doesn't make any other model usable. Revisit this if OpenRouter starts enforcing `strict` for all tool-capable providers.


## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## License

This project is licensed under the GNU General Public License v3.0. See the LICENSE file for details.

## Acknowledgements

- **Mineflayer** for providing the Minecraft bot framework.
- **OpenAI** for the ChatGPT API.
- **Bun.js** for the fast JavaScript runtime.

## Contact

For any inquiries, please contact [roman@travnikov.com](mailto:roman@travnikov.com).

This README provides a comprehensive overview of the project, including setup instructions, usage, project structure, and more.
