import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_STT_SCRIPT = "C:\\Users\\Larri\\Documents\\PRGRAMACAO\\stt\\openya\\stt-config-ok.py";
const DEFAULT_STT_CWD = path.dirname(DEFAULT_STT_SCRIPT);
const OUTPUT_DIR = path.join(process.cwd(), "runtime");
const DEFAULT_OUTPUT_FILE = path.join(OUTPUT_DIR, "external-stt.txt");
const MAX_LOG_LINES = 30;

let sttProcess;
let startedAt = 0;
let lastExit = null;
const logs = [];

function pushLog(line) {
  const text = String(line || "").trim();
  if (!text) return;
  logs.push(text.slice(0, 500));
  while (logs.length > MAX_LOG_LINES) {
    logs.shift();
  }
}

function outputFile() {
  return process.env.STT_OUTPUT_PATH || DEFAULT_OUTPUT_FILE;
}

function ensureOutputFile() {
  const file = outputFile();
  const dir = path.dirname(file);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(file)) {
    writeFileSync(file, "", "utf8");
  }
}

function pythonCommand() {
  return process.env.STT_PYTHON || "python";
}

function scriptPath() {
  return process.env.STT_SCRIPT_PATH || DEFAULT_STT_SCRIPT;
}

function scriptCwd() {
  return process.env.STT_SCRIPT_CWD || path.dirname(scriptPath()) || DEFAULT_STT_CWD;
}

function baseStatus() {
  const output = readExternalSttText();
  return {
    running: Boolean(sttProcess && !sttProcess.killed),
    pid: sttProcess?.pid,
    startedAt,
    lastExit,
    scriptPath: scriptPath(),
    scriptCwd: scriptCwd(),
    outputPath: outputFile(),
    outputLength: output.text.length,
    outputMtimeMs: output.mtimeMs,
    logs
  };
}

export function readExternalSttText(cursor = 0) {
  ensureOutputFile();
  let text = "";
  let mtimeMs = 0;
  try {
    text = readFileSync(outputFile(), "utf8").trim();
    mtimeMs = statSync(outputFile()).mtimeMs;
  } catch {
    text = "";
  }

  const safeCursor = Math.max(0, Math.min(Number(cursor) || 0, text.length));
  return {
    text,
    delta: text.slice(safeCursor),
    cursor: text.length,
    mtimeMs
  };
}

export function getExternalSttStatus() {
  return baseStatus();
}

export function startExternalStt() {
  if (sttProcess && !sttProcess.killed) {
    return baseStatus();
  }

  const file = scriptPath();
  const cwd = scriptCwd();
  if (!existsSync(file)) {
    throw new Error(`Script STT nao encontrado: ${file}`);
  }
  if (!existsSync(path.join(cwd, "token.txt"))) {
    throw new Error(`token.txt nao encontrado em: ${cwd}`);
  }

  ensureOutputFile();
  writeFileSync(outputFile(), "", "utf8");
  logs.length = 0;
  lastExit = null;
  startedAt = Date.now();

  const args = [
    file,
    "--output",
    outputFile(),
    "--no-meter"
  ];

  sttProcess = spawn(pythonCommand(), args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  sttProcess.stdout.setEncoding("utf8");
  sttProcess.stderr.setEncoding("utf8");
  sttProcess.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) pushLog(line);
  });
  sttProcess.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) pushLog(line);
  });
  sttProcess.on("error", (error) => {
    lastExit = { error: error.message, at: Date.now() };
    pushLog(`erro: ${error.message}`);
  });
  sttProcess.on("exit", (code, signal) => {
    lastExit = { code, signal, at: Date.now() };
    pushLog(`processo finalizado code=${code} signal=${signal || ""}`);
    sttProcess = undefined;
  });

  return baseStatus();
}

export function stopExternalStt() {
  if (sttProcess && !sttProcess.killed) {
    sttProcess.kill();
  }
  return baseStatus();
}
