import { joinVoiceChannel, EndBehaviorType, createAudioPlayer, createAudioResource, StreamType, VoiceConnectionStatus, entersState } from "@discordjs/voice";
import { Readable } from "stream";
import prism from "prism-media";
import ffmpeg from "ffmpeg-static";
import fetch from "node-fetch";
import FormData from "form-data";
import wav from "wav";
import { systemPrompt } from "./prompt.js";
import { scoreTranscript } from "./scorer.js";

const sessions = new Map(); // voice sessions by userId

const openaiChat = async (messages) => {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", messages, temperature: 0.7, max_tokens: 240 })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
};

function pcmToWav(pcmBuffer, sampleRate = 48000, channels = 2) {
  const writer = new wav.Writer({ sampleRate, channels, bitDepth: 16 });
  const readable = Readable.from(pcmBuffer);
  const chunks = [];
  return new Promise((resolve, reject) => {
    readable.pipe(writer);
    writer.on("data", c => chunks.push(c));
    writer.on("finish", () => resolve(Buffer.concat(chunks)));
    writer.on("error", reject);
  });
}

async function transcribe(bufferWav) {
  const form = new FormData();
  form.append("file", bufferWav, { filename: "audio.wav", contentType: "audio/wav" });
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
  const data = await res.json();
  return data.text?.trim() || "";
}

async function ttsToOpusResource(text) {
  const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "tts-1", input: text, voice: "alloy", format: "mp3" })
  });
  const mp3 = Buffer.from(await ttsRes.arrayBuffer());
  const ff = new prism.FFmpeg({
    args: [
      "-analyzeduration", "0", "-loglevel", "0",
      "-f", "mp3", "-i", "pipe:0",
      "-ar", "48000", "-ac", "2",
      "-f", "opus", "-acodec", "libopus", "-b:a", "96k",
      "pipe:1"
    ],
    shell: false,
    ffmpeg: ffmpeg
  });
  const inStream = Readable.from(mp3);
  const opusStream = inStream.pipe(ff);
  return createAudioResource(opusStream, { inputType: StreamType.OggOpus });
}

export async function startVoicePractice({ interaction, config }) {
  const channel = interaction.options.getChannel("channel");
  const routeKey = interaction.options.getString("route");
  const industryKey = interaction.options.getString("industry");
  const difficulty = interaction.options.getString("difficulty");

  const route = config.routes[routeKey];
  const industry = config.industries[industryKey];
  const diff = config._difficulties[difficulty];
  if (!channel || channel.type !== 2 || !route || !industry || !diff) {
    await interaction.reply({ content: "Invalid options.", ephemeral: true });
    return;
  }

  const prospectName = (industry.prospect.name_pool || ["Alex"])[Math.floor(Math.random() * (industry.prospect.name_pool?.length || 1))];
  const sys = systemPrompt({ orgName: process.env.ORGANIZATION_NAME || "LeadAmp AI", industryKey, routeKey, difficulty, scenario: { objective: route.objective, prospect: industry.prospect, pains: industry.common_pains, objections: industry.objections, opener_hints: route.opener_hints, prospectName } });

  const connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator });
  await entersState(connection, VoiceConnectionStatus.Ready, 20000);
  const player = createAudioPlayer();
  connection.subscribe(player);

  const transcript = [{ role: "system", content: sys }];
  const userId = interaction.user.id;
  sessions.set(userId, { connection, player, transcript, diff, difficulty, industryKey, routeKey, started: Date.now(), prospectName });

  await interaction.reply(`Joined **${channel.name}**. Start speaking when you're ready. Say **END** to finish.`);

  const receiver = connection.receiver;
  receiver.speaking.on("start", (id) => {
    if (id !== interaction.user.id) return; // only the rep
    const opusStream = receiver.subscribe(id, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 } });
    const pcm = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
    const chunks = [];
    opusStream.pipe(pcm);
    pcm.on("data", d => chunks.push(d));
    pcm.on("end", async () => {
      try {
        const pcmBuf = Buffer.concat(chunks);
        if (!pcmBuf.length) return;
        const wavBuf = await pcmToWav(pcmBuf, 48000, 2);
        const text = await transcribe(wavBuf);
        if (!text) return;
        if (text.trim().toUpperCase().includes("END")) {
          await interaction.followUp("Heard END — type /voice_end to score.");
          return;
        }
        sessions.get(userId)?.transcript.push({ role: "user", content: text });
        const reply = await openaiChat(sessions.get(userId).transcript);
        sessions.get(userId)?.transcript.push({ role: "assistant", content: reply });
        const resource = await ttsToOpusResource(reply);
        sessions.get(userId).player.play(resource);
      } catch (e) {
        console.error("voice chunk error", e);
      }
    });
  });
}

export async function endVoicePractice({ interaction }) {
  const s = sessions.get(interaction.user.id);
  if (!s) { await interaction.reply({ content: "No active voice session.", ephemeral: true }); return; }
  try { s.connection.destroy(); } catch {}
  const score = await scoreTranscript({ transcript: s.transcript.filter(t => t.role !== "system"), rubric: { Discovery:30, Value:25, Objections:25, Close:15, Professionalism:5 }, model: process.env.OPENAI_MODEL || "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY, orgName: process.env.ORGANIZATION_NAME || "LeadAmp AI" });
  const ss = score.section_scores || {};
  const summary = `**Score:** ${score.score}/100\n**Section Scores:** Discovery ${ss.Discovery ?? "-" }, Value ${ss.Value ?? "-" }, Objections ${ss.Objections ?? "-" }, Close ${ss.Close ?? "-" }, Professionalism ${ss.Professionalism ?? "-" }\n**Wins:** ${(score.wins||[]).map(x=>`• ${x}`).join("\n")||"-"}\n**Focus:** ${(score.focus||[]).map(x=>`• ${x}`).join("\n")||"-"}`;
  await interaction.reply(summary);
  sessions.delete(interaction.user.id);
}
