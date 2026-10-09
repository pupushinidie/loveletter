import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dayTheme } from "./day-theme";
import { palette } from "./day-palette";

// 端口从环境变量读，默认是分配给情书的 5190（网页）/ 3017（服务器）。
// 另起一套服务（比如人机、界面用特殊环境变量测）时：WEB_PORT=5290 SERVER_PORT=3117 npm run dev。
const webPort = Number(process.env.WEB_PORT ?? 5190);
const serverTarget = `http://localhost:${process.env.SERVER_PORT ?? 3017}`;

export default defineConfig({
  // 部署在子路径时用 BASE_PATH 指定，例如 BASE_PATH=/loveletter/ npm run build。
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), dayTheme(palette)],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/socket.io": { target: serverTarget, ws: true },
      "/health": serverTarget
    }
  }
});
