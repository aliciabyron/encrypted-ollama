// Optional: save each exchange as a Markdown note in an Obsidian vault.
//   OBSIDIAN_VAULT=/path/to/vault        enables it
//   OBSIDIAN_MODE=encrypted (default)    note holds only ciphertext; decrypt with scripts/decrypt-note.js
//   OBSIDIAN_MODE=plain                  note holds readable text (searchable in Obsidian)

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

function seal(text, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from("obsidian"));
  const ct = Buffer.concat([c.update(text, "utf8"), c.final(), c.getAuthTag()]);
  return `${iv.toString("base64")}:${ct.toString("base64")}`;
}

async function saveToObsidian(prompt, reply, key) {
  const vault = process.env.OBSIDIAN_VAULT;
  if (!vault) return;
  const mode = process.env.OBSIDIAN_MODE === "plain" ? "plain" : "encrypted";
  const folder = path.join(vault, process.env.OBSIDIAN_FOLDER || "Encrypted Chats");
  await fs.mkdir(folder, { recursive: true });

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const body =
    mode === "plain"
      ? `## You\n\n${prompt}\n\n## Model\n\n${reply}\n`
      : "```encrypted\n" + seal(JSON.stringify({ prompt, reply }), key) + "\n```\n";

  const note = `---\ncreated: ${now.toISOString()}\nmode: ${mode}\ntags: [ollama-chat]\n---\n\n${body}`;
  await fs.writeFile(path.join(folder, `chat ${stamp}.md`), note, "utf8");
}

function unseal(blob, key) {
  const [ivB64, ctB64] = blob.trim().split(":");
  const raw = Buffer.from(ctB64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  d.setAAD(Buffer.from("obsidian"));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString("utf8");
}

module.exports = { saveToObsidian, unseal };
