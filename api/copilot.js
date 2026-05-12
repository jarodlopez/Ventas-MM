import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_API_KEY
});

export default async function handler(req, res) {
  // CORS para permitir la conexión desde tu extensión
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { accion, objecion, datosCliente } = req.body;

  // 1. VALIDACIÓN DE SEGURIDAD (Whitelist ampliada y validada)
  const accionesValidas = [
    "responder_objecion",
    "negociar_tasa",
    "cerrar_venta",
    "seguimiento", // Añadido basado en el análisis
    "resumir"
  ];

  if (!accionesValidas.includes(accion)) {
    return res.status(400).json({ error: "Acción inválida o no permitida por el sistema." });
  }

  // 2. CONTROL DE COSTOS
  const inputLimitado = objecion ? objecion.slice(0, 1500) : "Sin mensaje previo.";

  // 3. PROMPT MAESTRO OPTIMIZADO (Filosofía consultiva y de acompañamiento)
  const systemPrompt = `Eres el copiloto de ventas de MultiMoney. Ayudas a asesores financieros a responder clientes reales por WhatsApp de forma natural, profesional y humana.

El cliente no debe sentir que habla con un vendedor presionando un cierre. Debe sentir que habla con un asesor que entiende su situación y le ayuda a tomar una buena decisión.

TONO Y FILOSOFÍA:
- Conversacional, claro y profesional. Natural y humano.
- Seguro sin sonar dominante, consultivo sin manipular.
- Nunca agresivo ni insistente. No discutas ni presiones.
- Adapta la intensidad según el estado del cliente (calma si duda, dirección si hay interés, simplifica si hay confusión).
- Varía tu forma de empatizar, no repitas siempre frases como "entiendo" o "comprendo".

REGLAS ESTRICTAS:
- No inventes tasas, montos o beneficios.
- No todas las respuestas deben cerrar venta; generar confianza también es un avance.
- Máximo 4 líneas cortas. Prioriza claridad y naturalidad sobre sonar resumido.
- Respuestas listas para WhatsApp, sin emojis y sin sonar robótico.

OBLIGATORIO: Tu respuesta debe ser un objeto JSON válido con la propiedad "respuesta".`;

  // 4. CONTEXTO DINÁMICO
  let promptDinamico = `
Contexto del Cliente:
- Nombre: ${datosCliente?.nombre || 'Cliente'}
- Monto Solicitado: ${datosCliente?.monto || 'No especificado'}
- Tasa: ${datosCliente?.tasa || 'No especificada'}
- Plazo: ${datosCliente?.plazo || 'No especificado'}

Conversación / Mensaje del cliente: "${inputLimitado}"
`;

  // 5. ENRUTADOR DE ACCIONES (Inteligencia relacional aplicada)
  if (accion === 'responder_objecion') {
    promptDinamico += `\nInstrucción: Valida primero lo que el cliente piensa o siente. Responde con claridad y tranquilidad. Explica el valor de nuestros beneficios solo si aporta contexto útil, sin sonar a que estás "debatiendo".`;
  } else if (accion === 'negociar_tasa') {
    promptDinamico += `\nInstrucción: Enfócate en el costo de oportunidad y la rapidez (tiene el dinero HOY sin burocracia). Hazlo de forma conversacional, evitando justificar el precio a la defensiva.`;
  } else if (accion === 'cerrar_venta') {
    promptDinamico += `\nInstrucción: Si el cliente muestra intención o apertura, invítalo a continuar el proceso o enviar documentos. Si aún muestra fricción o dudas, enfócate primero en resolverlas sin presionar.`;
  } else if (accion === 'seguimiento') {
    promptDinamico += `\nInstrucción: Haz un acercamiento humano y contextual. Valida si la necesidad del cliente sigue vigente sin sonar automático ni asumir que ya está listo para comprar.`;
  } else if (accion === 'resumir') {
    promptDinamico += `\nInstrucción: Resume el estatus de este cliente en 3 viñetas cortas.`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: promptDinamico }
      ],
      // Se sube la temperatura a 0.55 para evitar repeticiones y ganar fluidez natural
      temperature: 0.55, 
      // Se ajusta ligeramente hacia arriba para dar margen a las 4 líneas sin cortar texto
      max_tokens: 200, 
      response_format: { type: "json_object" } 
    });

    const dataIA = JSON.parse(response.choices[0].message.content);

    res.status(200).json({ respuesta: dataIA.respuesta });

  } catch (error) {
    console.error("Error del Servidor/OpenAI:", error);
    res.status(500).json({ error: error.message || "Error interno del servidor" });
  }
}

