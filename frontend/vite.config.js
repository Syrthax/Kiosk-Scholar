import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  // Prevent Vite's esbuild pre-bundler from rewriting pdfjs-dist's internal
  // module graph.  Pre-bundling merges the package into a single chunk, which
  // breaks the relative imports that pdf.worker.min.mjs makes to the main
  // pdf.mjs library at runtime inside the Worker thread.
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
});
