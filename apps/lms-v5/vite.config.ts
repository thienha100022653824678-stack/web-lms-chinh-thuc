import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname),
  base: "/",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "../../dist-v5"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        v5: resolve(__dirname, "v5.html"),
        "v5-admin": resolve(__dirname, "v5-admin.html")
      }
    }
  },
  server: { port: 5175, strictPort: true }
});

