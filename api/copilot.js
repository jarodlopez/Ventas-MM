import OpenAI from "openai";

// Inicialización del cliente de OpenAI
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ─────────────────────────────────────────────
// 1. BASE DE CONOCIMIENTO (Chat & Text Native)
// ─────────────────────────────────────────────
const CATALOGO_PRODUCTOS = `
- Montos: $10,000 a $400,000 MXN.
- Tiempos: Depósito en máx 2 horas, proceso 100% online.
- Ventajas: Sin burocracia, sin penalización por pago anticipado.
- Expansión: Ampliación de línea a partir del 3er pago puntual.
`;

const PLAYBOOK_CHAT = `
━━━ EL FLUJO DE 7 PASOS (ADAPTADO A WHATSAPP) ━━━
1. PRESENTACIÓN: Mensaje corto. Tu nombre, "MultiMoney" y el motivo del contacto. Cero formalismos largos.
2. DESCUBRIR NECESIDADES: Una sola pregunta de sondeo al final del mensaje (ej. "¿Para qué tienes pensado usar el crédito?").
3. PITCH: Conectar el beneficio de las "2hrs y 60 meses" con la necesidad que el cliente escribió.
4. MANEJO DE OBJECIONES (TÉCNICA REA): Reconoce (valida en texto corto), Empatiza (conecta), Asegura (resuelve). NUNCA mandes párrafos largos.
5. EDUCAR: Dar instrucciones de biométrico en viñetas (CLABE, foto INE, selfie). Pedir UN documento a la vez para no abrumar.
6. CIERRE: Celebrar en texto, pedir explícitamente 2 REFERENCIAS (1 familiar y 1 conocido).
7. SEGUIMIENTO: Mensajes de reactivación cortos ("¿Pudiste revisar el dato?", "Retomamos tu trámite...").

━━━ CONTEXTO DE BASE DE DATOS ━━━
- UPPER FUNNEL (Nuevos): Sondeo profundo, descubrir necesidad.
- GANCHOS (Rechazaron antes): Foco: "Logramos mejorar la oferta que dejaste pasar".
- EXPIRADOS (No terminaron): Foco: "Podemos reactivar tu proceso donde lo dejamos".
`;

// ─────────────────────────────────────────────
// 2. VALIDACIÓN DE ENTRADA (Mapeado a tu UI)
// ─────────────────────────────────────────────
const ACCIONES_VALIDAS = [
  "responder_objecion", // Botón: Respuesta a Objeción
  "negociar_tasa",      // Botón: Negociar Tasa
  "cerrar_venta",       // Botón: Ir al Cierre
  "seguimiento",        // Botón: Generar Seguimiento
  "mejorar_mensaje",    // Botón: Mejorar Borrador
  "resumen_crm",        // Botón: Generar Resumen
];

function validateInput(body) {
  const errors = [];
  if (!body || typeof body !== "object") return ["El body de la petición es inválido."];
  if (!body.accion || !ACCIONES_VALIDAS.includes(body.accion)) {
    errors.push(`Acción inválida. Disponibles: ${ACCIONES_VALIDAS.join(", ")}`);
  }
  if (!body.mensajeCliente || typeof body.mensajeCliente !== "string") {
    errors.push("El campo 'mensajeCliente' es requerido y debe ser string.");
  }
  return errors;
}

// ─────────────────────────────────────────────
// 3. SYSTEM PROMPT: WHATSAPP CLOSER OVERHAUL
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el "Copilot MultiMoney", una IA táctica integrada en una extensión de Chrome para WhatsApp Web.
Tu rol es darle al Asesor de Ventas los mejores mensajes para copiar/pegar y destrabar ventas por chat.

${CATALOGO_PRODUCTOS}
${PLAYBOOK_CHAT}

━━━ REGLAS DE FORMATO WHATSAPP (ESTRICTO) ━━━
1. ASIMETRÍA: Si el cliente escribe 5 palabras, no respondas con 50.
2. FORMATO: Usa negritas de WhatsApp (asteriscos: *texto*) para resaltar montos o acciones. Usa viñetas cortas si pides requisitos.
3. PREGUNTAS DE CIERRE: Todo mensaje tuyo DEBE terminar con una pregunta corta para forzar al cliente a responder y mantener el momentum.
4. CERO PAJA: Elimina frases de call center como "esta llamada es grabada", "le asiste...", "quedo a su disposición". Eres humano y directo.
`;

// ─────────────────────────────────────────────
// 4. MEMORIA HÍBRIDA & CONTEXT BUILDER
// ─────────────────────────────────────────────
const renderCtx = (label, value) => (value ? `${label}: ${value}\n` : "");

const renderStrategicMemory = (datos) => {
  if (!datos.uso && !datos.monto && !datos.tasa && !datos.tipoBase) return "";
  return `\n[PANEL LATERAL DE CONTEXTO]
${renderCtx("Tipo de Base", datos.tipoBase)}
${renderCtx("Uso planeado", datos.uso)}
${renderCtx("Monto", datos.monto)}
${renderCtx("Fricción detectada", datos.friccion)}\n`;
};

function buildContext(body) {
  const { accion, mensajeCliente, datosCliente = {} } = body;
  
  const historialCrudo = datosCliente.historialConversacion;
  const historialProcesado = Array.isArray(historialCrudo) && historialCrudo.length > 0
      ? historialCrudo.slice(-5).join("\n") 
      : "Sin historial previo.";

  return {
    accion,
    input: mensajeCliente.trim().slice(0, 800),
    nombre: datosCliente.nombre || "Cliente",
    memoriaEstrategica: renderStrategicMemory(datosCliente),
    historial: historialProcesado,
  };
}

// ─────────────────────────────────────────────
// 5. INTENT ENGINE: ACCIONES NATIVAS DE CHAT
// ─────────────────────────────────────────────
const ACCIONES = {
  responder_objecion: (ctx) => `
Último mensaje chat: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${ctx.memoriaEstrategica}

Misión: Rebatir la objeción en texto aplicando Técnica REA.
1. [R] Reconoce y [E] Empatiza en la primera línea. (Ej. "Entiendo perfecto ${ctx.nombre}, es normal tener esa duda.")
2. [A] Asegura en la segunda línea resaltando *liquidez en 2 horas* o el uso del crédito.
3. Termina con una pregunta corta que invite a la acción.`,

  negociar_tasa: (ctx) => `
Último mensaje chat: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${ctx.memoriaEstrategica}

Misión: Pivote de objeción de tasa por chat.
No justifiques la tasa con párrafos largos. Valida que es bueno comparar, pero transiciona rápido a nuestra ventaja: "La diferencia con nosotros es que tienes el dinero *hoy mismo* sin ir a sucursales ni penalizaciones."
Cierra proponiendo enviar una simulación rápida: "¿Te paso los números reales de cómo quedaría tu cuota para que lo valores?".`,

  cerrar_venta: (ctx) => `
Último mensaje chat: "${ctx.input}"
${ctx.memoriaEstrategica}

Misión: Transicionar a la etapa operativa (Paso 6). 
Redacta un mensaje directo que celebre rápido ("¡Excelente ${ctx.nombre}!") y pide explícitamente el requisito del Playbook: las 2 referencias.
Ejemplo de tono: "Para avanzar a la validación, pásame por aquí 2 referencias (1 familiar y 1 conocido). Solo ocupo nombre y teléfono. ¿Me las compartes?"`,

  seguimiento: (ctx) => `
Último mensaje chat: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${ctx.memoriaEstrategica}

Misión: Mensaje de "push" por WhatsApp. El cliente dejó en visto o pausó. Sé muy casual. Asume que está ocupado. "Hola ${ctx.nombre}, ¿pudiste revisar lo que te mandé? Avisame si le damos luz verde para que quede hoy mismo."`,
  
  resumen_crm: (ctx) => `
Haz un resumen de 2 líneas de este cliente basado en: "${ctx.input}". Extrae solo: Intención de compra, fricción principal y siguiente paso lógico. Ideal para pegar en Salesforce/Hubspot.`,
  
  mejorar_mensaje: (ctx) => `
Borrador del asesor: "${ctx.input}"
Misión: El asesor escribió un mensaje robotizado o muy largo. Reescríbelo para que sea un mensaje de WhatsApp letal. Usa *negritas* para resaltar, quita los "quedo a la orden", hazlo más asimétrico y natural.`,
};

// ─────────────────────────────────────────────
// 6. GUARDRAILS & CLEANUP
// ─────────────────────────────────────────────
const BANNED_OPENERS = [
  /^estimado[,!.]?\s*/i, /^quedo a tus órdenes[,!.]?\s*/i, /^le asiste[,!.]?\s*/i
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
  return cleaned.replace(/\n{3,}/g, "\n\n").trim(); // Evitar saltos de línea excesivos
}

// ─────────────────────────────────────────────
// 7. TEMPERATURAS
// ─────────────────────────────────────────────
const TEMPERATURE_BY_ACTION = {
  resumen_crm: 0.1,  
  cerrar_venta: 0.2,   
  negociar_tasa: 0.4,  
  responder_objecion: 0.5,
  mejorar_mensaje: 0.6,
  seguimiento: 0.7,    
};

// ─────────────────────────────────────────────
// 8. HANDLER PRINCIPAL (API ROUTE)
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
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: validationErrors.join(" | ") });
  }

  const ctx = buildContext(req.body);
  const { accion } = ctx;
  const userPrompt = ACCIONES[accion](ctx);
  const temperature = TEMPERATURE_BY_ACTION[accion] ?? 0.5;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: 400, // Reducido para forzar concisión de chat
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "whatsapp_copilot_response",
          strict: true,
          schema: {
            type: "object",
            properties: {
              telemetria: {
                type: "object",
                properties: {
                  paso_playbook: { type: "integer", description: "Paso del 1 al 7" },
                  tecnica_rea_aplicada: { type: "boolean" },
                  friccion_detectada: { type: "string", description: "Muy corta, ej. 'Tasa', 'Desconfianza'" }
                },
                required: ["paso_playbook", "tecnica_rea_aplicada", "friccion_detectada"],
                additionalProperties: false
              },
              respuesta_whatsapp: { 
                type: "string",
                description: "Mensaje listo para copiar y pegar en WhatsApp. Corto, natural, usando asteriscos para negritas."
              },
              consejo_asesor: {
                type: "string",
                description: "Tip interno muy corto para el asesor. (Ej. 'Si acepta, pásale el link del biométrico')."
              }
            },
            required: ["telemetria", "respuesta_whatsapp", "consejo_asesor"],
            additionalProperties: false
          }
        }
      }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    
    // Limpiar respuesta para chat
    parsed.respuesta_whatsapp = cleanResponse(parsed.respuesta_whatsapp);

    return res.status(200).json({
      guion: parsed.respuesta_whatsapp,     // El texto para el textarea de la extensión
      consejo: parsed.consejo_asesor,       // Para mostrar como tip en la UI
      telemetria: parsed.telemetria,        // Para actualizar indicadores de la UI
      _meta: { accion, request_id: requestId, tiempo_ms: Date.now() - startTime },
    });

  } catch (err) {
    console.error(`[${requestId}] Error:`, err.message);
    return res.status(500).json({ error: "Fallo en motor cognitivo de chat." });
  }
}
