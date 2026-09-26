import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

// base "./" + HashRouter: o build em dist/ funciona em qualquer subpasta do site
// (ou dentro de um <iframe>) sem configuração adicional de servidor.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router"],
          charts: ["recharts"],
        },
      },
    },
  },
});
