import OpenAI from "openai";

// Inicialización del cliente de OpenAI
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ─────────────────────────────────────────────
// 1. BASE DE CONOCIMIENTO (Core Product + Playbook)
// ─────────────────────────────────────────────
const CATALOGO_PRODUCTOS = `
- Montos: $10,000 a $400,000 MXN.
- Tiempos: Depósito en máx 2 horas, proceso 100% online.
- Ventajas: Sin burocracia, sin penalización por pago anticipado.
- Expansión: Ampliación de línea a partir del 3er pago puntual.
`;

const PLAYBOOK_REGLAS = `
━━━ EL FLUJO DE 7 PASOS (MULTIMONEY PLAYBOOK) ━━━
1. PRESENTACIÓN: Nombre, "MultiMoney", motivo y "esta llamada será grabada por calidad".
2. DESCUBRIR NECESIDADES: Sondeo de valor (¿Para qué se usará el crédito?).
3. PITCH: Conectar el beneficio de las 2hrs y 60 meses con la necesidad.
4. MANEJO DE OBJECIONES (TÉCNICA REA ESTRICTA): Reconoce (parafrasea), Empatiza (valida), Asegura (resuelve). Mínimo 3 rebotes.
5. EDUCAR: Explicar biométrico (CLABE, foto INE sin sombras, selfie).
6. CIERRE: Celebrar, recapitular acuerdos y pedir 2 REFERENCIAS (1 familiar y 1 conocido).
7. SEGUIMIENTO: Agendar fecha si no cierra.

━━━ CONTEXTO DE BASE DE DATOS ━━━
- UPPER FUNNEL (Nuevos): Sondeo profundo.
- GANCHOS (Rechazaron antes): "Logramos mejorar la oferta que dejaste pasar".
- EXPIRADOS (No terminaron): "Podemos reactivar tu proceso sin empezar de cero".
`;

// ─────────────────────────────────────────────
// 2. VALIDACIÓN DE ENTRADA (Security & Routing)
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
  if (!body || typeof body !== "object") return ["El body de la petición es inválido."];
  if (!body.accion || !ACCIONES_VALIDAS.includes(body.accion)) {
    errors.push(`Acción inválida. Disponibles: ${ACCIONES_VALIDAS.join(", ")}`);
  }
  if (!body.mensajeCliente || typeof body !== "string" && typeof body.mensajeCliente !== "string") {
    errors.push("El campo 'mensajeCliente' es requerido y debe ser string.");
  }
  return errors;
}

// ─────────────────────────────────────────────
// 3. SYSTEM PROMPT: COGNITIVE OVERHAUL
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el "Copilot Senior" de MultiMoney operando por WhatsApp. 
Tu rol es evaluar prospectos, eliminar fricción y asegurar el fondeo aplicando ESTRICTAMENTE el Playbook Comercial.

${CATALOGO_PRODUCTOS}
${PLAYBOOK_REGLAS}

━━━ PRINCIPIOS DE IDENTIDAD (BEHAVIORAL DESIGN) ━━━
1. ECONOMÍA DE PALABRAS: Respuestas asimétricas. Si el cliente escribe poco, tú también.
2. MOMENTUM: Cada mensaje debe destrabar una fricción o avanzar al siguiente paso operativo (1 al 7).
3. ESTADO MENTAL DEL COPILOTO: 
   - 🔴 PERSUASIÓN: Si hay dudas, aplica Técnica REA.
   - 🟢 FACILITACIÓN: Si hay micro-señales de compra ("¿qué sigue?", "¿cómo pagan?"), DEJA DE VENDER. Da instrucciones operativas de inmediato.
`;

// ─────────────────────────────────────────────
// 4. MEMORIA HÍBRIDA & CONTEXT BUILDER
// ─────────────────────────────────────────────
const renderCtx = (label, value) => (value ? `${label}: ${value}\n` : "");

const renderStrategicMemory = (datos) => {
  if (!datos.uso && !datos.monto && !datos.tasa && !datos.tipoBase) return "";
  return `\n[MEMORIA ESTRATÉGICA DEL CLIENTE]
${renderCtx("Tipo de Base", datos.tipoBase || "UPPER FUNNEL")}
${renderCtx("Uso planeado del capital", datos.uso)}
${renderCtx("Monto pre-aprobado", datos.monto)}
${renderCtx("Tasa asignada", datos.tasa)}\n`;
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
    nombre: datosCliente.nombre || null,
    memoriaEstrategica: renderStrategicMemory(datosCliente),
    historial: historialProcesado,
  };
}

// ─────────────────────────────────────────────
// 5. INTENT ENGINE: ACCIONES ORIENTADAS A MISIÓN
// ─────────────────────────────────────────────
const ACCIONES = {
  responder_objecion: (ctx) => `
Mensaje actual: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${ctx.memoriaEstrategica}

Misión: Aplicar el Paso 4 del Playbook (Manejo de Objeciones).
EJECUCIÓN ESTRICTA (Técnica REA):
1. [R] RECONOCE: Parafrasea su objeción sin contradecir.
2. [E] EMPATIZA: Valida que su preocupación es legítima e importante.
3. [A] ASEGURA: Resuelve usando nuestro beneficio (Rapidez de 2 horas, liquidez hoy, ampliación a futuro).
TERMINA el mensaje forzando el avance. (La regla dice: rebotar mínimo 3 objeciones).`,

  negociar_tasa: (ctx) => `
Mensaje actual: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${ctx.memoriaEstrategica}

Misión: Rebatir la objeción de tasa aplicando REA (Playbook Sec. 2.4.C).
EJECUCIÓN COMERCIAL:
1. Reconoce y Empatiza: "Es completamente válido que analices el costo, eso habla de que eres responsable".
2. Asegura (Pivote): Mueve el enfoque de "precio" a "tiempo". Destaca que la ventaja MultiMoney es tener el capital HOY MISMO, sin filas, y con flexibilidad de liquidar antes sin multa.
3. Micro-cierre: "¿Te parece si hacemos el cálculo rápido de cómo te quedarían las cuotas?".`,

  cerrar_venta: (ctx) => `
Mensaje actual: "${ctx.input}"
${ctx.memoriaEstrategica}

Misión: Ejecutar el Paso 6 del Playbook (Cierre).
Si el cliente acepta la oferta, DEBES incluir en tu mensaje:
1. Celebrar su decisión.
2. Recapitular que el siguiente paso es la validación.
3. INSTRUCCIÓN CRÍTICA: Solicitar 2 referencias (1 familiar y 1 conocido).`,

  seguimiento: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${ctx.memoriaEstrategica}

Misión: Paso 7 del Playbook (Seguimiento). Retoma el momentum exacto donde se quedaron. Sé casual. Si es base EXPIRADOS, recuérdale que "podemos reactivar tu proceso sin empezar de cero".`,
  
  resumen_crm: (ctx) => `
Resume la intención actual del cliente y la fricción principal basándote en este último mensaje: "${ctx.input}". Devuelve solo hechos cortos.`,
  
  mejorar_mensaje: (ctx) => `
Borrador original: "${ctx.input}"
Misión: Reescribir para eliminar basura corporativa. Hacerlo sonar como Top Closer de WhatsApp. Reducir texto a la mitad e inyectar autoridad.`,
};

// ─────────────────────────────────────────────
// 6. GUARDRAILS & POST-PROCESSING (RegEx)
// ─────────────────────────────────────────────
const BANNED_OPENERS = [
  /^hola[,!.]?\s*/i, /^buenos\s+días[,!.]?\s*/i, /^buenas\s+tardes[,!.]?\s*/i,
  /^perfecto[,.]?\s*/i, /^claro que sí[,.]?\s*/i, /^sin problema[,.]?\s*/i, 
  /^con gusto[,.]?\s*/i, /^entiendo[,.]?\s*/i, /^comprendo[,.]?\s*/i
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
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

// ─────────────────────────────────────────────
// 7. CALIBRACIÓN TÉRMICA POR ESTADO
// ─────────────────────────────────────────────
const TEMPERATURE_BY_ACTION = {
  resumen_crm: 0.1,  
  cerrar_venta: 0.2,   // Bajo determinismo para NO olvidar pedir el INE ni las Referencias.
  negociar_tasa: 0.4,  // Estricto para evitar mentir sobre la tasa.
  responder_objecion: 0.5,
  mejorar_mensaje: 0.6,
  seguimiento: 0.7,    // Alta temperatura: Creatividad requerida para revivir clientes.
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
      max_tokens: 600,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cognition_and_response",
          strict: true,
          schema: {
            type: "object",
            properties: {
              _inteligencia_conversacional: {
                type: "object",
                properties: {
                  paso_playbook: { type: "integer", description: "Paso del 1 al 7" },
                  micro_senal_compra: { type: "boolean" },
                  tecnica_rea_aplicada: { type: "boolean", description: "¿Se aplicó Reconoce, Empatiza, Asegura?" },
                  next_best_action: { type: "string" }
                },
                required: ["paso_playbook", "micro_senal_compra", "tecnica_rea_aplicada", "next_best_action"],
                additionalProperties: false
              },
              respuesta: { 
                type: "string",
                description: "Mensaje listo para WhatsApp."
              }
            },
            required: ["_inteligencia_conversacional", "respuesta"],
            additionalProperties: false
          }
        }
      }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    
    // Ejecutar el Guardrail Regex
    parsed.respuesta = cleanResponse(parsed.respuesta) || "¿Me detallas más ese punto para ayudarte?";

    return res.status(200).json({
      respuesta: parsed.respuesta,
      inteligencia: parsed._inteligencia_conversacional,
      _meta: { accion, request_id: requestId, tiempo_ms: Date.now() - startTime },
    });

  } catch (err) {
    console.error(`[${requestId}] Error:`, err.message);
    return res.status(500).json({ error: "Fallo en motor cognitivo." });
  }
}
