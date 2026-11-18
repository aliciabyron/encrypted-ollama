// End-to-end test: real browser, real gateway, mock Ollama.
// Run: npm test
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const vault = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
const env = {
  ...process.env,
  PORT: "8799",
  OLLAMA_URL: "http://127.0.0.1:11435",
  MODEL: "mini",
  CHAT_PASSPHRASE: "correct horse battery",
  CHAT_SALT: "c2FsdHNhbHRzYWx0c2FsdA==",
  OBSIDIAN_VAULT: vault,
};

function start(file) {
  const p = spawn("node", [file], { cwd: root, env });
  p.logs = "";
  p.stdout.on("data", (d) => (p.logs += d));
  p.stderr.on("data", (d) => (p.logs += d));
  return p;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mock = start("scripts/mock-ollama.js");
  const server = start("server.js");
  await wait(800);
  const browser = await chromium.launch();
  const secret = "my bank PIN is 4821";
  try {
    const page = await browser.newPage();
    const wire = [];
    page.on("request", (r) => r.url().includes("/api/chat") && wire.push(r.postData()));
    page.on("response", async (r) => r.url().includes("/api/chat") && wire.push(await r.text()));

    await page.goto("http://127.0.0.1:8799/");
    await page.fill("#pass", env.CHAT_PASSPHRASE);
    await page.click("#unlock button");
    await page.fill("#msg", secret);
    await page.click("#composer button");
    await page.waitForSelector("#log li.assistant:not(:has-text('…'))");

    const reply = await page.textContent("#log li.assistant");
    assert.strictEqual(reply, `Echo from mini: ${secret}`, "UI shows decrypted reply");
    console.log("✓ UI shows decrypted reply:", reply);

    assert(wire.length === 2, "one request + one response captured");
    for (const body of wire) assert(!body.includes("4821") && !body.includes("PIN"), "no plaintext on the wire");
    console.log("✓ Request and response on the wire are ciphertext only");

    assert(mock.logs.includes(secret), "model received plaintext");
    console.log("✓ Model received decrypted plaintext");

    await page.screenshot({ path: path.join(root, "tests", "screenshot.png") });

    // Wrong passphrase must fail cleanly
    const bad = await browser.newPage();
    await bad.goto("http://127.0.0.1:8799/");
    await bad.fill("#pass", "wrong passphrase");
    await bad.click("#unlock button");
    await bad.fill("#msg", "hello");
    await bad.click("#composer button");
    await bad.waitForSelector("#log li.error");
    console.log("✓ Wrong passphrase rejected:", await bad.textContent("#log li.error"));

    // Obsidian note is encrypted and decryptable
    await wait(300);
    const dir = path.join(vault, "Encrypted Chats");
    const note = path.join(dir, fs.readdirSync(dir)[0]);
    assert(!fs.readFileSync(note, "utf8").includes("4821"), "note has no plaintext");
    const out = execFileSync("node", ["scripts/decrypt-note.js", note], { cwd: root, env }).toString();
    assert(out.includes(secret), "note decrypts");
    console.log("✓ Obsidian note saved encrypted and decrypts correctly");

    console.log("\nAll tests passed.");
  } catch (e) {
    console.error("TEST FAILED:", e.message, "\n--- server ---\n" + server.logs);
    process.exitCode = 1;
  } finally {
    await browser.close();
    mock.kill();
    server.kill();
    fs.rmSync(vault, { recursive: true, force: true });
  }
})();
