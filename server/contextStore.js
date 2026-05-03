import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appConfig } from "./config.js";

const MEMORY_DIR = path.join(process.cwd(), "memory");
const SYSTEM_PROMPT_PATH = path.join(MEMORY_DIR, "system_prompt.md");
const VOCABULARY_PATH = path.join(MEMORY_DIR, "vocabulary.txt");
const PERSONA_PATH = path.join(MEMORY_DIR, "persona.json");
const SUMMARY_PATH = path.join(MEMORY_DIR, "summary.json");
const MAX_SYSTEM_PROMPT_CHARS = Number(process.env.MAX_SYSTEM_PROMPT_CHARS || 12000);

const DEFAULT_PERSONA = {
  name: "Assistente",
  language: "pt-BR",
  style: "direta, natural, presente e util",
  rules: [
    "Responda em portugues do Brasil.",
    "Seja clara e objetiva.",
    "Nunca revele segredos, tokens, cookies ou conteudos de auth."
  ]
};

const DEFAULT_VOCABULARY = `# Vocabulario local
# Coloque aqui nomes, apelidos, termos, pronuncias e preferencias.
`;

const DEFAULT_SUMMARY = {
  summary: ""
};
let contextCache;

function ensureMemoryDir() {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function ensureFile(filePath, content) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, "utf8");
  }
}

export function ensureContextFiles() {
  ensureMemoryDir();
  ensureFile(SYSTEM_PROMPT_PATH, `${appConfig.defaultInstructions}\n`);
  ensureFile(VOCABULARY_PATH, DEFAULT_VOCABULARY);
  ensureFile(PERSONA_PATH, `${JSON.stringify(DEFAULT_PERSONA, null, 2)}\n`);
  ensureFile(SUMMARY_PATH, `${JSON.stringify(DEFAULT_SUMMARY, null, 2)}\n`);
}

function readTextFile(filePath, fallback = "") {
  ensureContextFiles();
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function readJsonFile(filePath, fallback) {
  ensureContextFiles();
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function filesSignature(files) {
  return files
    .map((file) => {
      try {
        const stat = statSync(file);
        return `${file}:${stat.size}:${stat.mtimeMs}`;
      } catch {
        return `${file}:missing`;
      }
    })
    .join("|");
}

function writeTextFile(filePath, value) {
  ensureContextFiles();
  const text = String(value || "").trimEnd();
  writeFileSync(filePath, `${text}\n`, "utf8");
}

function writeJsonFile(filePath, value) {
  ensureContextFiles();
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizePersona(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rules = Array.isArray(source.rules)
    ? source.rules.filter((rule) => typeof rule === "string" && rule.trim()).map((rule) => rule.trim())
    : DEFAULT_PERSONA.rules;

  return {
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : DEFAULT_PERSONA.name,
    language:
      typeof source.language === "string" && source.language.trim()
        ? source.language.trim()
        : DEFAULT_PERSONA.language,
    style: typeof source.style === "string" && source.style.trim() ? source.style.trim() : DEFAULT_PERSONA.style,
    rules
  };
}

function normalizeSummary(raw) {
  if (typeof raw === "string") {
    return { summary: raw };
  }
  if (raw && typeof raw === "object") {
    return {
      summary: typeof raw.summary === "string" ? raw.summary : ""
    };
  }
  return DEFAULT_SUMMARY;
}

export function readContext() {
  ensureContextFiles();
  const signature = filesSignature([SYSTEM_PROMPT_PATH, VOCABULARY_PATH, PERSONA_PATH, SUMMARY_PATH]);
  if (contextCache?.signature === signature) {
    return contextCache.context;
  }

  const persona = normalizePersona(readJsonFile(PERSONA_PATH, DEFAULT_PERSONA));
  const summary = normalizeSummary(readJsonFile(SUMMARY_PATH, DEFAULT_SUMMARY));
  const context = {
    systemPrompt: readTextFile(SYSTEM_PROMPT_PATH, appConfig.defaultInstructions).trimEnd(),
    vocabulary: readTextFile(VOCABULARY_PATH, DEFAULT_VOCABULARY).trimEnd(),
    persona,
    summary: summary.summary
  };
  contextCache = { signature, context };
  return context;
}

export function saveContextPatch(patch) {
  if (!patch || typeof patch !== "object") {
    throw new Error("Payload de contexto invalido.");
  }

  if (typeof patch.systemPrompt === "string") {
    writeTextFile(SYSTEM_PROMPT_PATH, patch.systemPrompt);
  }
  if (typeof patch.vocabulary === "string") {
    writeTextFile(VOCABULARY_PATH, patch.vocabulary);
  }
  if (patch.persona && typeof patch.persona === "object") {
    writeJsonFile(PERSONA_PATH, normalizePersona(patch.persona));
  }
  if (typeof patch.summary === "string" || (patch.summary && typeof patch.summary === "object")) {
    writeJsonFile(SUMMARY_PATH, normalizeSummary(patch.summary));
  }

  contextCache = undefined;
  return readContext();
}

function textTerms(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/i)
      .filter((term) => term.length >= 4)
  );
}

function normalizeForSearch(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function selectVocabulary(vocabulary, userText = "", maxLines = 90) {
  const lines = String(vocabulary || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }

  const terms = textTerms(userText);
  const selected = [];
  for (const line of lines) {
    const normalized = normalizeForSearch(line);
    if (line.startsWith("#") || [...terms].some((term) => normalized.includes(term))) {
      selected.push(line);
    }
    if (selected.length >= maxLines) {
      break;
    }
  }

  return selected.length ? selected.join("\n") : lines.slice(0, 24).join("\n");
}

function selectSystemPrompt(systemPrompt) {
  const text = String(systemPrompt || "").trim();
  if (!MAX_SYSTEM_PROMPT_CHARS || text.length <= MAX_SYSTEM_PROMPT_CHARS) {
    return text;
  }

  const slice = text.slice(0, MAX_SYSTEM_PROMPT_CHARS);
  const lastBreak = slice.lastIndexOf("\n\n");
  return (lastBreak > 2000 ? slice.slice(0, lastBreak) : slice).trim();
}

export function buildInstructions(extraInstructions = "", userText = "") {
  const context = readContext();
  const rules = context.persona.rules.map((rule) => `- ${rule}`).join("\n");
  const systemPrompt = selectSystemPrompt(context.systemPrompt);
  const vocabulary = selectVocabulary(context.vocabulary, userText);
  const blocks = [
    `Prompt editavel do usuario:\n${systemPrompt}`,
    [
      `Voce tambem e ${context.persona.name}.`,
      `Idioma: ${context.persona.language}.`,
      `Estilo: ${context.persona.style}.`
    ].join("\n"),
    rules ? `Regras:\n${rules}` : "",
    context.summary.trim() ? `Memoria resumida:\n${context.summary.trim()}` : "",
    vocabulary.trim() ? `Vocabulario local relevante:\n${vocabulary.trim()}` : "",
    String(extraInstructions || "").trim()
      ? `Instrucoes adicionais deste chat:\n${String(extraInstructions).trim()}`
      : ""
  ];

  return blocks.filter(Boolean).join("\n\n").trim();
}
