import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "src/client",
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
  },
});
