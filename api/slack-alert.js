/**
 * ============================================================================
 *  War Room — Relay de alertas a Slack (Vercel serverless)
 * ============================================================================
 *
 * El War Room (war-room.html) envía aquí sus alertas y esta función las
 * reenvía a Slack. Así el webhook NO queda expuesto en el navegador y no hay
 * problemas de CORS (esto corre en el servidor).
 *
 * ---- Configuración (una sola vez) ----
 *  1) Crea el Incoming Webhook en Slack:
 *       https://api.slack.com/apps  ->  Create New App  ->  From scratch
 *       -> Incoming Webhooks (On)  ->  Add New Webhook to Workspace
 *       -> elige el canal (ej. #ventas-alertas)  ->  copia la URL.
 *     (Un webhook = un canal. Con uno para el equipo basta; no es por usuario.)
 *
 *  2) En Vercel: Project -> Settings -> Environment Variables -> Add
 *       Name:  SLACK_WEBHOOK_URL
 *       Value: https://hooks.slack.com/services/T.../B.../xxxx
 *     Redeploy. Listo.
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

  const icono = (sev) => (Number(sev) >= 3 ? ":rotating_light:" : ":warning:");
  const lineas = alerts.slice(0, 20).map((a) => {
    const meta = a.meta ? `  _(${a.meta})_` : "";
    return `${icono(a.sev)} *${a.tipo || "Alerta"}* — ${a.txt || ""}${meta}`;
  });

  const payload = {
    text: `:bar_chart: *War Room · Alertas de ventas* (${alerts.length})`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `📊 Alertas de ventas (${alerts.length})`, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: lineas.join("\n") } },
    ],
  };

  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
}
