/**
 * ============================================================================
 *  War Room — Relay de alertas a Slack (Vercel serverless)
 * ============================================================================
 *
 * El War Room (war-room.html) envía aquí sus alertas y esta función las
 * reenvía a Slack. Así la URL NO queda expuesta en el navegador y no hay CORS.
 *
 * Soporta los DOS tipos de URL de Slack:
 *   A) Incoming Webhook clásico  -> https://hooks.slack.com/services/T.../B.../xxx
 *      Publica el mensaje directo (con formato). Funciona en plan gratis.
 *   B) Trigger de Workflow Builder -> https://hooks.slack.com/triggers/T.../.../...
 *      Dispara un Workflow tuyo. Requiere plan de pago de Slack y que el
 *      Workflow tenga: (1) inicio "Desde un webhook" con una variable de texto
 *      llamada  mensaje , y (2) un paso "Enviar mensaje a un canal" que use esa
 *      variable {mensaje}. Se envía como { "mensaje": "..." }.
 *
 * ---- Variables de entorno en Vercel (Settings -> Environment Variables) ----
 *   SLACK_WEBHOOK_URL  = tu URL (de /services/... o de /triggers/...)
 *   SLACK_TRIGGER_VAR  = (opcional, solo triggers) nombre de la variable del
 *                        workflow. Por defecto "mensaje".
 *  Guarda y haz Redeploy.
 *
 *  Espera un POST con { alerts: [{ tipo, txt, meta, sev }] }.
 * ============================================================================
 */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return res.status(500).json({ error: "Falta la variable SLACK_WEBHOOK_URL" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  const alerts = Array.isArray(body && body.alerts)
    ? body.alerts
    : (body && body.text ? [{ tipo: body.title || "Alerta", txt: body.text, meta: "", sev: 3 }] : []);
  if (!alerts.length) return res.status(400).json({ error: "Sin alertas en el cuerpo" });

  const icono = (sev) => (Number(sev) >= 3 ? "🚨" : "⚠️");
  const lineas = alerts.slice(0, 20).map((a) => {
    const meta = a.meta ? ` (${a.meta})` : "";
    return `${icono(a.sev)} ${a.tipo || "Alerta"} — ${a.txt || ""}${meta}`;
  });
  const resumen = `📊 Alertas de ventas (${alerts.length})\n` + lineas.join("\n");

  const esTrigger = /hooks\.slack\.com\/triggers\//.test(webhook);
  let payload;
  if (esTrigger) {
    // Workflow Builder: payload plano con las variables declaradas en el workflow.
    const varName = process.env.SLACK_TRIGGER_VAR || "mensaje";
    payload = { [varName]: resumen };
  } else {
    // Incoming Webhook clásico: mensaje con Block Kit.
    payload = {
      text: `📊 War Room · Alertas de ventas (${alerts.length})`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `📊 Alertas de ventas (${alerts.length})`, emoji: true } },
        { type: "section", text: { type: "mrkdwn", text: lineas.map((l) => l.replace(/^🚨 /, ":rotating_light: ").replace(/^⚠️ /, ":warning: ")).join("\n") } },
      ],
    };
  }

  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, tipo: esTrigger ? "trigger" : "webhook" });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
}
