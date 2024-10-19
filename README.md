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

- [Node.js](https://nodejs.org/) (v14 or later)
- [Bun.js](https://bun.sh/)
- [Minecraft Java Edition](https://www.minecraft.net/en-us/store/minecraft-java-edition)
- An OpenAI API key

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

    - Add your OpenAI API key to the `.env` file:

        ```sh
        OPENAI_API_KEY=your_openai_api_key
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
