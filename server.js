// Encrypted Ollama chat gateway — zero dependencies (Node 18+).
//
// Flow:  browser --(AES-256-GCM ciphertext)--> this gateway
//        gateway decrypts -> plaintext to local Ollama -> reply
//        gateway encrypts reply --(ciphertext)--> browser decrypts & shows it
//
// The model itself must see plaintext: an LLM can't reason over ciphertext.
// So this gateway is the trust boundary and should run on the same machine as Ollama.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { saveToObsidian } = require("./obsidian");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const MODEL = process.env.MODEL || "mini";
const PASSPHRASE = process.env.CHAT_PASSPHRASE;
const SALT_B64 = process.env.CHAT_SALT || crypto.randomBytes(16).toString("base64");
const ITERATIONS = 210000;
const MAX_SKEW_MS = 2 * 60 * 1000;

if (!PASSPHRASE || PASSPHRASE.length < 8) {
  console.error("Set CHAT_PASSPHRASE (8+ characters) before starting the server.");
  process.exit(1);
}

// Same derivation the browser does with Web Crypto: PBKDF2-SHA256 -> 256-bit AES key.
const KEY = crypto.pbkdf2Sync(PASSPHRASE, Buffer.from(SALT_B64, "base64"), ITERATIONS, 32, "sha256");

// AAD binds each message to its direction, so a request can't be replayed as a response.
function encrypt(obj, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final(), c.getAuthTag()]);
  return { iv: iv.toString("base64"), ct: ct.toString("base64") };
}

function decrypt({ iv, ct }, aad) {
  const raw = Buffer.from(ct, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(raw.subarray(raw.length - 16));
  const pt = Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]);
  return JSON.parse(pt.toString("utf8"));
}

const seenIvs = new Map(); // simple replay guard: iv -> timestamp
function checkReplay(iv, ts) {
  const now = Date.now();
  if (typeof ts !== "number" || Math.abs(now - ts) > MAX_SKEW_MS) throw new Error("stale message");
  if (seenIvs.has(iv)) throw new Error("replayed message");
  seenIvs.set(iv, now);
  for (const [k, t] of seenIvs) if (now - t > MAX_SKEW_MS * 2) seenIvs.delete(k);
}

async function askOllama(messages) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content ?? "";
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && STATIC[req.url]) {
      const [file, type] = STATIC[req.url];
      return send(res, 200, fs.readFileSync(path.join(__dirname, "public", file), "utf8"), type);
    }

    if (req.method === "GET" && req.url === "/api/params") {
      // Public KDF parameters only — never the key or passphrase.
      return send(res, 200, { salt: SALT_B64, iterations: ITERATIONS, model: MODEL });
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      const envelope = JSON.parse(await readBody(req));
      let payload;
      try {
        payload = decrypt(envelope, "request");
        checkReplay(envelope.iv, payload.ts);
      } catch (e) {
        // Wrong passphrase, tampered data, or replay — all look the same to the client.
        return send(res, 401, { error: "could not decrypt request (wrong passphrase?)" });
      }

      const messages = (payload.messages || [])
        .filter((m) => m && ["user", "assistant", "system"].includes(m.role) && typeof m.content === "string")
        .slice(-20);

      const reply = await askOllama(messages);
      const out = { content: reply, model: MODEL, ts: Date.now() };

      saveToObsidian(messages[messages.length - 1]?.content ?? "", reply, KEY).catch((e) =>
        console.error("Obsidian save failed:", e.message)
      );

      return send(res, 200, encrypt(out, "response"));
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    send(res, 502, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Encrypted chat on http://${HOST}:${PORT}  (model "${MODEL}" at ${OLLAMA_URL})`);
  if (!process.env.CHAT_SALT) console.log("Tip: set CHAT_SALT so the key stays the same across restarts.");
  if (MODEL.endsWith(":cloud") || MODEL.endsWith("-cloud")) {
    console.warn(
      `Warning: "${MODEL}" is an Ollama cloud model. Ollama sends the decrypted text to its servers,\n` +
        "so your messages leave this computer. Use a local model to keep them on this machine."
    );
  }
});

module.exports = { encrypt, decrypt };
