import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const POOL_NAME = "openai-codex";
const CODEX_REFRESH_URL = "https://chatgpt.com/api/auth/session";
let parsedAuthCache;

function projectRoot() {
  return path.resolve(process.cwd());
}

export function defaultAuthPath() {
  return process.env.CODEX_AUTH_PATH || path.join(projectRoot(), "auth.json");
}

export function defaultPoolDir() {
  return path.join(projectRoot(), "auth-pool");
}

export function defaultConfigPath() {
  return process.env.CODEX_CONFIG_PATH || path.join(projectRoot(), "config.toml");
}

function authSource() {
  return process.env.CODEX_AUTH_PATH ? "env" : "project";
}

function isInsideProject(candidatePath) {
  const root = projectRoot();
  const resolved = path.resolve(candidatePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function missingStatus(authPath, error) {
  return {
    authPath,
    exists: false,
    source: authSource(),
    hasApiKey: false,
    hasAccessToken: false,
    hasRefreshToken: false,
    pool: {
      files: 0,
      accounts: 0,
      available: 0
    },
    error
  };
}

function jwtExp(token) {
  if (!token || typeof token !== "string") {
    return 0;
  }
  try {
    const part = token.split(".")[1];
    if (!part) {
      return 0;
    }
    const padded = `${part}${"=".repeat((4 - (part.length % 4)) % 4)}`;
    const claims = JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
    return Number(claims.exp || 0);
  } catch {
    return 0;
  }
}

function candidateAuthFiles() {
  if (process.env.CODEX_AUTH_PATH) {
    return [path.resolve(process.env.CODEX_AUTH_PATH)];
  }

  const files = [];
  const rootAuth = path.join(projectRoot(), "auth.json");
  if (existsSync(rootAuth)) {
    files.push(rootAuth);
  }

  const poolDir = defaultPoolDir();
  if (existsSync(poolDir)) {
    for (const entry of readdirSync(poolDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        files.push(path.join(poolDir, entry.name));
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
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

function accountFromSingleFile(data, authPath) {
  const tokens = data.tokens || {};
  const accessToken = tokens.access_token || tokens.access || data.access;
  const refreshToken = tokens.refresh_token || tokens.refresh || data.refresh;
  const accountId = tokens.account_id || tokens.accountId || data.account_id || data.accountId;
  const apiKey = data.OPENAI_API_KEY;

  if (!accessToken && !apiKey) {
    return undefined;
  }

  const label = path.parse(authPath).name;
  return {
    key: `${authPath}#single#${accountId || label}`,
    authPath,
    label,
    sourceType: "single",
    authMode: data.auth_mode,
    apiKey,
    accessToken,
    refreshToken,
    idToken: tokens.id_token,
    accountId
  };
}

function accountsFromFile(authPath) {
  let data;
  try {
    data = JSON.parse(readFileSync(authPath, "utf8"));
  } catch (error) {
    return {
      accounts: [],
      error: error instanceof Error ? `auth invalido em ${authPath}: ${error.message}` : "auth invalido"
    };
  }

  const pool = data.credential_pool?.[POOL_NAME];
  if (Array.isArray(pool)) {
    return {
      accounts: pool.map((entry, index) => {
        const accountId = entry.account_id || entry.accountId || entry.extra?.account_id;
        const label = entry.label || entry.id || `${path.parse(authPath).name}-${index + 1}`;
        return {
          key: `${authPath}#pool#${accountId || label}#${index}`,
          authPath,
          label,
          sourceType: "pool",
          poolIndex: index,
          authMode: entry.auth_type || data.auth_mode || "oauth",
          accessToken: entry.access_token,
          refreshToken: entry.refresh_token,
          idToken: entry.id_token,
          accountId
        };
      })
    };
  }

  const single = accountFromSingleFile(data, authPath);
  return {
    accounts: single ? [single] : []
  };
}

export function listLocalAuthAccounts() {
  const files = candidateAuthFiles();
  const invalidPath = files.find((file) => !isInsideProject(file));
  const displayPath = process.env.CODEX_AUTH_PATH ? defaultAuthPath() : defaultPoolDir();

  if (invalidPath) {
    return {
      accounts: [],
      status: missingStatus(
        path.resolve(invalidPath),
        "CODEX_AUTH_PATH precisa apontar para um auth.json dentro da pasta do projeto."
      )
    };
  }

  if (!files.length) {
    return {
      accounts: [],
      status: missingStatus(displayPath)
    };
  }

  const signature = filesSignature(files);
  if (!parsedAuthCache || parsedAuthCache.signature !== signature) {
    const errors = [];
    const accounts = files.flatMap((file) => {
      const result = accountsFromFile(file);
      if (result.error) {
        errors.push(result.error);
      }
      return result.accounts;
    });
    parsedAuthCache = {
      signature,
      accounts: accounts.sort((a, b) => jwtExp(b.accessToken) - jwtExp(a.accessToken)),
      errors
    };
  }

  const { accounts, errors } = parsedAuthCache;
  const available = accounts.filter((account) => account.apiKey || account.accessToken);
  const nowSeconds = Date.now() / 1000;
  const usable = available.filter((account) => account.apiKey || jwtExp(account.accessToken) > nowSeconds + 30);

  return {
    accounts,
    status: {
      authPath: files.length === 1 ? files[0] : defaultPoolDir(),
      exists: true,
      source: authSource(),
      hasApiKey: usable.some((account) => Boolean(account.apiKey)),
      hasAccessToken: usable.some((account) => Boolean(account.accessToken)),
      hasRefreshToken: accounts.some((account) => Boolean(account.refreshToken)),
      pool: {
        files: files.length,
        accounts: accounts.length,
        available: usable.length
      },
      error: errors[0]
    }
  };
}

export function loadCodexAuth(options = {}) {
  const pool = listLocalAuthAccounts();
  const nowSeconds = Date.now() / 1000;
  const selected = pool.accounts.find(
    (account) =>
      (account.apiKey || jwtExp(account.accessToken) > nowSeconds + 30) && !options.skipKeys?.has(account.key)
  );

  if (!selected) {
    return {
      status: {
        ...pool.status,
        hasApiKey: false,
        hasAccessToken: false,
        error: pool.status.error || "Nenhuma conta disponivel no pool local."
      }
    };
  }

  return {
    accountKey: selected.key,
    label: selected.label,
    authPath: selected.authPath,
    sourceType: selected.sourceType,
    poolIndex: selected.poolIndex,
    apiKey: selected.apiKey,
    accessToken: selected.accessToken,
    refreshToken: selected.refreshToken,
    idToken: selected.idToken,
    accountId: selected.accountId,
    status: {
      ...pool.status,
      authPath: selected.authPath,
      exists: true,
      authMode: selected.authMode,
      hasApiKey: Boolean(selected.apiKey),
      hasAccessToken: Boolean(selected.accessToken),
      hasRefreshToken: Boolean(selected.refreshToken),
      selectedLabel: selected.label,
      error: undefined
    }
  };
}

export async function refreshCodexAuth(auth) {
  if (!auth?.refreshToken) {
    throw new Error("Conta sem refresh_token.");
  }
  if (!auth.authPath || !isInsideProject(auth.authPath)) {
    throw new Error("Auth fora da pasta do projeto.");
  }

  const response = await fetch(CODEX_REFRESH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://chatgpt.com",
      Referer: "https://chatgpt.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    body: JSON.stringify({ refreshToken: auth.refreshToken })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Falha ao renovar auth: HTTP ${response.status} ${text.slice(0, 160)}`);
  }

  const payload = await response.json();
  const accessToken = payload.accessToken || payload.access_token;
  const refreshToken = payload.refreshToken || payload.refresh_token || auth.refreshToken;
  const expiresAt = payload.expires_at || Math.floor(Date.now() / 1000) + 3600;

  if (!accessToken) {
    throw new Error("Refresh nao retornou access_token.");
  }

  const data = JSON.parse(readFileSync(auth.authPath, "utf8"));
  if (auth.sourceType === "pool") {
    const entries = data.credential_pool?.[POOL_NAME];
    const entry = Array.isArray(entries) ? entries[auth.poolIndex] : undefined;
    if (!entry) {
      throw new Error("Conta do pool nao encontrada para atualizar.");
    }
    entry.access_token = accessToken;
    entry.refresh_token = refreshToken;
    entry.expires_at = expiresAt;
  } else if (data.tokens) {
    data.tokens.access_token = accessToken;
    data.tokens.refresh_token = refreshToken;
    data.tokens.expires_at = expiresAt;
  } else {
    data.access = accessToken;
    data.refresh = refreshToken;
    data.expires = expiresAt;
  }

  writeFileSync(auth.authPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  return {
    ...auth,
    accessToken,
    refreshToken
  };
}

export function readModelFromConfig(configPath = defaultConfigPath()) {
  if (!existsSync(configPath)) {
    return undefined;
  }

  const config = readFileSync(configPath, "utf8");
  const match = config.match(/^model\s*=\s*"([^"]+)"/m);
  return match?.[1];
}
