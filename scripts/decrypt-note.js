#!/usr/bin/env node
// Decrypt an encrypted Obsidian chat note.
// Usage: CHAT_PASSPHRASE=... CHAT_SALT=... node scripts/decrypt-note.js "path/to/chat note.md"
const fs = require("fs");
const crypto = require("crypto");
const { unseal } = require("../obsidian");

const file = process.argv[2];
const { CHAT_PASSPHRASE, CHAT_SALT } = process.env;
if (!file || !CHAT_PASSPHRASE || !CHAT_SALT) {
  console.error('Usage: CHAT_PASSPHRASE=... CHAT_SALT=... node scripts/decrypt-note.js "note.md"');
  process.exit(1);
}
const key = crypto.pbkdf2Sync(CHAT_PASSPHRASE, Buffer.from(CHAT_SALT, "base64"), 210000, 32, "sha256");
const blob = fs.readFileSync(file, "utf8").match(/```encrypted\n([\s\S]*?)\n```/)?.[1];
if (!blob) { console.error("No encrypted block in that note."); process.exit(1); }
const { prompt, reply } = JSON.parse(unseal(blob, key));
console.log(`You:\n${prompt}\n\nModel:\n${reply}`);
