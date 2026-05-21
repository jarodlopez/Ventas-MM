import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ═══════════════════════════════════════════════════════════════════
// MM SALES COPILOT API — v5.0 "Hackathon Edition"
// Cambios clave vs v4.x:
//   • 3 variantes estratégicas por respuesta (empática / directa / educativa)
//   • Análisis emocional que ALIMENTA la generación (no solo reporta)
//   • Score de probabilidad de cierre (0-100) con razonamiento
//   • "Siguiente jugada" táctica para coachear al asesor
//   • Tono mexicano real, calibrado por hora del día y estado del cliente
//   • Contrato hacia atrás: `respuesta` sigue siendo el campo principal
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
  // Hora CDMX aproximada (UTC-6)
  const horaCDMX = (now.getUTCHours() - 6 + 24) % 24;
  const dia = now.getUTCDay(); // 0 dom - 6 sab

  let franja = "tarde";
  if (horaCDMX >= 6 && horaCDMX < 12) franja = "mañana";
  else if (horaCDMX >= 12 && horaCDMX < 19) franja = "tarde";
  else if (horaCDMX >= 19 && horaCDMX < 23) franja = "noche";
  else franja = "madrugada";

  const finDeSemana = dia === 0 || dia === 6;
  return { franja, finDeSemana, horaCDMX };
}

// ─────────────────────────────────────────────
// SYSTEM PROMPT — Mexicano real, no neutro
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres un asesor financiero senior de MultiMoney México. Llevas años cerrando créditos personales por WhatsApp. Tu trabajo es ayudar al asesor humano a responder mejor, más rápido y con más cierre.

${CATALOGO_PRODUCTOS}

━━━ TU VOZ (esto es lo más importante) ━━━
Suenas como un mexicano profesional cerrando ventas por chat. NO suenas a:
- Bot ("Comprendo tu situación", "Es un placer", "Con gusto")
- Call center ("Estimado cliente", "Le informo que")
- Coach motivacional ("¡Excelente decisión!", "¡Vamos por más!")
- Ni traducción del inglés ("Hagamos esto realidad")

SÍ suenas a:
- Asesor real que conoce su producto y respeta el tiempo del cliente
- Directo sin ser frío, cálido sin ser meloso
- Usas mexicanismos NATURALES cuando caben: "va", "checa", "te late", "ahorita", "órale", "sale", "qué tal si", "no le saques", "lo armamos rápido"
- Frases cortas, oraciones de 8-15 palabras máximo en chat
- Puntuación relajada de WhatsApp (puntos suspensivos OK, signos dobles NO)

━━━ REGLAS DURAS ━━━
1. NUNCA inicies con saludo (asume conversación ya en curso).
2. NUNCA uses bullets ni listas en la respuesta al cliente — es WhatsApp, es prosa.
3. NUNCA inventes datos que no te dieron (montos, tasas, plazos).
4. NUNCA prometas aprobación. Trabaja sobre pre-aprobación o lo ya cotizado.
5. CIERRA SIEMPRE con micro-cierre: una pregunta corta o un siguiente paso claro.
6. Si tienes el nombre del cliente, úsalo MÁXIMO una vez por mensaje.

━━━ METODOLOGÍA REA INVISIBLE ━━━
Para objeciones: Reconoce + Empatiza + Asegura, todo fundido en UN mensaje conversacional.
- Reconoce sin loro ("Es válido que lo pienses", NO "Entiendo que dices que...")
- Empatiza comercial, no terapéutico ("muchos clientes hacen esa comparación")
- Asegura conectando beneficio con SU caso ("para tu caso de [uso] esto funciona porque...")

━━━ CALIBRACIÓN POR EMOCIÓN DEL CLIENTE ━━━
- ANSIOSO/URGENTE → Tu respuesta transmite control y velocidad. Frases cortas, datos concretos.
- DESCONFIADO/ESCÉPTICO → Tu respuesta da prueba social y seguridad. Cifras, garantías, transparencia.
- INDECISO/TIBIO → Tu respuesta reduce fricción. Una sola pregunta, un solo siguiente paso.
- INTERESADO/CALIENTE → Tu respuesta cierra. Pide el siguiente requisito YA.
- MOLESTO/FRUSTRADO → Tu respuesta valida primero, resuelve después. Baja la temperatura.
- COMPARANDO → Tu respuesta destaca el diferencial (sin penalización, 2 horas, sin buró tradicional).

━━━ EJEMPLOS DE CALIBRACIÓN ━━━

[Cliente ansioso "necesito el dinero para mañana"]
MAL: "Comprendo la urgencia. Nuestro proceso es rápido y..."
BIEN: "Si firmas hoy antes de las 5, el depósito te entra mañana mismo. ¿Tienes la INE y CLABE a la mano para arrancar?"

[Cliente desconfiado "¿cómo sé que no es fraude?"]
MAL: "Te aseguro que somos una empresa seria..."
BIEN: "Válido que lo preguntes. MultiMoney está regulada por CNBV y operamos desde 2018. El contrato te llega antes de firmar, lo revisas con calma. ¿Te paso la liga oficial?"

[Cliente comparando "el banco me ofrece 22%"]
MAL: "Nuestra tasa es competitiva porque..."
BIEN: "Tiene sentido comparar. La diferencia es que aquí el dinero te cae en 2 horas sin trámite presencial, y si liquidas antes no te penalizamos. El banco te tarda 5-10 días. ¿Qué pesa más para ti, la tasa o el tiempo?"

━━━ GENERAS 3 VARIANTES SIEMPRE ━━━
1. EMPÁTICA: Pone primero el feeling del cliente, luego el beneficio. Para clientes sensibles.
2. DIRECTA: Va al cierre rápido. Para clientes que ya están listos o el asesor quiere acelerar.
3. EDUCATIVA: Explica un dato/diferencial concreto. Para clientes analíticos o comparadores.

Cada variante debe SER DIFERENTE en enfoque, no solo en palabras. Si son intercambiables, las hiciste mal.`;

// ─────────────────────────────────────────────
// HELPERS DE CONTEXTO
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
${renderCtx("Nombre", ctx.nombre)}${renderCtx("Uso del crédito", ctx.uso)}${renderCtx("Monto pre-aprobado", ctx.monto)}${renderCtx("Tasa cotizada", ctx.tasa)}${renderCtx("Plazo", ctx.plazo)}${renderHistorial(ctx.historial)}
Momento: ${ctx.momento.franja}${ctx.momento.finDeSemana ? " (fin de semana)" : ""}.

Genera las 3 variantes aplicando REA invisible, conectando con el uso específico del crédito.`,

  negociar_tasa: (ctx) => `
ACCIÓN: Negociar tasa
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${renderCtx("Tasa cotizada", ctx.tasa)}${renderCtx("Uso", ctx.uso)}${renderCtx("Monto", ctx.monto)}${renderHistorial(ctx.historial)}

El cliente cuestiona la tasa. Tus 3 variantes deben todas defender el valor sin bajar tasa (no tienes facultad), pero con ángulos distintos:
- EMPÁTICA: validar y reposicionar al diferencial
- DIRECTA: cerrar pidiendo siguiente requisito asumiendo aceptación
- EDUCATIVA: comparativa concreta vs banco/competencia`,

  cerrar_venta: (ctx) => `
ACCIÓN: Cerrar venta
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${renderCtx("Monto", ctx.monto)}${renderCtx("Tasa", ctx.tasa)}${renderCtx("Uso", ctx.uso)}${renderHistorial(ctx.historial)}

El cliente muestra señales de cierre. Tus 3 variantes piden siguiente requisito (INE/CLABE/comprobante) con enfoques distintos:
- EMPÁTICA: cierre suave, da control al cliente
- DIRECTA: micro-cierre asumiendo, "te paso el link / mándame INE"
- EDUCATIVA: explica el siguiente paso del proceso completo`,

  seguimiento: (ctx) => `
ACCIÓN: Seguimiento (cliente no respondió o quedó pendiente)
Último mensaje / razón: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${renderCtx("Última interacción", ctx.ultimaInteraccion)}${renderCtx("Monto", ctx.monto)}${renderHistorial(ctx.historial)}
Momento actual: ${ctx.momento.franja}.

Tus 3 variantes retoman SIN sonar desesperado, cada una con gancho distinto:
- EMPÁTICA: respeta el silencio, ofrece ayuda
- DIRECTA: anclaje de urgencia real (pre-aprobación 48h, tasa vigente)
- EDUCATIVA: aporta un dato nuevo de valor que mueve la conversación`,

  resumen_crm: (ctx) => `
ACCIÓN: Resumen CRM
Datos: ${ctx.nombre || "S/N"} | Monto: ${ctx.monto || "S/D"} | Tasa: ${ctx.tasa || "S/D"} | Uso: ${ctx.uso || "S/D"}
Situación clave: "${ctx.input}"
${renderHistorial(ctx.historial)}

Devuelve un resumen CRM factual en 3 variantes:
- EMPÁTICA: enfocada en estado emocional/relacional del cliente
- DIRECTA: bullet de acción inmediata para el asesor
- EDUCATIVA: contexto completo para handoff a otro asesor`,

  mejorar_mensaje: (ctx) => `
ACCIÓN: Mejorar borrador del asesor
Borrador original:
"${ctx.input}"
${renderCtx("Nombre cliente", ctx.nombre)}${renderHistorial(ctx.historial)}

Reescribe el borrador en 3 versiones, todas eliminando corporativismos:
- EMPÁTICA: versión más cálida y conectiva
- DIRECTA: versión más al grano, lista para cierre
- EDUCATIVA: versión que aporta un dato/diferencial`,
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
  negociar_tasa: 0.65,
  responder_objecion: 0.7,
  seguimiento: 0.7,
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

  const validationErrors = validateInput(req.body);
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: validationErrors.join(". ") });
  }

  const ctx = buildContext(req.body);
  const { accion } = ctx;
  const userPrompt = ACCIONES[accion](ctx);
  const temperature = TEMPERATURE_BY_ACTION[accion] ?? 0.6;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: 900, // más espacio para 3 variantes + análisis
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "copilot_response_v5",
          strict: true,
          schema: {
            type: "object",
            properties: {
              // ───── Análisis del cliente (alimenta la generación) ─────
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
                  probabilidad_cierre: {
                    type: "integer",
                    minimum: 0,
                    maximum: 100,
                  },
                  razon_score: { type: "string" },
                },
                required: [
                  "emocion", "estado_cliente", "tipo_objecion",
                  "probabilidad_cierre", "razon_score",
                ],
                additionalProperties: false,
              },
              // ───── 3 variantes estratégicas ─────
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
              // ───── Coaching para el asesor ─────
              siguiente_jugada: {
                type: "string",
                description: "Coaching corto: qué hacer después según cómo responda el cliente",
              },
              variante_recomendada: {
                type: "string",
                enum: ["empatica", "directa", "educativa"],
              },
            },
            required: [
              "analisis_cliente", "variantes",
              "siguiente_jugada", "variante_recomendada",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    // Limpieza de openers prohibidos en las 3 variantes
    parsed.variantes.empatica.mensaje =
      cleanResponse(parsed.variantes.empatica.mensaje) ||
      "Cuéntame un poco más para ayudarte mejor.";
    parsed.variantes.directa.mensaje =
      cleanResponse(parsed.variantes.directa.mensaje) ||
      "¿Avanzamos con el siguiente paso?";
    parsed.variantes.educativa.mensaje =
      cleanResponse(parsed.variantes.educativa.mensaje) ||
      "Te explico el detalle para que decidas con calma.";

    // ───── Compatibilidad hacia atrás ─────
    // El front-end actual espera `respuesta`. Le damos la variante recomendada.
    const recomendada = parsed.variante_recomendada || "directa";
    const respuestaPrincipal =
      parsed.variantes[recomendada]?.mensaje ||
      parsed.variantes.directa.mensaje;

    const tiempo_respuesta_ms = Date.now() - startTime;

    return res.status(200).json({
      // ── Contrato existente (no romper front) ──
      respuesta: respuestaPrincipal,
      tipo_objecion: parsed.analisis_cliente.tipo_objecion || undefined,
      emocion: parsed.analisis_cliente.emocion,
      estado_cliente: parsed.analisis_cliente.estado_cliente,
      tono_sugerido: recomendada,

      // ── Campos nuevos v5 (el front los puede ir adoptando) ──
      variantes: parsed.variantes,
      variante_recomendada: recomendada,
      probabilidad_cierre: parsed.analisis_cliente.probabilidad_cierre,
      razon_score: parsed.analisis_cliente.razon_score,
      siguiente_jugada: parsed.siguiente_jugada,

      _meta: {
        accion,
        request_id: requestId,
        tiempo_respuesta_ms,
        tokens: completion.usage?.total_tokens,
        version: "5.0",
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
