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

  // 1. VALIDACIÓN DE SEGURIDAD (Whitelist) - Evita inyección de prompts
  const accionesValidas = [
    "responder_objecion",
    "negociar_tasa",
    "cerrar_venta",
    "resumir"
  ];

  if (!accionesValidas.includes(accion)) {
    return res.status(400).json({ error: "Acción inválida o no permitida por el sistema." });
  }

  // 2. CONTROL DE COSTOS - Limita el texto a 1500 caracteres
  const inputLimitado = objecion ? objecion.slice(0, 1500) : "Sin mensaje previo.";

  // 3. PROMPT MAESTRO OPTIMIZADO Y ESTRUCTURADO
  const systemPrompt = `Eres un asesor financiero experto de MultiMoney.

  Objetivo:
  Ayudar al vendedor a responder clientes y aumentar cierres.

  Reglas:
  - Respuestas listas para WhatsApp.
  - Máximo 3 líneas.
  - Sonar humano y seguro.
  - No usar lenguaje robótico.
  - No inventar tasas o beneficios.
  - Enfatizar rapidez, facilidad y proceso digital.
  - Nunca discutir con el cliente.
  
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

  // Enrutador de Acciones
  if (accion === 'responder_objecion') {
    promptDinamico += `\nInstrucción: Rebate la objeción financiera enfocándote en nuestros beneficios.`;
  } else if (accion === 'negociar_tasa') {
    promptDinamico += `\nInstrucción: Justifica la tasa de interés. Hazle ver que aunque la tasa sea ligeramente mayor que un banco tradicional, aquí tiene el dinero HOY sin burocracia.`;
  } else if (accion === 'cerrar_venta') {
    promptDinamico += `\nInstrucción: Haz un llamado a la acción fuerte. Pídele sus documentos o que firme el contrato para depositarle ya.`;
  } else if (accion === 'resumir') {
    promptDinamico += `\nInstrucción: Resume el estatus de este cliente en 3 viñetas cortas.`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // <-- EL ARREGLO CLAVE (Modelo real y ultra rápido)
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: promptDinamico }
      ],
      temperature: 0.4, 
      max_tokens: 150, // <-- Arreglado a max_tokens por compatibilidad SDK
      response_format: { type: "json_object" } 
    });

    // Parseamos la respuesta JSON de la IA
    const dataIA = JSON.parse(response.choices[0].message.content);

    // Devolvemos exactamente lo que la extensión espera
    res.status(200).json({ respuesta: dataIA.respuesta });

  } catch (error) {
    console.error("Error del Servidor/OpenAI:", error);
    res.status(500).json({ error: error.message || "Error interno del servidor" });
  }
}
