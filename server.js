import dotenv from "dotenv";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(root, ".env") });

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT harus berupa angka antara 1 dan 65535.");
}

const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/config.js": ["config.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"]
};
const apiRoutes = new Set(["auth", "global", "keys", "logs", "staff", "status", "verify"]);

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error("Request body terlalu besar.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("JSON request tidak valid.");
    error.statusCode = 400;
    throw error;
  }
}

function createApiResponse(res) {
  const apiResponse = {
    status(code) {
      res.statusCode = code;
      return apiResponse;
    },
    setHeader(name, value) {
      res.setHeader(name, value);
      return apiResponse;
    },
    json(data) {
      if (!res.writableEnded) {
        if (!res.hasHeader("Content-Type")) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
        }
        res.end(JSON.stringify(data));
      }
      return apiResponse;
    }
  };
  return apiResponse;
}

const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const route = url.pathname.slice("/api/".length);
    if (!apiRoutes.has(route)) return sendJson(res, 404, { error: "API tidak ditemukan." });
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      return sendJson(res, 503, { error: "Turso belum dikonfigurasi. Atur TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN di environment." });
    }
    if (route !== "verify" && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
      return sendJson(res, 503, { error: "SESSION_SECRET belum valid. Atur secret minimal 32 karakter di environment." });
    }

    try {
      req.query = Object.fromEntries(url.searchParams.entries());
      req.body = await readJsonBody(req);
      const { default: handler } = await import(`./api-${route}.js`);
      await handler(req, createApiResponse(res));
      if (!res.writableEnded) {
        res.writeHead(204);
        res.end();
      }
    } catch (error) {
      if (error.statusCode) return sendJson(res, error.statusCode, { error: error.message });
      console.error(`Local API ${route} failed:`, error);
      if (!res.headersSent) sendJson(res, 500, { error: "API gagal. Periksa konfigurasi Turso dan log server." });
      else res.end();
    }
    return;
  }

  const file = staticFiles[url.pathname];
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  try {
    const content = await readFile(join(root, file[0]));
    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": file[1],
      "X-Content-Type-Options": "nosniff"
    });
    res.end(content);
  } catch (error) {
    console.error(`Static file ${file[0]} failed:`, error);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Failed to load the page.");
  }
});

const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
server.listen(port, host, () => {
  console.log(`NX PANEL server listening on ${host}:${port}`);
});
