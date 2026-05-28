import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ═══════════════════════════════════════════════════════════════════
// MM SALES COPILOT API — v7.2 "Stable + Q&A Edition"
//
// CAMBIOS vs v7.1:
//   • REMOVIDO: streaming (era inestable en Vercel serverless).
//     Vuelta al pipeline no-stream confiable.
//   • NUEVA ACCIÓN: preguntar_ia. Modo Q&A: el asesor le pregunta
//     a la IA cualquier cosa sobre productos, políticas, escenarios.
//     Responde asesor-a-asesor (no asesor-a-cliente).
//   • Anti-invención y contexto manual: se mantienen.
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// CONFIG & KILL SWITCHES
// ─────────────────────────────────────────────
const CONFIG = {
  USE_GPT4O: process.env.USE_GPT4O !== "false",
  MAX_REQUESTS_PER_HOUR: parseInt(process.env.MAX_REQUESTS_PER_HOUR || "200", 10),
  MODEL_FAST: "gpt-4o-mini",
  MODEL_QUALITY: "gpt-4o",
};

// Rate limiter en memoria
const requestLog = [];
function checkRateLimit() {
  const oneHourAgo = Date.now() - 3600_000;
  while (requestLog.length && requestLog[0] < oneHourAgo) requestLog.shift();
  if (requestLog.length >= CONFIG.MAX_REQUESTS_PER_HOUR) return false;
  requestLog.push(Date.now());
  return true;
}

// ─────────────────────────────────────────────
// CATÁLOGO Y CONSTANTES
// ─────────────────────────────────────────────
const CATALOGO_DENSO = `Créditos personales MultiMoney MX: $10k-$400k MXN | Depósito ≤2h, 100% online | Sin penalización por pago anticipado (DIFERENCIADOR) | Ampliación desde 3er pago puntual | Pre-aprobación válida 48h.`;

const ACCIONES_VALIDAS = [
  "responder_objecion", "negociar_tasa", "cerrar_venta",
  "seguimiento", "resumen_crm", "mejorar_mensaje",
  "preguntar_ia", // [v7.2] Q&A libre asesor → IA
];

const SENALES_ENUM = [
  "sensibilidad_precio", "urgencia", "comparacion_competencia",
  "alta_intencion", "desconfianza", "riesgo_ghosting",
  "validacion_seguridad", "necesidad_liquidez", "friccion_documental",
  "indecision", "interes_ampliacion", "resistencia_tasa",
  "interes_pago_anticipado",
];

const ACCIONES_PREMIUM = new Set([
  "responder_objecion", "negociar_tasa", "cerrar_venta",
  "seguimiento", "mejorar_mensaje",
]);

const LIMITES = {
  MENSAJE_CLIENTE_MAX: 800,
  CONTEXT_MAX: 1500,
  OBJETIVO_MAX: 200,
  HISTORIAL_ITEMS: 4,
  BORRADOR_MAX: 800,
  MENSAJES_RECIENTES: 5,
};

// ─────────────────────────────────────────────
// VALIDACIÓN
// ─────────────────────────────────────────────
function validateInput(body) {
  const errors = [];
  if (!body || typeof body !== "object") return ["Body inválido"];

  if (!body.accion || !ACCIONES_VALIDAS.includes(body.accion)) {
    errors.push(`Acción inválida. Disponibles: ${ACCIONES_VALIDAS.join(", ")}`);
  }

  const tieneContexto = typeof body.conversationContext === "string" && body.conversationContext.trim();
  const tieneMensaje = typeof body.mensajeCliente === "string" && body.mensajeCliente.trim();
  const tieneBorrador = typeof body.borrador === "string" && body.borrador.trim();
  const tienePregunta = typeof body.pregunta === "string" && body.pregunta.trim();

  if (body.accion === "mejorar_mensaje") {
    if (!tieneBorrador) errors.push("mejorar_mensaje requiere 'borrador' no vacío");
  } else if (body.accion === "preguntar_ia") {
    if (!tienePregunta) errors.push("preguntar_ia requiere 'pregunta' no vacía");
  } else if (!tieneContexto && !tieneMensaje) {
    errors.push("Se requiere conversationContext o mensajeCliente");
  }

  return errors;
}

// ─────────────────────────────────────────────
// ANTI-INJECTION
// ─────────────────────────────────────────────
const INJECTION_PATTERNS = [
  /ignora\s+(las\s+)?instrucciones/i,
  /ignore\s+(previous|all)\s+instructions/i,
  /system\s*[:>]/i,
  /\[INST\]/i,
  /<\|.*?\|>/g,
];

function sanitizeUserText(text) {
  if (!text || typeof text !== "string") return "";
  let clean = text;
  for (const pattern of INJECTION_PATTERNS) {
    clean = clean.replace(pattern, "[contenido filtrado]");
  }
  return clean.trim();
}

// ─────────────────────────────────────────────
// CONTEXTO TEMPORAL
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
  return { franja, finDeSemana: dia === 0 || dia === 6, horaCDMX };
}

// ─────────────────────────────────────────────
// PARSER DE CONVERSACIÓN
// ─────────────────────────────────────────────
const REGEX_PREFIJO_CLIENTE = /^\s*(cliente|prospecto|usuario|user|customer|lead)\s*[:\-]/i;
const REGEX_PREFIJO_ASESOR = /^\s*(asesor|agente|advisor|yo|me|tú|tu|operador|multimoney|mm)\s*[:\-]/i;
const REGEX_TIMESTAMP = /^\s*\d{1,2}:\d{2}(\s*(am|pm|AM|PM))?\s*$/;
const REGEX_FECHA = /^\s*(hoy|ayer|lun|mar|mié|jue|vie|sáb|dom|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i;
const REGEX_RUIDO = /^\s*.*?(leído|entregado|enviado|delivered|read|sent|escribiendo|typing|in[\s-]?app|transferido|asignado a|bot[\s:]|chatbot|ticket #|chat cerrado|sistema:|system:).*?\s*\.?\s*$/i;

function esLineaRuido(linea) {
  if (!linea || linea.trim().length === 0) return true;
  if (REGEX_TIMESTAMP.test(linea)) return true;
  if (REGEX_RUIDO.test(linea)) return true;
  if (linea.trim().length <= 2 && !/[a-záéíóúñ0-9]/i.test(linea)) return true;
  return false;
}

function shouldMergeWithPrevious(lineaActual, mensajeAnterior, rolDetectado, rolAnterior) {
  if (!mensajeAnterior || rolDetectado !== rolAnterior) return false;
  const trimmed = lineaActual.trim();
  if (trimmed.length < 40 && !/[.!?]$/.test(mensajeAnterior.texto)) return true;
  if (/^[a-záéíóúñ]/.test(trimmed)) return true;
  if (/^(pero|y|además|también|aunque|porque|o sea|es decir|entonces)\b/i.test(trimmed)) return true;
  if (!/[.!?]$/.test(mensajeAnterior.texto) && trimmed.length < 80) return true;
  return false;
}

function parseConversationContext(raw) {
  const fallback = {
    mensajes: [], ultimoMensajeCliente: null, ultimoMensajeAsesor: null,
    resumenContextual: "", totalMensajes: 0, fuente: "fallback",
  };

  if (!raw || typeof raw !== "string") return fallback;
  const texto = sanitizeUserText(raw).slice(0, LIMITES.CONTEXT_MAX);
  if (!texto) return fallback;

  const lineas = texto.split(/\r?\n+/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !esLineaRuido(l) && !REGEX_FECHA.test(l));

  if (lineas.length === 0) return fallback;

  const mensajes = [];
  let rolActual = null;

  for (const linea of lineas) {
    let rol = null;
    let contenido = linea;

    if (REGEX_PREFIJO_CLIENTE.test(linea)) {
      rol = "cliente";
      contenido = linea.replace(REGEX_PREFIJO_CLIENTE, "").trim();
    } else if (REGEX_PREFIJO_ASESOR.test(linea)) {
      rol = "asesor";
      contenido = linea.replace(REGEX_PREFIJO_ASESOR, "").trim();
    } else {
      rol = rolActual || "cliente";
    }

    if (!contenido) continue;

    const ultimo = mensajes[mensajes.length - 1];
    if (ultimo && shouldMergeWithPrevious(contenido, ultimo, rol, ultimo.rol)) {
      ultimo.texto += " " + contenido;
    } else if (ultimo && ultimo.rol === rol && !/[.!?]$/.test(ultimo.texto)) {
      ultimo.texto += " " + contenido;
    } else {
      mensajes.push({ rol, texto: contenido });
    }
    rolActual = rol;
  }

  if (mensajes.length === 0) return fallback;

  const mensajesRecortados = mensajes.slice(-LIMITES.MENSAJES_RECIENTES);

  const ultimoCliente = [...mensajesRecortados].reverse().find(m => m.rol === "cliente");
  const ultimoAsesor = [...mensajesRecortados].reverse().find(m => m.rol === "asesor");

  const resumenContextual = mensajesRecortados
    .map(m => `${m.rol === "cliente" ? "Cliente" : "Asesor"}: ${m.texto}`)
    .join("\n");

  return {
    mensajes: mensajesRecortados,
    ultimoMensajeCliente: ultimoCliente?.texto || null,
    ultimoMensajeAsesor: ultimoAsesor?.texto || null,
    resumenContextual,
    totalMensajes: mensajesRecortados.length,
    fuente: "parsed",
  };
}

// ─────────────────────────────────────────────
// EXTRACCIÓN DE MONTOS DEL INPUT (para validación)
// ─────────────────────────────────────────────
// Extrae montos que SÍ aparecen en la conversación o mensaje subrayado.
// Sirve para validar que el output no mencione montos inventados.
function extraerMontosDelInput(textoCompleto) {
  if (!textoCompleto) return new Set();
  const montos = new Set();

  // Patrones ordenados de más específico a menos específico
  const patterns = [
    // $3,000 / $3.000 / $1,200.50 (con separador de miles obligatorio)
    /\$\s?(\d{1,3}(?:[,.\s]\d{3})+(?:\.\d{2})?)/g,
    // $50000 / $3000000 (sin separadores, 4+ dígitos)
    /\$\s?(\d{4,})/g,
    // $400k / $50K
    /\$\s?(\d+)\s*[kK]\b/g,
    // 50,000 pesos / 3000 MXN
    /\b(\d{1,3}(?:[,.\s]\d{3})+|\d{4,})\s*(?:pesos|mxn|MXN)\b/gi,
    // 50 mil / 3 mil
    /\b(\d+)\s*mil\b/gi,
  ];

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(textoCompleto)) !== null) {
      let num = m[1].replace(/[^\d]/g, "");
      // Si el patrón fue "X mil" o "$X k", multiplicar por 1000
      const fullMatch = m[0].toLowerCase();
      if (/\bmil\b/.test(fullMatch) || /\s?[kK]\b/.test(fullMatch)) {
        num = String(parseInt(num, 10) * 1000);
      }
      // Solo registrar si es >= 1000 (descarta números pequeños tipo edad, días, números de teléfono parciales)
      if (num && parseInt(num, 10) >= 1000) montos.add(num);
    }
  }
  return montos;
}

// Valida si el output menciona montos que NO estaban en el input
function validarMontosOutput(output, montosPermitidos) {
  if (!output || montosPermitidos.size === 0) {
    // Si no hay montos permitidos, cualquier monto en output es sospechoso
    const tieneMontosOutput = /\$\s?\d|\d+\s*(?:mil|pesos|mxn)\b/i.test(output);
    return { sospechoso: tieneMontosOutput, montosInventados: [] };
  }

  const montosOutput = extraerMontosDelInput(output);
  const inventados = [];
  for (const m of montosOutput) {
    if (!montosPermitidos.has(m)) inventados.push(m);
  }
  return { sospechoso: inventados.length > 0, montosInventados: inventados };
}

// ─────────────────────────────────────────────
// SYSTEM PROMPTS
// ─────────────────────────────────────────────
const SYSTEM_PROMPT_ANALISIS = `Eres un analista comercial senior de MultiMoney México (fintech de créditos personales). Tu trabajo es leer una conversación de WhatsApp entre asesor y cliente y producir un BRIEFING estratégico para que otro modelo redacte la respuesta perfecta.

${CATALOGO_DENSO}

TU TAREA: Analizar, NO redactar. Producir inteligencia accionable.

ANALIZA:
- Etapa comercial (descubrimiento/evaluación/negociación/cierre/seguimiento/riesgo_ghosting)
- Momentum (subiendo/estable/bajando) con evidencia textual
- Emoción del cliente y nivel de confianza (0-100)
- Probabilidad de cierre (0-100) con razón factual breve
- Táctica recomendada en 1 frase clara
- Riesgos a evitar (ej: sonar desesperado, repetir argumento ya usado, pedir docs sin justificar)

REGLAS DE ANÁLISIS:
1. Si el cliente ya rechazó rotundamente o compró con la competencia → marca etapa=riesgo_ghosting + táctica=retiro_amable.
2. Si el asesor ya usó un argumento y no funcionó → NO lo recomiendes de nuevo.
3. Si momentum baja → priorizar recuperar interés sobre cerrar.
4. Si momentum sube + etapa=cierre → recomendar pedir próximo requisito (INE/CLABE/comprobante) justificado con fondeo rápido.
5. La "escasez táctica" (pre-aprobación 48h) es una HERRAMIENTA, no muletilla. Recomiéndala solo si: indecisión clara, ghosting incipiente, o resistencia de tasa repetida.
6. IMPORTANTE: en el briefing_redactor, especifica QUÉ datos concretos puede mencionar el redactor (montos, tasas, plazos que SÍ están en la conversación). Si NO hay datos en la conversación, indica al redactor "habla en abstracto, no inventes números".`;

const SYSTEM_PROMPT_REDACCION = `Eres un asesor financiero senior de MultiMoney México que responde por WhatsApp. Recibes un BRIEFING estratégico de tu equipo de análisis y tu único trabajo es escribir el mensaje perfecto al cliente.

${CATALOGO_DENSO}

C�MO SUENAS:
Como un asesor de fintech mexicana seria (estilo Kueski, Konfío, Nu): cercano sin ser coloquial, claro sin ser frío, ágil sin ser apurado. Tuteo natural. Frases cortas con verbos de acción.

EJEMPLOS DE VOZ (calibra tu output a esto):

[Cliente: "está cara la tasa"]
✅ "Tiene sentido revisarlo. La diferencia aquí es que tienes el dinero en 2 horas y sin penalización si liquidas antes. ¿Te calculo cómo quedan las cuotas a 12 o 18 meses?"

[Cliente: "lo voy a pensar"]
✅ "Tómate el tiempo. Solo considera que tu pre-aprobación tiene 48h de vigencia. ¿Te escribo mañana en la tarde?"

[Cliente: "ya casi, qué necesito"]
✅ "Para que tu dinero esté hoy en tu cuenta, mándame foto de tu INE por ambos lados. En cuanto la tenga seguimos con CLABE."

[Cliente: "ustedes cobran 40%, eso es robo, mejor uso mi tarjeta"]
✅ "Tiene sentido compararlo. La diferencia es que tu tarjeta te cobra una comisión alta solo por sacar efectivo, más interés corriente sobre todo el saldo. Aquí pagas únicamente por lo que usas y el tiempo que lo tienes. ¿Te calculo qué sale más barato a 6 meses?"

REGLAS DURAS (6 — críticas):
1. NUNCA inicies con saludo (asume conversación en curso).
2. NUNCA inventes datos. Esta es la regla más importante:
   - Si NO ves un monto, tasa, plazo o nombre en la conversación o en el mensaje del cliente, NO lo menciones.
   - Habla en abstracto ("el monto que necesitas", "la cuota que te quede", "tu pre-aprobación") en vez de inventar cifras.
   - Si el briefing del estratega te dice "no hay datos", obedece y habla genérico.
3. NUNCA prometas aprobación. Trabaja sobre pre-aprobación o lo ya cotizado.
4. Longitud: 1-4 oraciones. WhatsApp, no email. A veces una frase basta.
5. Si pides documentos, justifica con el beneficio (fondeo hoy). Si no pides docs, no fuerces CTA.
6. RESPONDE AL ÚLTIMO MENSAJE DEL CLIENTE. Si el cliente comparó vs competencia, responde la comparación. Si objetó tasa, responde la objeción. NO ignores lo que acaba de decir para pitchearle algo distinto.

LO QUE NO HACES:
- No suenas a call center ("Estimado", "Quedo a sus órdenes", "Con gusto")
- No suenas a bot ("Comprendo tu situación", "Es un placer")
- No suenas a coach ("¡Excelente decisión!", "¡Vamos por más!")
- No suenas a vendedor callejero ("va", "sale", "te late", "checa", "órale")
- No repites literal lo que el asesor ya dijo antes en el chat
- No fuerzas urgencia, persuasión o escasez si el briefing no lo pide

VARIACIÓN:
A veces el mejor mensaje es corto y directo. A veces necesita más calor. A veces termina con pregunta, a veces no. El briefing te dice la táctica — tú le pones la voz humana.`;

// ─────────────────────────────────────────────
// SCHEMAS
// ─────────────────────────────────────────────
const SCHEMA_ANALISIS = {
  name: "briefing_estrategico",
  strict: true,
  schema: {
    type: "object",
    properties: {
      razonamiento_interno: {
        type: "object",
        properties: {
          etapa_detectada: { type: "string" },
          momentum_evidencia: { type: "string" },
          tactica_elegida: { type: "string" },
          riesgos: { type: "string" },
        },
        required: ["etapa_detectada", "momentum_evidencia", "tactica_elegida", "riesgos"],
        additionalProperties: false,
      },
      analisis_conversacion: {
        type: "object",
        properties: {
          etapa_conversacion: {
            type: "string",
            enum: ["descubrimiento", "evaluacion", "negociacion", "cierre", "seguimiento", "riesgo_ghosting"],
          },
          momentum: { type: "string", enum: ["subiendo", "estable", "bajando"] },
          nivel_confianza: { type: "integer", minimum: 0, maximum: 100 },
          senales_detectadas: {
            type: "array",
            items: { type: "string", enum: SENALES_ENUM },
          },
          objecion_dominante: { type: ["string", "null"] },
        },
        required: ["etapa_conversacion", "momentum", "nivel_confianza", "senales_detectadas", "objecion_dominante"],
        additionalProperties: false,
      },
      analisis_cliente: {
        type: "object",
        properties: {
          emocion: {
            type: "string",
            enum: ["ansioso", "desconfiado", "indeciso", "interesado", "molesto", "comparando", "neutral", "entusiasmado"],
          },
          estado_cliente: { type: "string", enum: ["Frío", "Tibio", "Caliente"] },
          tipo_objecion: {
            type: ["string", "null"],
            enum: ["precio", "desconfianza", "indecision", "falta_de_tiempo", "comparacion", "ghosting", null],
          },
          probabilidad_cierre: { type: "integer", minimum: 0, maximum: 100 },
          razon_score: { type: "string" },
        },
        required: ["emocion", "estado_cliente", "tipo_objecion", "probabilidad_cierre", "razon_score"],
        additionalProperties: false,
      },
      briefing_redactor: { type: "string" },
      siguiente_jugada: { type: "string" },
    },
    required: ["razonamiento_interno", "analisis_conversacion", "analisis_cliente", "briefing_redactor", "siguiente_jugada"],
    additionalProperties: false,
  },
};

const SCHEMA_REDACCION_SIMPLE = {
  name: "respuesta_whatsapp",
  strict: true,
  schema: {
    type: "object",
    properties: {
      respuesta: { type: "string" },
    },
    required: ["respuesta"],
    additionalProperties: false,
  },
};

const SCHEMA_REDACCION_VARIANTES = {
  name: "respuestas_whatsapp_variantes",
  strict: true,
  schema: {
    type: "object",
    properties: {
      variante_recomendada: { type: "string", enum: ["empatica", "directa", "educativa"] },
      variantes: {
        type: "object",
        properties: {
          empatica: {
            type: "object",
            properties: { mensaje: { type: "string" }, cuando_usar: { type: "string" } },
            required: ["mensaje", "cuando_usar"], additionalProperties: false,
          },
          directa: {
            type: "object",
            properties: { mensaje: { type: "string" }, cuando_usar: { type: "string" } },
            required: ["mensaje", "cuando_usar"], additionalProperties: false,
          },
          educativa: {
            type: "object",
            properties: { mensaje: { type: "string" }, cuando_usar: { type: "string" } },
            required: ["mensaje", "cuando_usar"], additionalProperties: false,
          },
        },
        required: ["empatica", "directa", "educativa"],
        additionalProperties: false,
      },
    },
    required: ["variante_recomendada", "variantes"],
    additionalProperties: false,
  },
};

const SCHEMA_RESUMEN_CRM = {
  name: "resumen_crm",
  strict: true,
  schema: {
    type: "object",
    properties: {
      respuesta: { type: "string" },
      analisis_conversacion: {
        type: "object",
        properties: {
          etapa_conversacion: {
            type: "string",
            enum: ["descubrimiento", "evaluacion", "negociacion", "cierre", "seguimiento", "riesgo_ghosting"],
          },
          momentum: { type: "string", enum: ["subiendo", "estable", "bajando"] },
          nivel_confianza: { type: "integer", minimum: 0, maximum: 100 },
          senales_detectadas: { type: "array", items: { type: "string", enum: SENALES_ENUM } },
          objecion_dominante: { type: ["string", "null"] },
        },
        required: ["etapa_conversacion", "momentum", "nivel_confianza", "senales_detectadas", "objecion_dominante"],
        additionalProperties: false,
      },
      siguiente_jugada: { type: "string" },
    },
    required: ["respuesta", "analisis_conversacion", "siguiente_jugada"],
    additionalProperties: false,
  },
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function renderConversacion(conversacion, inputFallback, contextoManual = false) {
  if (conversacion?.fuente === "parsed" && conversacion.resumenContextual) {
    const ultimo = conversacion.ultimoMensajeCliente || inputFallback;
    const fuentePrefix = contextoManual
      ? "CONVERSACIÓN (pegada por el asesor, FUENTE DE VERDAD):"
      : "CONVERSACIÓN RECIENTE (extraída del chat):";
    return `${fuentePrefix}\n${conversacion.resumenContextual}\n\nÚltimo mensaje del cliente: "${ultimo}"`;
  }
  return `Mensaje del cliente: "${inputFallback}"`;
}

function renderDatos(ctx) {
  const parts = [];
  if (ctx.nombre) parts.push(`Nombre: ${ctx.nombre}`);
  if (ctx.objetivo) parts.push(`Objetivo del asesor: ${ctx.objetivo}`);
  return parts.length ? parts.join(" | ") : null;
}

// ─────────────────────────────────────────────
// USER PROMPTS
// ─────────────────────────────────────────────
function buildPromptAnalisis(ctx) {
  const { accion, conversacion, input, momento, contextoManual } = ctx;

  if (accion === "mejorar_mensaje") {
    const conversacionStr = conversacion?.fuente === "parsed"
      ? `${contextoManual ? "CONVERSACIÓN PREVIA (pegada por el asesor)" : "CONVERSACIÓN PREVIA"} (CONTEXTO, NO ES A ESTO LO QUE RESPONDEN):\n${conversacion.resumenContextual}\n\n`
      : "";

    return `ACCIÓN: Analizar para MEJORAR un borrador del asesor

${conversacionStr}BORRADOR DEL ASESOR (esto es lo que el asesor escribió y quiere mejorar):
"${ctx.borrador}"

${renderDatos(ctx) || ""}

ANALIZA:
- ¿Qué INTENCIÓN tiene el borrador del asesor?
- ¿El borrador es coherente con la conversación previa?
- ¿Qué le falta o qué le sobra al borrador?
- ¿Qué datos concretos (montos/tasas/plazos) puede mencionar el redactor SIN inventar?
- En el briefing_redactor: instrucción clara de cómo reescribirlo manteniendo la intención del asesor pero aplicando metodología MultiMoney.
- IMPORTANTE: El briefing_redactor debe decir REESCRIBIR el borrador, NO responder a la conversación.`;
  }

  const conversacionStr = renderConversacion(conversacion, input, contextoManual);
  const datos = renderDatos(ctx);

  const accionLabel = {
    responder_objecion: "Responder una objeción del cliente",
    negociar_tasa: "Negociar la tasa sin bajarla (defender valor)",
    cerrar_venta: "Cerrar la venta pidiendo siguiente requisito",
    seguimiento: "Seguimiento (cliente sin respuesta o pendiente)",
    resumen_crm: "Generar nota CRM factual",
  }[accion];

  const trustNote = contextoManual
    ? "\n\nNOTA: La conversación fue pegada manualmente por el asesor. Confía 100% en ella, es la fuente de verdad."
    : "\n\nNOTA: La conversación fue extraída del DOM, puede tener ruido. Si algún dato parece extraño, asume que NO está confirmado.";

  return `ACCIÓN: ${accionLabel}

${conversacionStr}

${datos || ""}
Momento: ${momento.franja}${momento.finDeSemana ? " (fin de semana)" : ""}${trustNote}

Analiza la situación completa y produce el briefing estratégico para el redactor.
IMPORTANTE: En briefing_redactor, lista los datos concretos (montos/tasas/plazos) que SÍ aparecen en la conversación. Si no hay, di explícitamente "no hay datos numéricos, hablar en abstracto".`;
}

function buildPromptRedaccion(ctx, briefing, modoVariantes) {
  const { accion, conversacion, input, contextoManual } = ctx;

  let contextoUltimoMsg;
  if (accion === "mejorar_mensaje") {
    const conversacionStr = conversacion?.fuente === "parsed"
      ? `\nCONVERSACIÓN PREVIA (solo contexto):\n${conversacion.resumenContextual}\n`
      : "";
    contextoUltimoMsg = `${conversacionStr}\nBORRADOR DEL ASESOR A REESCRIBIR:\n"${ctx.borrador}"`;
  } else {
    contextoUltimoMsg = renderConversacion(conversacion, input, contextoManual);
  }

  const datos = renderDatos(ctx);

  const briefingStr = `BRIEFING DEL EQUIPO DE ANÁLISIS:
- Etapa: ${briefing.analisis_conversacion.etapa_conversacion}
- Momentum: ${briefing.analisis_conversacion.momentum}
- Emoción cliente: ${briefing.analisis_cliente.emocion}
- Estado: ${briefing.analisis_cliente.estado_cliente}
- Táctica: ${briefing.razonamiento_interno.tactica_elegida}
- Riesgos a evitar: ${briefing.razonamiento_interno.riesgos}

INSTRUCCIÓN CONCRETA: ${briefing.briefing_redactor}

RECORDATORIO CRÍTICO: Solo menciona montos/tasas/plazos que aparezcan textualmente en la conversación o el mensaje del cliente. Si no hay, habla en abstracto.`;

  if (modoVariantes) {
    return `${contextoUltimoMsg}

${datos || ""}

${briefingStr}

Genera 3 variantes del mensaje:
- empatica: más cálida, valida emoción primero (no terapéutica, sobria)
- directa: corta, al grano, ejecutiva
- educativa: explica brevemente el "por qué" del diferencial MultiMoney

Para cada variante incluye "cuando_usar" en 1 frase corta.
Indica cuál es la "variante_recomendada" según el briefing.`;
  }

  return `${contextoUltimoMsg}

${datos || ""}

${briefingStr}

Escribe el mensaje al cliente siguiendo el briefing. Solo el mensaje, listo para enviar por WhatsApp.`;
}

// ─────────────────────────────────────────────
// POST-PROCESSING
// ─────────────────────────────────────────────
const BANNED_OPENERS = [
  /^hola[,!.]?\s*/i, /^buenos\s+días[,!.]?\s*/i, /^buenas\s+tardes[,!.]?\s*/i,
  /^buenas\s+noches[,!.]?\s*/i, /^buen\s+día[,!.]?\s*/i,
  /^estimado[a]?[,.]?\s*/i,
  /^entiendo tu situación[,.]?\s*/i, /^comprendo perfectamente[,.]?\s*/i,
  /^excelente decisión[,.!]?\s*/i, /^excelente pregunta[,.!]?\s*/i,
  /^órale[,.!]?\s*/i, /^ándale[,.!]?\s*/i,
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
// BUILD CONTEXT
// ─────────────────────────────────────────────
function buildContext(body) {
  const { accion, mensajeCliente, conversationContext, objetivo, borrador, pregunta, datosCliente = {}, contextoManual } = body;

  let conversacion = null;
  let inputPrincipal = "";
  let modoEntrada = "legacy";

  if (typeof conversationContext === "string" && conversationContext.trim()) {
    conversacion = parseConversationContext(conversationContext);
    inputPrincipal = sanitizeUserText(conversacion.ultimoMensajeCliente || mensajeCliente || "");
    modoEntrada = "contextual";
  } else if (typeof mensajeCliente === "string") {
    inputPrincipal = sanitizeUserText(mensajeCliente);
  }

  inputPrincipal = inputPrincipal.slice(0, LIMITES.MENSAJE_CLIENTE_MAX);

  const textoCompleto = [
    conversacion?.resumenContextual || "",
    inputPrincipal,
    borrador || "",
  ].join(" ");
  const montosPermitidos = extraerMontosDelInput(textoCompleto);

  return {
    accion,
    input: inputPrincipal,
    conversacion,
    modoEntrada,
    contextoManual: contextoManual === true,
    objetivo: sanitizeUserText(objetivo || "").slice(0, LIMITES.OBJETIVO_MAX) || null,
    borrador: borrador ? sanitizeUserText(borrador).slice(0, LIMITES.BORRADOR_MAX) : null,
    pregunta: pregunta ? sanitizeUserText(pregunta).slice(0, 500) : null, // [v7.2]
    nombre: datosCliente.nombre ? sanitizeUserText(datosCliente.nombre).slice(0, 100) : null,
    momento: getMomentoMexico(),
    montosPermitidos,
  };
}

// ─────────────────────────────────────────────
// LLAMADAS A OPENAI
// ─────────────────────────────────────────────
async function llamarAnalisis(ctx) {
  const prompt = buildPromptAnalisis(ctx);
  const completion = await openai.chat.completions.create({
    model: CONFIG.MODEL_FAST,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_ANALISIS },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 700,
    response_format: { type: "json_schema", json_schema: SCHEMA_ANALISIS },
  });
  return {
    parsed: JSON.parse(completion.choices[0].message.content),
    tokens: completion.usage?.total_tokens || 0,
  };
}

async function llamarRedaccion(ctx, briefing, modoVariantes) {
  const prompt = buildPromptRedaccion(ctx, briefing, modoVariantes);
  const modelo = CONFIG.USE_GPT4O ? CONFIG.MODEL_QUALITY : CONFIG.MODEL_FAST;
  const schema = modoVariantes ? SCHEMA_REDACCION_VARIANTES : SCHEMA_REDACCION_SIMPLE;

  const completion = await openai.chat.completions.create({
    model: modelo,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_REDACCION },
      { role: "user", content: prompt },
    ],
    temperature: modoVariantes ? 0.85 : 0.8,
    max_tokens: modoVariantes ? 600 : 300,
    response_format: { type: "json_schema", json_schema: schema },
  });
  return {
    parsed: JSON.parse(completion.choices[0].message.content),
    tokens: completion.usage?.total_tokens || 0,
    modelo,
  };
}

async function llamarResumenCRM(ctx) {
  const conversacionStr = renderConversacion(ctx.conversacion, ctx.input, ctx.contextoManual);
  const datos = renderDatos(ctx);

  const prompt = `Genera una nota CRM factual en 2-3 líneas máximo. Solo datos, sin adjetivos subjetivos. Incluye etapa actual y siguiente paso lógico.

${conversacionStr}

${datos || ""}`;

  const completion = await openai.chat.completions.create({
    model: CONFIG.MODEL_FAST,
    messages: [
      { role: "system", content: `Eres analista CRM de MultiMoney México. ${CATALOGO_DENSO}\nProduces notas CRM factuales: solo datos, sin opiniones, sin recomendaciones de "intentar de nuevo más tarde".\nNUNCA inventes datos no presentes en la conversación.` },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 350,
    response_format: { type: "json_schema", json_schema: SCHEMA_RESUMEN_CRM },
  });

  return {
    parsed: JSON.parse(completion.choices[0].message.content),
    tokens: completion.usage?.total_tokens || 0,
  };
}

// ─────────────────────────────────────────────
// [v7.2] PREGUNTAR A LA IA (Q&A asesor → IA)
// ─────────────────────────────────────────────
const SYSTEM_PROMPT_PREGUNTAR = `Eres un asesor financiero senior y mentor del equipo comercial de MultiMoney México (fintech de créditos personales). Un colega del equipo (otro asesor humano) te hace una pregunta sobre el producto, políticas, casos difíciles, escenarios hipotéticos, o cómo manejar una situación.

${CATALOGO_DENSO}

REGLAS:
1. Respondes AL ASESOR, no al cliente. Tuteo de colega ("revisa", "pregúntale", "lo que harías es...").
2. Eres DIRECTO y PRÁCTICO. Sin floreo. Sin saludos. Sin despedidas. Sin "espero que esto te ayude".
3. Si no sabes algo factual (tasas exactas vigentes, políticas internas no documentadas), DILO. No inventes. Sugiere consultarlo con el supervisor o el sistema interno.
4. Longitud: 2-5 oraciones máximo. WhatsApp interno, no manual corporativo.
5. Si la pregunta es muy abierta o ambigua, pide UNA aclaración corta antes de responder.
6. Si la pregunta es sobre un cliente específico y tienes contexto de conversación, úsalo. Si no, responde en términos generales.
7. Cuando aplique, da un MICRO-SCRIPT: "Le puedes decir: '...' " — para que el asesor pueda copiar y usar.
8. NO inventes datos no presentes (montos específicos, tasas exactas no del catálogo, plazos personalizados).

EJEMPLOS DE VOZ:

[Pregunta: "qué hago si el cliente no tiene comprobante de ingresos formal?"]
✅ "Pídele estado de cuenta de los últimos 3 meses donde se vean depósitos recurrentes. Si es informal puro, escálalo con tu supervisor — algunos perfiles entran con co-deudor. Le puedes decir: 'No te preocupes, hay varias opciones, mándame un estado de cuenta donde se vean tus ingresos típicos.'"

[Pregunta: "cuál es la tasa exacta para $50,000 a 24 meses?"]
✅ "Esa la sacas del cotizador interno, no la tengo memorizada (varía por buró). Lo que sí: ese plazo y monto cae en rango medio, normalmente sale más competitivo que la mayoría de bancos. Mándale primero la cotización antes de mencionar tasa."

[Pregunta: "el cliente ya rechazó tres veces, sigo insistiendo?"]
✅ "No. Retiro amable: 'Te dejo el espacio. Si en algún momento retomas, aquí estoy.' Mover al CRM a follow-up de 30 días. Insistir te quema al lead."`;

const SCHEMA_PREGUNTAR = {
  name: "respuesta_qa_interno",
  strict: true,
  schema: {
    type: "object",
    properties: {
      respuesta: { type: "string" },
    },
    required: ["respuesta"],
    additionalProperties: false,
  },
};

async function llamarPreguntarIA(ctx) {
  const conversacionStr = ctx.conversacion?.fuente === "parsed"
    ? `\nCONTEXTO DE CONVERSACIÓN CON EL CLIENTE (si aplica):\n${ctx.conversacion.resumenContextual}\n`
    : "";

  const prompt = `PREGUNTA DEL ASESOR HUMANO:
"${ctx.pregunta}"
${conversacionStr}
${ctx.nombre ? `Cliente en contexto: ${ctx.nombre}` : ""}

Responde como mentor del equipo. Directo, práctico, sin floreo.`;

  // Q&A es factual → usar mini para ahorrar tokens
  const completion = await openai.chat.completions.create({
    model: CONFIG.MODEL_FAST,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_PREGUNTAR },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 400,
    response_format: { type: "json_schema", json_schema: SCHEMA_PREGUNTAR },
  });

  return {
    parsed: JSON.parse(completion.choices[0].message.content),
    tokens: completion.usage?.total_tokens || 0,
  };
}

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

  if (!checkRateLimit()) {
    return res.status(429).json({
      error: "Rate limit alcanzado (protección de presupuesto). Intenta en unos minutos.",
      request_id: requestId,
    });
  }

  const validationErrors = validateInput(req.body);
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: validationErrors.join(". "), request_id: requestId });
  }

  const ctx = buildContext(req.body);
  const { accion } = ctx;
  const modoVariantes = req.body.modo === "variantes" && ACCIONES_PREMIUM.has(accion);

  try {
    // ─── RUTA 1: resumen_crm (solo mini, JSON) ───
    if (accion === "resumen_crm") {
      const { parsed, tokens } = await llamarResumenCRM(ctx);
      const tiempo_respuesta_ms = Date.now() - startTime;

      return res.status(200).json({
        respuesta: cleanResponse(parsed.respuesta) || "Sin datos suficientes para resumen.",
        razonamiento_interno: null,
        analisis_conversacion: parsed.analisis_conversacion,
        siguiente_jugada: parsed.siguiente_jugada,
        _meta: {
          accion, request_id: requestId, tiempo_respuesta_ms,
          tokens, version: "7.2", modo_entrada: ctx.modoEntrada,
          pipeline: "single_mini",
          contexto_manual: ctx.contextoManual,
        },
      });
    }

    // ─── RUTA 2 [v7.2]: preguntar_ia (Q&A asesor → IA, solo mini) ───
    if (accion === "preguntar_ia") {
      const { parsed, tokens } = await llamarPreguntarIA(ctx);
      const tiempo_respuesta_ms = Date.now() - startTime;

      // Anti-invención también aplica aquí
      const { sospechoso, montosInventados } = validarMontosOutput(parsed.respuesta, ctx.montosPermitidos);

      return res.status(200).json({
        respuesta: cleanResponse(parsed.respuesta) || "Necesito un poco más de contexto para responderte bien.",
        razonamiento_interno: null,
        analisis_conversacion: null,
        siguiente_jugada: null,
        warning_montos_inventados: sospechoso ? montosInventados : null,
        _meta: {
          accion, request_id: requestId, tiempo_respuesta_ms,
          tokens, version: "7.2", modo_entrada: ctx.modoEntrada,
          pipeline: "single_mini_qa",
          contexto_manual: ctx.contextoManual,
        },
      });
    }

    // ─── RUTA 3: NO-STREAM (pipeline 2 etapas — TODAS las demás acciones) ───
    const { parsed: briefing, tokens: tokensAnalisis } = await llamarAnalisis(ctx);
    const { parsed: redaccion, tokens: tokensRedaccion, modelo: modeloRedaccion } =
      await llamarRedaccion(ctx, briefing, modoVariantes);

    const tiempo_respuesta_ms = Date.now() - startTime;
    const tokensTotal = tokensAnalisis + tokensRedaccion;

    if (Array.isArray(briefing.analisis_conversacion?.senales_detectadas)) {
      briefing.analisis_conversacion.senales_detectadas =
        briefing.analisis_conversacion.senales_detectadas
          .filter(s => SENALES_ENUM.includes(s)).slice(0, 8);
    }

    const metaBase = {
      accion, request_id: requestId, tiempo_respuesta_ms,
      tokens: tokensTotal, version: "7.2",
      modo_entrada: ctx.modoEntrada,
      pipeline: "two_stage",
      modelo_redaccion: modeloRedaccion,
      mensajes_parseados: ctx.conversacion?.totalMensajes ?? 0,
      objetivo_estrategico_aplicado: !!ctx.objetivo,
      borrador_recibido: !!ctx.borrador,
      contexto_manual: ctx.contextoManual,
    };

    if (modoVariantes) {
      const variantes = redaccion.variantes;
      variantes.empatica.mensaje = cleanResponse(variantes.empatica.mensaje) || "Cuéntame un poco más para ayudarte mejor.";
      variantes.directa.mensaje = cleanResponse(variantes.directa.mensaje) || "¿Avanzamos con el siguiente paso?";
      variantes.educativa.mensaje = cleanResponse(variantes.educativa.mensaje) || "Te explico el detalle para que decidas con calma.";

      const recomendada = redaccion.variante_recomendada || "directa";

      // Validar montos en cada variante
      const warningEmpatica = validarMontosOutput(variantes.empatica.mensaje, ctx.montosPermitidos);
      const warningDirecta = validarMontosOutput(variantes.directa.mensaje, ctx.montosPermitidos);
      const warningEducativa = validarMontosOutput(variantes.educativa.mensaje, ctx.montosPermitidos);
      const algunWarning = [warningEmpatica, warningDirecta, warningEducativa]
        .filter(w => w.sospechoso)
        .flatMap(w => w.montosInventados);

      return res.status(200).json({
        respuesta: variantes[recomendada].mensaje,
        razonamiento_interno: briefing.razonamiento_interno,
        tipo_objecion: briefing.analisis_cliente.tipo_objecion || undefined,
        emocion: briefing.analisis_cliente.emocion,
        estado_cliente: briefing.analisis_cliente.estado_cliente,
        tono_sugerido: recomendada,
        variantes,
        variante_recomendada: recomendada,
        probabilidad_cierre: briefing.analisis_cliente.probabilidad_cierre,
        razon_score: briefing.analisis_cliente.razon_score,
        analisis_conversacion: briefing.analisis_conversacion,
        siguiente_jugada: briefing.siguiente_jugada,
        warning_montos_inventados: algunWarning.length ? algunWarning : null,
        _meta: { ...metaBase, modo: "variantes" },
      });
    }

    const respuestaLimpia = cleanResponse(redaccion.respuesta) || "Cuéntame un poco más para darte la mejor opción.";
    const { sospechoso, montosInventados } = validarMontosOutput(respuestaLimpia, ctx.montosPermitidos);

    return res.status(200).json({
      respuesta: respuestaLimpia,
      razonamiento_interno: briefing.razonamiento_interno,
      tipo_objecion: briefing.analisis_cliente.tipo_objecion || undefined,
      emocion: briefing.analisis_cliente.emocion,
      estado_cliente: briefing.analisis_cliente.estado_cliente,
      probabilidad_cierre: briefing.analisis_cliente.probabilidad_cierre,
      razon_score: briefing.analisis_cliente.razon_score,
      analisis_conversacion: briefing.analisis_conversacion,
      siguiente_jugada: briefing.siguiente_jugada,
      warning_montos_inventados: sospechoso ? montosInventados : null,
      _meta: { ...metaBase, modo: "simple" },
    });
  } catch (err) {
    console.error(`[${requestId}] Error:`, err.message);
    return res.status(500).json({
      error: "Error generando respuesta. Intenta de nuevo.",
      request_id: requestId,
    });
  }
}

export const __internals = {
  parseConversationContext,
  buildContext,
  cleanResponse,
  validateInput,
  sanitizeUserText,
  extraerMontosDelInput,
  validarMontosOutput,
  SCHEMA_ANALISIS,
  SCHEMA_REDACCION_SIMPLE,
  SCHEMA_REDACCION_VARIANTES,
  SENALES_ENUM,
  LIMITES,
  CONFIG,
};

