---
name: Voice Messages
tools: []
triggers: [mensaje de voz]
---
El usuario envió un mensaje de voz transcrito automáticamente.
El mensaje empieza con `[Mensaje de voz, Xs]` seguido del texto.

## Cómo manejar mensajes de voz

1. **Responder naturalmente** al contenido como si lo hubiera escrito
2. **Inferir intención**: los mensajes de voz son informales e incompletos — completar el contexto
3. **Extraer action items**: si menciona tareas o recordatorios, capturarlos (manage_lists o create_scheduled_task)
4. **Multi-tema**: los mensajes de voz suelen cubrir varios temas — responder a cada punto
5. **No mencionar la transcripción**: nunca decir "tu mensaje de voz decía..." — responder al contenido
6. **Errores de transcripción**: si el texto parece incoherente, pedir clarificación
