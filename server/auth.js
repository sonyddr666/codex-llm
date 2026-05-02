import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const POOL_NAME = "openai-codex";

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

  const errors = [];
  const accounts = files.flatMap((file) => {
    const result = accountsFromFile(file);
    if (result.error) {
      errors.push(result.error);
    }
    return result.accounts;
  });
  const available = accounts.filter((account) => account.apiKey || account.accessToken);

  return {
    accounts,
    status: {
      authPath: files.length === 1 ? files[0] : defaultPoolDir(),
      exists: true,
      source: authSource(),
      hasApiKey: available.some((account) => Boolean(account.apiKey)),
      hasAccessToken: available.some((account) => Boolean(account.accessToken)),
      hasRefreshToken: accounts.some((account) => Boolean(account.refreshToken)),
      pool: {
        files: files.length,
        accounts: accounts.length,
        available: available.length
      },
      error: errors[0]
    }
  };
}

export function loadCodexAuth(options = {}) {
  const pool = listLocalAuthAccounts();
  const selected = pool.accounts.find(
    (account) => (account.apiKey || account.accessToken) && !options.skipKeys?.has(account.key)
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
    apiKey: selected.apiKey,
    accessToken: selected.accessToken,
    idToken: selected.idToken,
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

export function readModelFromConfig(configPath = defaultConfigPath()) {
  if (!existsSync(configPath)) {
    return undefined;
  }

  const config = readFileSync(configPath, "utf8");
  const match = config.match(/^model\s*=\s*"([^"]+)"/m);
  return match?.[1];
}
