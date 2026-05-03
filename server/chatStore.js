import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const CHATS_DIR = path.join(process.cwd(), "chats");

function ensureChatsDir() {
  if (!existsSync(CHATS_DIR)) {
    mkdirSync(CHATS_DIR, { recursive: true });
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function timestamp() {
  return timestampFromDate(new Date());
}

function timestampFromDate(now) {
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function timestampFromIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? timestamp() : timestampFromDate(date);
}

function cleanText(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeChatTitle(userText, assistantText = "") {
  const source = cleanText(userText) || cleanText(assistantText) || "Novo chat";
  const words = source.split(/\s+/).filter(Boolean).slice(0, 8);
  const title = words.join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function slugify(text) {
  const normalized = String(text || "chat")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return normalized || "chat";
}

function safeChatId(id) {
  const base = path.basename(String(id || ""));
  return base.replace(/\.json$/i, "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function chatPath(id) {
  const safeId = safeChatId(id);
  if (!safeId) {
    throw new Error("chatId invalido");
  }
  return path.join(CHATS_DIR, `${safeId}.json`);
}

function uniqueChatId(title, createdAt) {
  const base = `${timestampFromIso(createdAt)}-${slugify(title)}`;
  let id = base;
  let index = 2;
  while (existsSync(chatPath(id))) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeChat(raw) {
  return {
    id: safeChatId(raw.id),
    title: String(raw.title || "Novo chat"),
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || raw.createdAt || nowIso(),
    messages: Array.isArray(raw.messages)
      ? raw.messages
          .filter((message) => message && ["user", "assistant"].includes(message.role))
          .map((message) => ({
            role: message.role,
            content: String(message.content || ""),
            createdAt: message.createdAt || nowIso(),
            durationMs: Number.isFinite(Number(message.durationMs)) ? Number(message.durationMs) : undefined
          }))
      : []
  };
}

export function createChat(title = "Novo chat") {
  ensureChatsDir();
  const finalTitle = title || "Novo chat";
  const createdAt = nowIso();
  const id = uniqueChatId(finalTitle, createdAt);
  const chat = {
    id,
    title: finalTitle,
    createdAt,
    updatedAt: createdAt,
    messages: []
  };
  saveChat(chat);
  return chat;
}

export function saveChat(chat) {
  ensureChatsDir();
  const normalized = normalizeChat(chat);
  writeFileSync(chatPath(normalized.id), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function getChat(id) {
  ensureChatsDir();
  const filePath = chatPath(id);
  if (!existsSync(filePath)) {
    return undefined;
  }
  return normalizeChat(JSON.parse(readFileSync(filePath, "utf8")));
}

export function listChats() {
  ensureChatsDir();
  return readdirSync(CHATS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => {
      try {
        const chat = getChat(entry.name);
        return chat
          ? {
              id: chat.id,
              title: chat.title,
              createdAt: chat.createdAt,
              updatedAt: chat.updatedAt,
              messageCount: chat.messages.length
            }
          : undefined;
      } catch {
        return undefined;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function appendChatMessage(id, role, content, extra = {}) {
  const chat = getChat(id);
  if (!chat) {
    throw new Error("Chat nao encontrado");
  }
  const message = {
    role,
    content: String(content || ""),
    createdAt: nowIso()
  };
  if (Number.isFinite(Number(extra.durationMs))) {
    message.durationMs = Math.max(0, Math.round(Number(extra.durationMs)));
  }
  chat.messages.push(message);
  chat.updatedAt = nowIso();
  return saveChat(chat);
}

export function deleteChat(id) {
  ensureChatsDir();
  const filePath = chatPath(id);
  if (!existsSync(filePath)) {
    return false;
  }
  unlinkSync(filePath);
  return true;
}

export function maybeRenameChatFromFirstRound(chat, userText, assistantText) {
  if (!chat || chat.title !== "Novo chat") {
    return chat;
  }
  const oldPath = chatPath(chat.id);
  chat.title = makeChatTitle(userText, assistantText);
  chat.id = uniqueChatId(chat.title, chat.createdAt);
  chat.updatedAt = nowIso();
  const saved = saveChat(chat);
  const newPath = chatPath(saved.id);
  if (oldPath !== newPath && existsSync(oldPath)) {
    unlinkSync(oldPath);
  }
  return saved;
}

export function chatHistoryForLlm(chat) {
  return (chat?.messages || [])
    .filter((message) => ["user", "assistant"].includes(message.role) && message.content.trim())
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}
