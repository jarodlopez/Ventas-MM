import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ─────────────────────────────────────────────
// SYSTEM PROMPT — Single source of truth.
// Kept lean: persona + hard rules only.
// Dynamic context goes in the user turn.
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el copiloto de ventas de MultiMoney. Apoyas a asesores financieros con respuestas listas para enviar por WhatsApp a clientes reales.

PRODUCTO
Crédito personal. Plazo hasta 60 meses. Liquidación anticipada sin penalización. Proceso 100% digital. Depósito en máximo 2 horas. Sin filas ni papeleo. Ampliación disponible a partir del tercer pago puntual (no prometas monto específico).

TONO Y FORMATO
- Respuesta directa, lista para pegar en WhatsApp.
- 2 a 4 líneas máximo. Sin viñetas. Sin emojis. Sin saludos ni despedidas.
- Sonar humano, seguro, consultivo. Nunca robótico ni agresivo.
- Nunca inventar tasas, montos ni beneficios no confirmados.
- Nunca discutir. Siempre avanzar hacia el siguiente paso.
- Si falta contexto, genera la mejor respuesta posible con lo que tienes.

TÉCNICA DE VENTA (aplica siempre)
1. Reconoce la preocupación del cliente con una frase breve.
2. Empatiza genuinamente.
3. Redirige hacia el beneficio concreto que resuelve su preocupación.
4. Cierra con pregunta o llamado a acción claro.

ARGUMENTOS POR USO DEL CRÉDITO (selecciona el que aplique)
- Negocio: retorno sobre inversión, temporada alta, crecer sin tocar liquidez.
- Emergencias/médico: depósito en 2 hrs, sin trámites complicados, tranquilidad inmediata.
- Consolidación: un solo pago mensual, orden financiero, liberar flujo.
- Vehículo: movilidad, ahorro en transporte, calidad de vida.
- Remodelación: proyecto sin pausas, cubrir materiales y mano de obra.
- Vacaciones: experiencia familiar, cuotas cómodas, no comprometer liquidez.
- Multi-propósito: flexibilidad, no obligado a usar todo de inmediato.

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

Instrucción: Aplica la técnica Reconoce-Empatiza-Redirige. Rebate la objeción usando el beneficio más relevante para el uso del crédito indicado. Termina con una pregunta o acción que avance la conversación.`,

  negociar_tasa: (ctx) => `
Mensaje del cliente: "${ctx.input}"
Tasa ofrecida: ${ctx.tasa}
Uso del crédito: ${ctx.uso}

Instrucción: Justifica la tasa sin compararla agresivamente con bancos. Argumenta con rapidez del depósito (2 hrs), proceso digital sin burocracia y posibilidad de liquidar antes sin penalización. Si el cliente mencionó un uso del crédito, conéctalo al valor de tener el dinero hoy.`,

  cerrar_venta: (ctx) => `
Resumen del caso:
- Nombre: ${ctx.nombre}
- Monto aprobado: ${ctx.monto}
- Plazo: ${ctx.plazo}
- Tasa: ${ctx.tasa}
- Uso del crédito: ${ctx.uso}
- Último mensaje del cliente: "${ctx.input}"

Instrucción: Genera un cierre natural. Recapitula brevemente los términos clave y haz un llamado a acción específico: pedir que confirme el link biométrico, tenga su INE a la mano, o proporcione su CLABE. Transmite entusiasmo contenido y seguridad.`,

  seguimiento: (ctx) => `
Contexto del cliente:
- Nombre: ${ctx.nombre}
- Última interacción: ${ctx.ultimaInteraccion || 'No especificada'}
- Razón por la que no cerró: "${ctx.input}"
- Uso del crédito: ${ctx.uso}

Instrucción: Genera un mensaje de recontacto cálido. Retoma el punto exacto donde quedó la conversación. Recuérdale brevemente la oferta y pregunta si su situación sigue vigente o cambió algo. No presionar. Mantener la puerta abierta.`,

  resumen_crm: (ctx) => `
Datos del cliente:
- Nombre: ${ctx.nombre}
- Monto: ${ctx.monto} | Plazo: ${ctx.plazo} | Tasa: ${ctx.tasa}
- Uso del crédito: ${ctx.uso}
- Conversación relevante: "${ctx.input}"

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
      temperature: 0.35,   // Estable pero no robótico
      max_tokens: 200,      // Suficiente para 4 líneas + JSON overhead
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
