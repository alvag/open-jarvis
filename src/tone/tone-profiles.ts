export interface ToneProfile {
  id: string;
  label: string;
  aliases: string[];
  instructions: string;
}

export const TONE_PROFILES: Record<string, ToneProfile> = {
  default: {
    id: "default",
    label: "Default",
    aliases: ["normal", "por defecto", "predeterminado"],
    instructions: "",
  },
  formal: {
    id: "formal",
    label: "Formal",
    aliases: ["profesional", "professional", "serio"],
    instructions: `## Response Style Override
- Use formal, professional language
- No emojis, no slang, no colloquialisms
- Use complete sentences and proper grammar
- Prefer technical and precise vocabulary
- Maintain a respectful, measured tone`,
  },
  casual: {
    id: "casual",
    label: "Casual",
    aliases: ["relajado", "chill", "informal", "relax"],
    instructions: `## Response Style Override
- Be relaxed and conversational
- Use emojis naturally (but don't overdo it)
- Contractions and colloquialisms are welcome
- Match informal energy — like texting a friend
- Keep it light and approachable`,
  },
  brief: {
    id: "brief",
    label: "Brief",
    aliases: ["breve", "corto", "conciso", "terse", "short"],
    instructions: `## Response Style Override
- Maximum brevity: shortest possible answer that's still complete
- No greetings, no sign-offs, no filler
- One-liners preferred when the answer fits in one
- Lists only if strictly necessary, and keep them short
- Skip explanations unless explicitly asked`,
  },
  friendly: {
    id: "friendly",
    label: "Friendly",
    aliases: ["amigable", "warm", "cálido", "empático"],
    instructions: `## Response Style Override
- Warm, empathetic, and encouraging tone
- Acknowledge the user's situation before diving into solutions
- Explain things patiently, as if helping a friend
- Use light humor and positive reinforcement
- Be generous with helpful context and suggestions`,
  },
  executive: {
    id: "executive",
    label: "Executive",
    aliases: ["ejecutivo", "exec", "business", "action", "al grano"],
    instructions: `## Response Style Override
- Action-oriented, no fluff
- Lead with the conclusion or recommendation
- Use bullet points for multiple items
- Include clear next steps when applicable
- Numbers and data over adjectives
- Skip background unless it changes the decision`,
  },
};

export function resolveTone(input: string): ToneProfile | undefined {
  const normalized = input.toLowerCase().trim();
  if (TONE_PROFILES[normalized]) return TONE_PROFILES[normalized];
  return Object.values(TONE_PROFILES).find((p) =>
    p.aliases.some((a) => a === normalized),
  );
}

export function listToneNames(): string[] {
  return Object.keys(TONE_PROFILES);
}
