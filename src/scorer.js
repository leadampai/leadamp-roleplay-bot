import fetch from "node-fetch";

const openaiChat = async (messages, model, apiKey) => {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0 })
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
};

export async function scoreTranscript({ transcript, rubric, model, apiKey, orgName }) {
  const convo = transcript.map(t => `${t.role.toUpperCase()}: ${t.content}`).join("\n");
  const prompt = `You are a sales coach for ${orgName}. Score the rep on a 0–100 scale using this rubric: ${JSON.stringify(rubric)}.\n
Transcript:\n${convo}\n
Return JSON with: {"score": number, "section_scores": {Discovery:number, Value:number, Objections:number, Close:number, Professionalism:number}, "wins": [..], "focus": [..], "next_actions": [..], "decision_summary": "..."}.
`;

  const content = await openaiChat(
    [
      { role: "system", content: "You are a strict but helpful sales coach." },
      { role: "user", content: prompt }
    ],
    model,
    apiKey
  );

  try {
    const jsonStart = content.indexOf("{");
    const json = JSON.parse(content.slice(jsonStart));
    return json;
  } catch {
    return {
      score: 0,
      section_scores: {},
      wins: [],
      focus: ["Could not parse response"],
      next_actions: [],
      decision_summary: ""
    };
  }
}
