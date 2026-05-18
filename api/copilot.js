import OpenAI from "openai";

// Inicialización del cliente de OpenAI
const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ─────────────────────────────────────────────
// 1. BASE DE CONOCIMIENTO (Core Product)
// ─────────────────────────────────────────────
const CATALOGO_PRODUCTOS = `
- Montos: $10,000 a $400,000 MXN.
- Tiempos: Depósito en máx 2 horas, proceso 100% online.
- Ventaja competitiva principal: Sin burocracia, sin penalización por pago anticipado (liquidez flexible).
- Expansión: Posibilidad de ampliación de línea a partir del 3er pago puntual.
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
  if (!body.mensajeCliente || typeof body.mensajeCliente !== "string") {
    errors.push("El campo 'mensajeCliente' es requerido y debe ser de tipo string.");
  }
  return errors;
}

// ─────────────────────────────────────────────
// 3. SYSTEM PROMPT: COGNITIVE OVERHAUL
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres un Closer Senior de créditos personales en MultiMoney operando por WhatsApp. 
Tu rol no es "dar servicio al cliente", es evaluar prospectos, eliminar fricción, optimizar el momentum comercial y asegurar el fondeo.

${CATALOGO_PRODUCTOS}

━━━ PRINCIPIOS DE IDENTIDAD (BEHAVIORAL DESIGN) ━━━
1. ECONOMÍA DE PALABRAS: En WhatsApp menos es más. Usa respuestas asimétricas. Si el cliente escribe 4 palabras, no le envíes un párrafo.
2. CALIBRACIÓN: Adapta tu energía, longitud y ritmo al cliente sin perder tu autoridad comercial.
3. MOMENTUM COMERCIAL: Cada mensaje tuyo debe destrabar una fricción o avanzar al siguiente paso operativo. No dejes conversaciones abiertas.
4. COMUNICACIÓN DIRECTA: Eres humano, rápido y seguro. Cero formalismos corporativos vacíos.

━━━ STATE MACHINE: MODOS DE OPERACIÓN ━━━
Analiza la intención del cliente en el historial y opera bajo uno de estos dos modos estratégicos:

🔴 MODO PERSUASIÓN (El cliente tiene dudas lógicas, emocionales o de precio):
- Usa lógica basada en el uso que le dará al dinero.
- Acepta la objeción con naturalidad (ej. "Es normal comparar", "Entiendo que busques la mejor opción") y reencuadra rápidamente hacia nuestra ventaja: el tiempo y la flexibilidad (sin penalización por liquidar antes).
- Retoma el control siempre con una pregunta orientada a avanzar.

🟢 MODO FACILITACIÓN (¡CRÍTICO! - Triggered por Micro-señales de Compra):
- Si el cliente pregunta cosas operativas como: "¿Qué documentos necesito?", "¿Cómo me depositan?", "¿Cuánto pagaría al mes?", "¿Qué sigue?".
- ACCIÓN ESTRICTA: DEJA DE VENDER. Ya compró. Abandona la persuasión. No justifiques más el producto. Pasa a dar instrucciones directas, claras y pide el siguiente requisito (INE, CLABE, referencias).

━━━ EJEMPLOS DE CALIBRACIÓN AVANZADA ━━━
[CASO: Objeción de Tasa vs Banco]
Cliente: "La tasa está muy alta, en el banco es menos."
Tú: "Totalmente, el banco tradicional siempre tendrá una tasa más baja. Nuestra ventaja es que tienes el capital hoy mismo sin ir a sucursales ni papeleo. ¿Te urge el dinero para esta semana o tienes margen para esperar los tiempos del banco?"

[CASO: Micro-señal de compra -> Cambio a Facilitación]
Cliente: "¿Y cuánto tiempo tardan en depositar una vez aprobado?"
Tú: "Máximo 2 horas una vez firmes el contrato. ¿Te paso la lista de los 3 documentos que necesito para arrancar?"`;

// ─────────────────────────────────────────────
// 4. MEMORIA HÍBRIDA & CONTEXT BUILDER
// ─────────────────────────────────────────────
const renderCtx = (label, value) => (value ? `${label}: ${value}\n` : "");

const renderStrategicMemory = (datos) => {
  if (!datos.uso && !datos.monto && !datos.tasa) return "";
  return `\n[MEMORIA ESTRATÉGICA DEL CLIENTE]
${renderCtx("Uso planeado del capital", datos.uso)}
${renderCtx("Monto pre-aprobado", datos.monto)}
${renderCtx("Tasa asignada", datos.tasa)}\n`;
};

function buildContext(body) {
  const { accion, mensajeCliente, datosCliente = {} } = body;
  
  // Short-Term Memory: Últimos 5 mensajes
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
Mensaje actual del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${ctx.memoriaEstrategica}
Historial Reciente:\n${ctx.historial}

Misión: Rebatir y destrabar la objeción de forma contundente pero conversacional. 
EJECUCIÓN COMERCIAL (3 Pasos):
1. VALIDA SIN REPETIR: Acepta su preocupación rápidamente ("Te entiendo", "Es una duda válida") pero NO repitas su objeción para no anclarla en su mente.
2. REBATE CON LÓGICA: Destruye la objeción usando el [Uso planeado del capital] (si existe) o el beneficio estrella (liquidez inmediata sin burocracia y cero penalizaciones). Haz que la objeción parezca pequeña comparada con el beneficio de resolver su necesidad HOY MISMO.
3. CALL TO ACTION: No dejes silencios. Devuelve el control inmediatamente con una pregunta corta para avanzar hacia el siguiente requisito o cierre.`,

  negociar_tasa: (ctx) => `
Mensaje actual del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${ctx.memoriaEstrategica}

Misión: Ganar el debate lógico sobre la tasa cambiando el enfoque hacia el TIEMPO, LA AUSENCIA DE BUROCRACIA y la FLEXIBILIDAD (sin penalización por liquidar antes).
EJECUCIÓN COMERCIAL (Sigue estos 3 pasos de forma natural):
1. DEJA CAER LA GUARDIA: Dale la razón al cliente rápido y sin rodeos. Acepta que el banco tiene tasas más bajas (Ej: "Totalmente [Nombre], el banco siempre será más barato", "Haces bien en comparar la tasa"). Cero defensividad.
2. EL PIVOTE (REGLA ESTRICTA): Si existe un [Uso planeado del capital] en la Memoria Estratégica, ancla el beneficio ahí (Ej: para urgencias, deudas o lo que diga el contexto, la velocidad vale más que la tasa). PROHIBIDO inventar el uso; si no hay uso registrado en la memoria, enfócate en el beneficio universal: "tener el capital fondeado hoy mismo en tu cuenta sin ir a sucursales". 
3. EL MICRO-CIERRE: Termina con una pregunta asimétrica que lo haga decidir entre el costo (banco) y el tiempo (nosotros). Ej: "¿Tienes margen para esperar las semanas del banco o aseguramos tu capital hoy?".`,

  cerrar_venta: (ctx) => `
Mensaje actual del cliente: "${ctx.input}"
${ctx.memoriaEstrategica}
Historial Reciente:\n${ctx.historial}

Misión: Transicionar al cierre final. Si detectas intención operativa, entra inmediatamente en Modo Facilitación y pide el INE o el siguiente paso transaccional. Ve directo al grano.`,

  seguimiento: (ctx) => `
Último mensaje / objeción del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${ctx.memoriaEstrategica}

Misión: Reactivar momentum comercial. Ve al punto exacto donde se quedaron. Sé casual, asume que está ocupado trabajando, no ofrezcas disculpas ni suenes corporativo.`,
  
  resumen_crm: (ctx) => `
Resume la intención actual del cliente y la fricción principal basándote en este último mensaje: "${ctx.input}". Devuelve solo hechos.`,
  
  mejorar_mensaje: (ctx) => `
Borrador original: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}${ctx.memoriaEstrategica}

Misión: Eres un "Copilot" para un asesor. Tu trabajo es tomar este borrador débil/corporativo y reescribirlo para que suene como un Top Closer de WhatsApp.
REGLAS ESTRICTAS DE REESCRITURA (BEHAVIORAL DESIGN):
1. ELIMINA LA BASURA CORPORATIVA: Destruye saludos ("Hola", "Buen día"), frases de servicio al cliente ("Con gusto te apoyo", "Quedo a tus órdenes", "Entiendo tu situación") y despedidas.
2. INYECTA AUTORIDAD: Cambia palabras débiles ("vamos a intentar", "creo que", "espero") por certezas absolutas ("lo tenemos listo", "avanzamos con", "el siguiente paso es").
3. ECONOMÍA DE PALABRAS: Reduce la paja. Di lo mismo en la mitad de texto.
4. MOMENTUM COMERCIAL: Asegúrate de que el mensaje final termine con una pregunta corta y directa o una instrucción clarísima para que el cliente actúe. 
El resultado debe ser UN SOLO MENSAJE letal, directo y conversacional.`,
};

// ─────────────────────────────────────────────
// 6. GUARDRAILS & POST-PROCESSING LIGERO
// ─────────────────────────────────────────────
// Elimina saludos robóticos o redundantes de forma barata (RegEx)
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
  cerrar_venta: 0.3,   // Bajo determinismo: Necesitamos precisión operativa para pedir documentos
  negociar_tasa: 0.45, // Balance estratégico estricto para evitar alucinación de contexto
  responder_objecion: 0.6,
  mejorar_mensaje: 0.6,
  seguimiento: 0.7,    // Alta temperatura: Creatividad requerida para revivir clientes en ghosting
};

// ─────────────────────────────────────────────
// 8. HANDLER PRINCIPAL (API ROUTE)
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Headers CORS estándar
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método HTTP no permitido" });

  // 1. Validación de payload
  const validationErrors = validateInput(req.body);
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: validationErrors.join(" | ") });
  }

  // 2. Construcción de Contexto y Estrategia
  const ctx = buildContext(req.body);
  const { accion } = ctx;
  const userPrompt = ACCIONES[accion](ctx);
  const temperature = TEMPERATURE_BY_ACTION[accion] ?? 0.5;

  try {
    // 3. LLM Orchestration & Conversation Intelligence Layer
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Optimizamos costo/velocidad. Perfecto para Structured Outputs.
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: 600, // Aumentado para mayor holgura en razonamiento y rebatimiento robusto
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
                description: "Capa de razonamiento y state machine ejecutada ANTES de redactar la respuesta.",
                properties: {
                  etapa_detectada: { 
                    type: "string", 
                    enum: ["exploracion", "persuasion_activa", "facilitacion_operativa"] 
                  },
                  micro_senal_compra: { 
                    type: "boolean",
                    description: "¿El cliente hizo una pregunta logística/operativa que indica readiness para avanzar?"
                  },
                  nivel_friccion: { 
                    type: "integer", 
                    description: "Escala 1 al 10 indicando qué tan reacio está el cliente." 
                  },
                  riesgo_ghosting: { 
                    type: "integer", 
                    description: "Escala 1 al 10 indicando probabilidad de abandono." 
                  },
                  palanca_de_negociacion_usada: {
                    type: "string",
                    description: "El uso del capital detectado en la memoria para reencuadrar. Si no hay, escribe 'tiempo/conveniencia'."
                  },
                  next_best_action: { 
                    type: "string",
                    description: "Estrategia de 1 oración. Ej: 'Pedir INE', 'Reencuadrar objeción de tasa'."
                  }
                },
                required: ["etapa_detectada", "micro_senal_compra", "nivel_friccion", "riesgo_ghosting", "palanca_de_negociacion_usada", "next_best_action"],
                additionalProperties: false
              },
              respuesta: { 
                type: "string",
                description: "Mensaje comercial final para WhatsApp redactado basado estrictamente en el next_best_action."
              }
            },
            required: ["_inteligencia_conversacional", "respuesta"],
            additionalProperties: false
          }
        }
      }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    
    // 4. Limpieza Final (Guardrails)
    parsed.respuesta = cleanResponse(parsed.respuesta) || "¿Me podrías detallar un poco más ese punto para poder ayudarte?";

    const tiempo_respuesta_ms = Date.now() - startTime;

    // 5. Respuesta Final Integrada
    return res.status(200).json({
      respuesta: parsed.respuesta,
      inteligencia: parsed._inteligencia_conversacional, // Output crítico para tu backend/CRM
      _meta: {
        accion,
        request_id: requestId,
        tiempo_respuesta_ms,
        tokens: completion.usage?.total_tokens,
      },
    });

  } catch (err) {
    console.error(`[${requestId}] Error Crítico en Orquestación:`, err.message);
    return res.status(500).json({
      error: "Error procesando el motor cognitivo. Por favor, intente de nuevo.",
      request_id: requestId
    });
  }
}
