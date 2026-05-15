import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ─────────────────────────────────────────────
// BASE DE CONOCIMIENTO (NUEVO - Edita para el Hackathon)
// ─────────────────────────────────────────────
const CATALOGO_PRODUCTOS = `
━━━ CATÁLOGO DE PRODUCTOS (Usa esto, NO inventes) ━━━
- Montos: Desde $10,000 hasta $400,000 MXN.
- Tiempos: Depósito en máximo 2 horas, proceso 100% online.
- Beneficio estrella: Sin penalización por pago anticipado.
- Ampliación: Disponible a partir del 3er pago puntual.
`;

// ─────────────────────────────────────────────
// VALIDACIÓN DE ENTRADA (Tu lógica original)
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
// SYSTEM PROMPT (Tu prompt original + Catálogo)
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el copiloto de ventas de MultiMoney. Generas mensajes de WhatsApp listos para enviar por un asesor financiero humano a clientes reales de crédito personal.

${CATALOGO_PRODUCTOS}

━━━ REGLAS DURAS — NUNCA las ignores ━━━
1. CERO saludos. Jamás empieces con "Hola", "Buenos días", "Buen día", "Qué tal" ni nada similar. La conversación ya está abierta.
2. CERO despedidas. Nada de "Quedo a tus órdenes", "Saludos", "Hasta pronto".
3. CERO frases de IA/call center: "Entiendo perfectamente", "Comprendo tu situación", "Con mucho gusto", "Es un placer", "Claro que sí", "Sin problema", "Por supuesto".
4. CERO apertura validando emoción. No empieces reconociendo cómo se siente el cliente — ve al punto.

━━━ TÉCNICA REA — BASE DE MANEJO DE OBJECIONES ━━━
Para cualquier objeción, aplica REA de forma conversacional (no robótica):
R — RECONOCE: Parafrasea la objeción brevemente con tus palabras.
E — EMPATIZA: Una frase corta que valide su punto sin exceso.
A — ASEGURA: Conecta el beneficio específicamente con su situación.
Termina siempre con una pregunta de micro-cierre natural.

━━━ ARGUMENTOS POR USO DEL CRÉDITO ━━━
- Negocio: retorno sobre inversión, capital hoy = utilidades mañana
- Gastos médicos: depósito en 2 horas, sin trámites, urgencia resuelta
- Vacaciones/familia: cuotas cómodas, el disfrute no espera
- Auto: movilidad, ahorro en transporte, calidad de vida
- Emergencia/imprevisto: certeza de contar con el dinero cuando lo necesitas
- Consolidación: un solo pago ordenado, menor estrés financiero
- Sin uso definido: colchón financiero — no lo necesitas hasta que lo necesitas

━━━ ESTILO ━━━
Asesor senior con criterio. Seguro, no ansioso. Claro, no corporativo.
Varía apertura, longitud y ritmo. Usa el nombre del cliente si está disponible.`;

// ─────────────────────────────────────────────
// HELPERS (Tus helpers originales)
// ─────────────────────────────────────────────
const renderCtx = (label, value) => (value ? `${label}: ${value}\n` : "");
const renderHistorial = (h) => (h ? `Historial reciente:\n${h}\n` : "");

const instruccionLongitud = `
REGLA: Adapta la longitud de tu respuesta al mensaje del cliente:
- Mensaje corto (<25 chars) → respuesta de 1-2 líneas
- Mensaje medio (25-120 chars) → 2-3 líneas
- Mensaje largo (>120 chars) → hasta 4-5 líneas`;

const RECORDATORIO_FINAL = `
⚠️ ANTES DE GENERAR: Verifica que tu respuesta NO empiece con saludo ("Hola", "Buenos días", etc.) ni despedida. Ve directo al punto. Sin frases de IA.`;

// ─────────────────────────────────────────────
// PLANTILLAS DE ACCIÓN (¡Restauradas intactas!)
// ─────────────────────────────────────────────
const ACCIONES = {
  responder_objecion: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre del cliente", ctx.nombre)}
${renderCtx("Uso del crédito", ctx.uso)}
${renderCtx("Monto aprobado", ctx.monto)}
${renderCtx("Tasa", ctx.tasa)}
${renderHistorial(ctx.historial)}
${instruccionLongitud}

Aplica la técnica REA de forma conversacional (no en formato lista, sino como mensaje natural):
1. RECONOCE la objeción brevemente con tus propias palabras
2. EMPATIZA con una frase corta — sin exceso ni artificialidad
3. ASEGURA conectando el beneficio con el uso específico.

Si tienes el nombre del cliente, úsalo una vez de forma natural. Termina con una pregunta de micro-cierre.
${RECORDATORIO_FINAL}`,

  negociar_tasa: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre del cliente", ctx.nombre)}
${renderCtx("Tasa ofrecida", ctx.tasa)}
${renderCtx("Uso del crédito", ctx.uso)}
${renderHistorial(ctx.historial)}
${instruccionLongitud}

Aplica REA de forma conversacional para manejar la objeción de tasa:
- El cliente ya está pre-aprobado HOY — proceso rápido, sin filas.
- El costo del tiempo y la burocracia de un banco supera la diferencia en tasa.
- Sin penalización por pago anticipado.
Termina con una pregunta concreta: calcular cuotas juntos, o avanzar.
${RECORDATORIO_FINAL}`,

  cerrar_venta: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}
${renderCtx("Monto", ctx.monto)}
${renderHistorial(ctx.historial)}
${instruccionLongitud}

SITUACIÓN: El cliente muestra intención de avanzar o ya aceptó.
Si hay intención clara → micro-cierre natural (pedir INE, CLABE, referencias).
Si hay fricción → resuélvela transmitiendo seguridad (100% en línea, depósito 2 horas).
${RECORDATORIO_FINAL}`,

  seguimiento: (ctx) => `
Último mensaje / razón de no cierre: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}
${renderCtx("Última interacción", ctx.ultimaInteraccion)}
${renderHistorial(ctx.historial)}
${instruccionLongitud}

Retoma el punto exacto donde quedó — no arranques desde cero.
No suenes desesperado ni insistente.
${RECORDATORIO_FINAL}`,

  resumen_crm: (ctx) => `
Datos del cliente: ${ctx.nombre} | Monto: ${ctx.monto} | Tasa: ${ctx.tasa} | Uso: ${ctx.uso}
Mensaje / situación clave: "${ctx.input}"

Devuelve una nota CRM. Solo datos factuales, sin subjetividad.`,

  mejorar_mensaje: (ctx) => `
Borrador del asesor:
"${ctx.input}"
${renderCtx("Nombre del cliente", ctx.nombre)}
${renderHistorial(ctx.historial)}

Tu única tarea: convertir este borrador en la mejor versión posible para WhatsApp.
Elimina saludos, despedidas y frases de call center. Hazlo específico.
${RECORDATORIO_FINAL}`,
};

// ─────────────────────────────────────────────
// CONTEXTO (Tu lógica original)
// ─────────────────────────────────────────────
function buildContext(body) {
  const { accion, mensajeCliente, datosCliente = {} } = body;
  const historialCrudo = datosCliente.historialConversacion;
  const historialProcesado = Array.isArray(historialCrudo) && historialCrudo.length > 0
      ? historialCrudo.slice(-4).join("\n") : null;

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
// POST-PROCESSING (Limpieza quirúrgica original)
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
// TEMPERATURA POR ACCIÓN (Tu lógica original)
// ─────────────────────────────────────────────
const TEMPERATURE_BY_ACTION = {
  resumen_crm: 0.2, cerrar_venta: 0.45, negociar_tasa: 0.5,
  responder_objecion: 0.6, seguimiento: 0.65, mejorar_mensaje: 0.75,
};

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL (Blindado con JSON Schema)
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
      max_tokens: 220,
      // NUEVO: Structured Outputs. Reemplaza tu safeParseJSON y asegura que no se rompa la extensión.
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
    
    // Mantenemos tu limpieza por si la IA es terca
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
