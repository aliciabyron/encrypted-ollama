// Browser side: derive the AES key from the passphrase, encrypt every outgoing
// message, decrypt every reply. Only ciphertext ever leaves this page.
const enc = new TextEncoder();
const dec = new TextDecoder();
const $ = (id) => document.getElementById(id);

let key = null;
const history = [];

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, saltB64, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode("request") },
    key,
    enc.encode(JSON.stringify(obj))
  );
  return { iv: b64(iv), ct: b64(ct) };
}

async function decrypt({ iv, ct }) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode("response") },
    key,
    unb64(ct)
  );
  return JSON.parse(dec.decode(pt));
}

function addBubble(role, text) {
  const li = document.createElement("li");
  li.className = role;
  li.textContent = text;
  $("log").append(li);
  li.scrollIntoView({ block: "end" });
  return li;
}

$("unlock").addEventListener("submit", async (e) => {
  e.preventDefault();
  const params = await (await fetch("/api/params")).json();
  key = await deriveKey($("pass").value, params.salt, params.iterations);
  $("pass").value = "";
  $("unlock").hidden = true;
  $("chat").hidden = false;
  $("status").textContent = `encrypted · ${params.model}`;
  $("status").classList.add("ok");
  $("msg").focus();
});

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("msg").value.trim();
  if (!text) return;
  $("msg").value = "";
  history.push({ role: "user", content: text });
  addBubble("user", text);

  const button = e.submitter || $("composer").querySelector("button");
  button.disabled = true;
  const pending = addBubble("assistant", "…");

  try {
    const envelope = await encrypt({ messages: history, ts: Date.now() });
    $("wire-out").textContent = JSON.stringify(envelope, null, 2);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    $("wire-in").textContent = JSON.stringify(body, null, 2);

    const reply = await decrypt(body);
    pending.textContent = reply.content;
    history.push({ role: "assistant", content: reply.content });
  } catch (err) {
    history.pop();
    pending.className = "error";
    pending.textContent = `Error: ${err.message}`;
  } finally {
    button.disabled = false;
    $("msg").focus();
  }
});
