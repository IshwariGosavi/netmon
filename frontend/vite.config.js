import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev`   -> dev server on :5173, /api requests are forwarded to Flask on :5000
// `npm run build` -> writes the production files into ../static, which Flask already serves
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:5000" } },
  build: { outDir: "../static", emptyOutDir: true },
});