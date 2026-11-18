# Mini Chat: an encrypted UI for a local Ollama model

```
 Browser (UI)                    Gateway (server.js)                 Ollama
 ───────────                     ───────────────────                 ──────
 type message
 encrypt (AES-256-GCM) ──cipher──▶ decrypt
                                   plaintext ─────────────────────▶ "mini" model
                                   encrypt reply ◀──────────────────  reply
 decrypt & show  ◀──────cipher──── (optional: encrypted note → Obsidian vault)
```

**Why the model sees plaintext:** a language model can't understand ciphertext.
Encrypted text looks like random noise to it. So the gateway decrypts just before
the model and encrypts again right after. Run the gateway on the **same machine
as Ollama**. Then plaintext only ever exists inside that machine. The network, logs,
proxies and your Obsidian vault only ever see ciphertext.

## 1. Create the mini model

Install Ollama from https://ollama.com, then:

```bash
ollama pull llama3.2:1b
```

```bash
ollama create mini -f Modelfile
```

```bash
ollama run mini "hello"
```

Edit `Modelfile` to change the base model, its personality (SYSTEM) or its settings.

### Using an Ollama cloud model instead

You can point the app at a cloud model. Sign in to Ollama once, then set `MODEL`:

```bash
ollama signin
```

```bash
export MODEL="deepseek-v4.1-flash:cloud"
```

**Privacy:** a `:cloud` model runs on Ollama's servers. Ollama sends them the decrypted
text, so your messages leave your machine. The encryption still protects the hop between
your browser and the gateway, but not the trip to the cloud. Use a local model if
your messages must stay on your computer.

(`ollama launch claude --model ...` is something else: it starts Claude Code, the
coding assistant, with that model in place of Claude. You can use it to work on this
project's code, but the chat app doesn't need it.)

## 2. Start the gateway + UI

No `npm install` is needed to run it. The app uses only Node's built-in modules (Node 18+).

```bash
export CHAT_PASSPHRASE="pick a long passphrase"
```

```bash
export CHAT_SALT="$(node -e 'console.log(require("crypto").randomBytes(16).toString("base64"))')"
```

```bash
npm start
```

Open http://127.0.0.1:8787 and enter the same passphrase. Your browser turns it into
the AES key, so the passphrase itself is never sent. Open **What went over the wire**
to see the ciphertext.

Other settings: `MODEL` (default `mini`), `OLLAMA_URL` (default `http://127.0.0.1:11434`), `PORT` (default `8787`).

## 3. Obsidian (optional)

```bash
export OBSIDIAN_VAULT="$HOME/Documents/MyVault"
```

Each exchange is saved as a note in `Encrypted Chats/`. By default the note holds only ciphertext. To read one:

```bash
node scripts/decrypt-note.js "$OBSIDIAN_VAULT/Encrypted Chats/chat 2026-....md"
```

Set `OBSIDIAN_MODE=plain` if you would rather have readable, searchable notes.

## 4. Testing with Playwright

```bash
npm install
```

```bash
npm test
```

The test runs a mock Ollama, the gateway and a real browser. It checks that the UI
shows the decrypted reply, that the network carries **no plaintext**, that the model
gets plaintext, that a wrong passphrase is rejected, and that Obsidian notes are
encrypted and can be decrypted.

**Playwright MCP:** `.mcp.json` registers the Playwright MCP server. If you open this
folder in Claude Code, Claude can drive the chat UI in a browser for you. It can click
through the app, take screenshots and check behaviour.

## Security notes

- AES-256-GCM, with a key from PBKDF2-SHA256 (210k rounds). Every message is
  authenticated, so tampered messages are rejected. Each message is also tagged with its
  direction (request or response), and old or replayed messages are refused.
- The salt is public. The passphrase is the secret, so pick a strong one.
- If you serve this beyond `localhost`, also put it behind HTTPS. Browsers only allow Web Crypto on
  secure origins, and HTTPS protects the page's code itself.
