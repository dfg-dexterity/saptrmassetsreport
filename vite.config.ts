import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Dois produtos separados, cada um com a sua página:
//   index.html     → Aplicações Financeiras
//   captacoes.html → Captações Financeiras
// base "./" + HashRouter: o build em dist/ funciona em qualquer subpasta do site (ou dentro de um <iframe>).
// `npm run build:single` gera dist-single/index.html e dist-single/captacoes.html, cada um um único arquivo
// com JS, CSS e fontes embutidos.
export default defineConfig(({ mode }) => {
  const single = mode.startsWith("single-");
  const pagina = mode === "single-captacoes" ? "captacoes.html" : "index.html";
  return {
    base: "./",
    plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : [])],
    build: single
      ? {
          outDir: "dist-single",
          emptyOutDir: mode === "single-aplicacoes",
          chunkSizeWarningLimit: 4000,
          rollupOptions: { input: pagina },
        }
      : {
          chunkSizeWarningLimit: 900,
          rollupOptions: {
            input: { aplicacoes: "index.html", captacoes: "captacoes.html" },
            output: {
              manualChunks: {
                react: ["react", "react-dom", "react-router"],
                charts: ["recharts"],
              },
            },
          },
        },
  };
});
