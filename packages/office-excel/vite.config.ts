import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig } from "vite";

const certDir = join(homedir(), ".office-addin-dev-certs");
const certFile = join(certDir, "localhost.crt");
const keyFile = join(certDir, "localhost.key");
const caFile = join(certDir, "ca.crt");
const hasCerts = existsSync(certFile) && existsSync(keyFile);

if (!hasCerts) {
  console.warn("No SSL certs found. Run `bun run setup:certs` to install dev certificates.");
}

const BRIDGE_PORT = 3100;

export default defineConfig({
  root: resolve(__dirname, "src"),
  publicDir: resolve(__dirname, "src/assets"),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist"),
    rollupOptions: {
      input: {
        taskpane: resolve(__dirname, "src/taskpane/index.html"),
        commands: resolve(__dirname, "src/commands/commands.html"),
      },
    },
  },
  server: {
    port: 3000,
    https: hasCerts
      ? { ca: readFileSync(caFile), key: readFileSync(keyFile), cert: readFileSync(certFile) }
      : undefined,
    proxy: {
      "/ws": {
        target: `ws://localhost:${BRIDGE_PORT}`,
        ws: true,
      },
    },
  },
  define: {
    __BRIDGE_URL__: JSON.stringify(hasCerts ? "wss://localhost:3000/ws" : "ws://localhost:3000/ws"),
  },
});
