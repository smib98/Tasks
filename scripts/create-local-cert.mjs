import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const certDir = join(process.cwd(), "certs");
const keyPath = join(certDir, "notetasks-key.pem");
const certPath = join(certDir, "notetasks-cert.pem");
const configPath = join(certDir, "notetasks-openssl.cnf");

function localIps() {
  return Object.values(networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

mkdirSync(certDir, { recursive: true });

const ips = ["127.0.0.1", ...localIps()];
const altNames = ["DNS.1 = localhost", ...ips.map((ip, index) => `IP.${index + 1} = ${ip}`)].join("\n");

const config = `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = NoteTasks Local

[v3_req]
subjectAltName = @alt_names

[alt_names]
${altNames}
`;

writeFileSync(configPath, config.trimStart());

if (existsSync(keyPath) && existsSync(certPath)) {
  console.log(`Local HTTPS certificate already exists in ${certDir}`);
  console.log(`Included IPs: ${ips.join(", ")}`);
  process.exit(0);
}

execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-nodes",
    "-days",
    "825",
    "-newkey",
    "rsa:2048",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-config",
    configPath
  ],
  {
    stdio: "inherit"
  }
);

console.log(`Created local HTTPS certificate in ${certDir}`);
console.log(`Included IPs: ${ips.join(", ")}`);
