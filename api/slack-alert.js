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

  // Texto a enviar: (a) reporte con formato propio (body.mensaje), o (b) resumen de alertas.
  let resumen;
  if (body && typeof body.mensaje === "string" && body.mensaje.trim()) {
    resumen = body.mensaje;
  } else {
    const alerts = Array.isArray(body && body.alerts)
      ? body.alerts
      : (body && body.text ? [{ tipo: body.title || "Alerta", txt: body.text, meta: "", sev: 3 }] : []);
    if (!alerts.length) return res.status(400).json({ error: "Sin alertas ni mensaje en el cuerpo" });
    const icono = (sev) => (Number(sev) >= 3 ? "🚨" : "⚠️");
    const lineas = alerts.slice(0, 20).map((a) => {
      const meta = a.meta ? ` (${a.meta})` : "";
      return `${icono(a.sev)} ${a.tipo || "Alerta"} — ${a.txt || ""}${meta}`;
    });
    resumen = `📊 Alertas de ventas (${alerts.length})\n` + lineas.join("\n");
  }

  const esTrigger = /hooks\.slack\.com\/triggers\//.test(webhook);
  const varName = process.env.SLACK_TRIGGER_VAR || "mensaje";
  const payload = esTrigger ? { [varName]: resumen } : { text: resumen };

  if (typeof fetch !== "function") {
    return res.status(500).json({ ok: false, error: "El runtime no tiene fetch (usa Node 18+ en Vercel)" });
  }

  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const slackBody = await r.text().catch(() => "");
    if (!r.ok) {
      console.error("Slack rechazó:", r.status, slackBody);
      return res.status(502).json({
        ok: false, status: r.status, tipo: esTrigger ? "trigger" : "webhook",
        slack: (slackBody || "").slice(0, 300), enviado: payload,
      });
    }
    return res.status(200).json({ ok: true, status: r.status, tipo: esTrigger ? "trigger" : "webhook", slack: (slackBody || "").slice(0, 200) });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
}
