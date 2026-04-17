import type { BitbucketPR } from "../tools/bitbucket-api.js";

const MAX_DIFF_CHARS = 25_000;
const MAX_PROMPT_CHARS = 30_000;

export function buildBitbucketPrReviewPrompt(
  pr: BitbucketPR,
  diff: string,
  isRereview: boolean,
): string {
  const truncatedDiff = diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + `\n\n[... diff truncado a ${MAX_DIFF_CHARS} chars de ${diff.length} totales ...]`
    : diff;

  const header = isRereview
    ? `Ya revisaste este PR antes. Hubo nuevos commits — enfoca tu review en los cambios incrementales pero valida que no rompan lo anterior.`
    : `Primer code review de este PR. Analiza los cambios con detalle.`;

  let prompt = `You are performing an automated code review on a Bitbucket Pull Request. This is a scheduled task — produce a concise review and send it to the user as your final response (it will be delivered via Telegram).

## Contexto

${header}

## Pull Request

- **ID**: #${pr.id}
- **Titulo**: ${pr.title}
- **Autor**: ${pr.author.display_name} (${pr.author.nickname})
- **Source**: ${pr.source.branch.name}
- **Destination**: ${pr.destination.branch.name}
- **Estado**: ${pr.state}
- **Link**: ${pr.links.html.href}

### Descripcion

${pr.description?.trim() || "(sin descripcion)"}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

## Instrucciones

Revisa el diff y produce un resumen accionable en espanol con estas secciones:

1. **Resumen** (1-2 lineas): que hace el PR en terminos de negocio/tecnicos.
2. **Hallazgos** (lista con severidad): bugs, riesgos, problemas de seguridad, edge cases no cubiertos, style issues relevantes. Cada item con formato \`[severidad] archivo:linea — descripcion\`. Severidades: critica / alta / media / baja.
3. **Recomendacion**: una de aprobar / pedir cambios / comentar-sin-bloquear, con justificacion breve.

## Reglas

- No inventes hallazgos. Si el diff es trivial o esta bien, dilo explicitamente.
- Se conciso: este mensaje va por Telegram, no es un informe formal.
- Empieza el mensaje con el header: \`${isRereview ? "\u{1F504}" : "\u{1F9D0}"} Code review PR #${pr.id} — ${pr.title}\`
- Termina con el link: ${pr.links.html.href}
- No uses herramientas auxiliares (save_memory, etc.) a menos que sean imprescindibles — el foco es producir el texto del review.
- Tu respuesta final (el texto completo del review) sera tomada y entregada al usuario por el orquestador. Produci SOLO el review como respuesta final, sin explicaciones adicionales ni preambulos.`;

  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS) + "\n\n[Prompt truncado por tamano]";
  }

  return prompt;
}
