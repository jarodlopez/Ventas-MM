/**
 * ============================================================================
 *  MUNDIAL 2026 — Proxy de marcador EN VIVO (Cloudflare Worker)  [TEMPORAL]
 * ============================================================================
 *
 * ¿Para qué sirve?
 *   El CRM (index.html) es una página estática que corre en el navegador.
 *   API-Football NO se puede llamar directo desde el navegador (bloquea CORS
 *   y expondría tu llave). Este Worker es un intermediario que:
 *     1) guarda tu llave en secreto (no viaja al navegador),
 *     2) agrega los encabezados CORS para que el CRM pueda leerlo,
 *     3) cachea la respuesta para no gastar tu límite gratis (100 req/día).
 *
 * ¿Es gratis?
 *   - Cloudflare Workers: gratis (100,000 req/día).
 *   - API-Football: plan gratis 100 req/día (incluye el Mundial). Con el caché
 *     de abajo (TTL 300s = 5 min), aunque muchos vean el CRM se hace 1 sola
 *     consulta cada 5 min -> alcanza para un día de partidos sin pasarte.
 *     Si quieres refresco más rápido en días con muchos partidos, sube de plan.
 *
 * ----------------------------------------------------------------------------
 *  CÓMO DESPLEGARLO (una sola vez, ~5 min)
 * ----------------------------------------------------------------------------
 *  1) Crea cuenta gratis en API-Football y copia tu llave (API key):
 *        https://dashboard.api-football.com/register   (o vía RapidAPI)
 *
 *  2) Crea cuenta gratis en Cloudflare:  https://dash.cloudflare.com/sign-up
 *
 *  3) En el panel de Cloudflare:  Workers & Pages  ->  Create  ->  Create Worker
 *        - Ponle un nombre (ej. "mundial-marcador") y "Deploy".
 *        - Click en "Edit code", BORRA lo que traiga y PEGA todo este archivo.
 *        - "Deploy".
 *
 *  4) Guarda tu llave como variable secreta del Worker:
 *        Settings  ->  Variables and Secrets  ->  Add
 *        - Type: Secret
 *        - Name (EXACTO):  API_FOOTBALL_KEY
 *        - Value:  (tu llave de API-Football)
 *        - Save and deploy.
 *
 *  5) Copia la URL del Worker (algo como
 *        https://mundial-marcador.TU-USUARIO.workers.dev )
 *     y pégala en index.html, en:
 *        MUNDIAL.marcador.proxyUrl = "https://mundial-marcador.TU-USUARIO.workers.dev"
 *     Guarda y sube el cambio. ¡Listo! El CRM usará datos oficiales en vivo.
 *
 *  Para desactivarlo: deja  proxyUrl: ""  (el CRM vuelve a worldcup26.ir).
 * ----------------------------------------------------------------------------
 */

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // --- Ajustes ---
    const TTL = 300; // segundos de caché (5 min). Súbelo si te acercas al límite; bájalo si tienes plan de pago.
    // Filtro del Mundial: por id de liga (1 = FIFA World Cup en API-Football) o por nombre.
    const esMundial = (x) =>
      x && x.league &&
      (x.league.id === 1 || (/world cup/i.test(x.league.name || "") && !/club/i.test(x.league.name || "")));

    // Servir desde caché de Cloudflare si existe (protege tu límite diario).
    const cache = caches.default;
    const cacheKey = new Request("https://mundial-cache/live", { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) {
      const h = new Headers(cached.headers);
      Object.entries(cors).forEach(([k, v]) => h.set(k, v));
      return new Response(cached.body, { status: 200, headers: h });
    }

    try {
      if (!env.API_FOOTBALL_KEY) throw new Error("Falta el secreto API_FOOTBALL_KEY");
      const up = await fetch("https://v3.football.api-sports.io/fixtures?live=all", {
        headers: { "x-apisports-key": env.API_FOOTBALL_KEY },
      });
      const data = await up.json();
      const response = (data.response || []).filter(esMundial);
      const body = JSON.stringify({ response });
      const res = new Response(body, {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": `public, max-age=${TTL}`, ...cors },
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (e) {
      // Ante cualquier fallo devolvemos lista vacía (el CRM cae a sus otras fuentes).
      return new Response(JSON.stringify({ response: [], error: String(e && e.message || e) }), {
        status: 200,
        headers: { "content-type": "application/json", ...cors },
      });
    }
  },
};
