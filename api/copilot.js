import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ─────────────────────────────────────────────
// SYSTEM PROMPT — Single source of truth.
// Diseñado para reducir el "AI Smell", sonar como top performer
// y manejar la estructura JSON requerida.
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el copiloto de ventas de MultiMoney. Apoyas a asesores financieros con respuestas listas para enviar por WhatsApp a clientes reales.

ESTILO COMERCIAL (TOP PERFORMER)
El cliente debe sentir que habla con un experto humano que entiende su situación.
- Conversacional, directo y profesional. Humano sin sonar informal.
- Cero "AI Smell": PROHIBIDO usar frases de cajón como "Entiendo perfectamente", "Comprendo tu situación", "Es un placer ayudarte".
- Ve al grano. Responde primero lo importante.
- Nunca robótico, insistente, desesperado ni agresivo.
- Nunca inventes tasas, montos ni beneficios no confirmados.
- Máximo 4 líneas. Sin viñetas. Sin emojis. Sin saludos ni despedidas.

ACTITUD (ASESOR SENIOR):
Tu objetivo NO es sonar amable.
Tu objetivo es sonar útil, claro y seguro.

PATRONES A EVITAR:
- No inicies siempre validando emociones
- No uses estructuras repetidas
- No uses frases típicas de IA
- Evita responder como soporte al cliente
- Evita exceso de empatía artificial
- Evita frases demasiado perfectas o estructuradas
- Algunas respuestas pueden ir directo al punto sin validación previa
- A veces una respuesta corta y segura genera más confianza que una explicación larga

CADENCIA HUMANA:
No todas las respuestas deben tener estructura perfecta.
A veces una frase corta y natural funciona mejor.
Evita sonar como copy publicitario o discurso preparado.

VARIABILIDAD:
Cada respuesta debe variar naturalmente en:
- apertura
- longitud
- ritmo
- estructura
- forma de explicar valor
- manera de invitar a continuar

No sigas siempre la misma fórmula conversacional.

NATURALIDAD HUMANA:
Las respuestas no deben sentirse demasiado editadas.
A veces es mejor sonar natural que perfectamente estructurado.
Prioriza conversaciones reales de WhatsApp sobre copywriting corporativo.

ESTRATEGIA
- Adapta el tono: Si duda, da calma. Si hay interés, guía con seguridad. Si hay confusión, simplifica.
- No toda respuesta debe cerrar la venta; a veces el avance es generar confianza.
- Explica valor solo si aporta contexto útil basado en el uso del crédito.

FORMATO DE RESPUESTA
RESPONDE SIEMPRE con JSON válido.
Estructura base: { "respuesta": "tu mensaje aquí" }

Detección Avanzada (Recomendado para UI):
Para dar insights visuales al asesor, agrega estos campos opcionales si tienes contexto:
- "tipo_objecion": (precio | desconfianza | indecisión | falta de tiempo | comparación | ghosting)
- "emocion": emoción percibida (ej. frustración, duda, curiosidad)
- "tono_sugerido": el tono que usaste (ej. Profesional, Directo, Seguro, Empático)
- "estado_cliente": temperatura de venta (Frío, Tibio, Caliente)
`;

// ─────────────────────────────────────────────
// HELPERS DE RENDERIZADO PARA PROMPTS
// Evitan inyectar contexto vacío y ahorran tokens.
// ─────────────────────────────────────────────
const renderContexto = (label, value) => value ? `${label}: ${value}\n` : "";
const renderHistorial = (historial) => historial ? `Historial reciente:\n${historial}\n` : "";

// ─────────────────────────────────────────────
// PLANTILLAS DE ACCIÓN
// Optimizadas para bajo consumo de tokens y mayor naturalidad.
// ─────────────────────────────────────────────
const ACCIONES = {

  responder_objecion: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderContexto("Uso del crédito", ctx.uso)}
${renderContexto("Longitud del mensaje del cliente", ctx.longitudCliente)}
${renderHistorial(ctx.historial)}

Instrucción: Aborda la preocupación de forma directa y natural, sin ponerte a la defensiva. Usa un tono resolutivo. Si aplica, apóyate en el beneficio del producto, pero hazlo conversacional. No presiones el cierre si aún hay dudas. Evalúa la objeción para incluir 'tipo_objecion' y 'emocion' en el JSON.
- Si el cliente escribe corto, responde más corto y natural
- Si el cliente desarrolla más contexto, puedes profundizar un poco más
- Mantén proporción natural entre lo que escribe el cliente y lo que responde el asesor`,

  negociar_tasa: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderContexto("Tasa ofrecida", ctx.tasa)}
${renderContexto("Uso del crédito", ctx.uso)}
${renderContexto("Longitud del mensaje del cliente", ctx.longitudCliente)}
${renderHistorial(ctx.historial)}

Instrucción: Maneja la objeción de tasa enfocándote en el costo de oportunidad y agilidad (proceso digital, liquidez hoy, sin penalización por pago anticipado). Suena seguro, no te disculpes por la tasa ni compares agresivamente con bancos. Haz que la liquidez inmediata suene como el verdadero beneficio. Evalúa incluir 'tipo_objecion'.
- Si el cliente escribe corto, responde más corto y natural
- Si el cliente desarrolla más contexto, puedes profundizar un poco más
- Mantén proporción natural entre lo que escribe el cliente y lo que responde el asesor`,

  cerrar_venta: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderContexto("Nombre", ctx.nombre)}
${renderContexto("Monto", ctx.monto)}
${renderContexto("Plazo", ctx.plazo)}
${renderContexto("Tasa", ctx.tasa)}
${renderContexto("Uso", ctx.uso)}
${renderContexto("Longitud del mensaje del cliente", ctx.longitudCliente)}
${renderHistorial(ctx.historial)}

Instrucción: Si hay intención clara, genera un micro-cierre natural (ej. confirmar link biométrico, INE a la mano, CLABE). Si hay fricción, resuélvela primero. Transmite seguridad, como un asesor que sabe que el proceso es ágil y fácil.
- Si el cliente escribe corto, responde más corto y natural
- Si el cliente desarrolla más contexto, puedes profundizar un poco más
- Mantén proporción natural entre lo que escribe el cliente y lo que responde el asesor`,

  seguimiento: (ctx) => `
Razón por la que no cerró/Último mensaje: "${ctx.input}"
${renderContexto("Nombre", ctx.nombre)}
${renderContexto("Última interacción", ctx.ultimaInteraccion)}
${renderContexto("Uso", ctx.uso)}
${renderContexto("Longitud del mensaje del cliente", ctx.longitudCliente)}
${renderHistorial(ctx.historial)}

Instrucción: Escribe un recontacto cálido y conciso. Ve directo al punto. Valida si la necesidad sigue vigente sin asumir interés ni sonar desesperado ("¿sigues interesado?"). Mantén la puerta abierta con baja fricción.
- Si el cliente escribe corto, responde más corto y natural
- Si el cliente desarrolla más contexto, puedes profundizar un poco más
- Mantén proporción natural entre lo que escribe el cliente y lo que responde el asesor`,

  resumen_crm: (ctx) => `
Datos: ${ctx.nombre} | ${ctx.monto} | ${ctx.plazo} | ${ctx.tasa} | Uso: ${ctx.uso}
Mensaje clave: "${ctx.input}"

Instrucción: Devuelve un JSON donde "respuesta" sea una nota de CRM estandarizada.
Formato de la nota (máximo 5 líneas, puro dato factual):
ESTADO: [Venta / Seguimiento / Sin contacto / En validación]
MOTIVO: [razón]
ACCIÓN SIGUIENTE: [qué hacer y cuándo]`,

  mejorar_mensaje: (ctx) => `
Borrador original del asesor:
"${ctx.input}"

Nombre del cliente: ${ctx.nombre}
Uso del crédito: ${ctx.uso}
Historial reciente:
${ctx.historial || "No disponible"}

Tu tarea NO es crear un mensaje nuevo.
Tu tarea es transformar este borrador en una versión más natural, persuasiva y profesional para WhatsApp.

REGLAS:
- Conserva la intención original del asesor
- Mantén el mensaje breve y fácil de leer
- Usa solo el espacio necesario para sonar natural y resolver correctamente el punto
- Evita sonar robótico, genérico o corporativo
- NO uses frases repetitivas típicas de IA
- NO empieces siempre validando emocionalmente
- NO uses siempre "entiendo", "comprendo", "perfecto", "claro"
- Varía estructuras, openings y ritmo entre respuestas
- El mensaje debe sentirse escrito por un asesor humano con experiencia real en ventas digitales

ESTILO DE UN ASESOR TOP:
- Habla simple y directo
- Genera confianza sin presión
- Responde primero lo importante
- Explica beneficios solo si ayudan a avanzar
- Usa micro cierres naturales, no agresivos
- Evita exceso de entusiasmo o formalidad
- Prioriza claridad antes que técnicas de venta

ADAPTACIÓN:
- Si el cliente está frío → prioriza confianza
- Si está confundido → simplifica
- Si tiene interés → guía naturalmente
- Si tiene objeciones → responde sin ponerte defensivo
- Si responde corto → responde más corto
- Si necesita claridad → puedes extenderte un poco más

SI EL BORRADOR:
- suena agresivo → suavízalo
- suena frío → hazlo más humano
- suena desesperado → dale seguridad
- suena largo → simplifícalo
- ya está bien → mejora solo pequeños detalles

DIVERSIFICADOR DE APERTURAS:
Evita empezar repetidamente con:
- "Claro"
- "Entiendo"
- "Perfecto"
- "Comprendo"
- "Sin problema"

Diversifica openings de forma natural.

EJEMPLOS DE ESTILO:

MAL:
"Entiendo su preocupación, pero recuerde que..."

MEJOR:
"Y tiene sentido revisarlo bien. La ventaja es que todo el proceso es digital y el dinero puede quedar listo hoy mismo si decide avanzar."

MAL:
"¿Desea continuar con el proceso?"

MEJOR:
"Si le hace sentido, puedo ayudarle a dejarlo listo de una vez."

MAL:
"Perfecto, quedo atento."

MEJOR:
"Si gusta, revisamos eso juntos y vemos qué opción le acomoda mejor."

MAL:
"Comprendo su situación."

MEJOR:
"Claro, revisémoslo bien para que tome una decisión con tranquilidad."

IMPORTANTE:
- No inventes tasas, montos ni beneficios no mencionados
- No cambies completamente el significado del mensaje
- Debe sentirse como la mejor versión posible del mismo asesor
- Prioriza naturalidad humana sobre lenguaje corporativo
- Evita estructuras repetitivas entre respuestas
- Las respuestas deben sentirse reales en WhatsApp
`,
};

// ─────────────────────────────────────────────
// HELPERS DE PROCESAMIENTO Y SANITIZACIÓN
// ─────────────────────────────────────────────

/**
 * Detecta patrones repetitivos y frases muertas que huelen a IA.
 */
function detectRepetition(text) {
  const bannedPatterns = [
    "entiendo tu situación",
    "comprendo tu situación",
    "perfecto",
    "claro que sí",
    "sin problema",
    "con gusto",
    "permíteme ayudarte",
    "estoy aquí para ayudarte",
  ];

  return bannedPatterns.some(pattern =>
    text.toLowerCase().includes(pattern)
  );
}

/**
 * Limpia y formatea la respuesta final para garantizar
 * que se vea bien en WhatsApp y limite su longitud.
 * Mantiene 5 líneas por defecto para sonar natural, 6 para CRM.
 */
function sanitizeResponse(text, ctx) {
  if (!text || typeof text !== "string") return "";
  const maxLines = ctx?.accion === "resumen_crm" ? 6 : 5;
  
  return text
    .trim()
    .replace(/\n{3,}/g, "\n\n") // Elimina saltos de línea excesivos
    .split("\n")
    .slice(0, maxLines)         // Límite condicional de líneas
    .join("\n");
}

/**
 * Centraliza la extracción, validación y sanitización de datos.
 * Incluye soporte para memoria conversacional y longitud de mensaje.
 */
function buildContext(body) {
  const { accion, mensajeCliente, datosCliente = {} } = body;
  
  const historialCrudo = datosCliente.historialConversacion;
  const historialProcesado = Array.isArray(historialCrudo) && historialCrudo.length > 0
    ? historialCrudo.slice(-4).join("\n")
    : null;

  const longitudCliente = (mensajeCliente || "").length < 25
    ? "corto"
    : (mensajeCliente || "").length < 120
      ? "medio"
      : "largo";

  return {
    accion,
    input: (mensajeCliente || "").slice(0, 800),
    nombre: datosCliente.nombre || "el cliente",
    monto: datosCliente.monto || null,
    tasa: datosCliente.tasa || null,
    plazo: datosCliente.plazo || null,
    uso: datosCliente.uso || null,
    ultimaInteraccion: datosCliente.ultimaInteraccion || null,
    historial: historialProcesado,
    longitudCliente,
  };
}

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL (Serverless)
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  const startTime = Date.now();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const { accion } = req.body || {};

  if (!accion || !ACCIONES[accion]) {
    return res.status(400).json({
      error: `Acción inválida. Acciones disponibles: ${Object.keys(ACCIONES).join(", ")}`,
    });
  }

  const ctx = buildContext(req.body);
  const userPrompt = ACCIONES[accion](ctx);

  // Temperatura dinámica: precisión vs. creatividad donde importa
  const TEMPERATURE_BY_ACTION = {
    resumen_crm: 0.2,
    cerrar_venta: 0.45,
    negociar_tasa: 0.5,
    responder_objecion: 0.6,
    seguimiento: 0.65,
    mejorar_mensaje: 0.75,
  };
  
  const temperature = TEMPERATURE_BY_ACTION[accion] ?? 0.55;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature,           // Dinámico basado en la acción
      max_tokens: 180,       // Consumo optimizado manteniendo calidad
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0].message.content;
    
    // Post-processing defensivo
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { respuesta: raw };
    }

    // Regeneración ligera (Cleanup sin llamada extra al modelo)
    if (detectRepetition(parsed.respuesta)) {
      parsed.respuesta = parsed.respuesta
        .replace(/perfecto[,.]?\s*/gi, "")
        .replace(/claro que sí[,.]?\s*/gi, "")
        .replace(/sin problema[,.]?\s*/gi, "")
        .replace(/con gusto[,.]?\s*/gi, "")
        .trim();
        
      // Capitalizar la primera letra si quedó en minúscula tras el trim
      if (parsed.respuesta.length > 0) {
        parsed.respuesta = parsed.respuesta.charAt(0).toUpperCase() + parsed.respuesta.slice(1);
      }
    }

    // Sanitización final adaptativa
    parsed.respuesta = sanitizeResponse(parsed.respuesta, ctx);

    // Fallback de seguridad
    if (!parsed.respuesta) {
      parsed.respuesta = "Disculpa, ¿podrías darme un poco más de detalle sobre eso?";
    }

    const tiempo_respuesta_ms = Date.now() - startTime;

    // Payload de respuesta enriquecido (Ideal para Demo Enterprise)
    const responsePayload = {
      respuesta: parsed.respuesta,
      // Metadata útil y badges visuales para UI
      ...(parsed.tipo_objecion && { tipo_objecion: parsed.tipo_objecion }),
      ...(parsed.emocion && { emocion: parsed.emocion }),
      ...(parsed.tono_sugerido && { tono_sugerido: parsed.tono_sugerido }),
      ...(parsed.estado_cliente && { estado_cliente: parsed.estado_cliente }),
      _meta: {
        accion,
        tiempo_respuesta_ms,
        tokens: completion.usage?.total_tokens,
        modelo: completion.model,
      },
    };

    return res.status(200).json(responsePayload);

  } catch (err) {
    console.error("[MultiMoney Copilot] Error:", err);
    return res.status(500).json({
      error: "Error generando respuesta. Intenta de nuevo.",
      detalle: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}

