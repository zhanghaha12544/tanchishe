const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const ADMIN_VIEW_KEY = process.env.ADMIN_VIEW_KEY || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const sessions = new Map();

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], scores: [] }, null, 2));
  }
}

function readDb() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i > 0) {
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function getSessionUser(req, db) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies["snake_session"];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  const user = db.users.find((u) => u.id === session.userId);
  return user || null;
}

function createPasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = createPasswordHash(password, salt).hash;
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (_e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeUsername(name) {
  return String(name || "").trim().toLowerCase();
}

function formatLeaderboard(db, limit = 10) {
  const bestByUser = new Map();
  for (const row of db.scores) {
    const current = bestByUser.get(row.userId);
    if (!current || row.score > current.score || (row.score === current.score && row.createdAt > current.createdAt)) {
      bestByUser.set(row.userId, row);
    }
  }
  return Array.from(bestByUser.values())
    .sort((a, b) => (b.score - a.score) || (b.createdAt - a.createdAt))
    .slice(0, limit)
    .map((r) => ({ username: r.username, score: r.score, createdAt: r.createdAt }));
}

function isAdminRequestAuthorized(req, url) {
  if (!ADMIN_VIEW_KEY) return false;
  const queryKey = url.searchParams.get("key") || "";
  const headerKey = req.headers["x-admin-key"] || "";
  const candidate = String(queryKey || headerKey);
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(ADMIN_VIEW_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sanitizeDbForAdmin(db) {
  return {
    users: db.users.map((u) => ({ id: u.id, username: u.username, createdAt: u.createdAt })),
    scores: db.scores,
  };
}

function createSession(res, userId) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { userId, expiresAt });
  res.setHeader(
    "Set-Cookie",
    `snake_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearSession(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies["snake_session"];
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", "snake_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const db = readDb();

  if (req.method === "GET" && url.pathname === "/api/me") {
    const user = getSessionUser(req, db);
    if (!user) return sendJson(res, 401, { error: "Not logged in" });
    return sendJson(res, 200, { user: { id: user.id, username: user.username } });
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await readBody(req);
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    if (username.length < 3 || username.length > 20) {
      return sendJson(res, 400, { error: "Username must be 3-20 characters" });
    }
    if (password.length < 6) {
      return sendJson(res, 400, { error: "Password must be at least 6 characters" });
    }
    if (!/^[a-z0-9_]+$/.test(username)) {
      return sendJson(res, 400, { error: "Username only supports letters, numbers and _" });
    }
    if (db.users.some((u) => u.username === username)) {
      return sendJson(res, 409, { error: "Username already exists" });
    }
    const id = crypto.randomUUID();
    const { salt, hash } = createPasswordHash(password);
    db.users.push({ id, username, salt, hash, createdAt: Date.now() });
    writeDb(db);
    createSession(res, id);
    return sendJson(res, 201, { user: { id, username } });
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    const user = db.users.find((u) => u.username === username);
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      return sendJson(res, 401, { error: "Invalid username or password" });
    }
    createSession(res, user.id);
    return sendJson(res, 200, { user: { id: user.id, username: user.username } });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    clearSession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/score") {
    const user = getSessionUser(req, db);
    if (!user) return sendJson(res, 401, { error: "Login required" });
    const body = await readBody(req);
    const score = Number(body.score);
    if (!Number.isInteger(score) || score <= 0 || score > 1000000) {
      return sendJson(res, 400, { error: "Invalid score value" });
    }
    db.scores.push({
      id: crypto.randomUUID(),
      userId: user.id,
      username: user.username,
      score,
      createdAt: Date.now(),
    });
    writeDb(db);
    return sendJson(res, 201, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    const limit = Math.max(1, Math.min(30, Number(url.searchParams.get("limit") || 10)));
    const items = formatLeaderboard(db, limit);
    return sendJson(res, 200, { items });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/db") {
    if (!isAdminRequestAuthorized(req, url)) {
      return sendJson(res, 403, { error: "Forbidden: invalid admin key" });
    }
    return sendJson(res, 200, {
      now: Date.now(),
      usersCount: db.users.length,
      scoresCount: db.scores.length,
      db: sanitizeDbForAdmin(db),
    });
  }

  return sendJson(res, 404, { error: "API route not found" });
}

function serveFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const fallback = path.join(ROOT, "index.html");
    if (!fs.existsSync(fallback)) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const html = fs.readFileSync(fallback);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    serveFile(req, res);
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Server error" });
  }
});

server.listen(PORT, () => {
  ensureDataFile();
  console.log(`Neon Snake server running at http://localhost:${PORT}`);
});
