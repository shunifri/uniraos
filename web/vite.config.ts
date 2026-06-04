import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 9002,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        // 匹配后端 skill 超时（300s）+ 缓冲，0 表示无超时
        timeout: 0,
        configure: (proxy, _options) => {
          proxy.on("error", (err, req, res) => {
            console.error("[Vite Proxy Error]", req.method, req.url, err.message);
            if (res && !res.headersSent) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: false, error: "Proxy error: " + err.message }));
            }
          });
        },
      },
      // P2 修复：把 /ws WebSocket 也代理到后端 (之前只代理 /api，WS 握手直接 404)
      // ws: true 启用 WebSocket 升级；changeOrigin 让后端看到正确的 host
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
        changeOrigin: true,
        configure: (proxy, _options) => {
          proxy.on("error", (err, _req, _socket) => {
            console.error("[Vite WS Proxy Error]", err.message);
          });
        },
      },
    },
  },
  build: {
    outDir: "../src/ui",
    emptyOutDir: true,
    // P2 修复：显式禁用 Source Map，防止生产环境源码泄露
    sourcemap: false,
  },
});
