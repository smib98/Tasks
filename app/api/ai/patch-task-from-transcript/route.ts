import { NextResponse } from "next/server";
import { patchFromTranscript } from "@/lib/ai";
import { errorResponse, readJson } from "@/lib/http";
import { aiPatchRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const { task, transcript } = aiPatchRequestSchema.parse(body);
    const patch = await patchFromTranscript(
      {
        ...task,
        category: task.category ?? "work",
        estimatedMinutes: task.estimatedMinutes ?? null
      },
      transcript
    );
    return NextResponse.json({ patch });
  } catch (error) {
    return errorResponse(error);
  }
}
