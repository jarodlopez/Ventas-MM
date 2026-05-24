import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ═══════════════════════════════════════════════════════════════════
// MM SALES COPILOT API — v6.4 "Internal Reasoning Edition"
//
// EVOLUCIÓN vs v6.3:
//   • [v6.4] Inyección de CoT Real (Cadena de Pensamiento): Se agregó el 
//     campo `razonamiento_interno` al inicio de los esquemas JSON.
//     Esto le da a gpt-4o-mini un lienzo en blanco para procesar la estrategia
//     comercial ANTES de clasificar la data y generar el mensaje.
//   • Se conservan las temperaturas actuales para testing empírico.
//   • 100% retrocompatible (el payload de salida añade un campo extra 
//     que el frontend puede ignorar o loguear).
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// BASE DE CONOCIMIENTO
// ─────────────────────────────────────────────
const CATALOGO_PRODUCTOS = `
- Montos: $10,000 a $400,000 MXN.
- Depósito en máximo 2 horas, 100% online.
- Sin penalización por pago anticipado (diferenciador estrella).
- Ampliación disponible desde el 3er pago puntual.
- Pre-aprobación válida 48 horas — después se re-evalúa buró.
`;

// ─────────────────────────────────────────────
// VALIDACIÓN Y LÍMITES
// ─────────────────────────────────────────────
const ACCIONES_VALIDAS = [
  "responder_objecion",
  "negociar_tasa",
  "cerrar_venta",
  "seguimiento",
  "resumen_crm",
  "mejorar_mensaje",
];

const SENALES_ENUM = [
  "sensibilidad_precio", "urgencia", "comparacion_competencia",
  "alta_intencion", "desconfianza", "riesgo_ghosting",
  "validacion_seguridad", "necesidad_liquidez", "friccion_documental",
  "indecision", "interes_ampliacion", "resistencia_tasa",
  "interes_pago_anticipado",
];

const LIMITES = {
  MENSAJE_CLIENTE_MAX: 800,
  CONTEXT_MAX: 4000,
  OBJETIVO_MAX: 200,
  HISTORIAL_ITEMS: 4,
  BORRADOR_MAX: 1200, 
};

function validateInput(body) {
  const errors = [];
  if (!body || typeof body !== "object") return ["Body inválido"];

  if (!body.accion || !ACCIONES_VALIDAS.includes(body.accion)) {
    errors.push(`Acción inválida. Disponibles: ${ACCIONES_VALIDAS.join(", ")}`);
  }

  const tieneContexto =
    typeof body.conversationContext === "string" &&
    body.conversationContext.trim().length > 0;
  const tieneMensaje =
    typeof body.mensajeCliente === "string" &&
    body.mensajeCliente.trim().length > 0;

  if (!tieneContexto && !tieneMensaje) {
    errors.push(
      "Se requiere conversationContext (bloque conversacional) o mensajeCliente (legacy)"
    );
  }

  if (body.objetivo && typeof body.objetivo !== "string") {
    errors.push("objetivo debe ser string");
  }

  if (body.borrador && typeof body.borrador !== "string") {
    errors.push("borrador debe ser string");
  }

  return errors;
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

  const finDeSemana = dia === 0 || dia === 6;
  return { franja, finDeSemana, horaCDMX };
}

// ─────────────────────────────────────────────
// PARSER DE CONVERSACIÓN (HubSpot + Atomchat)
// ─────────────────────────────────────────────

const REGEX_PREFIJO_CLIENTE = /^\s*(cliente|prospecto|usuario|user|customer|lead)\s*[:\-]/i;
const REGEX_PREFIJO_ASESOR  = /^\s*(asesor|agente|advisor|yo|me|tú|tu|operador|multimoney|mm)\s*[:\-]/i;
const REGEX_TIMESTAMP       = /^\s*\d{1,2}:\d{2}(\s*(am|pm|AM|PM))?\s*$/;
const REGEX_FECHA           = /^\s*(hoy|ayer|lun|mar|mié|jue|vie|sáb|dom|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i;

const REGEX_RUIDO_HUBSPOT = /^\s*(?:.*?)?(leído|entregado|enviado|delivered|read|sent|escribiendo|typing|in[\s-]?app|whatsapp|sms|transferido|transfirió|transferida|unido al chat|se unió al chat|abandonó el chat|salió del chat|nota interna|nota privada|internal note|private note|asignado a|reasignado|assigned to|reassigned|bot[\s:]|chatbot|ticket creado|ticket #|cerró el chat|chat cerrado|chat closed|conversación cerrada|conversation closed|el asesor escribió|the agent wrote|automated message|mensaje automático|sistema:|system:)(?:\s*.*?)?\s*\.?\s*$/i;

const REGEX_RUIDO_ATOMCHAT_HEADER = /^\s*\[?(bot|sistema|system|atomchat|hubspot)[\s\-:].*$/i;

function esLineaRuido(linea) {
  if (!linea || linea.trim().length === 0) return true;
  if (REGEX_TIMESTAMP.test(linea)) return true;
  if (REGEX_RUIDO_HUBSPOT.test(linea)) return true;
  if (REGEX_RUIDO_ATOMCHAT_HEADER.test(linea)) return true;
  if (linea.trim().length <= 2 && !/[a-záéíóúñ0-9]/i.test(linea)) return true;
  return false;
}

function shouldMergeWithPrevious(lineaActual, mensajeAnterior, rolDetectado, rolAnterior) {
  if (!mensajeAnterior) return false;
  if (rolDetectado !== rolAnterior) return false;

  const trimmed = lineaActual.trim();
  if (trimmed.length < 40 && !/[.!?]$/.test(mensajeAnterior.texto)) return true;
  if (/^[a-záéíóúñ]/.test(trimmed)) return true;
  if (/^(pero|y|además|también|aunque|porque|o sea|es decir|entonces)\b/i.test(trimmed)) return true;
  if (!/[.!?]$/.test(mensajeAnterior.texto) && trimmed.length < 80) return true;

  return false;
}

function parseConversationContext(raw) {
  const fallback = {
    mensajes: [],
    ultimoMensajeCliente: null,
    ultimoMensajeAsesor: null,
    resumenContextual: "",
    totalMensajes: 0,
    fuente: "fallback",
  };

  if (!raw || typeof raw !== "string") return fallback;

  const texto = raw.trim().slice(0, LIMITES.CONTEXT_MAX);
  if (!texto) return fallback;

  const lineas = texto
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !esLineaRuido(l) && !REGEX_FECHA.test(l));

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

  const ultimoCliente = [...mensajes].reverse().find((m) => m.rol === "cliente");
  const ultimoAsesor  = [...mensajes].reverse().find((m) => m.rol === "asesor");

  const ultimos = mensajes.slice(-5);
  const resumenContextual = ultimos
    .map((m) => `${m.rol === "cliente" ? "Cliente" : "Asesor"}: ${m.texto}`)
    .join("\n");

  return {
    mensajes,
    ultimoMensajeCliente: ultimoCliente?.texto || null,
    ultimoMensajeAsesor: ultimoAsesor?.texto || null,
    resumenContextual,
    totalMensajes: mensajes.length,
    fuente: "parsed",
  };
}

// ─────────────────────────────────────────────
// SYSTEM PROMPT 
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres un asesor financiero senior de MultiMoney México. Llevas años cerrando créditos personales por WhatsApp dentro de HubSpot + Atomchat. Tu trabajo es ayudar al asesor humano a responder mejor, más rápido y con más cierre.

<catalogo_multimoney>
${CATALOGO_PRODUCTOS}
</catalogo_multimoney>

<input_esperado>
Trabajas sobre un BLOQUE DE CONVERSACIÓN RECIENTE entre el cliente y el asesor (los últimos 3-8 mensajes). Antes de redactar, analiza la dinámica completa:
- ¿Qué pidió el cliente al inicio vs al final?
- ¿Hay objeciones repetidas o intensificándose?
- ¿El asesor ya intentó algo que no funcionó?
- ¿En qué etapa comercial estamos: descubrimiento, evaluación, negociación, cierre, seguimiento, o riesgo de ghosting?
- ¿El momentum va subiendo, estable, o bajando?

Tu respuesta es SIEMPRE como el ASESOR, dirigida al cliente. Nunca hables como narrador, nunca expliques tu razonamiento dentro del mensaje, nunca digas "como asesor te recomendaría". Solo redacta el mensaje listo para enviar.
</input_esperado>

<voz_y_tono>
Suenas como un asesor de una fintech mexicana seria (Kueski, Konfío, Nu): cercano sin ser coloquial, claro sin ser frío, ágil sin ser apurado. El cliente tiene un crédito de hasta $400k en juego — espera autoridad financiera, no plática de pasillo.

NO suenas a:
- Call center ("Estimado cliente", "Le informo", "Quedo a sus órdenes")
- Bot ("Comprendo tu situación", "Es un placer atenderte", "Con gusto")
- Coach motivacional ("¡Excelente decisión!", "¡Vamos por más!")
- Vendedor callejero ("va", "sale", "te late", "checa esto", "órale")

SÍ suenas a:
- Asesor que respeta el tiempo y la inteligencia del cliente
- Frases cortas, claras, con verbos de acción
- Datos concretos antes que adjetivos
- Tuteo natural (no usted, no licenciado)
- Una calidez sobria: "tiene sentido", "claro", "exacto", "buen punto"
- Cierres orientados al siguiente paso, no a la despedida
</voz_y_tono>

<ejemplos>
[Cliente: "está cara la tasa"]
❌ Callejero: "Va, te entiendo. Pero checa, te late más rápido aquí"
✅ Fintech: "Tiene sentido revisarlo. La diferencia aquí es que tienes el dinero en 2 horas sin trámite presencial, y si liquidas antes no hay penalización. ¿Te calculo cómo quedarían las cuotas a 12 o 18 meses?"

[Cliente: "lo voy a pensar"]
✅ Fintech: "Tómate el tiempo. Solo considera que tu pre-aprobación tiene 48 horas de vigencia; después se re-evalúa. ¿Te escribo mañana en la tarde para retomarlo?"

[Cliente: "ya casi, dime qué necesito"]
✅ Fintech con justificación: "Para que tu dinero quede fondeado hoy mismo, apóyame con foto de tu INE por ambos lados. En cuanto la tenga avanzamos con CLABE."
</ejemplos>

<reglas_duras>
1. NUNCA inicies con saludo (asume conversación en curso).
2. NUNCA uses bullets ni listas en la respuesta — es WhatsApp, es prosa.
3. NUNCA inventes datos no proporcionados (montos, tasas, plazos).
4. NUNCA prometas aprobación. Trabaja sobre pre-aprobación o lo ya cotizado.
5. NUNCA repitas literal lo que ya dijo el asesor antes en la conversación — avanza, no recicles.
6. CIERRA con micro-cierre: pregunta corta o siguiente paso concreto.
7. Si tienes nombre, úsalo MÁXIMO una vez por mensaje (y solo si suena natural).
8. Longitud objetivo: 2-4 oraciones. WhatsApp, no email.
9. Si el cliente expresó algo específico en SU último mensaje, RESPÓNDELO. No cambies de tema.
10. [FRICCIÓN DOCUMENTAL] Nunca pidas requisitos (INE, CLABE, comprobante) en frío. Justifica SIEMPRE la petición conectándola con el beneficio del fondeo rápido. Ej: "Para que tu dinero quede fondeado hoy mismo, apóyame con tu INE".
11. [ESCASEZ TÁCTICA] Para manejar objeciones de tasa o indecisión, ancla al cliente a la urgencia real: la pre-aprobación vence en 48 horas y después se re-evalúa buró. Úsalo como dato, no como amenaza ni presión.
</reglas_duras>

<metodologia_rea>
Para objeciones aplica Reconoce + Empatiza + Asegura, todo fundido en un mensaje:
- Reconoce sin repetir loro ("Tiene sentido", "Es válido", "Buen punto")
- Empatiza comercial, no terapéutico ("muchos clientes lo comparan", no "entiendo tu dolor")
- Asegura conectando con SU caso ("para tu uso de [X] esto funciona porque...")
</metodologia_rea>

<analisis_senales>
Calibra el mensaje según emoción y momentum detectados:
- ANSIOSO/URGENTE → control y velocidad. Datos concretos, plazos exactos.
- DESCONFIADO → prueba social, regulación, transparencia. Datos verificables.
- INDECISO/TIBIO → reduce fricción. Una sola pregunta, un solo paso. Aplica escasez táctica suave.
- INTERESADO/CALIENTE → cierra. Pide siguiente requisito JUSTIFICADO con fondeo rápido.
- MOLESTO → valida primero, resuelve después. Baja la temperatura.
- COMPARANDO → destaca diferencial (2 horas, sin penalización, sin presencial).

Reglas de momentum:
- Si el momentum va BAJANDO, prioriza recuperar interés antes que empujar cierre.
- Si el momentum va SUBIENDO, no enfríes: pide siguiente requisito concreto (con justificación).
- Si detectas RIESGO_GHOSTING, ancla con escasez táctica (48h pre-aprobación) sin presionar.
- Si el cliente ya RECHAZÓ rotundamente o compró con la competencia, NO insistas: ejecuta retiro amable.
</analisis_senales>`;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const renderCtx = (label, value) => (value ? `${label}: ${value}\n` : "");
const renderHistorial = (h) => (h ? `Historial reciente (CRM):\n${h}\n` : "");

function renderConversacion(ctx) {
  if (ctx.conversacion?.fuente === "parsed" && ctx.conversacion.resumenContextual) {
    return `CONVERSACIÓN RECIENTE:\n${ctx.conversacion.resumenContextual}\n\nÚltimo mensaje del cliente (al que debes responder): "${ctx.conversacion.ultimoMensajeCliente || ctx.input}"\n`;
  }
  return `Mensaje del cliente: "${ctx.input}"\n`;
}

const renderObjetivo = (obj) =>
  obj ? `OBJETIVO ESTRATÉGICO del asesor: ${obj}\nOrienta tu respuesta para avanzar ese objetivo específico.\n` : "";

// ─────────────────────────────────────────────
// PLANTILLAS POR ACCIÓN
// ─────────────────────────────────────────────
const ACCIONES = {
  responder_objecion: (ctx) => `
ACCIÓN: Responder objeción

${renderConversacion(ctx)}${renderObjetivo(ctx.objetivo)}${renderCtx("Nombre", ctx.nombre)}${renderCtx("Uso del crédito", ctx.uso)}${renderCtx("Monto pre-aprobado", ctx.monto)}${renderCtx("Tasa cotizada", ctx.tasa)}${renderCtx("Plazo", ctx.plazo)}${renderHistorial(ctx.historial)}Momento: ${ctx.momento.franja}${ctx.momento.finDeSemana ? " (fin de semana)" : ""}.

ANTES DE RESPONDER, EVALÚA INTERNAMENTE (en tu campo de razonamiento): 
1. ¿En qué ETAPA está la conversación?
2. ¿El MOMENTUM va subiendo, estable o bajando?
3. Si el momentum baja → prioriza recuperar interés antes que empujar cierre.
4. Si el momentum sube → pide siguiente requisito JUSTIFICADO con fondeo rápido.

Aplica REA invisible. Conecta el beneficio con el uso específico del cliente. Cierra con pregunta corta para avanzar. Si pides documentos, justifica con el beneficio (fondeo hoy mismo).`,

  negociar_tasa: (ctx) => `
ACCIÓN: Negociar tasa

${renderConversacion(ctx)}${renderObjetivo(ctx.objetivo)}${renderCtx("Nombre", ctx.nombre)}${renderCtx("Tasa cotizada", ctx.tasa)}${renderCtx("Uso", ctx.uso)}${renderCtx("Monto", ctx.monto)}${renderHistorial(ctx.historial)}

ANTES DE RESPONDER, EVALÚA INTERNAMENTE (en tu campo de razonamiento): 
1. ¿Cuál es el MOMENTUM? Si baja → ancla con escasez táctica (pre-aprobación 48h). Si sube → cierra con diferencial.
2. ¿Cuántas veces ya pidió descuento? Si es la 2ª+ vez, NO repitas el mismo argumento — escala con dato nuevo o reformula.

Defiende valor sin bajar tasa. Reposiciona en el diferencial: velocidad (2 horas), sin penalización, sin trámite presencial. Aplica escasez táctica si es necesario. Pregunta concreta al final.`,

  cerrar_venta: (ctx) => `
ACCIÓN: Cerrar venta

${renderConversacion(ctx)}${renderObjetivo(ctx.objetivo)}${renderCtx("Nombre", ctx.nombre)}${renderCtx("Monto", ctx.monto)}${renderCtx("Tasa", ctx.tasa)}${renderCtx("Uso", ctx.uso)}${renderHistorial(ctx.historial)}
Cliente con señales de cierre. Micro-cierre pidiendo siguiente requisito (INE / CLABE / comprobante) SIEMPRE JUSTIFICADO con beneficio de fondeo rápido. Ej: "Para que tu dinero esté hoy en tu cuenta, apóyame con tu INE". Si la conversación ya mencionó alguno, pide el SIGUIENTE, no repitas.`,

  seguimiento: (ctx) => `
ACCIÓN: Seguimiento (cliente sin respuesta o pendiente)

${renderConversacion(ctx)}${renderObjetivo(ctx.objetivo)}${renderCtx("Nombre", ctx.nombre)}${renderCtx("Última interacción", ctx.ultimaInteraccion)}${renderCtx("Monto", ctx.monto)}${renderHistorial(ctx.historial)}Momento: ${ctx.momento.franja}.

EVALÚA PRIMERO LA SEÑAL DEL CLIENTE (en tu campo de razonamiento): 
- Si el cliente YA RECHAZÓ rotundamente la oferta o compró con la competencia → ejecuta RETIRO AMABLE: agradece, deja la puerta abierta sin presión, NO pidas siguiente paso.
- Si solo hay silencio o tibieza → retoma sin sonar desesperado. Ancla con escasez táctica real (pre-aprobación 48h). Prueba ángulo nuevo.

Bajo NINGUNA circunstancia suenes rogón, insistente o desesperado. Eres un asesor financiero serio.`,

  resumen_crm: (ctx) => `
ACCIÓN: Resumen CRM
Datos: ${ctx.nombre || "S/N"} | Monto: ${ctx.monto || "S/D"} | Tasa: ${ctx.tasa || "S/D"} | Uso: ${ctx.uso || "S/D"}

${renderConversacion(ctx)}${renderHistorial(ctx.historial)}
Devuelve nota CRM factual basada en la conversación completa. Solo datos, sin adjetivos subjetivos. 2-3 líneas máximo. Incluye etapa actual y siguiente paso lógico.`,

  mejorar_mensaje: (ctx) => {
    const borradorActual = ctx.borrador || ctx.conversacion?.ultimoMensajeAsesor || ctx.input || "";
    const conversacionBloque = ctx.conversacion?.fuente === "parsed" && ctx.conversacion.resumenContextual
        ? `CONVERSACIÓN RECIENTE:\n${ctx.conversacion.resumenContextual}\n`
        : "";

    return `
ACCIÓN: Mejorar borrador del asesor

BORRADOR ACTUAL DEL ASESOR:
"${borradorActual}"

${conversacionBloque}${renderObjetivo(ctx.objetivo)}${renderCtx("Nombre cliente", ctx.nombre)}${renderHistorial(ctx.historial)}
INSTRUCCIÓN: Reescribe el borrador en versión óptima para WhatsApp. Elimina corporativismos, saludos, despedidas. Directo, empático, comercial, profesional. Si hay conversación previa, alinea el borrador con ese contexto. Si pide documentos, JUSTIFICA siempre con el beneficio (fondeo rápido).`;
  },
};

// ─────────────────────────────────────────────
// BUILD CONTEXT
// ─────────────────────────────────────────────
function buildContext(body) {
  const { accion, mensajeCliente, conversationContext, objetivo, borrador, datosCliente = {} } = body;

  let conversacion = null;
  let inputPrincipal = "";
  let modoEntrada = "legacy";

  if (typeof conversationContext === "string" && conversationContext.trim()) {
    conversacion = parseConversationContext(conversationContext);
    inputPrincipal = (conversacion.ultimoMensajeCliente || mensajeCliente || "").trim();
    modoEntrada = "contextual";
  } else if (typeof mensajeCliente === "string") {
    inputPrincipal = mensajeCliente.trim();
    modoEntrada = "legacy";
  }

  inputPrincipal = inputPrincipal.slice(0, LIMITES.MENSAJE_CLIENTE_MAX);

  const historialCrudo = datosCliente.historialConversacion;
  const historialProcesado =
    Array.isArray(historialCrudo) && historialCrudo.length > 0
      ? historialCrudo.filter((x) => typeof x === "string" && x.trim().length > 0).slice(-LIMITES.HISTORIAL_ITEMS).join("\n")
      : null;

  return {
    accion,
    input: inputPrincipal,
    conversacion,
    modoEntrada,
    objetivo: (objetivo || "").toString().trim().slice(0, LIMITES.OBJETIVO_MAX) || null,
    borrador: typeof borrador === "string" ? borrador.trim().slice(0, LIMITES.BORRADOR_MAX) : null, 
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

const TEMPERATURE_BY_ACTION = {
  resumen_crm: 0.1,
  cerrar_venta: 0.5,
  negociar_tasa: 0.6,
  responder_objecion: 0.65,
  seguimiento: 0.65,
  mejorar_mensaje: 0.7,
};

// ─────────────────────────────────────────────
// SCHEMAS — [v6.4] CoT Verdadero Inyectado
// ─────────────────────────────────────────────
const ANALISIS_CLIENTE_PROPS = {
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
};

const ANALISIS_CONVERSACION_PROPS = {
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
};

const SCHEMA_SIMPLE = {
  name: "copilot_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      // [v6.4] El lienzo en blanco para el Chain of Thought
      razonamiento_interno: {
        type: "string",
        description: "Espacio de pensamiento libre. Evalúa aquí paso a paso la conversación, la etapa, el momentum y cómo aplicarás las reglas ANTES de generar el resto de la respuesta."
      },
      analisis_conversacion: ANALISIS_CONVERSACION_PROPS,
      analisis_cliente: ANALISIS_CLIENTE_PROPS,
      siguiente_jugada: { type: "string" },
      respuesta: { type: "string" }, 
    },
    required: [
      "razonamiento_interno", "analisis_conversacion", "analisis_cliente", "siguiente_jugada", "respuesta"
    ],
    additionalProperties: false,
  },
};

const SCHEMA_VARIANTES = {
  name: "copilot_response_variantes",
  strict: true,
  schema: {
    type: "object",
    properties: {
      // [v6.4] CoT para la generación de variantes
      razonamiento_interno: {
        type: "string",
        description: "Espacio de pensamiento libre. Evalúa aquí paso a paso la conversación, la etapa, el momentum y cómo aplicarás las reglas ANTES de generar las variantes."
      },
      analisis_conversacion: ANALISIS_CONVERSACION_PROPS,
      analisis_cliente: ANALISIS_CLIENTE_PROPS,
      siguiente_jugada: { type: "string" },
      variante_recomendada: {
        type: "string",
        enum: ["empatica", "directa", "educativa"],
      },
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
    required: [
      "razonamiento_interno", "analisis_conversacion", "analisis_cliente", "siguiente_jugada",
      "variante_recomendada", "variantes"
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
    return res.status(400).json({ error: validationErrors.join(". "), request_id: requestId });
  }

  const ctx = buildContext(req.body);
  const { accion } = ctx;
  const userPrompt = ACCIONES[accion](ctx);
  const temperature = TEMPERATURE_BY_ACTION[accion] ?? 0.6;

  const modoVariantes = req.body.modo === "variantes";
  const schema = modoVariantes ? SCHEMA_VARIANTES : SCHEMA_SIMPLE;
  const maxTokens = modoVariantes ? 1200 : (ctx.modoEntrada === "contextual" ? 800 : 600); // Aumentado ligeramente para acomodar el campo de razonamiento

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Mantenemos el modelo ultra-rápido para asegurar latencia
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

    if (Array.isArray(parsed.analisis_conversacion?.senales_detectadas)) {
      parsed.analisis_conversacion.senales_detectadas =
        parsed.analisis_conversacion.senales_detectadas
          .filter((s) => SENALES_ENUM.includes(s))
          .slice(0, 8); 
    }

    const metaBase = {
      accion,
      request_id: requestId,
      tiempo_respuesta_ms,
      tokens: completion.usage?.total_tokens,
      version: "6.4", // [v6.4]
      modo_entrada: ctx.modoEntrada,
      mensajes_parseados: ctx.conversacion?.totalMensajes ?? 0,
      objetivo_estrategico_aplicado: !!ctx.objetivo,
      borrador_recibido: !!ctx.borrador, 
    };

    if (modoVariantes) {
      parsed.variantes.empatica.mensaje = cleanResponse(parsed.variantes.empatica.mensaje) || "Cuéntame un poco más para ayudarte mejor.";
      parsed.variantes.directa.mensaje = cleanResponse(parsed.variantes.directa.mensaje) || "¿Avanzamos con el siguiente paso?";
      parsed.variantes.educativa.mensaje = cleanResponse(parsed.variantes.educativa.mensaje) || "Te explico el detalle para que decidas con calma.";

      const recomendada = parsed.variante_recomendada || "directa";
      const respuestaPrincipal = parsed.variantes[recomendada].mensaje;

      return res.status(200).json({
        respuesta: respuestaPrincipal,
        razonamiento_interno: parsed.razonamiento_interno, // [v6.4] Exponemos el log
        tipo_objecion: parsed.analisis_cliente.tipo_objecion || undefined,
        emocion: parsed.analisis_cliente.emocion,
        estado_cliente: parsed.analisis_cliente.estado_cliente,
        tono_sugerido: recomendada,
        variantes: parsed.variantes,
        variante_recomendada: recomendada,
        probabilidad_cierre: parsed.analisis_cliente.probabilidad_cierre,
        razon_score: parsed.analisis_cliente.razon_score,
        analisis_conversacion: parsed.analisis_conversacion,
        siguiente_jugada: parsed.siguiente_jugada,
        _meta: { ...metaBase, modo: "variantes" },
      });
    }

    parsed.respuesta = cleanResponse(parsed.respuesta) || "Cuéntame un poco más para darte la mejor opción.";

    return res.status(200).json({
      respuesta: parsed.respuesta,
      razonamiento_interno: parsed.razonamiento_interno, // [v6.4] Exponemos el log
      tipo_objecion: parsed.analisis_cliente.tipo_objecion || undefined,
      emocion: parsed.analisis_cliente.emocion,
      estado_cliente: parsed.analisis_cliente.estado_cliente,
      probabilidad_cierre: parsed.analisis_cliente.probabilidad_cierre,
      razon_score: parsed.analisis_cliente.razon_score,
      analisis_conversacion: parsed.analisis_conversacion,
      siguiente_jugada: parsed.siguiente_jugada,
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
  shouldMergeWithPrevious,
  SCHEMA_SIMPLE,
  SCHEMA_VARIANTES,
  SENALES_ENUM, 
  LIMITES, 
};

