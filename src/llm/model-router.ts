export type Complexity = "simple" | "moderate" | "complex";

const GREETING_PATTERNS =
  /^(hola|hey|hi|hello|buenas|buenos días|buenas tardes|buenas noches|qué tal|que tal|sup|yo|ey|gracias|thanks|ok|dale|listo|bye|chau|adiós|adios)\b/i;

const COMPLEX_KEYWORDS =
  /\b(analiz|compar|explic|resum|traduc|escrib|program|codific|refactor|debug|evalua|investig|busca|recuerda|recordá|remember|save|guarda|olvid|forget|hora|time|fecha|date|calcula|convert|drive|gmail|calendar|sheet|archivo|email|correo|evento|cita|agenda|carpeta|folder|codigo|codebase|source|modulo|module|import|funcion|function|class|arquitectura|architecture|entry.?point|handler|flujo|flow|dependenc|smell|dead.?code|duplica|acoplamiento|coupling)\b/i;

export function classifyComplexity(
  message: string,
  hasTools: boolean,
): Complexity {
  const wordCount = message.trim().split(/\s+/).length;

  // Short greetings or single-word responses
  if (wordCount <= 5 && GREETING_PATTERNS.test(message.trim())) {
    return "simple";
  }

  // Messages that likely trigger tools or need deep reasoning
  if (hasTools && COMPLEX_KEYWORDS.test(message)) {
    return "complex";
  }

  // Long messages usually need more capable models
  if (wordCount > 100) {
    return "complex";
  }

  // Very short, non-greeting messages
  if (wordCount <= 10) {
    return "simple";
  }

  return "moderate";
}

export function selectModel(
  complexity: Complexity,
  models: Record<Complexity, string>,
): string {
  return models[complexity];
}
