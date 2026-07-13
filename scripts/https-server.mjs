import { createServer } from "node:https";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import next from "next";
import { loadConfigEnvironment } from "./config.mjs";

loadConfigEnvironment();

const hostname = process.env.NOTETASKS_HOST || "127.0.0.1";
const port = Number(process.env.NOTETASKS_HTTPS_PORT || 3443);
const keyPath = join(process.cwd(), "certs", "notetasks-key.pem");
const certPath = join(process.cwd(), "certs", "notetasks-cert.pem");

if (!existsSync(keyPath) || !existsSync(certPath)) {
  console.error("Missing HTTPS certificate. Run npm run setup:https first.");
  process.exit(1);
}

const app = next({
  dev: false,
  hostname,
  port
});
const handle = app.getRequestHandler();

await app.prepare();

createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath)
  },
  (request, response) => {
    handle(request, response);
  }
).listen(port, hostname, () => {
  const shownHost = ["0.0.0.0", "127.0.0.1"].includes(hostname) ? "localhost" : hostname;
  console.log(`NoteTasks HTTPS ready on https://${shownHost}:${port}`);
});
