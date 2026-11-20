const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns").promises;
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { randomUUID } = require("node:crypto");

function loadEnvironmentFile() {
  const filePath = path.join(__dirname, ".env");
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`Ligne ${index + 1} invalide dans .env.`);

    let value = match[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      if (!value.endsWith(quote)) throw new Error(`Valeur non terminée à la ligne ${index + 1} de .env.`);
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

loadEnvironmentFile();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "apps.json");
const FAVICON_DIR = path.join(DATA_DIR, "favicons");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_APPS = 100;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_FAVICON_BYTES = 128 * 1024;
const MAX_REDIRECTS = 4;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || "";
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || "";

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

function requestFaviconOnce(url) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, { method: "GET", timeout: 8000 }, (response) => {
      const location = response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.destroy();
        resolve({ location });
        return;
      }

      const contentType = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const extensions = {
        "image/avif": "avif",
        "image/gif": "gif",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/x-icon": "ico",
        "image/vnd.microsoft.icon": "ico",
      };
      const extension = extensions[contentType];
      const contentLength = Number(response.headers["content-length"]);
      if (response.statusCode < 200 || response.statusCode >= 300 || !extension ||
          (Number.isFinite(contentLength) && contentLength > MAX_FAVICON_BYTES)) {
        response.destroy();
        resolve(null);
        return;
      }

      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_FAVICON_BYTES) {
          response.destroy(new Error("La favicon dépasse la taille maximale."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ extension, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Délai de téléchargement de la favicon dépassé.")));
    request.on("error", reject);
    request.end();
  });
}

async function fetchFavicon(app) {
  let url = new URL("/favicon.ico", app.url);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    url = await validatePublicUrl(url.toString());
    const favicon = await requestFaviconOnce(url);
    if (favicon?.location) {
      if (redirects === MAX_REDIRECTS) throw new Error("Trop de redirections pour la favicon.");
      url = new URL(favicon.location, url);
      continue;
    }
    if (!favicon) return;

    fs.mkdirSync(FAVICON_DIR, { recursive: true });
    fs.writeFileSync(path.join(FAVICON_DIR, `${app.id}.${favicon.extension}`), favicon.body);
    app.favicon = `/favicons/${app.id}.${favicon.extension}`;
    return;
  }
  throw new Error("Trop de redirections pour la favicon.");
}

async function checkApp(app) {
  const [httpCheck, vercelCheck] = await Promise.all([
    (async () => {
      try {
        return await checkUrl(new URL(app.healthPath || "/", app.url).toString());
      } catch (error) {
        return {
          status: "offline",
          code: null,
          latency: null,
          checkedAt: new Date().toISOString(),
          error: error.message || "Vérification impossible.",
        };
      }
    })(),
    app.vercelProjectId ? checkVercelDeployment(app.vercelProjectId) : Promise.resolve(null),
  ]);
  app.check = httpCheck;
  app.vercel = vercelCheck;
}

async function checkVercelDeployment(projectId) {
  if (!VERCEL_TOKEN) {
    return {
      status: "unconfigured",
      message: "Configure VERCEL_TOKEN sur le serveur.",
    };
  }

  const endpoint = new URL("https://api.vercel.com/v7/deployments");
  endpoint.searchParams.set("projectId", projectId);
  endpoint.searchParams.set("target", "production");
  endpoint.searchParams.set("from", "0");
  endpoint.searchParams.set("until", String(Date.now()));
  endpoint.searchParams.set("limit", "1");
  if (VERCEL_TEAM_ID) endpoint.searchParams.set("teamId", VERCEL_TEAM_ID);

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json();
    if (!response.ok) {
      const messages = {
        401: "Jeton Vercel invalide ou expiré.",
        403: "Le jeton Vercel n'a pas accès à ce projet.",
        404: "Projet Vercel introuvable.",
        429: "Limite de requêtes Vercel atteinte.",
      };
      return {
        status: "api_error",
        message: messages[response.status] || `L'API Vercel a répondu HTTP ${response.status}.`,
      };
    }

    const deployment = payload.deployments?.[0];
    if (!deployment) {
      return { status: "none", message: "Aucun déploiement de production trouvé." };
    }

    const state = String(deployment.readyState || deployment.state || "UNKNOWN").toUpperCase();
    const deploymentUrl = typeof deployment.url === "string" && /^[a-z0-9.-]+\.vercel\.app$/i.test(deployment.url)
      ? `https://${deployment.url}`
      : null;
    let inspectorUrl = null;
    if (typeof deployment.inspectorUrl === "string") {
      try {
        const parsedInspectorUrl = new URL(deployment.inspectorUrl);
        if (parsedInspectorUrl.protocol === "https:" && parsedInspectorUrl.hostname === "vercel.com") {
          inspectorUrl = parsedInspectorUrl.toString();
        }
      } catch {
        inspectorUrl = null;
      }
    }

    return {
      status: ["READY", "BUILDING", "INITIALIZING", "QUEUED", "ERROR", "CANCELED", "BLOCKED"].includes(state)
        ? state
        : "UNKNOWN",
      createdAt: Number(deployment.createdAt || deployment.created) || null,
      deploymentUrl,
      inspectorUrl,
      message: null,
    };
  } catch (error) {
    return {
      status: "api_error",
      message: error.name === "TimeoutError" ? "Délai de réponse de l'API Vercel dépassé." : "API Vercel temporairement inaccessible.",
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
  const vercelProjectId = typeof body.vercelProjectId === "string" ? body.vercelProjectId.trim() : "";
  if (vercelProjectId.length > 200) throw new Error("L'identifiant du projet Vercel est trop long.");
  return { name, url: url.toString().replace(/\/$/, ""), healthPath, vercelProjectId };
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/apps") {
    return sendJson(response, 200, { apps, vercelConfigured: Boolean(VERCEL_TOKEN) });
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
    try {
      await fetchFavicon(app);
    } catch (error) {
      console.warn(`Impossible de récupérer la favicon de ${app.url} :`, error.message);
    }
    apps.push(app);
    saveApps();
    void checkApp(app).then(saveApps).catch((error) => console.error("Échec de sauvegarde du statut :", error));
    return sendJson(response, 201, { app, vercelConfigured: Boolean(VERCEL_TOKEN) });
  }

  if (request.method === "POST" && url.pathname === "/api/check") {
    await Promise.all(apps.map(checkApp));
    saveApps();
    return sendJson(response, 200, { apps, vercelConfigured: Boolean(VERCEL_TOKEN) });
  }

  const updateMatch = url.pathname.match(/^\/api\/apps\/([a-f0-9-]+)$/i);
  if (request.method === "PATCH" && updateMatch) {
    const app = apps.find((item) => item.id === updateMatch[1]);
    if (!app) return sendJson(response, 404, { error: "Application introuvable." });
    const body = await readJsonBody(request);
    if (typeof body.vercelProjectId !== "string" || body.vercelProjectId.trim().length > 200) {
      throw new Error("Identifiant de projet Vercel invalide.");
    }
    app.vercelProjectId = body.vercelProjectId.trim();
    app.vercel = null;
    saveApps();
    void checkApp(app).then(saveApps).catch((error) => console.error("Échec de sauvegarde du statut :", error));
    return sendJson(response, 200, { app, vercelConfigured: Boolean(VERCEL_TOKEN) });
  }

  const deleteMatch = url.pathname.match(/^\/api\/apps\/([a-f0-9-]+)$/i);
  if (request.method === "DELETE" && deleteMatch) {
    const index = apps.findIndex((app) => app.id === deleteMatch[1]);
    if (index === -1) return sendJson(response, 404, { error: "Application introuvable." });
    const [app] = apps.splice(index, 1);
    for (const extension of ["avif", "gif", "ico", "jpg", "png", "webp"]) {
      const faviconPath = path.join(FAVICON_DIR, `${app.id}.${extension}`);
      if (fs.existsSync(faviconPath)) fs.unlinkSync(faviconPath);
    }
    saveApps();
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: "Route introuvable." });
}

function serveStatic(response, pathname) {
  const faviconMatch = pathname.match(/^\/favicons\/([a-f0-9-]+)\.(avif|gif|ico|jpg|png|webp)$/i);
  if (faviconMatch) {
    const faviconId = faviconMatch[1].toLowerCase();
    const extension = faviconMatch[2].toLowerCase();
    const extensions = {
      avif: "image/avif",
      gif: "image/gif",
      ico: "image/x-icon",
      jpg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };
    const filePath = path.join(FAVICON_DIR, `${faviconId}.${extension}`);
    if (!fs.existsSync(filePath)) {
      response.writeHead(404);
      return response.end("Introuvable");
    }
    response.writeHead(200, {
      "Content-Type": extensions[extension],
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    return fs.createReadStream(filePath).pipe(response);
  }

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
