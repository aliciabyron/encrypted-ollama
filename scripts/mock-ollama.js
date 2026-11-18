// A tiny stand-in for Ollama's /api/chat, for testing without a real model.
// It logs what it receives so tests can prove the model got plaintext.
const http = require("http");
const PORT = Number(process.env.MOCK_PORT || 11435);
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { model, messages } = JSON.parse(body || "{}");
      const last = messages?.[messages.length - 1]?.content ?? "";
      console.log(`[mock-ollama] ${model} received: ${last}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model, message: { role: "assistant", content: `Echo from ${model}: ${last}` }, done: true }));
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock Ollama on :${PORT}`));
