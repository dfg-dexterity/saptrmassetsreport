import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// base "./" + HashRouter: o build em dist/ funciona em qualquer subpasta do site
// (ou dentro de um <iframe>) sem configuração adicional de servidor.
// `npm run build:single` gera dist-single/index.html: um único arquivo com JS, CSS e fontes embutidos.
export default defineConfig(({ mode }) => {
  const single = mode === "single";
  return {
    base: "./",
    plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : [])],
    build: single
      ? { outDir: "dist-single", chunkSizeWarningLimit: 4000 }
      : {
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
  };
});
