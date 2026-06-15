import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Keep Rust server logs visible when Vite is run alongside server-dev.
  clearScreen: false,
  server: {
    host: "0.0.0.0",
    port: 30000,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
  },
});
