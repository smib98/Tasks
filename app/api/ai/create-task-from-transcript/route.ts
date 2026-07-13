import { NextResponse } from "next/server";
import { taskFromTranscript } from "@/lib/ai";
import { errorResponse, readJson } from "@/lib/http";
import { transcriptionRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const { transcript } = transcriptionRequestSchema.parse(body);
    const task = await taskFromTranscript(transcript);
    return NextResponse.json({ task });
  } catch (error) {
    return errorResponse(error);
  }
}
