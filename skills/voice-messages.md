---
name: Voice Messages
tools: []
triggers: [mensaje de voz]
---
El usuario envió un mensaje de voz transcrito automáticamente. El mensaje empieza con `[Mensaje de voz, Xs]` (corto, <1min) o `[Mensaje de voz, XmYs]` (largo, ≥1min) seguido del texto.

**Heurístico clave:** si la duración contiene `m` → audio largo. Si solo tiene `s` → audio corto.

## Reglas universales (siempre)

1. **Responder al contenido**, no a la transcripción. Nunca decir "tu mensaje de voz decía..."
2. **Inferir intención**: los mensajes de voz son informales e incompletos — completar el contexto
3. **Extraer action items** cuando aparezcan:
   - Con fecha/recordatorio → `create_scheduled_task`
   - Sin fecha (tarea o idea) → `manage_lists`
4. **Errores de transcripción**: si el texto parece incoherente o tiene palabras inventadas, pedir clarificación en lugar de inventar respuesta

## Decision tree por duración

### Audio corto (`Xs`, ej. `45s`)
Responder **natural y conversacional**, como si fuera texto. **Sin** resumen ni mención de tono. Si se ejecutó una tool, confirmar brevemente.

### Audio largo (`XmYs`, ej. `2m10s`)
Responder con **formato estructurado**:

```
📝 **Resumen:**
- Punto 1
- Punto 2
- Punto 3 (si aplica)

🎭 **Tono:** [urgente/relajado/preocupado/entusiasta/neutral]

[Respuesta a cada tema, o confirmación de acciones ejecutadas]
```

- Máximo **3 bullets** en el resumen. Cada bullet = un tema distinto.
- Tono en **una palabra**. Si es ambiguo → `neutral`.
- La sección de respuesta debe cubrir cada tema del resumen.

## Detección de tono (solo por texto)

No hay acceso al audio raw. Inferir tono por señales léxicas:

- **urgente**: "ya", "urgente", "ahora", "rápido", "no puedo esperar"
- **relajado**: "bueno...", "eh...", "nada...", divagaciones, temas mezclados sin prisa
- **preocupado**: "no sé qué hacer", "me preocupa", "estoy mal", frases inconclusas
- **entusiasta**: exclamaciones, "genial", "increíble", velocidad implícita alta
- **neutral**: cuando no hay señal clara

## Ejemplos

**Corto (`25s`):**
Input: `[Mensaje de voz, 25s] che comprá leche cuando salgas`
Output: `Listo, agregué "comprar leche" a tu lista 🛒`

**Largo (`2m10s`):**
Input: `[Mensaje de voz, 2m10s] bueno, eh, mañana tengo la reunión con el cliente a las 10, recordámelo. También anotá que tengo que renovar el seguro del auto. Ah y te cuento que al final me aceptaron la propuesta del proyecto nuevo, arrancamos la semana que viene.`
Output:
```
📝 **Resumen:**
- Reunión con cliente mañana 10hs
- Renovar seguro del auto
- Propuesta aceptada, arranca la semana que viene 🎉

🎭 **Tono:** relajado

Listo, te programé el recordatorio para mañana 9:45 ⏰ y agregué "renovar seguro del auto" a tu lista. ¡Felicitaciones por la propuesta!
```
