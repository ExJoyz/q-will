import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { HttpsProxyAgent } from "https-proxy-agent";

// The public REST API sends no CORS headers, so the browser reaches it through
// the dev (and preview) server: /lcd/* is forwarded to QORE_REST_PROXY_TARGET.
// In production, serve the app behind a proxy that does the same, or set
// VITE_QORE_REST_URL to an endpoint that allows your origin.
//
// Vite's proxy does not read HTTPS_PROXY on its own. When the environment sets
// one (e.g. this VM, whose egress goes through an HTTP proxy), route the
// proxied request through it; otherwise connect directly.
function proxyAgent(): HttpsProxyAgent<string> | undefined {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  return proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.QORE_REST_PROXY_TARGET || "http://localhost:1317";
  const proxy = {
    "/lcd": {
      target,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/lcd/, ""),
      agent: proxyAgent(),
    },
  };
  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    preview: { proxy },
  };
});
