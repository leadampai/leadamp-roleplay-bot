import "dotenv/config";
import fs from "fs";
import YAML from "yaml";
import fetch from "node-fetch";
import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import { systemPrompt } from "./prompt.js";
import { scoreTranscript } from "./scorer.js";
import { startVoicePractice, endVoicePractice } from "./voice.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

const sessions = new Map(); // text sessions
const config = YAML.parse(fs.readFileSync(new URL("./scenarios.yaml", import.meta.url)));

const RUBRIC = { Discovery: 30, Value: 25, Objections: 25, Close: 15, Professionalism: 5 };

const openaiChat = async (messages) => {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 300
    })
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
};

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;
  const { commandName } = interaction;

  if (commandName === "practice") {
    const routeKey = interaction.options.getString("route");
    const industryKey = interaction.options.getString("industry");
    const difficulty = interaction.options.getString("difficulty");

    const route = config.routes[routeKey];
    const industry = config.industries[industryKey];
    const diff = config._difficulties[difficulty];

    if (!route || !industry || !diff) {
      await interaction.reply({ content: "Invalid options. Try again.", ephemeral: true });
      return;
    }

    const namePool = industry.prospect.name_pool || ["Taylor", "Alex"];
    const prospectName = namePool[Math.floor(Math.random() * namePool.length)];

    const scenario = {
      objective: route.objective,
      prospect: industry.prospect,
      pains: industry.common_pains,
      objections: industry.objections,
      opener_hints: route.opener_hints,
      prospectName
    };

    const sys = systemPrompt({
      orgName: process.env.ORGANIZATION_NAME || "LeadAmp AI",
      industryKey,
      routeKey,
      difficulty,
      scenario
    });

    sessions.set(interaction.user.id, {
      userId: interaction.user.id,
      channelId: interaction.channelId,
      routeKey,
      industryKey,
      difficulty,
      scenario,
      diff,
      turns: 0,
      transcript: [{ role: "system", content: sys }],
      active: true
    });

    await interaction.reply({
      content: `Text roleplay started (**${routeKey} • ${industryKey} • ${difficulty}**). Prospect: **${prospectName}**, ${industry.prospect.title}.\nHints: ${route.opener_hints.join(" | ")}\nType **END** to finish.`,
      ephemeral: false
    });

    const opening = opener(routeKey);
    sessions.get(interaction.user.id).transcript.push({ role: "assistant", content: `(${prospectName}) ${opening}` });
    await interaction.channel.send(`**${prospectName}:** ${opening}`);
  }

  if (commandName === "end") {
    const s = sessions.get(interaction.user.id);
    if (!s || !s.active) {
      await interaction.reply({ content: "No active text session.", ephemeral: true });
      return;
    }
    s.active = false;
    const score = await scoreTranscript({
      transcript: s.transcript.filter(t => t.role !== "system"),
      rubric: RUBRIC,
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      apiKey: process.env.OPENAI_API_KEY,
      orgName: process.env.ORGANIZATION_NAME || "LeadAmp AI"
    });
    const summary = formatScoreSummary(score);
    await interaction.reply({ content: summary, ephemeral: true });

    if (process.env.REPORT_CHANNEL_ID) {
      const ch = await client.channels.fetch(process.env.REPORT_CHANNEL_ID).catch(() => null);
      if (ch && ch.type === ChannelType.GuildText) {
        await ch.send(`**Roleplay Summary for <@${interaction.user.id}>**\n${summary}`);
      }
    }
  }

  if (commandName === "status") {
    const s = sessions.get(interaction.user.id);
    await interaction.reply({ content: s?.active ? `Active: ${s.routeKey}/${s.industryKey} turns=${s.turns}` : "No active text session.", ephemeral: true });
  }

  if (commandName === "voice_practice") {
    await startVoicePractice({ client, interaction, config });
  }
  if (commandName === "voice_end") {
    await endVoicePractice({ interaction });
  }
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const s = sessions.get(msg.author.id);
  if (!s || !s.active || msg.channelId !== s.channelId) return;

  const content = msg.content.trim();
  if (content.toUpperCase() === "END") {
    s.active = false;
    await msg.reply("Ending session. Use /end to score.");
    return;
  }

  s.transcript.push({ role: "user", content });
  s.turns += 1;

  if (s.turns > s.diff.patience_turns && Math.random() < 0.4) {
    const line = "Look, I have to jump. Can you keep this quick?";
    s.transcript.push({ role: "assistant", content: line });
    await msg.channel.send(`**${s.scenario.prospectName}:** ${line}`);
    return;
  }

  const reply = await openaiChat([
    ...s.transcript,
    { role: "system", content: `If rep asks for a meeting and has earned trust, allow tentative booking. Use ${s.scenario.prospect.title} tone.` }
  ]).catch(() => "(Prospect glitches) Can you repeat that?");

  s.transcript.push({ role: "assistant", content: reply });
  await msg.channel.send(`**${s.scenario.prospectName}:** ${reply}`);
});

function opener(route) {
  if (route === "cold_dm") return "Hey—who is this and how did you find us?";
  if (route === "door_knock") return "Can we make this quick? We’ve got clients inside.";
  return "Hello? (a bit rushed)";
}

function formatScoreSummary(score) {
  const ss = score.section_scores || {};
  return [
    `**Score:** ${score.score}/100`,
    `**Section Scores:** Discovery ${ss.Discovery ?? "-" }, Value ${ss.Value ?? "-" }, Objections ${ss.Objections ?? "-" }, Close ${ss.Close ?? "-" }, Professionalism ${ss.Professionalism ?? "-" }`,
    `**Wins:** ${(score.wins || []).map(x => `• ${x}`).join("\n") || "-"}`,
    `**Focus Next:** ${(score.focus || []).map(x => `• ${x}`).join("\n") || "-"}`,
    `**Next Actions (1–3):** ${(score.next_actions || []).map(x => `• ${x}`).join("\n") || "-"}`,
    `**Decision Summary:** ${score.decision_summary || ""}`
  ].join("\n");
}

client.login(process.env.DISCORD_TOKEN);
