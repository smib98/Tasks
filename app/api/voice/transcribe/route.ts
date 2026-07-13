import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { errorResponse, jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const maxAudioBytes = 25 * 1024 * 1024;

function extensionForMime(mime: string) {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export async function POST(request: Request) {
  let audioPath: string | null = null;

  try {
    const form = await request.formData();
    const audio = form.get("audio");

    if (!audio || typeof audio === "string" || typeof audio.arrayBuffer !== "function") {
      return jsonError("Upload an audio file in the 'audio' field.", 400);
    }

    const buffer = Buffer.from(await audio.arrayBuffer());
    if (!buffer.length) {
      return jsonError("The audio file is empty.", 400);
    }

    if (buffer.length > maxAudioBytes) {
      return jsonError("Audio file is too large. Keep recordings under 25 MB.", 413);
    }

    const uploadDir = join(process.cwd(), "tmp", "uploads");
    await mkdir(uploadDir, { recursive: true });
    audioPath = join(uploadDir, `${randomUUID()}.${extensionForMime(audio.type || "")}`);
    await writeFile(audioPath, buffer);

    const script = join(process.cwd(), "scripts", "transcribe_whisper.py");
    const model = process.env.WHISPER_MODEL || "base";
    const device = process.env.WHISPER_DEVICE || "auto";
    const computeType = process.env.WHISPER_COMPUTE_TYPE || "auto";
    const { stdout, stderr } = await execFileAsync(process.env.WHISPER_PYTHON_BIN || "python3", [
      script,
      audioPath,
      "--model",
      model,
      "--device",
      device,
      "--compute-type",
      computeType
    ], {
      timeout: 180_000,
      maxBuffer: 1024 * 1024 * 8
    });

    if (stderr.trim()) {
      console.warn(stderr);
    }

    const parsed = JSON.parse(stdout);
    if (!parsed.text) {
      return jsonError("No speech was detected in the recording.", 422, parsed);
    }

    return NextResponse.json({
      transcript: parsed.text,
      language: parsed.language ?? null,
      languageProbability: parsed.languageProbability ?? null,
      duration: parsed.duration ?? null
    });
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (audioPath) {
      await unlink(audioPath).catch(() => undefined);
    }
  }
}
