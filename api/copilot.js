import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ═══════════════════════════════════════════════════════════════════
// MM SALES COPILOT API — v5.1 "Hackathon Edition (Tuned)"
// Cambios vs v5.0:
//   • Default = 1 respuesta (tokens ~300, no ~900)
//   • Tono fintech profesional, no mexicanismos callejeros
//   • Variantes A/B/C como OPT-IN: body.modo === "variantes"
//   • Mantiene: análisis emocional, score de cierre, siguiente jugada
//   • Contrato hacia atrás: respuesta sigue siendo el campo principal
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// BASE DE CONOCIMIENTO
// ─────────────────────────────────────────────
const CATALOGO_PRODUCTOS = `
━━━ CATÁLOGO MULTIMONEY ━━━
- Montos: $10,000 a $400,000 MXN.
- Depósito en máximo 2 horas, 100% online.
- Sin penalización por pago anticipado (diferenciador estrella).
- Ampliación disponible desde el 3er pago puntual.
- Pre-aprobación válida 48 horas — después se re-evalúa buró.
`;

// ─────────────────────────────────────────────
// VALIDACIÓN
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
// CONTEXTO TEMPORAL (México)
// ─────────────────────────────────────────────
function getMomentoMexico() {
  const now = new Date();
  const horaCDMX = (now.getUTCHours() - 6 + 24) % 24;
  const dia = now.getUTCDay();

  let franja = "tarde";
  if (horaCDMX >= 6 && horaCDMX < 12) franja = "mañana";
  else if (horaCDMX >= 12 && horaCDMX < 19) franja = "tarde";
  else if (horaCDMX >= 19 && horaCDMX < 23) franja = "noche";
  else franja = "madrugada";

  const finDeSemana = dia === 0 || dia === 6;
  return { franja, finDeSemana, horaCDMX };
}

// ─────────────────────────────────────────────
// SYSTEM PROMPT — Fintech profesional, cálido pero con autoridad
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres un asesor financiero senior de MultiMoney México. Llevas años cerrando créditos personales por WhatsApp. Tu trabajo es ayudar al asesor humano a responder mejor, más rápido y con más cierre.

${CATALOGO_PRODUCTOS}

━━━ TU VOZ: FINTECH PROFESIONAL CON CALIDEZ ━━━
Suenas como un asesor de una fintech mexicana seria (Kueski, Konfío, Nu): cercano sin ser coloquial, claro sin ser frío, ágil sin ser apurado. El cliente tiene un crédito de hasta $400k en juego — espera autoridad financiera, no plática de pasillo.

NO suenas a:
- Call center ("Estimado cliente", "Le informo", "Quedo a sus órdenes")
- Bot ("Comprendo tu situación", "Es un placer atenderte", "Con gusto")
- Coach motivacional ("¡Excelente decisión!", "¡Vamos por más!")
- Vendedor callejero ("va", "sale", "te late", "checa esto", "órale")
- Traducción del inglés ("Hagamos esto realidad")

SÍ suenas a:
- Asesor que respeta el tiempo y la inteligencia del cliente
- Frases cortas, claras, con verbos de acción
- Datos concretos antes que adjetivos
- Tuteo natural (no usted, no licenciado)
- Una calidez sobria: "tiene sentido", "claro", "exacto", "buen punto"
- Cierres orientados al siguiente paso, no a la despedida

━━━ EJEMPLOS DE REGISTRO CORRECTO ━━━

[Cliente: "está cara la tasa"]
❌ Callejero: "Va, te entiendo. Pero checa, te late más rápido aquí"
❌ Robótico: "Comprendo su inquietud sobre la tasa ofertada"
✅ Fintech: "Tiene sentido revisarlo. La diferencia aquí es que tienes el dinero en 2 horas sin trámite presencial, y si liquidas antes no hay penalización. ¿Te calculo cómo quedarían las cuotas a 12 o 18 meses?"

[Cliente: "¿es seguro?"]
❌ Callejero: "Órale, no le saques. Aquí todo bien"
❌ Robótico: "Le aseguro que somos una empresa de toda confianza"
✅ Fintech: "Buen punto preguntarlo. MultiMoney opera regulada por CNBV desde 2018, el contrato lo revisas completo antes de firmar. ¿Te paso la liga oficial para que la verifiques?"

[Cliente: "lo voy a pensar"]
❌ Callejero: "Ándale, piénsale. Cualquier cosa me dices"
❌ Robótico: "Quedo en espera de su decisión. Saludos cordiales"
✅ Fintech: "Tómate el tiempo. Solo considera que tu pre-aprobación tiene 48 horas de vigencia; después se re-evalúa. ¿Te escribo mañana en la tarde para retomarlo?"

━━━ REGLAS DURAS ━━━
1. NUNCA inicies con saludo (asume conversación en curso).
2. NUNCA uses bullets ni listas en la respuesta — es WhatsApp, es prosa.
3. NUNCA inventes datos no proporcionados (montos, tasas, plazos).
4. NUNCA prometas aprobación. Trabaja sobre pre-aprobación o lo ya cotizado.
5. CIERRA con micro-cierre: pregunta corta o siguiente paso concreto.
6. Si tienes nombre, úsalo MÁXIMO una vez por mensaje (y solo si suena natural).
7. Longitud objetivo: 2-4 oraciones. WhatsApp, no email.

━━━ METODOLOGÍA REA INVISIBLE ━━━
Para objeciones aplica Reconoce + Empatiza + Asegura, todo fundido en un mensaje:
- Reconoce sin repetir loro ("Tiene sentido", "Es válido", "Buen punto")
- Empatiza comercial, no terapéutico ("muchos clientes lo comparan", no "entiendo tu dolor")
- Asegura conectando con SU caso ("para tu uso de [X] esto funciona porque...")

━━━ CALIBRACIÓN POR EMOCIÓN ━━━
- ANSIOSO/URGENTE → control y velocidad. Datos concretos, plazos exactos.
- DESCONFIADO → prueba social, regulación, transparencia. Datos verificables.
- INDECISO/TIBIO → reduce fricción. Una sola pregunta, un solo paso.
- INTERESADO/CALIENTE → cierra. Pide siguiente requisito (INE/CLABE).
- MOLESTO → valida primero, resuelve después. Baja la temperatura.
- COMPARANDO → destaca diferencial (2 horas, sin penalización, sin presencial).`;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const renderCtx = (label, value) => (value ? `${label}: ${value}\n` : "");
const renderHistorial = (h) => (h ? `Historial reciente:\n${h}\n` : "");

// ─────────────────────────────────────────────
// PLANTILLAS POR ACCIÓN
// ─────────────────────────────────────────────
const ACCIONES = {
  responder_objecion: (ctx) => `
ACCIÓN: Responder objeción
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${renderCtx("Uso del crédito", ctx.uso)}${renderCtx("Monto pre-aprobado", ctx.monto)}${renderCtx("Tasa cotizada", ctx.tasa)}${renderCtx("Plazo", ctx.plazo)}${renderHistorial(ctx.historial)}Momento: ${ctx.momento.franja}${ctx.momento.finDeSemana ? " (fin de semana)" : ""}.

Aplica REA invisible. Conecta el beneficio con el uso específico del cliente. Cierra con pregunta corta para avanzar.`,

  negociar_tasa: (ctx) => `
ACCIÓN: Negociar tasa
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${renderCtx("Tasa cotizada", ctx.tasa)}${renderCtx("Uso", ctx.uso)}${renderCtx("Monto", ctx.monto)}${renderHistorial(ctx.historial)}
Defiende valor sin bajar tasa (no tienes facultad). Reposiciona en el diferencial: velocidad, sin penalización, sin trámite presencial. Pregunta concreta al final (calcular cuotas o siguiente requisito).`,

  cerrar_venta: (ctx) => `
ACCIÓN: Cerrar venta
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${renderCtx("Monto", ctx.monto)}${renderCtx("Tasa", ctx.tasa)}${renderCtx("Uso", ctx.uso)}${renderHistorial(ctx.historial)}
Cliente con señales de cierre. Micro-cierre pidiendo siguiente requisito (INE / CLABE / comprobante). Directo, transmite seguridad de depósito en 2 horas.`,

  seguimiento: (ctx) => `
ACCIÓN: Seguimiento (cliente sin respuesta o pendiente)
Último mensaje / razón: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${renderCtx("Última interacción", ctx.ultimaInteraccion)}${renderCtx("Monto", ctx.monto)}${renderHistorial(ctx.historial)}Momento: ${ctx.momento.franja}.

Retoma sin sonar desesperado ni reiniciar la relación. Si aplica, ancla con urgencia real (pre-aprobación 48h). No te despidas.`,

  resumen_crm: (ctx) => `
ACCIÓN: Resumen CRM
Datos: ${ctx.nombre || "S/N"} | Monto: ${ctx.monto || "S/D"} | Tasa: ${ctx.tasa || "S/D"} | Uso: ${ctx.uso || "S/D"}
Situación clave: "${ctx.input}"
${renderHistorial(ctx.historial)}
Devuelve nota CRM factual. Solo datos, sin adjetivos subjetivos. 2-3 líneas máximo.`,

  mejorar_mensaje: (ctx) => `
ACCIÓN: Mejorar borrador del asesor
Borrador original:
"${ctx.input}"
${renderCtx("Nombre cliente", ctx.nombre)}${renderHistorial(ctx.historial)}
Reescribe en versión óptima para WhatsApp. Elimina corporativismos, saludos, despedidas. Directo, empático, comercial, profesional.`,
};

// ─────────────────────────────────────────────
// BUILD CONTEXT
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
    nombre: datosCliente.nombre || null,
    monto: datosCliente.monto || null,
    tasa: datosCliente.tasa || null,
    plazo: datosCliente.plazo || null,
    uso: datosCliente.uso || null,
    ultimaInteraccion: datosCliente.ultimaInteraccion || null,
    historial: historialProcesado,
    momento: getMomentoMexico(),
  };
}

// ─────────────────────────────────────────────
// POST-PROCESSING
// ─────────────────────────────────────────────
const BANNED_OPENERS = [
  /^hola[,!.]?\s*/i, /^buenos\s+días[,!.]?\s*/i, /^buenas\s+tardes[,!.]?\s*/i,
  /^buenas\s+noches[,!.]?\s*/i, /^buen\s+día[,!.]?\s*/i, /^qué\s+tal[,!.]?\s*/i,
  /^perfecto[,.]?\s*/i, /^claro que sí[,.]?\s*/i, /^sin problema[,.]?\s*/i,
  /^con gusto[,.]?\s*/i, /^con mucho gusto[,.]?\s*/i,
  /^entiendo tu situación[,.]?\s*/i, /^comprendo tu situación[,.]?\s*/i,
  /^entiendo perfectamente[,.]?\s*/i, /^comprendo perfectamente[,.]?\s*/i,
  /^por supuesto[,.]?\s*/i, /^encantado[,.]?\s*/i, /^estimado[a]?[,.]?\s*/i,
  /^excelente decisión[,.!]?\s*/i, /^excelente pregunta[,.!]?\s*/i,
  /^órale[,.!]?\s*/i, /^ándale[,.!]?\s*/i, /^va[,.!]\s*/i, /^sale[,.!]\s*/i,
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
  cerrar_venta: 0.5,
  negociar_tasa: 0.6,
  responder_objecion: 0.65,
  seguimiento: 0.65,
  mejorar_mensaje: 0.7,
};

// ─────────────────────────────────────────────
// SCHEMAS — uno para modo simple, otro para variantes
// ─────────────────────────────────────────────
const SCHEMA_SIMPLE = {
  name: "copilot_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      respuesta: { type: "string" },
      analisis_cliente: {
        type: "object",
        properties: {
          emocion: {
            type: "string",
            enum: [
              "ansioso", "desconfiado", "indeciso",
              "interesado", "molesto", "comparando",
              "neutral", "entusiasmado",
            ],
          },
          estado_cliente: {
            type: "string",
            enum: ["Frío", "Tibio", "Caliente"],
          },
          tipo_objecion: {
            type: ["string", "null"],
            enum: [
              "precio", "desconfianza", "indecision",
              "falta_de_tiempo", "comparacion", "ghosting", null,
            ],
          },
          probabilidad_cierre: { type: "integer", minimum: 0, maximum: 100 },
          razon_score: { type: "string" },
        },
        required: [
          "emocion", "estado_cliente", "tipo_objecion",
          "probabilidad_cierre", "razon_score",
        ],
        additionalProperties: false,
      },
      siguiente_jugada: { type: "string" },
    },
    required: ["respuesta", "analisis_cliente", "siguiente_jugada"],
    additionalProperties: false,
  },
};

const SCHEMA_VARIANTES = {
  name: "copilot_response_variantes",
  strict: true,
  schema: {
    type: "object",
    properties: {
      analisis_cliente: SCHEMA_SIMPLE.schema.properties.analisis_cliente,
      variantes: {
        type: "object",
        properties: {
          empatica: {
            type: "object",
            properties: {
              mensaje: { type: "string" },
              cuando_usar: { type: "string" },
            },
            required: ["mensaje", "cuando_usar"],
            additionalProperties: false,
          },
          directa: {
            type: "object",
            properties: {
              mensaje: { type: "string" },
              cuando_usar: { type: "string" },
            },
            required: ["mensaje", "cuando_usar"],
            additionalProperties: false,
          },
          educativa: {
            type: "object",
            properties: {
              mensaje: { type: "string" },
              cuando_usar: { type: "string" },
            },
            required: ["mensaje", "cuando_usar"],
            additionalProperties: false,
          },
        },
        required: ["empatica", "directa", "educativa"],
        additionalProperties: false,
      },
      variante_recomendada: {
        type: "string",
        enum: ["empatica", "directa", "educativa"],
      },
      siguiente_jugada: { type: "string" },
    },
    required: [
      "analisis_cliente", "variantes",
      "variante_recomendada", "siguiente_jugada",
    ],
    additionalProperties: false,
  },
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

  const validationErrors = validateInput(req.body);
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: validationErrors.join(". ") });
  }

  const ctx = buildContext(req.body);
  const { accion } = ctx;
  const userPrompt = ACCIONES[accion](ctx);
  const temperature = TEMPERATURE_BY_ACTION[accion] ?? 0.6;

  // OPT-IN: variantes solo si el cliente lo pide explícito
  const modoVariantes = req.body.modo === "variantes";
  const schema = modoVariantes ? SCHEMA_VARIANTES : SCHEMA_SIMPLE;
  const maxTokens = modoVariantes ? 800 : 350;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_schema", json_schema: schema },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    const tiempo_respuesta_ms = Date.now() - startTime;

    // ── MODO VARIANTES ──
    if (modoVariantes) {
      parsed.variantes.empatica.mensaje =
        cleanResponse(parsed.variantes.empatica.mensaje) ||
        "Cuéntame un poco más para ayudarte mejor.";
      parsed.variantes.directa.mensaje =
        cleanResponse(parsed.variantes.directa.mensaje) ||
        "¿Avanzamos con el siguiente paso?";
      parsed.variantes.educativa.mensaje =
        cleanResponse(parsed.variantes.educativa.mensaje) ||
        "Te explico el detalle para que decidas con calma.";

      const recomendada = parsed.variante_recomendada || "directa";
      const respuestaPrincipal = parsed.variantes[recomendada].mensaje;

      return res.status(200).json({
        respuesta: respuestaPrincipal,
        tipo_objecion: parsed.analisis_cliente.tipo_objecion || undefined,
        emocion: parsed.analisis_cliente.emocion,
        estado_cliente: parsed.analisis_cliente.estado_cliente,
        tono_sugerido: recomendada,
        variantes: parsed.variantes,
        variante_recomendada: recomendada,
        probabilidad_cierre: parsed.analisis_cliente.probabilidad_cierre,
        razon_score: parsed.analisis_cliente.razon_score,
        siguiente_jugada: parsed.siguiente_jugada,
        _meta: {
          accion,
          modo: "variantes",
          request_id: requestId,
          tiempo_respuesta_ms,
          tokens: completion.usage?.total_tokens,
          version: "5.1",
        },
      });
    }

    // ── MODO SIMPLE (default) ──
    parsed.respuesta =
      cleanResponse(parsed.respuesta) ||
      "Cuéntame un poco más para darte la mejor opción.";

    return res.status(200).json({
      respuesta: parsed.respuesta,
      tipo_objecion: parsed.analisis_cliente.tipo_objecion || undefined,
      emocion: parsed.analisis_cliente.emocion,
      estado_cliente: parsed.analisis_cliente.estado_cliente,
      probabilidad_cierre: parsed.analisis_cliente.probabilidad_cierre,
      razon_score: parsed.analisis_cliente.razon_score,
      siguiente_jugada: parsed.siguiente_jugada,
      _meta: {
        accion,
        modo: "simple",
        request_id: requestId,
        tiempo_respuesta_ms,
        tokens: completion.usage?.total_tokens,
        version: "5.1",
      },
    });
  } catch (err) {
    console.error(`[${requestId}] Error:`, err.message);
    return res.status(500).json({
      error: "Error generando respuesta. Intenta de nuevo.",
      request_id: requestId,
    });
  }
}
