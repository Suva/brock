import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Set by `tauri dev` when developing on another device, such as a phone.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte()],
  publicDir: "static",
  // Leave Rust's errors on screen.
  clearScreen: false,
  server: {
    // Tauri expects the port in tauri.conf.json, and nothing else.
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // The oldest webviews the app runs in: Safari 16 on macOS, Chromium on Windows.
    target: ["safari16", "chrome110"],
  },
});
