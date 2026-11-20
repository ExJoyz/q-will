// Vercel serverless function: production proxy for the QoreChain testnet REST
// API. It mirrors the Vite dev-server /lcd proxy in vite.config.ts.
//
// The public REST API sends no CORS headers, so the browser cannot call it
// directly. The app calls /lcd/... (VITE_QORE_REST_URL=/lcd); vercel.json
// rewrites that to /api/lcd/... and this function forwards it to
// https://api-testnet.qore.host/... with open CORS headers.
//
// Read-only: only GET (plus OPTIONS preflight) is forwarded. No secrets are
// read, stored or logged; only the path and the upstream status are logged.
// Plain JavaScript on purpose: tsconfig only covers src/, and the file must
// stay out of the Vite bundle.
const TARGET = "https://api-testnet.qore.host";
const TIMEOUT_MS = 9000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const url = new URL(req.url, "http://localhost");
  const suffix = url.pathname.replace(/^\/api\/lcd/, "") || "/";
  const target = `${TARGET}${suffix}${url.search}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json",
    );
    res.send(body);
  } catch (err) {
    console.error(
      "lcd proxy error",
      url.pathname,
      err instanceof Error ? err.message : String(err),
    );
    res.status(502).json({ error: "upstream unreachable" });
  } finally {
    clearTimeout(timer);
  }
}
