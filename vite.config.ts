import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "overlay-diagnostics",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use("/__overlay_diagnostics", (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end();
            return;
          }
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
            if (body.length > 16384) req.destroy();
          });
          req.on("end", () => {
            try {
              const packet: unknown = JSON.parse(body);
              console.log("[overlay-diag]", JSON.stringify(packet));
              res.statusCode = 204;
            } catch {
              res.statusCode = 400;
            }
            res.end();
          });
        });
      },
    },
  ],

  // Path aliases
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@/bindings": resolve(__dirname, "./src/bindings.ts"),
    },
  },

  // Multiple entry points for main app and overlay
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        overlay: resolve(__dirname, "src/overlay/index.html"),
        picker: resolve(__dirname, "src/picker/index.html"),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // Freeze the diagnostic replay while capture is active. A full reload
    // would discard the event-driven overlay state before the trigger arrives.
    hmr: process.env.HANDY_DEBUG_OVERLAY_REPLAY_TRIGGER
      ? false
      : host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
