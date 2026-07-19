/// <reference types="vitest" />
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        background: resolve(__dirname, "background.html"),
      },
    },
  },
  server: { cors: { origin: "https://www.owlbear.rodeo" } },
  test: { globals: true, environment: "jsdom", clearMocks: true },
});
