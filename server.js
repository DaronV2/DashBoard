const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns").promises;
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { randomUUID } = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "apps.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_APPS = 100;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_REDIRECTS = 4;

function readApps() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return [];
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Le fichier des applications est invalide.");
  return parsed;
}

let apps = readApps();

function saveApps() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(apps, null, 2));
  fs.renameSync(temporaryFile, DATA_FILE);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Requête trop volumineuse."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(Object.assign(new Error("Corps JSON invalide."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function isBlockedAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::" || normalized === "::1" ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb") ||
      normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.");
  }
  return true;
}

async function validatePublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL invalide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Seules les URL HTTP et HTTPS sont acceptées.");
  }
  if (url.username || url.password) throw new Error("Les identifiants dans l'URL ne sont pas acceptés.");

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Seules les adresses publiques peuvent être surveillées.");
  }
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("Seules les adresses publiques peuvent être surveillées.");
  }
  return url;
}

function requestOnce(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, { method: "GET", timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response);
    });
    request.on("timeout", () => request.destroy(new Error("Délai de réponse dépassé.")));
    request.on("error", reject);
    request.end();
  });
}

async function checkUrl(value) {
  const startedAt = Date.now();
  let url = await validatePublicUrl(value);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await requestOnce(url, 8000);
    const location = response.headers.location;
    if (response.statusCode >= 300 && response.statusCode < 400 && location) {
      if (redirects === MAX_REDIRECTS) throw new Error("Trop de redirections.");
      url = await validatePublicUrl(new URL(location, url).toString());
      continue;
    }

    return {
      status: response.statusCode >= 200 && response.statusCode < 400 ? "online" : "error",
      code: response.statusCode,
      latency: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  }
  throw new Error("Trop de redirections.");
}

async function checkApp(app) {
  try {
    app.check = await checkUrl(new URL(app.healthPath || "/", app.url).toString());
  } catch (error) {
    app.check = {
      status: "offline",
      code: null,
      latency: null,
      checkedAt: new Date().toISOString(),
      error: error.message || "Vérification impossible.",
    };
  }
}

function validateAppInput(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  const healthPath = typeof body.healthPath === "string" ? body.healthPath.trim() : "/";
  if (!name || name.length > 60) throw new Error("Le nom doit contenir entre 1 et 60 caractères.");
  if (!rawUrl || rawUrl.length > 2048) throw new Error("Saisissez une URL valide.");
  if (!healthPath.startsWith("/") || healthPath.startsWith("//")) {
    throw new Error("Le chemin de vérification doit commencer par /.");
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Saisissez une URL valide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Seules les URL HTTP et HTTPS sont acceptées.");
  }
  if (url.username || url.password) throw new Error("Les identifiants dans l'URL ne sont pas acceptés.");
  return { name, url: url.toString().replace(/\/$/, ""), healthPath };
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/apps") {
    return sendJson(response, 200, { apps });
  }

  if (request.method === "POST" && url.pathname === "/api/apps") {
    const body = await readJsonBody(request);
    const values = validateAppInput(body);
    await validatePublicUrl(values.url);
    if (apps.length >= MAX_APPS) return sendJson(response, 400, { error: "Limite de 100 applications atteinte." });
    const app = {
      id: randomUUID(),
      ...values,
      addedAt: new Date().toISOString(),
      check: null,
    };
    apps.push(app);
    saveApps();
    void checkApp(app).then(saveApps).catch((error) => console.error("Échec de sauvegarde du statut :", error));
    return sendJson(response, 201, { app });
  }

  if (request.method === "POST" && url.pathname === "/api/check") {
    await Promise.all(apps.map(checkApp));
    saveApps();
    return sendJson(response, 200, { apps });
  }

  const deleteMatch = url.pathname.match(/^\/api\/apps\/([a-f0-9-]+)$/i);
  if (request.method === "DELETE" && deleteMatch) {
    const index = apps.findIndex((app) => app.id === deleteMatch[1]);
    if (index === -1) return sendJson(response, 404, { error: "Application introuvable." });
    apps.splice(index, 1);
    saveApps();
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: "Route introuvable." });
}

function serveStatic(response, pathname) {
  const files = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json; charset=utf-8"],
    "/sw.js": ["sw.js", "text/javascript; charset=utf-8"],
    "/icons/icon-192.png": ["icons/icon-192.png", "image/png"],
    "/icons/icon-512.png": ["icons/icon-512.png", "image/png"],
    "/icons/apple-touch-icon.png": ["icons/apple-touch-icon.png", "image/png"],
  };
  const file = files[pathname];
  if (!file) {
    response.writeHead(404);
    return response.end("Introuvable");
  }
  response.writeHead(200, {
    "Content-Type": file[1],
    "Cache-Control": pathname.startsWith("/icons/") ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    ...(pathname === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}),
  });
  fs.createReadStream(path.join(PUBLIC_DIR, file[0])).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else {
      serveStatic(response, url.pathname);
    }
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, error.status || 400, { error: error.message || "Une erreur est survenue." });
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard disponible sur http://${HOST}:${PORT}`);
});
