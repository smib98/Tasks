import { spawn } from "node:child_process";
import { loadConfigEnvironment } from "./config.mjs";

const config = loadConfigEnvironment();
const [command, ...originalArgs] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/run-with-config.mjs <command> [...args]");
  process.exit(2);
}

const args = [...originalArgs];
if (command === "next" && ["dev", "start"].includes(args[0])) {
  if (!args.includes("--hostname") && !args.includes("-H")) {
    args.push("--hostname", config.server.host);
  }
  if (!args.includes("--port") && !args.includes("-p")) {
    args.push("--port", config.server.http_port);
  }
}

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`Could not start ${command}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
