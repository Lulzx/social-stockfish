import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:8000", ws: true },
      "/health": "http://localhost:8000",
    },
  },
});
