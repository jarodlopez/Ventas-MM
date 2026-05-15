import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.AI_API_KEY });

// ─────────────────────────────────────────────
// VALIDACIÓN DE ENTRADA
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
// SYSTEM PROMPT — Compacto y sin contradicciones
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el copiloto de ventas de MultiMoney. Generas mensajes de WhatsApp listos para enviar por un asesor financiero humano a clientes reales de crédito personal.

━━━ REGLAS DURAS — NUNCA las ignores ━━━
1. CERO saludos. Jamás empieces con "Hola", "Buenos días", "Buen día", "Qué tal" ni nada similar. La conversación ya está abierta.
2. CERO despedidas. Nada de "Quedo a tus órdenes", "Saludos", "Hasta pronto".
3. CERO frases de IA/call center: "Entiendo perfectamente", "Comprendo tu situación", "Con mucho gusto", "Es un placer", "Claro que sí", "Sin problema", "Por supuesto".
4. CERO apertura validando emoción. No empieces reconociendo cómo se siente el cliente — ve al punto.
5. Nunca inventes tasas, montos ni beneficios no mencionados.

━━━ TÉCNICA REA — BASE DE MANEJO DE OBJECIONES ━━━
Para cualquier objeción, aplica REA de forma conversacional (no robótica):
R — RECONOCE: Parafrasea la objeción brevemente con tus palabras.
E — EMPATIZA: Una frase corta que valide su punto sin exceso.
A — ASEGURA: Conecta el beneficio de MultiMoney específicamente con su situación y uso del crédito.
Termina siempre con una pregunta de micro-cierre natural.

━━━ ARGUMENTOS POR USO DEL CRÉDITO ━━━
Siempre que tengas el uso, adapta el argumento:
- Negocio: retorno sobre inversión, capital hoy = utilidades mañana
- Gastos médicos: depósito en 2 horas, sin trámites, urgencia resuelta
- Vacaciones/familia: cuotas cómodas, el disfrute no espera
- Auto: movilidad, ahorro en transporte, calidad de vida
- Emergencia/imprevisto: certeza de contar con el dinero cuando lo necesitas
- Consolidación: un solo pago ordenado, menor estrés financiero, recuperas control
- Sin uso definido: colchón financiero — no lo necesitas hasta que lo necesitas

━━━ BENEFICIOS CLAVE DE MULTIMONEY (usar solo los que aplican) ━━━
- Depósito en máximo 2 horas
- Proceso 100% en línea, sin filas ni papeleo
- Plazo hasta 60 meses (cuota accesible)
- Sin penalización por pago anticipado o aportaciones a capital
- Ampliación disponible a partir del 3er pago puntual
- Ya está pre-aprobado — no es una solicitud, es una oferta activa

━━━ ESTILO ━━━
Asesor senior con criterio. Seguro, no ansioso. Claro, no corporativo.
Varía apertura, longitud y ritmo. Usa el nombre del cliente si está disponible.

LONGITUD: Proporcional al mensaje del cliente. Corto → corto. Largo → puedes extenderte.

━━━ FORMATO ━━━
Responde SIEMPRE con JSON válido:
{ "respuesta": "mensaje aquí" }
Opcionales: "tipo_objecion" (precio|desconfianza|indecisión|falta_de_tiempo|comparación|ghosting), "emocion", "tono_sugerido", "estado_cliente" (Frío|Tibio|Caliente)`;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const renderCtx = (label, value) => (value ? `${label}: ${value}\n` : "");
const renderHistorial = (h) => (h ? `Historial reciente:\n${h}\n` : "");

const instruccionLongitud = `
REGLA: Adapta la longitud de tu respuesta al mensaje del cliente:
- Mensaje corto (<25 chars) → respuesta de 1-2 líneas
- Mensaje medio (25-120 chars) → 2-3 líneas
- Mensaje largo (>120 chars) → hasta 4-5 líneas`;

// Recordatorio que se inyecta al FINAL de cada prompt de acción.
// Los LLMs atienden más el final del contexto — esto refuerza la regla crítica
// justo antes de que el modelo genere.
const RECORDATORIO_FINAL = `
⚠️ ANTES DE GENERAR: Verifica que tu respuesta NO empiece con saludo ("Hola", "Buenos días", etc.) ni despedida. Ve directo al punto. Sin frases de IA.`;
// ─────────────────────────────────────────────
// PLANTILLAS DE ACCIÓN
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
3. ASEGURA conectando el beneficio de MultiMoney con el uso específico del crédito del cliente

Si tienes el nombre del cliente, úsalo una vez de forma natural.
Termina con una pregunta de micro-cierre que mueva la conversación hacia adelante.

OBJECIONES COMUNES Y CÓMO MANEJARLAS:
- "Monto muy bajo": menciona que a partir del 3er pago puntual hay ampliación disponible. Pregunta para qué usará el crédito y muestra que el monto actual cubre la fase inicial.
- "No necesito el dinero / solo estaba viendo": posiciona el crédito como colchón financiero. "No lo necesitas hasta que lo necesitas." Explora proyectos postergados.
- "No necesito la suma entera": tomar el monto mayor da flexibilidad y mejor historial para ampliaciones. El dinero extra no tiene que usarse de inmediato.
- "Lo tengo que pensar / consultar": pregunta qué genera la duda específicamente (monto, plazo, documentación). La oferta puede no estar disponible mañana.

Incluye tipo_objecion y emocion en el JSON.
${RECORDATORIO_FINAL}`,

  negociar_tasa: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre del cliente", ctx.nombre)}
${renderCtx("Tasa ofrecida", ctx.tasa)}
${renderCtx("Uso del crédito", ctx.uso)}
${renderCtx("Monto aprobado", ctx.monto)}
${renderHistorial(ctx.historial)}
${instruccionLongitud}

Aplica REA de forma conversacional para manejar la objeción de tasa:
1. RECONOCE: El cliente compara con su banco o siente que la tasa es alta.
2. EMPATIZA: Es válido analizar el costo — eso habla de que es un cliente responsable.
3. ASEGURA: Enfócate en estos argumentos (elige los que apliquen al uso del crédito):
   - El cliente ya está pre-aprobado HOY — proceso rápido, sin filas, sin trámites. Eso tiene valor real.
   - El costo del tiempo y la burocracia de un banco normalmente supera la diferencia en tasa.
   - Sin penalización por pago anticipado — si paga antes, reduce el costo total del crédito.
   - Si el uso es negocio: el rendimiento del negocio supera la tasa. El dinero hoy genera utilidades mañana.
   - Si el uso es emergencia/médico: la agilidad del depósito (2 horas) no tiene precio cuando hay urgencia.
   - Si consolida deudas: una sola mensualidad ordenada normalmente es más baja que los pagos actuales combinados.

Si tienes el nombre, úsalo una vez.
Termina con una pregunta concreta: calcular cuotas juntos, avanzar con el proceso, o resolver otra duda.

Incluye tipo_objecion: "precio" en el JSON.
${RECORDATORIO_FINAL}`,

  cerrar_venta: (ctx) => `
Mensaje del cliente: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}
${renderCtx("Monto", ctx.monto)}
${renderCtx("Plazo", ctx.plazo)}
${renderCtx("Tasa", ctx.tasa)}
${renderCtx("Uso", ctx.uso)}
${renderHistorial(ctx.historial)}
${instruccionLongitud}

SITUACIÓN: El cliente muestra intención de avanzar o ya aceptó la oferta.

Si hay intención clara → micro-cierre natural. Ejemplos de lo que pedir según el momento:
- Confirmar link biométrico recibido por WhatsApp
- Tener INE a la mano (fotos claras, sin fondo blanco, ambos lados)
- Confirmar CLABE de 18 dígitos de la cuenta donde llegará el depósito
- Selfie de rostro completo sin accesorios
- 2 referencias: 1 familiar y 1 conocido

Si hay fricción o duda → resuélvela primero antes de pedir documentación.
Transmite seguridad: el proceso es 100% en línea, el depósito llega en máximo 2 horas.
${RECORDATORIO_FINAL}`,

  seguimiento: (ctx) => `
Último mensaje / razón de no cierre: "${ctx.input}"
${renderCtx("Nombre", ctx.nombre)}
${renderCtx("Última interacción", ctx.ultimaInteraccion)}
${renderCtx("Uso", ctx.uso)}
${renderHistorial(ctx.historial)}
${instruccionLongitud}

Recontacto para retomar desde donde quedó la conversación previa.

REGLAS:
- Retoma el punto exacto donde quedó — no arranques desde cero
- Valida si la necesidad sigue vigente sin asumir que sí sigue interesado
- No sonar desesperado ni insistente
- Si dijo "lo pienso" → pregunta si resolvió la duda que tenía
- Si desapareció (ghosting) → mensaje corto, baja fricción, puerta abierta
- Si acordaron un seguimiento → cumple el compromiso, menciona el contexto acordado

Mantén la conversación viva sin presionar.
${RECORDATORIO_FINAL}`,

  resumen_crm: (ctx) => `
Datos del cliente: ${ctx.nombre} | Monto: ${ctx.monto} | Plazo: ${ctx.plazo} | Tasa: ${ctx.tasa} | Uso: ${ctx.uso}
Mensaje / situación clave: "${ctx.input}"

Devuelve una nota CRM en el campo "respuesta". Usa el formato de plantilla que corresponda al resultado:

VENTA:
Medio de contacto: [WhatsApp / Llamada / etc.]
Ocupación: | Ingresos: | Comp Ingresos:
Monto Aceptado: | Biométrico: Completo / Pendiente
Comentarios: [contexto relevante]

SEGUIMIENTO:
Medio de contacto:
Razón de seguimiento:
Fecha y hora acordada:
Comentarios:

SIN CONTACTO:
Primer Intento — Medio: | Resultado: NC / BV
[continúa si aplica]

EN VALIDACIÓN:
Documentación entregada a Riesgo: | Pendiente:
Referencias entregadas: Sí / No | Biométrico:
SLA acordado con cliente:

Elige la plantilla correcta según el contexto. Solo datos factuales, sin subjetividad.`,

  mejorar_mensaje: (ctx) => `
Borrador del asesor:
"${ctx.input}"
${renderCtx("Nombre del cliente", ctx.nombre)}
${renderCtx("Uso del crédito", ctx.uso)}
${renderHistorial(ctx.historial)}

Tu única tarea: convertir este borrador en la mejor versión posible para WhatsApp.

QUÉ MEJORAR (en orden de prioridad):
1. Elimina cualquier saludo o despedida — la conversación ya está abierta
2. Quita frases de call center ("Con gusto", "Quedo a tus órdenes", "Es un placer", "A sus órdenes")
3. Si suena genérico → hazlo específico al contexto del cliente
4. Si suena largo → simplifica sin perder la intención
5. Si suena frío → humanízalo con una frase natural, no artificial
6. Si suena desesperado o insistente → dale seguridad, baja la presión

ESTILO OBJETIVO — asesor senior con experiencia real en créditos digitales:
- Habla como persona, no como guión
- Ve al punto antes de explicar beneficios
- Los micro-cierres deben sentirse naturales: "Si le parece, lo dejamos listo ahorita"
- Nunca suplicar, nunca presionar, nunca sonar ansioso

EJEMPLOS:

Borrador: "Hola! Quería recordarle que aún tiene disponible su crédito preaprobado. Quedo a sus órdenes para cualquier duda."
Mejorado: "Su crédito sigue disponible. Si quiere avanzar esta semana, el proceso es rápido y el dinero cae el mismo día."

Borrador: "Buenos días, ¿cómo está usted? Le escribo para comentarle que ya tenemos todo listo para su préstamo."
Mejorado: "Ya tenemos todo listo de su lado. Solo necesitamos que nos confirme para activar el proceso."

Borrador: "Entiendo que está ocupado pero me gustaría saber si aún le interesa el crédito que le ofrecimos."
Mejorado: "¿Sigue en pie lo del crédito? Si el momento cambió no hay problema — pero si quiere avanzar, lo resolvemos rápido."

Borrador: "Con mucho gusto le ayudo. Para proceder necesito que me envíe su INE y CLABE interbancaria."
Mejorado: "Para dejarlo listo necesito su INE y CLABE. ¿Me los puede mandar ahorita?"

RESTRICCIONES:
- No cambies el significado original
- No inventes tasas, montos ni beneficios no mencionados
- Si el borrador ya está bien, solo pule detalles pequeños
- El resultado debe sentirse escrito por el mismo asesor, en su mejor versión
${RECORDATORIO_FINAL}`,
};

// ─────────────────────────────────────────────
// CONTEXTO
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
// POST-PROCESSING
// Más quirúrgico: solo limpia, no rompe frases.
// ─────────────────────────────────────────────
const BANNED_OPENERS = [
  // Saludos — el problema principal
  /^hola[,!.]?\s*/i,
  /^buenos\s+días[,!.]?\s*/i,
  /^buenas\s+tardes[,!.]?\s*/i,
  /^buenas\s+noches[,!.]?\s*/i,
  /^buen\s+día[,!.]?\s*/i,
  /^qué\s+tal[,!.]?\s*/i,
  // Frases de IA clásicas
  /^perfecto[,.]?\s*/i,
  /^claro que sí[,.]?\s*/i,
  /^sin problema[,.]?\s*/i,
  /^con gusto[,.]?\s*/i,
  /^con mucho gusto[,.]?\s*/i,
  /^entiendo tu situación[,.]?\s*/i,
  /^comprendo tu situación[,.]?\s*/i,
  /^por supuesto[,.]?\s*/i,
  /^encantado[,.]?\s*/i,
];

function cleanResponse(text) {
  if (!text || typeof text !== "string") return "";

  let cleaned = text.trim();

  // Solo elimina si el patrón está al inicio (no rompe frases en medio)
  for (const pattern of BANNED_OPENERS) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, "").trim();
      break; // Solo un pase
    }
  }

  // Capitalizar primera letra si quedó en minúscula
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // Eliminar saltos excesivos sin cortar líneas abruptamente
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned;
}

// ─────────────────────────────────────────────
// PARSEO DEFENSIVO DEL JSON
// Maneja markdown fences y texto plano inesperado.
// ─────────────────────────────────────────────
function safeParseJSON(raw) {
  if (!raw || typeof raw !== "string") {
    return { respuesta: null, parseError: "Respuesta vacía del modelo" };
  }

  // Eliminar markdown fences si el modelo los incluyó
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.respuesta !== "string") {
      return { respuesta: null, parseError: "Campo 'respuesta' ausente o inválido" };
    }
    return parsed;
  } catch (e) {
    // Si falla el parse pero hay texto, úsalo como fallback
    return {
      respuesta: cleaned.length > 0 ? cleaned : null,
      parseError: `JSON inválido: ${e.message}`,
    };
  }
}

// ─────────────────────────────────────────────
// TEMPERATURA POR ACCIÓN
// ─────────────────────────────────────────────
const TEMPERATURE_BY_ACTION = {
  resumen_crm: 0.2,
  cerrar_venta: 0.45,
  negociar_tasa: 0.5,
  responder_objecion: 0.6,
  seguimiento: 0.65,
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

  // Validación temprana
  const validationErrors = validateInput(req.body);
  if (validationErrors.length > 0) {
    return res.status(400).json({ error: validationErrors.join(". ") });
  }

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
      max_tokens: 220, // Subido ligeramente: 180 era demasiado justo para respuestas largas
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content;
    const parsed = safeParseJSON(raw);

    // Fallback si el modelo devolvió algo irrecuperable
    if (!parsed.respuesta) {
      console.warn(`[${requestId}] Parse fallback activado:`, parsed.parseError);
      parsed.respuesta = "Disculpa, ¿podrías darme un poco más de detalle sobre eso?";
    } else {
      parsed.respuesta = cleanResponse(parsed.respuesta);
      // Segunda verificación: si cleanResponse dejó vacío
      if (!parsed.respuesta) {
        parsed.respuesta = "Disculpa, ¿podrías darme un poco más de detalle sobre eso?";
      }
    }

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
        modelo: completion.model,
        ...(parsed.parseError && { parse_warning: parsed.parseError }),
      },
    });
  } catch (err) {
    // Log estructurado con contexto suficiente para depurar en producción
    console.error(JSON.stringify({
      level: "error",
      request_id: requestId,
      accion,
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString(),
    }));

    return res.status(500).json({
      error: "Error generando respuesta. Intenta de nuevo.",
      request_id: requestId, // Para correlacionar con logs
      ...(process.env.NODE_ENV === "development" && { detalle: err.message }),
    });
  }
}
