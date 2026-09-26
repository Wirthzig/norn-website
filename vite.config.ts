import { resolve } from "node:path";
import { defineConfig } from "vite";

// github pages serves the project under /norn-website/. a custom domain later sets
// SITE_BASE=/ in the workflow and nothing else changes
export default defineConfig({
  base: process.env.SITE_BASE ?? "/norn-website/",
  build: {
    rollupOptions: {
      input: { home: resolve(__dirname, "index.html") },
    },
  },
});
