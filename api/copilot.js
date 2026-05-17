import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ─────────────────────────────────────────────
// BASE DE CONOCIMIENTO
// ─────────────────────────────────────────────
const CATALOGO_PRODUCTOS = `
━━━ CATÁLOGO DE PRODUCTOS ━━━
- Montos: Desde $10,000 hasta $400,000 MXN.
- Tiempos: Depósito en máximo 2 horas, proceso 100% online.
- Beneficio estrella: Sin penalización por pago anticipado.
- Ampliación: Disponible a partir del 3er pago puntual.
`;

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
// SYSTEM PROMPT OPTIMIZADO (Con refinamiento comercial de micro-cierres)
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu objetivo es llevar a prospectos hacia el cierre de créditos personales por WhatsApp. 
Eres un asesor financiero senior de MultiMoney. Te comunicas como un asesor comercial real: directo, ágil, seguro y profesional.

${CATALOGO_PRODUCTOS}

━━━ TU ESTILO Y TONO DE WHATSAPP ━━━
- Entras directo al punto (asume que ya saludaste antes).
- Usas lenguaje conciso, propio de un chat rápido. Evitas la informalidad excesiva o el tono callejero, pero no suenas corporativo.
- CALIBRACIÓN DE RITMO: Adapta tu energía, longitud y nivel de detalle según el estilo del cliente y el historial (ej. responde corto a clientes cortos, explica más a clientes analíticos).
- Evitas por completo formalismos de IA o call center ("Con gusto", "Comprendo tu situación", "Es un placer", "Claro que sí", "Entiendo perfectamente").
- Mantienes el avance natural de la conversación usando micro-cierres breves, naturales y orientados al siguiente paso. No te despides.

━━━ METODOLOGÍA REA (Reconoce, Empatiza, Asegura) ━━━
Para las objeciones, usas REA de forma invisible y fluida en UN SOLO MENSAJE CONVERSACIONAL (no en formato de lista):
- Reconoce: Valida el punto del cliente sutilmente sin repetir textualmente lo que dijo.
- Empatiza: Demuestra entendimiento con empatía comercial, no terapéutica ("Es normal revisarlo", "Tiene sentido compararlo", "Muchos clientes hacen esa validación").
- Asegura: Conecta el beneficio del crédito (rápido, sin penalización) con su necesidad.

━━━ ARGUMENTOS POR USO ━━━
- Negocio: Capital hoy = utilidades mañana.
- Gastos médicos: Depósito en 2 horas, urgencia resuelta.
- Vacaciones/Auto/Familia: Cuotas cómodas, no afecta liquidez.
- Consolidación: Un solo pago ordenado, menor estrés.
- Sin uso/Imprevisto: Colchón financiero, mejor tenerlo listo.

━━━ EJEMPLOS DE RESPUESTA (FEW-SHOT) ━━━
[MAL - Tono IA]: "Comprendo tu situación, Juan. Es completamente normal que la tasa te parezca alta. Sin embargo, te aseguro que nuestro crédito te beneficia porque no hay penalizaciones. ¿Deseas continuar?"
[BIEN - Tono MultiMoney]: "Es normal que revises la tasa, Juan. La ventaja aquí es que tienes el dinero hoy mismo sin papeleo y si liquidas antes no hay penalización. ¿Hacemos el cálculo de cómo te quedarían las cuotas?"

[MAL - Tono IA]: "Hola de nuevo. Entiendo perfectamente que lo quieras pensar. Quedo a tu disposición por si tienes dudas. Saludos."
[BIEN - Tono MultiMoney]: "Tómate el tiempo de revisarlo bien. Solo recuerda que la pre-aprobación que revisamos hoy está lista para fondearse en 2 horas. ¿A qué hora te escribo mañana para retomarlo?"`;

// ─────────────────────────────────────────────
// HELPERS 
// ─────────────────────────────────────────────
const renderCtx = (label, value) => (value ? `${label}: ${value}\n` : "");
const renderHistorial = (h) => (h ? `Historial reciente:\n${h}\n` : "");

// ─────────────────────────────────────────────
// PLANTILLAS DE ACCIÓN 
// ─────────────────────────────────────────────
const ACCIONES = {
  responder_objecion: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}
${renderCtx("Uso del crédito", ctx.uso)}
${renderCtx("Monto aprobado", ctx.monto)}
${renderCtx("Tasa", ctx.tasa)}
${renderHistorial(ctx.historial)}

Objetivo: Aplica la técnica REA de forma conversacional e invisible en respuesta a su objeción. Conecta el beneficio con su uso específico. Si tienes su nombre, úsalo una vez con naturalidad. Cierra con una pregunta corta para avanzar.`,

  negociar_tasa: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}
${renderCtx("Tasa ofrecida", ctx.tasa)}
${renderCtx("Uso", ctx.uso)}
${renderHistorial(ctx.historial)}

Objetivo: Maneja la objeción de tasa usando REA. Recuerda al cliente que ya está pre-aprobado HOY (sin burocracia de bancos) y resalta que no hay penalización por pago anticipado. Termina con una pregunta concreta (ej. calcular cuotas o pedir el siguiente requisito).`,

  cerrar_venta: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}
${renderCtx("Monto", ctx.monto)}
${renderHistorial(ctx.historial)}

Objetivo: El cliente muestra intención de avanzar. 
Si hay intención clara → haz un micro-cierre natural pidiendo el siguiente requisito (INE, CLABE, referencias). 
Si hay fricción → resuélvela transmitiendo seguridad (depósito en 2 horas). Sé directo.`,

  seguimiento: (ctx) => `
Último mensaje / razón de no cierre: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}
${renderCtx("Última interacción", ctx.ultimaInteraccion)}
${renderHistorial(ctx.historial)}

Objetivo: Retoma el punto exacto donde quedó la conversación. Sé casual, no suenes desesperado ni inicies como si fuera la primera vez que hablan.`,

  resumen_crm: (ctx) => `
Datos del cliente: ${ctx.nombre} | Monto: ${ctx.monto} | Tasa: ${ctx.tasa} | Uso: ${ctx.uso}
Mensaje / situación clave: "${ctx.input}"

Objetivo: Devuelve una nota CRM. Solo datos factuales, sin subjetividad.`,

  mejorar_mensaje: (ctx) => `
Borrador del asesor:
"${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}
${renderHistorial(ctx.historial)}

Objetivo: Convierte este borrador en la versión óptima para WhatsApp. Elimina formalismos corporativos, saludos o despedidas. Hazlo directo, empático y comercial.`,
};

// ─────────────────────────────────────────────
// CONTEXTO
// ─────────────────────────────────────────────
function buildContext(body) {
  const { accion, mensajeCliente, datosCliente = {} } = body;
  const historialCrudo = datosCliente.historialConversacion;
  const historialProcesado = Array.isArray(historialCrudo) && historialCrudo.length > 0
      ? historialCrudo.slice(-4).join("\n") : null;

  return {
    accion,
    input: mensajeCliente.trim().slice(0, 800),
    nombre: datosCliente.nombre || null,
    monto: datosCliente.monto || null,
    tasa: datosCliente.tasa || null,
    plazo: datosCliente.plazo || null,
    uso: datosCliente.uso || null,
    ultimaInteraccion: datosCliente.ultimaInteraccion || null,
    historial: historialProcesado,
  };
}

// ─────────────────────────────────────────────
// POST-PROCESSING (Guardrails intactos)
// ─────────────────────────────────────────────
const BANNED_OPENERS = [
  /^hola[,!.]?\s*/i, /^buenos\s+días[,!.]?\s*/i, /^buenas\s+tardes[,!.]?\s*/i, /^buenas\s+noches[,!.]?\s*/i,
  /^buen\s+día[,!.]?\s*/i, /^qué\s+tal[,!.]?\s*/i, /^perfecto[,.]?\s*/i, /^claro que sí[,.]?\s*/i,
  /^sin problema[,.]?\s*/i, /^con gusto[,.]?\s*/i, /^con mucho gusto[,.]?\s*/i, /^entiendo tu situación[,.]?\s*/i,
  /^comprendo tu situación[,.]?\s*/i, /^por supuesto[,.]?\s*/i, /^encantado[,.]?\s*/i,
];

function cleanResponse(text) {
  if (!text || typeof text !== "string") return "";
  let cleaned = text.trim();
  for (const pattern of BANNED_OPENERS) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, "").trim();
      break;
    }
  }
  if (cleaned.length > 0) cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

// ─────────────────────────────────────────────
// TEMPERATURA POR ACCIÓN
// ─────────────────────────────────────────────
const TEMPERATURE_BY_ACTION = {
  resumen_crm: 0.2, 
  cerrar_venta: 0.45, 
  negociar_tasa: 0.6,
  responder_objecion: 0.65,
  seguimiento: 0.65, 
  mejorar_mensaje: 0.75,
};

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL (Schema y compatibilidad garantizados)
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const validationErrors = validateInput(req.body);
  if (validationErrors.length > 0) return res.status(400).json({ error: validationErrors.join(". ") });

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
      max_tokens: 300, 
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "copilot_response",
          strict: true,
          schema: {
            type: "object",
            properties: {
              respuesta: { type: "string" },
              tipo_objecion: { 
                type: ["string", "null"], 
                enum: ["precio", "desconfianza", "indecision", "falta_de_tiempo", "comparacion", "ghosting", null] 
              },
              emocion: { type: ["string", "null"] },
              tono_sugerido: { type: ["string", "null"] },
              estado_cliente: { type: ["string", "null"], enum: ["Frío", "Tibio", "Caliente", null] }
            },
            required: ["respuesta", "tipo_objecion", "emocion", "tono_sugerido", "estado_cliente"],
            additionalProperties: false
          }
        }
      }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    
    parsed.respuesta = cleanResponse(parsed.respuesta) || "Disculpa, ¿podrías darme un poco más de detalle sobre eso?";

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
      },
    });

  } catch (err) {
    console.error(`[${requestId}] Error:`, err.message);
    return res.status(500).json({
      error: "Error generando respuesta. Intenta de nuevo.",
      request_id: requestId
    });
  }
}

