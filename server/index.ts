import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Pool } from "pg";
import { createApp } from "./app";
import { registeredLayoutPolicies } from "./layout-policies";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT ?? 5000);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 환경 변수가 필요합니다.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = createApp(pool, undefined, { policies: registeredLayoutPolicies });

async function start() {
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(resolve(root, "dist/public")));
    app.get("*", (_req, res) => res.sendFile(resolve(root, "dist/public/index.html")));
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      configFile: resolve(root, "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const server = createServer(app);
  server.listen(port, "0.0.0.0", () => {
    console.log(`내 방식 QR is listening on port ${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (process.env.NODE_ENV !== "test") {
  void start().catch((error) => {
    console.error("Application startup failed:", error);
    process.exit(1);
  });
}
