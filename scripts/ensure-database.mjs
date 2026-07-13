import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigEnvironment } from "./config.mjs";

loadConfigEnvironment();

const databaseUrl = process.env.DATABASE_URL || "file:./notetasks.db";
if (!databaseUrl.startsWith("file:")) process.exit(0);

const withoutQuery = databaseUrl.split("?")[0];
let databasePath;

if (withoutQuery.startsWith("file://")) {
  databasePath = fileURLToPath(withoutQuery);
} else {
  const configuredPath = decodeURIComponent(withoutQuery.slice("file:".length));
  databasePath = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(process.cwd(), "prisma", configuredPath);
}

mkdirSync(dirname(databasePath), { recursive: true });
closeSync(openSync(databasePath, "a", 0o600));
