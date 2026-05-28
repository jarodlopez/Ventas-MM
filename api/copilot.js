import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ═══════════════════════════════════════════════════════════════════
// MM SALES COPILOT API — v8.0 "Iron Tactics Edition"
//
// CAMBIOS vs v7.2:
//   • SYSTEM PROMPTS completamente reescritos — sin rendición posible.
//   • OVERRIDES por acción en código (no depende del modelo).
//   • responder_objecion: aplica REA con playbook real, nunca se rinde.
//   • negociar_tasa: defiende valor siempre, usa datos de competencia.
//   • cerrar_venta: pide siguiente requisito concreto, nada de pasivo.
//   • seguimiento: diferencia días transcurridos, nunca presiona en exceso.
//   • mejorar_mensaje: respeta intención del asesor, no la sobreescribe.
//   • preguntar_ia: incorpora playbook completo (REA, manejo, cierre).
//   • PLAYBOOK_CONTEXT: conocimiento estructurado de técnicas MultiMoney.
//   • TACTIC_OVERRIDES: tabla de tácticas obligatorias por acción.
//   • Anti-rendición: validación de output que detecta frases de abandono.
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

const requestLog = [];
function checkRateLimit() {
  const oneHourAgo = Date.now() - 3600_000;
  while (requestLog.length && requestLog[0] < oneHourAgo) requestLog.shift();
  if (requestLog.length >= CONFIG.MAX_REQUESTS_PER_HOUR) return false;
  requestLog.push(Date.now());
  return true;
}

// ─────────────────────────────────────────────
// CATÁLOGO, PLAYBOOK Y CONSTANTES
// ─────────────────────────────────────────────
const CATALOGO_DENSO = `
PRODUCTO MultiMoney MX — créditos personales:
• Monto: $10,000–$400,000 MXN
• Depósito: ≤2 horas, 100% online
• Sin penalización por pago anticipado (DIFERENCIADOR CLAVE)
• Ampliación disponible desde el 3er pago puntual
• Pre-aprobación válida 48 horas
• Plazo: hasta 60 meses
• Sin aval, sin filas, sin papeleo
`.trim();

// Conocimiento del playbook para que todos los prompts lo tengan
const PLAYBOOK_CONTEXT = `
TÉCNICA REA (protocolo MultiMoney para objeciones):
  R — RECONOCE: parafrasea la objeción con tus propias palabras, sin contradecir.
  E — EMPATIZA: valida que la preocupación es legítima, 1 línea, sin sonar a call center.
  A — ASEGURA: conecta el diferencial MultiMoney con la preocupación específica.
  → Siempre termina con pregunta de avance (calcular cuota, confirmar necesidad, pedir dato).
  → Mínimo 3 rebotes antes de considerar la venta perdida.

MANEJO DE OBJECIONES — RESPUESTAS AUTORIZADAS:

"La tasa es muy alta":
  Asegura: "Comparado con otras opciones, aquí ya estás pre-aprobado, sin filas, sin papeleo.
  El dinero llega en 2 horas y sin penalización si liquidas antes. ¿Calculamos tu cuota mensual?"
  Si mencionó tasa de competencia: usa ese número para comparar tipo de crédito, velocidad y requisitos.

"El monto es muy bajo":
  Asegura: "Es el primer paso. A partir del 3er pago puntual tienes acceso a una ampliación.
  ¿Para qué necesitas el dinero? Vemos si el monto actual te alcanza para la fase inicial."

"No necesito el dinero / Solo estaba viendo":
  Asegura: "Un crédito disponible es como un colchón: no lo necesitas hasta que lo necesitas.
  ¿Hay algo que hayas postergado por falta de liquidez — vacaciones, reparación, negocio?"

"No necesito la suma entera":
  Asegura: "No tienes que usar todo de inmediato. El historial con monto mayor te posiciona
  mejor para futuras ampliaciones. ¿Para qué ibas a usar la parte que sí necesitas?"

"Lo tengo que pensar / consultar":
  Asegura: "Estoy aquí para resolver dudas en este momento. ¿Qué es lo que genera la duda —
  el monto, el plazo, la documentación? La oferta de hoy puede no estar disponible mañana."

CIERRE — próximos requisitos (en orden):
  1. CLABE (18 dígitos, cuenta donde recibirá el depósito)
  2. INE (foto ambos lados, sin fondo blanco, completa, todos los bordes)
  3. Selfie (rostro completo, sin accesorios, sin contraluz)
  4. Comprobante de domicilio (CFE, Telmex, MegaCable, TotalPlay, IZZI, Axtel — pueden no estar a nombre del cliente; Telcel/AT&T sí deben estar a nombre del cliente)
  Siempre justifica el requisito con el beneficio: "Para que tu dinero esté hoy en tu cuenta, mándame X."

SEGUIMIENTO — reglas:
  • Si es mismo día: recontacto directo, no presionar, preguntar si resolvió la duda.
  • Si es día siguiente o más: retomar desde el último punto de la conversación.
  • Nunca pedir disculpas por el seguimiento — es parte del servicio.
  • Nunca mencionar "la oferta expira" dos veces en el mismo chat.
`.trim();

// ─────────────────────────────────────────────
// OVERRIDES DE TÁCTICA POR ACCIÓN
// Estas reglas son ABSOLUTAS — se aplican en código, no solo en prompts.
// ─────────────────────────────────────────────
const TACTIC_OVERRIDES = {
  negociar_tasa: {
    tactica: "defender_valor_REA_tasa",
    riesgo_bloqueado: ["retiro_amable", "ghosting", "despedir", "dejar ir", "otro momento"],
    estado_minimo: "Tibio", // nunca degradar a Frío en esta acción
    prohibido_en_output: [
      "aquí estaré si cambias de opinión",
      "cuando quieras me avisas",
      "buen día",
      "suerte",
      "en otro momento",
      "no hay problema",
      "entiendo tu decisión",
    ],
  },
  responder_objecion: {
    tactica: "aplicar_REA_personalizado",
    riesgo_bloqueado: ["retiro_amable", "no_insistir"],
    estado_minimo: "Tibio",
    prohibido_en_output: [
      "cuando quieras me avisas",
      "buen día",
      "suerte",
      "no hay problema",
      "entiendo tu decisión",
    ],
  },
  cerrar_venta: {
    tactica: "pedir_siguiente_requisito_justificado",
    riesgo_bloqueado: ["esperar", "no_presionar", "seguimiento_pasivo"],
    prohibido_en_output: [
      "cuando estés listo",
      "sin prisa",
      "tómate tu tiempo",
      "en otro momento",
    ],
  },
  seguimiento: {
    tactica: "recontacto_desde_ultimo_punto",
    riesgo_bloqueado: ["presionar_urgencia_excesiva"],
    prohibido_en_output: [],
  },
  mejorar_mensaje: {
    tactica: "mejorar_manteniendo_intencion_asesor",
    riesgo_bloqueado: [],
    prohibido_en_output: [],
  },
};

// ─────────────────────────────────────────────
// FRASES DE RENDICIÓN — detector de output inválido
// ─────────────────────────────────────────────
const FRASES_RENDICION = [
  /aquí estaré si (cambias|decides)/i,
  /cuando (quieras|puedas) me avisas/i,
  /buen(os)? día/i,
  /mucha suerte/i,
  /en otro momento/i,
  /entiendo tu decisión/i,
  /no hay problema[,.]? (avísame|cuídate)/i,
  /que te vaya bien/i,
  /cuídate mucho/i,
];

function detectaRendicion(texto) {
  return FRASES_RENDICION.some((re) => re.test(texto));
}

const ACCIONES_VALIDAS = [
  "responder_objecion",
  "negociar_tasa",
  "cerrar_venta",
  "seguimiento",
  "resumen_crm",
  "mejorar_mensaje",
  "preguntar_ia",
];

const SENALES_ENUM = [
  "sensibilidad_precio",
  "urgencia",
  "comparacion_competencia",
  "alta_intencion",
  "desconfianza",
  "riesgo_ghosting",
  "validacion_seguridad",
  "necesidad_liquidez",
  "friccion_documental",
  "indecision",
  "interes_ampliacion",
  "resistencia_tasa",
  "interes_pago_anticipado",
];

const ACCIONES_PREMIUM = new Set([
  "responder_objecion",
  "negociar_tasa",
  "cerrar_venta",
  "seguimiento",
  "mejorar_mensaje",
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

  const tieneContexto =
    typeof body.conversationContext === "string" && body.conversationContext.trim();
  const tieneMensaje =
    typeof body.mensajeCliente === "string" && body.mensajeCliente.trim();
  const tieneBorrador =
    typeof body.borrador === "string" && body.borrador.trim();
  const tienePregunta =
    typeof body.pregunta === "string" && body.pregunta.trim();

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
const REGEX_PREFIJO_CLIENTE =
  /^\s*(cliente|prospecto|usuario|user|customer|lead)\s*[:\-]/i;
const REGEX_PREFIJO_ASESOR =
  /^\s*(asesor|agente|advisor|yo|me|tú|tu|operador|multimoney|mm)\s*[:\-]/i;
const REGEX_TIMESTAMP = /^\s*\d{1,2}:\d{2}(\s*(am|pm|AM|PM))?\s*$/;
const REGEX_FECHA =
  /^\s*(hoy|ayer|lun|mar|mié|jue|vie|sáb|dom|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i;
const REGEX_RUIDO =
  /^\s*.*?(leído|entregado|enviado|delivered|read|sent|escribiendo|typing|in[\s-]?app|transferido|asignado a|bot[\s:]|chatbot|ticket #|chat cerrado|sistema:|system:).*?\s*\.?\s*$/i;

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
  if (
    /^(pero|y|además|también|aunque|porque|o sea|es decir|entonces)\b/i.test(trimmed)
  )
    return true;
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
  const texto = sanitizeUserText(raw).slice(0, LIMITES.CONTEXT_MAX);
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

  const mensajesRecortados = mensajes.slice(-LIMITES.MENSAJES_RECIENTES);
  const ultimoCliente = [...mensajesRecortados].reverse().find((m) => m.rol === "cliente");
  const ultimoAsesor = [...mensajesRecortados].reverse().find((m) => m.rol === "asesor");

  const resumenContextual = mensajesRecortados
    .map((m) => `${m.rol === "cliente" ? "Cliente" : "Asesor"}: ${m.texto}`)
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
// EXTRACCIÓN Y VALIDACIÓN DE MONTOS
// ─────────────────────────────────────────────
function extraerMontosDelInput(textoCompleto) {
  if (!textoCompleto) return new Set();
  const montos = new Set();

  const patterns = [
    /\$\s?(\d{1,3}(?:[,.\s]\d{3})+(?:\.\d{2})?)/g,
    /\$\s?(\d{4,})/g,
    /\$\s?(\d+)\s*[kK]\b/g,
    /\b(\d{1,3}(?:[,.\s]\d{3})+|\d{4,})\s*(?:pesos|mxn|MXN)\b/gi,
    /\b(\d+)\s*mil\b/gi,
  ];

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(textoCompleto)) !== null) {
      let num = m[1].replace(/[^\d]/g, "");
      const fullMatch = m[0].toLowerCase();
      if (/\bmil\b/.test(fullMatch) || /\s?[kK]\b/.test(fullMatch)) {
        num = String(parseInt(num, 10) * 1000);
      }
      if (num && parseInt(num, 10) >= 1000) montos.add(num);
    }
  }
  return montos;
}

function validarMontosOutput(output, montosPermitidos) {
  if (!output) return { sospechoso: false, montosInventados: [] };
  if (montosPermitidos.size === 0) {
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
// SYSTEM PROMPTS — completamente reescritos
// ─────────────────────────────────────────────

const SYSTEM_PROMPT_ANALISIS = `Eres un analista comercial senior de MultiMoney México. Lees conversaciones de WhatsApp entre asesor y cliente y produces un BRIEFING estratégico para que el redactor escriba la respuesta perfecta.

${CATALOGO_DENSO}

${PLAYBOOK_CONTEXT}

TU TAREA: Analizar y orientar. Nunca rendirte por el asesor.

ANALIZA:
- Etapa comercial exacta
- Momentum con evidencia textual específica
- Emoción del cliente y nivel de confianza (0-100)
- Objeción dominante y tipo específico
- Probabilidad de cierre REALISTA (no pesimista por default)
- Qué datos concretos existen en la conversación (montos, tasas de competencia, plazos mencionados)

REGLAS DE ANÁLISIS — IRROMPIBLES:

1. NUNCA recomiendes retiro_amable, ghosting, o dejar ir al cliente si la acción es "negociar_tasa", "responder_objecion", o "cerrar_venta". Esas acciones son para AVANZAR, siempre.

2. Si el cliente mencionó tasa de competencia → registra ese dato exacto en briefing_redactor para que el redactor lo use en la comparación.

3. Si el cliente objetó tasa → etapa es "negociacion", NO "riesgo_ghosting". Solo es riesgo_ghosting si el cliente dijo explícitamente que ya no le interesa o compró en otro lado.

4. Si el asesor ya usó un argumento Y no funcionó → recomienda argumento distinto. No repitas lo ya intentado.

5. Si momentum baja → la táctica es recuperar interés, no rendirse. Hay diferencia entre momentum bajo y venta perdida.

6. Si hay objeción de tasa → la táctica SIEMPRE incluye: (a) comparar con competencia si hay dato, (b) diferenciales MultiMoney (velocidad, sin penalización, sin aval), (c) calcular cuota concreta si hay monto.

7. En briefing_redactor: lista EXPLÍCITAMENTE qué datos concretos puede mencionar el redactor. Si el cliente mencionó una tasa de competencia, inclúyela. Si hay monto, inclúyelo. Si no hay datos, di "hablar en abstracto".

8. La "escasez táctica" (pre-aprobación 48h) solo si hay indecisión clara y no se ha usado antes en el chat.

9. probabilidad_cierre: sé honesto pero no catastrofista. Una objeción de tasa con cliente que sigue en chat = mínimo 30%. Solo baja de 20% si el cliente dijo explícitamente que no le interesa.`;

// ─────────────────────────────────────────────
// Instrucción específica por acción para el prompt de análisis
// ─────────────────────────────────────────────
const INSTRUCCION_ANALISIS_POR_ACCION = {
  negociar_tasa: `ACCIÓN SOLICITADA: negociar_tasa
MANDATO ABSOLUTO: La táctica es SIEMPRE defender el valor de MultiMoney con REA. NUNCA sugieras retiro, despedida, ni "dejar ir al cliente". Aunque el momentum sea bajo y la probabilidad sea baja, el objetivo es rebotar la objeción de tasa con argumentos concretos.
Si el cliente mencionó tasa de competencia, úsala en briefing_redactor para que el redactor compare.
Si hay monto en la conversación, sugiere calcular cuota concreta.`,

  responder_objecion: `ACCIÓN SOLICITADA: responder_objecion
MANDATO ABSOLUTO: Identifica la objeción específica y aplica REA del playbook MultiMoney. NUNCA sugieras retiro ni rendición. El asesor eligió esta acción porque quiere rebotar — dáselo.
Especifica en briefing_redactor: qué objeción responder (solo la última del cliente), qué argumento REA aplica, y con qué pregunta de avance terminar.`,

  cerrar_venta: `ACCIÓN SOLICITADA: cerrar_venta
MANDATO ABSOLUTO: La táctica es pedir el próximo requisito concreto (CLABE, INE, selfie, comprobante) justificado con el beneficio de rapidez. NUNCA un mensaje de seguimiento pasivo ni "cuando estés listo".
En briefing_redactor: indica cuál es el próximo requisito lógico según lo que ya se entregó, y la justificación exacta para pedirlo ("para que tu dinero esté hoy en tu cuenta").`,

  seguimiento: `ACCIÓN SOLICITADA: seguimiento
Analiza cuánto tiempo lleva sin respuesta el cliente según el contexto. Si es mismo día: recontacto suave desde último punto. Si es día siguiente o más: retomar con contexto y propuesta directa.
NUNCA presiones urgencia dos veces en el mismo chat. NUNCA pidas disculpas por el seguimiento.`,

  mejorar_mensaje: `ACCIÓN SOLICITADA: mejorar_mensaje
El asesor quiere mejorar su borrador, NO reemplazarlo con algo distinto. Respeta la intención.
En briefing_redactor: (1) identifica qué intención tiene el borrador, (2) qué le falta o le sobra, (3) instrucción de reescritura que mantiene esa intención con voz MultiMoney. NO cambies el objetivo del mensaje.`,

  resumen_crm: `ACCIÓN SOLICITADA: resumen_crm
Genera nota factual. Solo datos observables, sin adjetivos subjetivos.`,
};

const SYSTEM_PROMPT_REDACCION = `Eres un asesor financiero senior de MultiMoney México que responde por WhatsApp. Recibes un BRIEFING estratégico y escribes el mensaje perfecto al cliente.

${CATALOGO_DENSO}

${PLAYBOOK_CONTEXT}

VOZ MULTIMONEY:
Fintech mexicana seria (estilo Nu, Kueski, Konfío): cercano sin ser coloquial, claro sin ser frío, ágil sin ser apurado. Tuteo natural. Frases cortas con verbos de acción.

EJEMPLOS CALIBRADOS:

[negociar_tasa — cliente dice "50% anual, antes me ofrecieron 2.99%"]
✅ "Entiendo — la diferencia parece grande a primera vista. La clave está en comparar productos equivalentes: una tasa de 2.99% anual generalmente aplica a crédito revolvente con aval o garantía, con semanas de espera. Aquí el dinero está en tu cuenta en 2 horas, sin aval, y sin penalización si lo liquidas antes. ¿Te calculo cuánto sería tu cuota mensual para que veas los números concretos?"

[negociar_tasa — cliente dice "la tasa está cara", sin dato de competencia]
✅ "Tiene sentido revisarlo. La diferencia real es velocidad y condiciones: tienes el dinero en 2 horas, sin filas, sin penalización si pagas antes. ¿Te calculo cómo quedan las cuotas a 12 o 18 meses y ves si te acomoda?"

[responder_objecion — "lo tengo que pensar"]
✅ "Claro, es una decisión financiera y quiero que la tomes con todo claro. ¿Qué es lo que genera la duda — el monto, el plazo, la documentación? Si lo resolvemos ahorita, evitas perder tiempo y la oferta se mantiene."

[responder_objecion — "el monto es muy bajo"]
✅ "Entiendo que necesitas más. Este monto es el primer paso — a partir del 3er pago puntual tienes acceso a una ampliación. ¿Para qué lo ibas a usar? Vemos si el monto actual te cubre la fase inicial."

[cerrar_venta — cliente listo]
✅ "Para que tu dinero esté hoy en tu cuenta, mándame foto de tu INE por ambos lados — que salga completa, sin fondo blanco. En cuanto la tenga seguimos con CLABE."

[seguimiento — cliente sin respuesta]
✅ "Hola, retomando lo de tu crédito — quedamos en que ibas a revisar [punto específico]. ¿Pudiste?"

REGLAS DURAS — IRROMPIBLES:

1. NUNCA inicies con saludo (conversación en curso).

2. NUNCA inventes datos. Si no ves un monto, tasa, plazo o nombre en la conversación, no lo menciones. Habla en abstracto.

3. NUNCA prometas aprobación. Trabaja sobre pre-aprobación.

4. Longitud: 1-4 oraciones. WhatsApp. A veces una frase basta.

5. Si pides documentos, justifica con el beneficio (fondeo hoy).

6. RESPONDE AL ÚLTIMO MENSAJE DEL CLIENTE. No lo ignores para pitchear otra cosa.

7. PROHIBIDO RENDIRSE: las siguientes frases NUNCA aparecen en tu output:
   - "aquí estaré si cambias de opinión"
   - "cuando quieras me avisas"
   - "buen día" / "que te vaya bien" / "cuídate"
   - "entiendo tu decisión"
   - "no hay problema, avísame"
   Si el briefing sugiere retiro → IGNÓRALO. Tu trabajo es avanzar.

8. Para negociar_tasa: siempre termina con propuesta concreta (calcular cuota, comparar número específico, o pedir siguiente dato). Nunca con despedida.

9. Para cerrar_venta: pide el próximo requisito específico, justificado. Nada de "cuando estés listo".

10. Para seguimiento: retoma desde el último punto, sin pedir disculpas por el contacto.

LO QUE NO SUENAS:
- Call center: "Estimado", "Quedo a sus órdenes", "Con gusto le ayudo"
- Bot: "Comprendo tu situación", "Es un placer"
- Coach: "¡Excelente decisión!", "¡Vamos por más!"
- Vendedor callejero: "va", "sale", "te late", "checa", "órale"
- Alguien que se rinde: cualquier frase de las 7 prohibidas arriba`;

// ─────────────────────────────────────────────
// SYSTEM PROMPT — preguntar_ia (mentor interno)
// ─────────────────────────────────────────────
const SYSTEM_PROMPT_PREGUNTAR = `Eres mentor del equipo comercial de MultiMoney México. Un asesor humano te hace una pregunta sobre producto, políticas, objeciones, o cómo manejar una situación.

${CATALOGO_DENSO}

${PLAYBOOK_CONTEXT}

CÓMO RESPONDES:
- Al ASESOR, no al cliente. Tuteo de colega: "revisa", "pregúntale", "lo que harías es..."
- Directo y práctico. Sin floreo. Sin saludos ni despedidas.
- 2-5 oraciones máximo.
- Cuando aplique, da MICRO-SCRIPT: "Le puedes decir: '...'"
- Si no sabes algo (tasa exacta, política interna no documentada), dilo y sugiere escalar con supervisor.
- NUNCA recomiendes rendirse ante una objeción sin antes aplicar REA al menos 3 veces.

EJEMPLOS:

[Pregunta: "qué hago si el cliente no tiene comprobante de ingresos formal?"]
✅ "Pídele estado de cuenta de los últimos 3 meses donde se vean depósitos recurrentes. Si es informal puro, escálalo con tu supervisor — algunos perfiles entran con co-deudor. Le puedes decir: 'No te preocupes, hay varias opciones, mándame un estado de cuenta donde se vean tus ingresos típicos.'"

[Pregunta: "cuántas veces reboto la objeción de tasa antes de rendirme?"]
✅ "Mínimo 3 rebotes con argumentos distintos: (1) velocidad y sin penalización, (2) comparar con el producto específico que mencionó, (3) calcular cuota concreta. Si después de los 3 sigue firme en no, ahí sí agendas seguimiento. Pero nunca te vayas en el primer 'está cara'."

[Pregunta: "el cliente ya rechazó tres veces con argumentos distintos cada vez, sigo?"]
✅ "Tres rebotes bien aplicados y sin avance: seguimiento de 3-5 días, no más insistencia hoy. Muévelo al CRM como seguimiento y genera tarea. Le puedes decir: 'Te dejo el espacio. ¿Te escribo el jueves para ver cómo estás?'"`;

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
            enum: [
              "descubrimiento",
              "evaluacion",
              "negociacion",
              "cierre",
              "seguimiento",
              "riesgo_ghosting",
            ],
          },
          momentum: { type: "string", enum: ["subiendo", "estable", "bajando"] },
          nivel_confianza: { type: "integer", minimum: 0, maximum: 100 },
          senales_detectadas: {
            type: "array",
            items: { type: "string", enum: SENALES_ENUM },
          },
          objecion_dominante: { type: ["string", "null"] },
        },
        required: [
          "etapa_conversacion",
          "momentum",
          "nivel_confianza",
          "senales_detectadas",
          "objecion_dominante",
        ],
        additionalProperties: false,
      },
      analisis_cliente: {
        type: "object",
        properties: {
          emocion: {
            type: "string",
            enum: [
              "ansioso",
              "desconfiado",
              "indeciso",
              "interesado",
              "molesto",
              "comparando",
              "neutral",
              "entusiasmado",
            ],
          },
          estado_cliente: { type: "string", enum: ["Frío", "Tibio", "Caliente"] },
          tipo_objecion: {
            type: ["string", "null"],
            enum: [
              "precio",
              "desconfianza",
              "indecision",
              "falta_de_tiempo",
              "comparacion",
              "ghosting",
              null,
            ],
          },
          probabilidad_cierre: { type: "integer", minimum: 0, maximum: 100 },
          razon_score: { type: "string" },
        },
        required: [
          "emocion",
          "estado_cliente",
          "tipo_objecion",
          "probabilidad_cierre",
          "razon_score",
        ],
        additionalProperties: false,
      },
      briefing_redactor: { type: "string" },
      siguiente_jugada: { type: "string" },
    },
    required: [
      "razonamiento_interno",
      "analisis_conversacion",
      "analisis_cliente",
      "briefing_redactor",
      "siguiente_jugada",
    ],
    additionalProperties: false,
  },
};

const SCHEMA_REDACCION_SIMPLE = {
  name: "respuesta_whatsapp",
  strict: true,
  schema: {
    type: "object",
    properties: { respuesta: { type: "string" } },
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
      variante_recomendada: {
        type: "string",
        enum: ["empatica", "directa", "educativa"],
      },
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
            enum: [
              "descubrimiento",
              "evaluacion",
              "negociacion",
              "cierre",
              "seguimiento",
              "riesgo_ghosting",
            ],
          },
          momentum: { type: "string", enum: ["subiendo", "estable", "bajando"] },
          nivel_confianza: { type: "integer", minimum: 0, maximum: 100 },
          senales_detectadas: {
            type: "array",
            items: { type: "string", enum: SENALES_ENUM },
          },
          objecion_dominante: { type: ["string", "null"] },
        },
        required: [
          "etapa_conversacion",
          "momentum",
          "nivel_confianza",
          "senales_detectadas",
          "objecion_dominante",
        ],
        additionalProperties: false,
      },
      siguiente_jugada: { type: "string" },
    },
    required: ["respuesta", "analisis_conversacion", "siguiente_jugada"],
    additionalProperties: false,
  },
};

const SCHEMA_PREGUNTAR = {
  name: "respuesta_qa_interno",
  strict: true,
  schema: {
    type: "object",
    properties: { respuesta: { type: "string" } },
    required: ["respuesta"],
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
  const { accion, conversacion, input, momento, contextoManual, borrador } = ctx;

  const instruccionAccion =
    INSTRUCCION_ANALISIS_POR_ACCION[accion] || `ACCIÓN SOLICITADA: ${accion}`;

  if (accion === "mejorar_mensaje") {
    const conversacionStr =
      conversacion?.fuente === "parsed"
        ? `${contextoManual ? "CONVERSACIÓN PREVIA (pegada por el asesor)" : "CONVERSACIÓN PREVIA"} (CONTEXTO):\n${conversacion.resumenContextual}\n\n`
        : "";

    return `${instruccionAccion}

${conversacionStr}BORRADOR DEL ASESOR (esto es lo que quiere mejorar, respeta su intención):
"${borrador}"

${renderDatos(ctx) || ""}

Analiza:
- ¿Qué INTENCIÓN tiene el borrador?
- ¿Es coherente con la conversación previa?
- ¿Qué le falta o le sobra?
- ¿Qué datos concretos puede mencionar el redactor SIN inventar?
- En briefing_redactor: instrucción clara de REESCRITURA que mantiene la intención del asesor con voz MultiMoney.`;
  }

  const conversacionStr = renderConversacion(conversacion, input, contextoManual);
  const datos = renderDatos(ctx);
  const trustNote = contextoManual
    ? "\n\nNOTA: Conversación pegada manualmente por el asesor. Es la fuente de verdad."
    : "\n\nNOTA: Conversación extraída del DOM, puede tener ruido menor.";

  return `${instruccionAccion}

${conversacionStr}

${datos || ""}
Momento: ${momento.franja}${momento.finDeSemana ? " (fin de semana)" : ""}${trustNote}

Analiza y produce el briefing estratégico. En briefing_redactor: lista datos concretos disponibles (montos, tasas de competencia, plazos mencionados). Si no hay datos numéricos, di explícitamente "hablar en abstracto".`;
}

function buildPromptRedaccion(ctx, briefing, modoVariantes) {
  const { accion, conversacion, input, contextoManual, borrador } = ctx;

  // Override de táctica en el briefing antes de pasarlo al redactor
  const override = TACTIC_OVERRIDES[accion];
  let briefingRedactor = briefing.briefing_redactor;
  let tacticaFinal = briefing.razonamiento_interno.tactica_elegida;
  let riesgosFinal = briefing.razonamiento_interno.riesgos;

  if (override) {
    tacticaFinal = override.tactica;
    if (override.riesgo_bloqueado?.length) {
      const regex = new RegExp(override.riesgo_bloqueado.join("|"), "gi");
      riesgosFinal = riesgosFinal.replace(regex, "[táctica bloqueada]");
      briefingRedactor = briefingRedactor.replace(regex, "[táctica bloqueada]");
    }
  }

  let contextoUltimoMsg;
  if (accion === "mejorar_mensaje") {
    const conversacionStr =
      conversacion?.fuente === "parsed"
        ? `\nCONVERSACIÓN PREVIA (solo contexto):\n${conversacion.resumenContextual}\n`
        : "";
    contextoUltimoMsg = `${conversacionStr}\nBORRADOR DEL ASESOR A REESCRIBIR (mantén su intención):\n"${borrador}"`;
  } else {
    contextoUltimoMsg = renderConversacion(conversacion, input, contextoManual);
  }

  const datos = renderDatos(ctx);

  // Advertencia explícita si la acción tiene prohibiciones de output
  const fraseProhibidasStr =
    override?.prohibido_en_output?.length
      ? `\nFRASES ABSOLUTAMENTE PROHIBIDAS EN TU OUTPUT (para esta acción):
${override.prohibido_en_output.map((f) => `- "${f}"`).join("\n")}`
      : "";

  const briefingStr = `BRIEFING DEL EQUIPO DE ANÁLISIS:
- Etapa: ${briefing.analisis_conversacion.etapa_conversacion}
- Momentum: ${briefing.analisis_conversacion.momentum}
- Emoción cliente: ${briefing.analisis_cliente.emocion}
- Estado: ${briefing.analisis_cliente.estado_cliente}
- Táctica: ${tacticaFinal}
- Riesgos a evitar: ${riesgosFinal}

INSTRUCCIÓN CONCRETA: ${briefingRedactor}

RECORDATORIO ANTI-INVENCIÓN: Solo menciona montos/tasas/plazos que aparezcan textualmente en la conversación. Si no hay, habla en abstracto.${fraseProhibidasStr}`;

  if (modoVariantes) {
    return `${contextoUltimoMsg}

${datos || ""}

${briefingStr}

Genera 3 variantes del mensaje. Todas deben avanzar la venta — ninguna puede ser de retiro o despedida:
- empatica: valida emoción primero, luego avanza
- directa: corta, al grano, ejecutiva
- educativa: explica brevemente el diferencial MultiMoney

Para cada variante incluye "cuando_usar" en 1 frase corta.
Indica "variante_recomendada" según el briefing.`;
  }

  return `${contextoUltimoMsg}

${datos || ""}

${briefingStr}

Escribe el mensaje al cliente. Solo el mensaje, listo para enviar por WhatsApp.`;
}

// ─────────────────────────────────────────────
// POST-PROCESSING
// ─────────────────────────────────────────────
const BANNED_OPENERS = [
  /^hola[,!.]?\s*/i,
  /^buenos\s+días[,!.]?\s*/i,
  /^buenas\s+tardes[,!.]?\s*/i,
  /^buenas\s+noches[,!.]?\s*/i,
  /^buen\s+día[,!.]?\s*/i,
  /^estimado[a]?[,.]?\s*/i,
  /^entiendo tu situación[,.]?\s*/i,
  /^comprendo perfectamente[,.]?\s*/i,
  /^excelente decisión[,.!]?\s*/i,
  /^excelente pregunta[,.!]?\s*/i,
  /^órale[,.!]?\s*/i,
  /^ándale[,.!]?\s*/i,
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
  if (cleaned.length > 0)
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

// ─────────────────────────────────────────────
// BUILD CONTEXT
// ─────────────────────────────────────────────
function buildContext(body) {
  const {
    accion,
    mensajeCliente,
    conversationContext,
    objetivo,
    borrador,
    pregunta,
    datosCliente = {},
    contextoManual,
  } = body;

  let conversacion = null;
  let inputPrincipal = "";
  let modoEntrada = "legacy";

  if (typeof conversationContext === "string" && conversationContext.trim()) {
    conversacion = parseConversationContext(conversationContext);
    inputPrincipal = sanitizeUserText(
      conversacion.ultimoMensajeCliente || mensajeCliente || ""
    );
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
    objetivo:
      sanitizeUserText(objetivo || "").slice(0, LIMITES.OBJETIVO_MAX) || null,
    borrador: borrador
      ? sanitizeUserText(borrador).slice(0, LIMITES.BORRADOR_MAX)
      : null,
    pregunta: pregunta ? sanitizeUserText(pregunta).slice(0, 500) : null,
    nombre: datosCliente.nombre
      ? sanitizeUserText(datosCliente.nombre).slice(0, 100)
      : null,
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
    max_tokens: 800,
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
  const schema = modoVariantes
    ? SCHEMA_REDACCION_VARIANTES
    : SCHEMA_REDACCION_SIMPLE;

  const completion = await openai.chat.completions.create({
    model: modelo,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_REDACCION },
      { role: "user", content: prompt },
    ],
    temperature: modoVariantes ? 0.85 : 0.75,
    max_tokens: modoVariantes ? 700 : 350,
    response_format: { type: "json_schema", json_schema: schema },
  });
  return {
    parsed: JSON.parse(completion.choices[0].message.content),
    tokens: completion.usage?.total_tokens || 0,
    modelo,
  };
}

async function llamarResumenCRM(ctx) {
  const conversacionStr = renderConversacion(
    ctx.conversacion,
    ctx.input,
    ctx.contextoManual
  );
  const datos = renderDatos(ctx);

  const prompt = `Genera una nota CRM factual en 2-3 líneas máximo. Solo datos observables, sin adjetivos subjetivos, sin recomendaciones genéricas. Incluye: etapa actual, objeción dominante si existe, y siguiente paso lógico y específico.

${conversacionStr}

${datos || ""}`;

  const completion = await openai.chat.completions.create({
    model: CONFIG.MODEL_FAST,
    messages: [
      {
        role: "system",
        content: `Eres analista CRM de MultiMoney México. ${CATALOGO_DENSO}\nProduces notas CRM factuales: solo datos observables, sin opiniones, sin recomendaciones vagas. NUNCA inventes datos no presentes en la conversación.`,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 400,
    response_format: { type: "json_schema", json_schema: SCHEMA_RESUMEN_CRM },
  });

  return {
    parsed: JSON.parse(completion.choices[0].message.content),
    tokens: completion.usage?.total_tokens || 0,
  };
}

async function llamarPreguntarIA(ctx) {
  const conversacionStr =
    ctx.conversacion?.fuente === "parsed"
      ? `\nCONTEXTO DE CONVERSACIÓN CON EL CLIENTE (si aplica):\n${ctx.conversacion.resumenContextual}\n`
      : "";

  const prompt = `PREGUNTA DEL ASESOR:
"${ctx.pregunta}"
${conversacionStr}
${ctx.nombre ? `Cliente en contexto: ${ctx.nombre}` : ""}

Responde como mentor del equipo. Directo, práctico, sin floreo.`;

  const completion = await openai.chat.completions.create({
    model: CONFIG.MODEL_FAST,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_PREGUNTAR },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 450,
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
      error: "Rate limit alcanzado. Intenta en unos minutos.",
      request_id: requestId,
    });
  }

  const validationErrors = validateInput(req.body);
  if (validationErrors.length > 0) {
    return res
      .status(400)
      .json({ error: validationErrors.join(". "), request_id: requestId });
  }

  const ctx = buildContext(req.body);
  const { accion } = ctx;
  const modoVariantes =
    req.body.modo === "variantes" && ACCIONES_PREMIUM.has(accion);

  try {
    // ─── RUTA 1: resumen_crm ───
    if (accion === "resumen_crm") {
      const { parsed, tokens } = await llamarResumenCRM(ctx);
      const tiempo_respuesta_ms = Date.now() - startTime;

      return res.status(200).json({
        respuesta:
          cleanResponse(parsed.respuesta) || "Sin datos suficientes para resumen.",
        razonamiento_interno: null,
        analisis_conversacion: parsed.analisis_conversacion,
        siguiente_jugada: parsed.siguiente_jugada,
        _meta: {
          accion,
          request_id: requestId,
          tiempo_respuesta_ms,
          tokens,
          version: "8.0",
          modo_entrada: ctx.modoEntrada,
          pipeline: "single_mini",
          contexto_manual: ctx.contextoManual,
        },
      });
    }

    // ─── RUTA 2: preguntar_ia ───
    if (accion === "preguntar_ia") {
      const { parsed, tokens } = await llamarPreguntarIA(ctx);
      const tiempo_respuesta_ms = Date.now() - startTime;
      const { sospechoso, montosInventados } = validarMontosOutput(
        parsed.respuesta,
        ctx.montosPermitidos
      );

      return res.status(200).json({
        respuesta:
          cleanResponse(parsed.respuesta) ||
          "Necesito un poco más de contexto para responderte bien.",
        razonamiento_interno: null,
        analisis_conversacion: null,
        siguiente_jugada: null,
        warning_montos_inventados: sospechoso ? montosInventados : null,
        _meta: {
          accion,
          request_id: requestId,
          tiempo_respuesta_ms,
          tokens,
          version: "8.0",
          modo_entrada: ctx.modoEntrada,
          pipeline: "single_mini_qa",
          contexto_manual: ctx.contextoManual,
        },
      });
    }

    // ─── RUTA 3: pipeline 2 etapas (todas las demás acciones) ───
    const { parsed: briefing, tokens: tokensAnalisis } = await llamarAnalisis(ctx);
    const {
      parsed: redaccion,
      tokens: tokensRedaccion,
      modelo: modeloRedaccion,
    } = await llamarRedaccion(ctx, briefing, modoVariantes);

    const tiempo_respuesta_ms = Date.now() - startTime;
    const tokensTotal = tokensAnalisis + tokensRedaccion;

    // Limpiar señales inválidas
    if (Array.isArray(briefing.analisis_conversacion?.senales_detectadas)) {
      briefing.analisis_conversacion.senales_detectadas =
        briefing.analisis_conversacion.senales_detectadas
          .filter((s) => SENALES_ENUM.includes(s))
          .slice(0, 8);
    }

    // Override de estado_cliente mínimo según acción
    const override = TACTIC_OVERRIDES[accion];
    if (override?.estado_minimo === "Tibio" && briefing.analisis_cliente.estado_cliente === "Frío") {
      briefing.analisis_cliente.estado_cliente = "Tibio";
    }

    const metaBase = {
      accion,
      request_id: requestId,
      tiempo_respuesta_ms,
      tokens: tokensTotal,
      version: "8.0",
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

      // Limpiar y verificar cada variante
      variantes.empatica.mensaje =
        cleanResponse(variantes.empatica.mensaje) ||
        "¿Qué es lo que genera la duda? Resolvemos en este momento.";
      variantes.directa.mensaje =
        cleanResponse(variantes.directa.mensaje) ||
        "¿Avanzamos con el siguiente paso?";
      variantes.educativa.mensaje =
        cleanResponse(variantes.educativa.mensaje) ||
        "Te explico el diferencial para que decidas con números claros.";

      // Si alguna variante huele a rendición, reemplazar
      if (detectaRendicion(variantes.empatica.mensaje)) {
        variantes.empatica.mensaje =
          "Tiene sentido revisarlo. ¿Qué es específicamente lo que te genera la duda para resolverlo en este momento?";
      }
      if (detectaRendicion(variantes.directa.mensaje)) {
        variantes.directa.mensaje =
          "¿Calculamos tu cuota para que veas los números concretos?";
      }
      if (detectaRendicion(variantes.educativa.mensaje)) {
        variantes.educativa.mensaje =
          "La diferencia clave: tienes el dinero en 2 horas, sin penalización por pago anticipado. ¿Calculamos cuota?";
      }

      const recomendada = redaccion.variante_recomendada || "directa";

      const warningEmpatica = validarMontosOutput(
        variantes.empatica.mensaje,
        ctx.montosPermitidos
      );
      const warningDirecta = validarMontosOutput(
        variantes.directa.mensaje,
        ctx.montosPermitidos
      );
      const warningEducativa = validarMontosOutput(
        variantes.educativa.mensaje,
        ctx.montosPermitidos
      );
      const algunWarning = [warningEmpatica, warningDirecta, warningEducativa]
        .filter((w) => w.sospechoso)
        .flatMap((w) => w.montosInventados);

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

    // Modo simple
    let respuestaLimpia =
      cleanResponse(redaccion.respuesta) ||
      "Cuéntame un poco más para darte la mejor opción.";

    // Última línea de defensa: si el output es una rendición, reemplazar
    if (detectaRendicion(respuestaLimpia)) {
      const fallbacks = {
        negociar_tasa:
          "Tiene sentido compararlo. La diferencia está en las condiciones: aquí el dinero llega en 2 horas, sin aval, sin penalización si liquidas antes. ¿Te calculo cuánto sería tu cuota mensual?",
        responder_objecion:
          "¿Qué es específicamente lo que genera la duda? Si lo resolvemos ahorita, tienes todo claro para avanzar.",
        cerrar_venta:
          "Para que tu dinero esté hoy en tu cuenta, mándame foto de tu INE por ambos lados.",
        seguimiento:
          "Retomando — ¿pudiste revisar lo que habíamos platicado?",
      };
      respuestaLimpia =
        fallbacks[accion] ||
        "¿Qué es lo que genera la duda? Resolvemos en este momento.";
    }

    const { sospechoso, montosInventados } = validarMontosOutput(
      respuestaLimpia,
      ctx.montosPermitidos
    );

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
  detectaRendicion,
  TACTIC_OVERRIDES,
  SCHEMA_ANALISIS,
  SCHEMA_REDACCION_SIMPLE,
  SCHEMA_REDACCION_VARIANTES,
  SENALES_ENUM,
  LIMITES,
  CONFIG,
};
