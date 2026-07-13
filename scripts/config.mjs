import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULTS = {
  server: {
    host: "127.0.0.1",
    http_port: "3000",
    https_enabled: "false",
    https_port: "3443"
  },
  database: {
    url: "file:./notetasks.db"
  },
  gemini: {
    api_key: "",
    model: "gemini-3.5-flash"
  },
  whisper: {
    python_bin: ".venv/bin/python",
    model: "base",
    device: "auto",
    compute_type: "auto"
  }
};

function stripInlineComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? null : (quote || char);
      continue;
    }
    if (!quote && (char === "#" || char === ";") && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trim();
    }
  }
  return value.trim();
}

function unquote(value) {
  if (value.length >= 2 && value[0] === value.at(-1) && ['"', "'"].includes(value[0])) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseIni(text) {
  const parsed = {};
  let section = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      parsed[section] ||= {};
      continue;
    }

    const separator = line.indexOf("=");
    if (!section || separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = unquote(stripInlineComment(line.slice(separator + 1)));
    parsed[section][key] = value;
  }

  return parsed;
}

export function loadConfig(configPath = resolve(process.cwd(), "config.ini")) {
  const parsed = existsSync(configPath) ? parseIni(readFileSync(configPath, "utf8")) : {};
  return Object.fromEntries(
    Object.entries(DEFAULTS).map(([section, values]) => [section, { ...values, ...(parsed[section] || {}) }])
  );
}

export function loadConfigEnvironment(configPath) {
  const config = loadConfig(configPath);
  const mapping = {
    DATABASE_URL: config.database.url,
    GEMINI_API_KEY: config.gemini.api_key,
    GEMINI_MODEL: config.gemini.model,
    NOTETASKS_HOST: config.server.host,
    NOTETASKS_HTTP_PORT: config.server.http_port,
    NOTETASKS_HTTPS_ENABLED: config.server.https_enabled,
    NOTETASKS_HTTPS_PORT: config.server.https_port,
    WHISPER_PYTHON_BIN: config.whisper.python_bin,
    WHISPER_MODEL: config.whisper.model,
    WHISPER_DEVICE: config.whisper.device,
    WHISPER_COMPUTE_TYPE: config.whisper.compute_type
  };

  for (const [name, value] of Object.entries(mapping)) {
    if (process.env[name] === undefined && value !== "") process.env[name] = value;
  }

  return config;
}
