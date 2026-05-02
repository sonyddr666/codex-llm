import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCodexAuth, listLocalAuthAccounts } from "./auth.js";
import { CodexSessionProvider } from "./codexProvider.js";
import { appConfig } from "./config.js";
import { setupSse, writeSse } from "./outboundSse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const codexProvider = new CodexSessionProvider();

function createHealth() {
  const auth = loadCodexAuth();
  return {
    ok: true,
    model: appConfig.model,
    auth: auth.status,
    llm: {
      mock: appConfig.mockLlm,
      endpoint: auth.accessToken
        ? appConfig.codexBaseUrl
        : auth.apiKey
          ? appConfig.openAiBaseUrl
          : "not-configured"
    }
  };
}

function normalizeChatBody(req) {
  const source = req.method === "GET" ? req.query : req.body;
  return {
    threadId:
      typeof source.threadId === "string" && source.threadId.trim()
        ? source.threadId.trim()
        : "default",
    text: typeof source.text === "string" ? source.text.trim() : "",
    instructions:
      typeof source.instructions === "string" && source.instructions.trim()
        ? source.instructions.trim()
        : undefined,
    model: typeof source.model === "string" && source.model.trim() ? source.model.trim() : undefined
  };
}

async function handleChatSse(req, res) {
  const chat = normalizeChatBody(req);
  if (!chat.text) {
    res.status(400).json({ error: "text e obrigatorio." });
    return;
  }

  setupSse(res);
  writeSse(res, { type: "status", state: "thinking", detail: "codex" });

  try {
    for await (const event of codexProvider.streamChat(chat)) {
      writeSse(res, event);
      if (event.type === "error" && !event.recoverable) {
        break;
      }
    }
  } catch (error) {
    writeSse(res, {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      recoverable: false
    });
  } finally {
    res.end();
  }
}

async function handleChatJson(req, res) {
  const chat = normalizeChatBody(req);
  if (!chat.text) {
    res.status(400).json({ error: "text e obrigatorio." });
    return;
  }

  let text = "";
  let responseId;
  for await (const event of codexProvider.streamChat(chat)) {
    if (event.type === "text_delta") {
      text += event.text;
    }
    if (event.type === "completed") {
      responseId = event.responseId;
      text = event.text || text;
    }
    if (event.type === "error" && !event.recoverable) {
      res.status(502).json(event);
      return;
    }
  }

  res.json({ ok: true, responseId, text });
}

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(publicDir));

  app.get("/api/health", (_req, res) => {
    res.json(createHealth());
  });

  app.get("/api/auth/accounts", (_req, res) => {
    const { status } = listLocalAuthAccounts();
    res.json(status);
  });

  app.get("/api/chat/sse", handleChatSse);
  app.post("/api/chat/sse", handleChatSse);
  app.post("/api/chat/json", handleChatJson);

  app.listen(appConfig.port, appConfig.host, () => {
    console.log(`codex-LLM ativo em http://${appConfig.host}:${appConfig.port}`);
    console.log(`modelo: ${appConfig.model}`);
    console.log(`mock: ${appConfig.mockLlm ? "sim" : "nao"}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
