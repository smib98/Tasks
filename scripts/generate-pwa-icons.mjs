import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = path.join(root, "public", "icons", "notetasks.svg");
const iconDir = path.join(root, "public", "icons");

await mkdir(iconDir, { recursive: true });

await Promise.all([
  sharp(source).resize(192, 192).png().toFile(path.join(iconDir, "icon-192.png")),
  sharp(source).resize(512, 512).png().toFile(path.join(iconDir, "icon-512.png")),
  sharp(source)
    .resize(512, 512, {
      fit: "contain",
      background: "#111827"
    })
    .png()
    .toFile(path.join(iconDir, "maskable-512.png"))
]);

console.log("Generated PWA icons.");
