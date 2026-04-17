export type IntentCategory = "reminder_request" | "list_add";

export interface RepetitiveIntent {
  category: IntentCategory;
  canonicalKey: string;
  rawText: string;
  metadata?: {
    listName?: string;
    normalizedObject?: string;
  };
}

// Only explicit reminder REQUESTS, not obligation statements.
// "hay que" / "tengo que" intentionally excluded: they are conversational
// obligation markers ("tengo que pagar el alquiler") and would classify
// ordinary chat as reminder requests, polluting the usage counter.
const REMINDER_TRIGGERS = [
  "recuerdame",
  "recuerdam",
  "acuerdame",
  "acordarme",
  "avisame",
  "remind me",
  "reminder",
  "programar",
  "agendar",
  "no olvides",
  "no olvidar",
];

const LIST_ADD_TRIGGERS = [
  "agrega",
  "agregar",
  "agrega a",
  "anota",
  "anotar",
  "apunta",
  "apuntar",
  "anade",
  "anadir",
  "pon en",
  "pon a",
  "add to",
  "meter en",
  "mete en",
];

// Individual words to remove when building the canonical key. Multi-word
// phrases like "pon en" never appear contiguously ("pon LECHE en compras"),
// so stripping the full phrase misses them — we strip the head verb instead.
const LIST_ADD_STRIP_WORDS = [
  "agrega",
  "agregar",
  "anota",
  "anotar",
  "apunta",
  "apuntar",
  "anade",
  "anadir",
  "añade",
  "añadir",
  "pon",
  "poner",
  "mete",
  "meter",
  "add",
];

const REMINDER_STRIP_WORDS = [
  "recuerdame",
  "recuerdam",
  "recuérdame",
  "recuerdem",
  "acuerdame",
  "acuérdame",
  "acordarme",
  "avisame",
  "avísame",
  "remind",
  "reminder",
  "programar",
  "programa",
  "agendar",
  "agenda",
  "olvides",
  "olvidar",
];

const DATE_WORDS = [
  "mañana",
  "manana",
  "hoy",
  "pasado mañana",
  "pasado manana",
  "lunes",
  "martes",
  "miercoles",
  "miércoles",
  "jueves",
  "viernes",
  "sabado",
  "sábado",
  "domingo",
  "esta noche",
  "esta tarde",
  "esta manana",
  "esta mañana",
  "la proxima semana",
  "la próxima semana",
  "proxima semana",
  "próxima semana",
  "next week",
  "tomorrow",
  "today",
  "tonight",
];

const TIME_PATTERNS = [
  /\ba\s+las?\s+\d{1,2}(:\d{2})?\s*(am|pm|de la mañana|de la tarde|de la noche|de la manana)?\b/gi,
  /\bal mediodia\b/gi,
  /\bal mediodía\b/gi,
  /\ben \d+ (horas?|minutos?|dias?|días?|semanas?)\b/gi,
  /\b\d{1,2}:\d{2}\b/g,
  /\b\d{1,2}\s*(am|pm)\b/gi,
  /\btodos los (dias?|días?|lunes|martes|miercoles|miércoles|jueves|viernes|sabados?|sábados?|domingos?)\b/gi,
  /\bcada (dia|día|semana|mes|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|hora|minuto)\b/gi,
  /\bdiario\b/gi,
  /\bsemanal\b/gi,
  /\bmensual\b/gi,
];

const STOPWORDS = new Set([
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "de",
  "del",
  "al",
  "a",
  "en",
  "y",
  "o",
  "u",
  "que",
  "por",
  "para",
  "con",
  "sin",
  "mi",
  "mis",
  "tu",
  "tus",
  "me",
  "te",
  "se",
  "lo",
  "le",
  "porfa",
  "por favor",
  "please",
  "the",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "and",
  "or",
  "my",
  "your",
]);

const VERB_NORMALIZATIONS: Record<string, string> = {
  pagar: "pay",
  paga: "pay",
  pago: "pay",
  revisar: "review",
  revisa: "review",
  reviso: "review",
  comprar: "buy",
  compra: "buy",
  compro: "buy",
  llamar: "call",
  llama: "call",
  llamo: "call",
  enviar: "send",
  envia: "send",
  envío: "send",
  envio: "send",
  mandar: "send",
  manda: "send",
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function removeFillers(text: string): string {
  let out = text;
  for (const pattern of TIME_PATTERNS) {
    out = out.replace(pattern, " ");
  }
  const normalized = stripAccents(out).toLowerCase();
  let result = normalized;
  for (const word of DATE_WORDS) {
    const stripped = stripAccents(word).toLowerCase();
    const re = new RegExp(`\\b${stripped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    result = result.replace(re, " ");
  }
  return result;
}

function tokenize(text: string): string[] {
  return text
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t));
}

function normalizeTokens(tokens: string[]): string[] {
  return tokens
    .map((t) => VERB_NORMALIZATIONS[t] ?? t)
    .filter((t) => t.length >= 2);
}

// Words that commonly appear right after the list name as politeness suffixes.
// "agrega leche a la lista de compras por favor" must NOT produce listName
// "compras por" — we strip these before accepting a two-token list name.
const COURTESY_WORDS = new Set([
  "por",
  "favor",
  "porfa",
  "please",
  "gracias",
  "plz",
  "ahora",
  "ya",
  "si",
  "sí",
]);

function isValidListToken(tok: string): boolean {
  return (
    tok.length > 0 &&
    !STOPWORDS.has(tok) &&
    !COURTESY_WORDS.has(tok) &&
    /^[a-z][a-z0-9]*$/i.test(tok)
  );
}

function extractListName(text: string): string | null {
  const lower = stripAccents(text).toLowerCase();
  const match =
    lower.match(/\b(?:a|en|al|to)\s+(?:la |el |mi |la lista de |lista de |list )?([a-z0-9]+)(?:\s+([a-z0-9]+))?\s*$/i) ??
    lower.match(/\b(?:lista|list)\s+(?:de\s+)?([a-z0-9]+)(?:\s+([a-z0-9]+))?/i);
  if (!match) return null;
  const first = match[1]?.trim() ?? "";
  const second = match[2]?.trim() ?? "";
  if (!isValidListToken(first)) return null;
  if (second && isValidListToken(second)) {
    return `${first} ${second}`;
  }
  return first;
}

function hasAnyTrigger(text: string, triggers: string[]): boolean {
  const lower = stripAccents(text).toLowerCase();
  return triggers.some((t) => lower.includes(stripAccents(t).toLowerCase()));
}

function stripPhrases(text: string, phrases: string[]): string {
  let out = text;
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    const stripped = stripAccents(phrase).toLowerCase();
    const escaped = stripped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "g");
    out = out.replace(re, " ");
  }
  return out;
}

function buildCanonicalPayload(text: string, triggersToStrip: string[]): string {
  const noFillers = removeFillers(text);
  const noTriggers = stripPhrases(noFillers, triggersToStrip);
  const tokens = normalizeTokens(tokenize(noTriggers));
  if (tokens.length === 0) return "";
  const unique = Array.from(new Set(tokens)).sort();
  return unique.slice(0, 6).join("-");
}

export function extractRepetitiveIntent(userText: string): RepetitiveIntent | null {
  if (!userText || userText.trim().length < 3) return null;

  const isListAdd = hasAnyTrigger(userText, LIST_ADD_TRIGGERS);
  const isReminder = hasAnyTrigger(userText, REMINDER_TRIGGERS);

  if (!isListAdd && !isReminder) return null;

  // Prefer reminder classification when both trigger families match.
  // "recuérdame agregar leche a compras cada martes" hits both sets, but the
  // actual action is a scheduled reminder — classifying as list_add would
  // make the detector expect manage_lists and miss the create_scheduled_task.
  if (isReminder) {
    // Strip BOTH single-word strip lists so payloads stay stable even for
    // mixed phrasings and non-contiguous triggers like "pon ... en".
    const payload = buildCanonicalPayload(userText, [
      ...REMINDER_STRIP_WORDS,
      ...LIST_ADD_STRIP_WORDS,
    ]);
    if (!payload) return null;
    return {
      category: "reminder_request",
      canonicalKey: `reminder:${payload}`,
      rawText: userText.trim(),
      metadata: { normalizedObject: payload },
    };
  }

  if (isListAdd) {
    const listName = extractListName(userText) ?? "tareas";
    // Strip individual trigger verbs AND the list name so equivalent phrasings
    // ("agrega leche a compras", "pon leche en compras", "anota leche") collapse.
    const payload = buildCanonicalPayload(userText, [
      ...LIST_ADD_STRIP_WORDS,
      listName,
    ]);
    if (!payload) return null;
    return {
      category: "list_add",
      canonicalKey: `list_add:${listName}:${payload}`,
      rawText: userText.trim(),
      metadata: { listName, normalizedObject: payload },
    };
  }

  return null;
}
