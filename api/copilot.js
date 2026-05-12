import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ─────────────────────────────────────────────
// SYSTEM PROMPT — Single source of truth.
// Kept lean: persona + hard rules only.
// Dynamic context goes in the user turn.
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el copiloto de ventas de MultiMoney. Apoyas a asesores financieros con respuestas listas para enviar por WhatsApp a clientes reales.

El cliente debe sentir que habla con un asesor que entiende su situación y le ayuda a tomar una buena decisión, no con un vendedor presionando un cierre.

PRODUCTO
Crédito personal. Plazo hasta 60 meses. Liquidación anticipada sin penalización. Proceso 100% digital. Depósito en máximo 2 horas. Sin filas ni papeleo. Ampliación disponible a partir del tercer pago puntual (no prometas monto específico).

TONO Y FORMATO
Conversacional, claro y profesional. Humano sin sonar informal.
Nunca robótico, insistente ni agresivo.
Nunca inventar tasas, montos ni beneficios no confirmados.
No todas las respuestas deben cerrar venta — a veces el mejor avance es generar confianza o resolver dudas.
Si falta contexto, genera la mejor respuesta posible con lo que tienes.
Máximo 4 líneas cortas. Sin viñetas. Sin emojis. Sin saludos ni despedidas.
Varía la estructura y el lenguaje — evita repetir siempre "entiendo" o "comprendo".

TÉCNICA DE RESPUESTA
1. Reconoce lo que el cliente siente o piensa.
2. Responde con claridad y tranquilidad.
3. Explica valor solo si aporta contexto útil.
4. Invita a continuar — solo avanza al cierre si el cliente ya mostró intención clara.

ADAPTACIÓN EMOCIONAL
- Si duda → responde con calma y claridad
- Si está interesado → guía con dirección
- Si está confundido → simplifica al máximo
- Si está ocupado → sé muy breve

ARGUMENTOS POR USO DEL CRÉDITO (selecciona el que aplique)
Negocio: retorno sobre inversión, temporada alta, crecer sin tocar liquidez.
Emergencias/médico: depósito en 2 hrs, sin trámites complicados, tranquilidad inmediata.
Consolidación: un solo pago mensual, orden financiero, liberar flujo.
Vehículo: movilidad, ahorro en transporte, calidad de vida.
Remodelación: proyecto sin pausas, cubrir materiales y mano de obra.
Vacaciones: experiencia familiar, cuotas cómodas, no comprometer liquidez.
Multi-propósito: flexibilidad, no obligado a usar todo de inmediato.

RESPONDE SIEMPRE con JSON válido: { "respuesta": "..." }`;

// ─────────────────────────────────────────────
// PLANTILLAS DE ACCIÓN
// Cada acción define solo su instrucción específica.
// El contexto del cliente se construye una sola vez.
// ─────────────────────────────────────────────
const ACCIONES = {

  responder_objecion: (ctx) => `
Mensaje del cliente: "${ctx.input}"
Uso del crédito: ${ctx.uso}

Instrucción: Primero valida genuinamente la preocupación del cliente — no la rebatas de inmediato. Luego responde con claridad usando el beneficio más relevante para su uso del crédito. Solo invita a continuar si tiene sentido en el contexto; no fuerces un cierre si el cliente aún no está listo.`,

  negociar_tasa: (ctx) => `
Mensaje del cliente: "${ctx.input}"
Tasa ofrecida: ${ctx.tasa}
Uso del crédito: ${ctx.uso}

Instrucción: Reconoce la preocupación del cliente sobre la tasa sin ponerte defensivo. Enfoca el argumento en el costo de oportunidad: tener el dinero disponible hoy, proceso digital sin burocracia, depósito en 2 horas y posibilidad de liquidar antes sin penalización. Si el cliente mencionó un uso del crédito, conéctalo al valor concreto de actuar rápido. No compares agresivamente con bancos.`,

  cerrar_venta: (ctx) => `
Resumen del caso:
Nombre: ${ctx.nombre}
Monto aprobado: ${ctx.monto}
Plazo: ${ctx.plazo}
Tasa: ${ctx.tasa}
Uso del crédito: ${ctx.uso}
Último mensaje del cliente: "${ctx.input}"

Instrucción: Evalúa el mensaje del cliente antes de cerrar. Si ya muestra intención clara, genera un cierre natural: recapitula brevemente los términos clave y haz un llamado a acción específico (confirmar link biométrico, tener INE a la mano, o proporcionar CLABE). Transmite seguridad sin presión. Si aún hay fricción o duda evidente en su mensaje, enfócate primero en resolver eso antes de pedir confirmación.`,

  seguimiento: (ctx) => `
Contexto del cliente:
Nombre: ${ctx.nombre}
Última interacción: ${ctx.ultimaInteraccion || 'No especificada'}
Razón por la que no cerró: "${ctx.input}"
Uso del crédito: ${ctx.uso}

Instrucción: Genera un mensaje de recontacto cálido y humano. No asumas que el cliente sigue interesado — primero valida si su necesidad sigue vigente o si algo cambió. Retoma el punto exacto donde quedó la conversación. Recuérdale brevemente la oferta solo si tiene sentido. No presionar. Mantener la puerta abierta.`,

  resumen_crm: (ctx) => `
Datos del cliente:
Nombre: ${ctx.nombre}
Monto: ${ctx.monto} | Plazo: ${ctx.plazo} | Tasa: ${ctx.tasa}
Uso del crédito: ${ctx.uso}
Conversación relevante: "${ctx.input}"

Instrucción: Genera una nota de CRM lista para pegar. Formato:
ESTADO: [Venta / Seguimiento / Sin contacto / En validación]
MOTIVO: [razón breve del estado]
ACCIÓN SIGUIENTE: [qué debe hacer el asesor y cuándo]
Máximo 5 líneas. Datos factuales, sin adornos.`,

};

// ─────────────────────────────────────────────
// CONSTRUCTOR DE CONTEXTO
// Centraliza la extracción y sanitización de datos.
// ─────────────────────────────────────────────
function buildContext(body) {
  const { accion, mensajeCliente, datosCliente = {} } = body;
  return {
    accion,
    input: (mensajeCliente || "").slice(0, 800), // Hard cap por seguridad
    nombre: datosCliente.nombre || "el cliente",
    monto: datosCliente.monto || "no especificado",
    tasa: datosCliente.tasa || "no especificada",
    plazo: datosCliente.plazo || "hasta 60 meses",
    uso: datosCliente.uso || "no especificado",
    ultimaInteraccion: datosCliente.ultimaInteraccion || null,
  };
}

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const { accion } = req.body || {};

  // Whitelist de acciones
  if (!accion || !ACCIONES[accion]) {
    return res.status(400).json({
      error: `Acción inválida. Acciones disponibles: ${Object.keys(ACCIONES).join(", ")}`,
    });
  }

  const ctx = buildContext(req.body);
  const userPrompt = ACCIONES[accion](ctx);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.55,    // Subido de 0.35 — mejora naturalidad y variación sin disparar tokens
      max_tokens: 200,       // Suficiente para 4 líneas + JSON overhead
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0].message.content;
    const parsed = JSON.parse(raw);

    if (!parsed.respuesta) throw new Error("La IA no devolvió el campo 'respuesta'.");

    return res.status(200).json({
      respuesta: parsed.respuesta,
      // Metadatos opcionales útiles para debugging y analytics
      _meta: {
        accion,
        tokens: completion.usage?.total_tokens,
        modelo: completion.model,
      },
    });

  } catch (err) {
    console.error("[MultiMoney Copilot] Error:", err);
    return res.status(500).json({
      error: "Error generando respuesta. Intenta de nuevo.",
      detalle: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}
