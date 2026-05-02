import { readModelFromConfig } from "./auth.js";

export const appConfig = {
  port: Number(process.env.PORT || 8788),
  host: process.env.HOST || "127.0.0.1",
  model: process.env.CODEX_MODEL || readModelFromConfig() || "gpt-5.4-mini",
  codexBaseUrl: process.env.CODEX_BASE_URL || "https://chatgpt.com/backend-api/codex",
  openAiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  mockLlm: process.env.MOCK_LLM === "1",
  defaultInstructions:
    process.env.CODEX_INSTRUCTIONS ||
    "Voce e um assistente local, direto e natural. Responda em portugues brasileiro."
};
