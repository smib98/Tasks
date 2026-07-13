import { NextResponse } from "next/server";
import { setTaskStatus } from "@/lib/tasks";
import { errorResponse, jsonError, readJson } from "@/lib/http";
import { statusUpdateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await readJson(request);
    const { status } = statusUpdateSchema.parse(body);
    const task = await setTaskStatus(id, status);
    if (!task) return jsonError("Task not found.", 404);
    return NextResponse.json({ task });
  } catch (error) {
    return errorResponse(error);
  }
}
