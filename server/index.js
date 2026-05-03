import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCodexAuth, listLocalAuthAccounts } from "./auth.js";
import {
  appendChatMessage,
  chatHistoryForLlm,
  createChat,
  deleteChat,
  getChat,
  listChats,
  maybeRenameChatFromFirstRound
} from "./chatStore.js";
import { CodexSessionProvider } from "./codexProvider.js";
import { appConfig } from "./config.js";
import { buildInstructions, ensureContextFiles, readContext, saveContextPatch } from "./contextStore.js";
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
    chatId:
      typeof source.chatId === "string" && source.chatId.trim() ? source.chatId.trim() : undefined,
    threadId:
      typeof source.threadId === "string" && source.threadId.trim()
        ? source.threadId.trim()
        : "default",
    text: typeof source.text === "string" ? source.text.trim() : "",
    instructions:
      typeof source.instructions === "string" && source.instructions.trim()
        ? source.instructions.trim()
        : undefined,
    model: typeof source.model === "string" && source.model.trim() ? source.model.trim() : undefined,
    reasoningEffort:
      typeof source.reasoningEffort === "string" && source.reasoningEffort.trim()
        ? source.reasoningEffort.trim()
        : undefined
  };
}

async function handleChatSse(req, res) {
  const request = normalizeChatBody(req);
  if (!request.text) {
    res.status(400).json({ error: "text e obrigatorio." });
    return;
  }

  const storedChat = request.chatId ? getChat(request.chatId) : createChat();
  if (!storedChat) {
    res.status(404).json({ error: "Chat nao encontrado." });
    return;
  }

  const userText = request.text;
  const initialHistory = chatHistoryForLlm(storedChat);
  appendChatMessage(storedChat.id, "user", userText);
  const startedAt = Date.now();

  setupSse(res);
  writeSse(res, { type: "status", state: "thinking", detail: "codex" });
  writeSse(res, { type: "chat", chat: getChat(storedChat.id) });

  let finalText = "";
  try {
    const finalInstructions = buildInstructions(request.instructions, userText);
    const streamRequest = {
      ...request,
      instructions: finalInstructions,
      threadId: storedChat.id,
      history: initialHistory
    };

    for await (const event of codexProvider.streamChat(streamRequest)) {
      if (event.type === "text_delta") {
        finalText += event.text;
      }
      if (event.type === "completed" && event.text && !finalText) {
        finalText = event.text;
      }

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
    if (finalText.trim()) {
      let updatedChat = appendChatMessage(storedChat.id, "assistant", finalText.trim(), {
        durationMs: Date.now() - startedAt
      });
      updatedChat = maybeRenameChatFromFirstRound(updatedChat, userText, finalText.trim());
      writeSse(res, { type: "chat", chat: updatedChat });
    }
    res.end();
  }
}

async function handleChatJson(req, res) {
  const chat = normalizeChatBody(req);
  if (!chat.text) {
    res.status(400).json({ error: "text e obrigatorio." });
    return;
  }

  const request = {
    ...chat,
    instructions: buildInstructions(chat.instructions, chat.text)
  };

  let text = "";
  let responseId;
  for await (const event of codexProvider.streamChat(request)) {
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
  ensureContextFiles();
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

  app.get("/api/context", (_req, res) => {
    res.json({ context: readContext() });
  });

  app.put("/api/context", (req, res) => {
    try {
      res.json({ context: saveContextPatch(req.body || {}) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/chats", (_req, res) => {
    res.json({ chats: listChats() });
  });

  app.post("/api/chats", (req, res) => {
    const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "Novo chat";
    res.json({ chat: createChat(title) });
  });

  app.get("/api/chats/:id", (req, res) => {
    const chat = getChat(req.params.id);
    if (!chat) {
      res.status(404).json({ error: "Chat nao encontrado." });
      return;
    }
    res.json({ chat });
  });

  app.delete("/api/chats/:id", (req, res) => {
    const deleted = deleteChat(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Chat nao encontrado." });
      return;
    }
    res.json({ ok: true, chats: listChats() });
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
