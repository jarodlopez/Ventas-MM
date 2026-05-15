import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ─────────────────────────────────────────────
// VALIDACIÓN DE ENTRADA
// ─────────────────────────────────────────────

const ACCIONES_VALIDAS = [
  "responder_objecion",
  "negociar_tasa",
  "cerrar_venta",
  "seguimiento",
  "resumen_crm",
  "mejorar_mensaje",
];

function validateInput(body) {
  const errors = [];
  if (!body || typeof body !== "object") return ["Body inválido"];
  if (!body.accion || !ACCIONES_VALIDAS.includes(body.accion)) {
    errors.push(`Acción inválida. Disponibles: ${ACCIONES_VALIDAS.join(", ")}`);
  }
  if (!body.mensajeCliente || typeof body.mensajeCliente !== "string") {
    errors.push("mensajeCliente es requerido y debe ser string");
  }
  return errors;
}

// ─────────────────────────────────────────────
// SYSTEM PROMPT — Compacto y sin contradicciones
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el copiloto de ventas de MultiMoney. Generas mensajes de WhatsApp para asesores financieros.

ESTILO:
- Conversacional, directo, humano. Sin frases de cajón ni AI-smell.
- PROHIBIDO: "Entiendo perfectamente", "Comprendo tu situación", "Es un placer", "Con gusto".
- Responde primero lo importante. Nunca inventes tasas ni montos.
- Varía apertura, longitud y estructura entre respuestas.
- Tono: útil y seguro, no amable-artificialmente.

LONGITUD: Proporcional al mensaje del cliente. Corto → corto. Largo → puedes extenderte.

FORMATO: Responde SIEMPRE con JSON válido.
Estructura base: { "respuesta": "mensaje aquí" }
Campos opcionales si tienes contexto:
- "tipo_objecion": precio | desconfianza | indecisión | falta_de_tiempo | comparación | ghosting
- "emocion": emoción percibida del cliente
- "tono_sugerido": tono usado
- "estado_cliente": Frío | Tibio | Caliente`;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const renderCtx = (label, value) => (value ? `${label}: ${value}\n` : "");
const renderHistorial = (h) => (h ? `Historial reciente:\n${h}\n` : "");

const instruccionLongitud = `
REGLA: Adapta la longitud de tu respuesta al mensaje del cliente:
- Mensaje corto (<25 chars) → respuesta de 1-2 líneas
- Mensaje medio (25-120 chars) → 2-3 líneas
- Mensaje largo (>120 chars) → hasta 4-5 líneas`;

// ─────────────────────────────────────────────
// PLANTILLAS DE ACCIÓN
// ─────────────────────────────────────────────
const ACCIONES = {
  responder_objecion: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Uso del crédito", ctx.uso)}
${renderHistorial(ctx.historial)}
${instruccionLongitud}

Aborda la preocupación directo y natural. Tono resolutivo. Si aplica, menciona beneficio del producto de forma conversacional. Incluye tipo_objecion y emocion en el JSON.`,

  negociar_tasa: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Tasa ofrecida", ctx.tasa)}
${renderCtx("Uso del crédito", ctx.uso)}
${renderHistorial(ctx.historial)}
${instruccionLongitud}

Maneja objeción de tasa enfocándote en costo de oportunidad y agilidad. No te disculpes por la tasa. Incluye tipo_objecion en el JSON.`,

  cerrar_venta: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}
${renderCtx("Monto", ctx.monto)}
${renderCtx("Plazo", ctx.plazo)}
${renderCtx("Tasa", ctx.tasa)}
${renderCtx("Uso", ctx.uso)}
${renderHistorial(ctx.historial)}
${instruccionLongitud}

Si hay intención clara, genera micro-cierre natural. Si hay fricción, resuélvela primero. Transmite seguridad.`,

  seguimiento: (ctx) => `
Último mensaje / razón de no cierre: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}
${renderCtx("Última interacción", ctx.ultimaInteraccion)}
${renderCtx("Uso", ctx.uso)}
${renderHistorial(ctx.historial)}
${instruccionLongitud}

Recontacto cálido y conciso. Valida si la necesidad sigue vigente sin asumir interés ni sonar desesperado.`,

  resumen_crm: (ctx) => `
Datos: ${ctx.nombre} | ${ctx.monto} | ${ctx.plazo} | ${ctx.tasa} | Uso: ${ctx.uso}
Mensaje clave: "${ctx.input}"

Devuelve un JSON donde "respuesta" sea una nota CRM. Máximo 5 líneas, puro dato factual:
ESTADO: [Venta / Seguimiento / Sin contacto / En validación]
MOTIVO: [razón]
ACCIÓN SIGUIENTE: [qué hacer y cuándo]`,

  mejorar_mensaje: (ctx) => `
Borrador del asesor: "${ctx.input}"
${renderCtx("Nombre del cliente", ctx.nombre)}
${renderCtx("Uso del crédito", ctx.uso)}
${renderHistorial(ctx.historial)}

Transforma este borrador en una versión más natural y profesional para WhatsApp.
- Conserva la intención original. No cambies el significado.
- Hazlo más humano, directo y sin frases de IA.
- Varía apertura y estructura respecto a respuestas previas.
- No inventes tasas, montos ni beneficios no mencionados.`,
};

// ─────────────────────────────────────────────
// CONTEXTO
// ─────────────────────────────────────────────
function buildContext(body) {
  const { accion, mensajeCliente, datosCliente = {} } = body;

  const historialCrudo = datosCliente.historialConversacion;
  const historialProcesado =
    Array.isArray(historialCrudo) && historialCrudo.length > 0
      ? historialCrudo.slice(-4).join("\n")
      : null;

  return {
    accion,
    input: mensajeCliente.trim().slice(0, 800),
    nombre: datosCliente.nombre || "el cliente",
    monto: datosCliente.monto || null,
    tasa: datosCliente.tasa || null,
    plazo: datosCliente.plazo || null,
    uso: datosCliente.uso || null,
    ultimaInteraccion: datosCliente.ultimaInteraccion || null,
    historial: historialProcesado,
  };
}

// ─────────────────────────────────────────────
// POST-PROCESSING
// Más quirúrgico: solo limpia, no rompe frases.
// ─────────────────────────────────────────────
const BANNED_OPENERS = [
  /^perfecto[,.]?\s*/i,
  /^claro que sí[,.]?\s*/i,
  /^sin problema[,.]?\s*/i,
  /^con gusto[,.]?\s*/i,
  /^entiendo tu situación[,.]?\s*/i,
  /^comprendo tu situación[,.]?\s*/i,
];

function cleanResponse(text) {
  if (!text || typeof text !== "string") return "";

  let cleaned = text.trim();

  // Solo elimina si el patrón está al inicio (no rompe frases en medio)
  for (const pattern of BANNED_OPENERS) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, "").trim();
      break; // Solo un pase
    }
  }

  // Capitalizar primera letra si quedó en minúscula
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // Eliminar saltos excesivos sin cortar líneas abruptamente
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned;
}

// ─────────────────────────────────────────────
// PARSEO DEFENSIVO DEL JSON
// Maneja markdown fences y texto plano inesperado.
// ─────────────────────────────────────────────
function safeParseJSON(raw) {
  if (!raw || typeof raw !== "string") {
    return { respuesta: null, parseError: "Respuesta vacía del modelo" };
  }

  // Eliminar markdown fences si el modelo los incluyó
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.respuesta !== "string") {
      return { respuesta: null, parseError: "Campo 'respuesta' ausente o inválido" };
    }
    return parsed;
  } catch (e) {
    // Si falla el parse pero hay texto, úsalo como fallback
    return {
      respuesta: cleaned.length > 0 ? cleaned : null,
      parseError: `JSON inválido: ${e.message}`,
    };
  }
}

// ─────────────────────────────────────────────
// TEMPERATURA POR ACCIÓN
// ─────────────────────────────────────────────
const TEMPERATURE_BY_ACTION = {
  resumen_crm: 0.2,
  cerrar_venta: 0.45,
  negociar_tasa: 0.5,
  responder_objecion: 0.6,
  seguimiento: 0.65,
  mejorar_mensaje: 0.75,
};

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  // Validación temprana
  const validationErrors = validateInput(req.body);
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: validationErrors.join(". ") });
  }

  const ctx = buildContext(req.body);
  const { accion } = ctx;
  const userPrompt = ACCIONES[accion](ctx);
  const temperature = TEMPERATURE_BY_ACTION[accion] ?? 0.55;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: 220, // Subido ligeramente: 180 era demasiado justo para respuestas largas
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content;
    const parsed = safeParseJSON(raw);

    // Fallback si el modelo devolvió algo irrecuperable
    if (!parsed.respuesta) {
      console.warn(`[${requestId}] Parse fallback activado:`, parsed.parseError);
      parsed.respuesta = "Disculpa, ¿podrías darme un poco más de detalle sobre eso?";
    } else {
      parsed.respuesta = cleanResponse(parsed.respuesta);
      // Segunda verificación: si cleanResponse dejó vacío
      if (!parsed.respuesta) {
        parsed.respuesta = "Disculpa, ¿podrías darme un poco más de detalle sobre eso?";
      }
    }

    const tiempo_respuesta_ms = Date.now() - startTime;

    return res.status(200).json({
      respuesta: parsed.respuesta,
      ...(parsed.tipo_objecion && { tipo_objecion: parsed.tipo_objecion }),
      ...(parsed.emocion && { emocion: parsed.emocion }),
      ...(parsed.tono_sugerido && { tono_sugerido: parsed.tono_sugerido }),
      ...(parsed.estado_cliente && { estado_cliente: parsed.estado_cliente }),
      _meta: {
        accion,
        request_id: requestId,
        tiempo_respuesta_ms,
        tokens: completion.usage?.total_tokens,
        modelo: completion.model,
        ...(parsed.parseError && { parse_warning: parsed.parseError }),
      },
    });
  } catch (err) {
    // Log estructurado con contexto suficiente para depurar en producción
    console.error(JSON.stringify({
      level: "error",
      request_id: requestId,
      accion,
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString(),
    }));

    return res.status(500).json({
      error: "Error generando respuesta. Intenta de nuevo.",
      request_id: requestId, // Para correlacionar con logs
      ...(process.env.NODE_ENV === "development" && { detalle: err.message }),
    });
  }
}
