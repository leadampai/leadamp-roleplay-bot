import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("practice")
    .setDescription("Start a text roleplay session")
    .addStringOption(o => o.setName("route").setDescription("cold_call | door_knock | cold_dm").setRequired(true))
    .addStringOption(o => o.setName("industry").setDescription("roofing | hvac | medspa").setRequired(true))
    .addStringOption(o => o.setName("difficulty").setDescription("easy | realistic | hard").setRequired(true)),
  new SlashCommandBuilder().setName("end").setDescription("End text session & score"),
  new SlashCommandBuilder().setName("status").setDescription("Show text session status"),
  new SlashCommandBuilder()
    .setName("voice_practice")
    .setDescription("Start voice roleplay in a voice channel")
    .addChannelOption(o => o.setName("channel").setDescription("Select a voice channel").addChannelTypes(2).setRequired(true))
    .addStringOption(o => o.setName("route").setDescription("cold_call | door_knock").setRequired(true))
    .addStringOption(o => o.setName("industry").setDescription("roofing | hvac | medspa").setRequired(true))
    .addStringOption(o => o.setName("difficulty").setDescription("easy | realistic | hard").setRequired(true)),
  new SlashCommandBuilder().setName("voice_end").setDescription("End the voice session & score")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log("Commands registered.");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
