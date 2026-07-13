import { NextResponse } from "next/server";
import { addTaskNote } from "@/lib/tasks";
import { createNoteSchema } from "@/lib/validation";
import { errorResponse, jsonError, readJson } from "@/lib/http";

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
    const input = createNoteSchema.parse(body);
    const task = await addTaskNote(id, input);
    if (!task) return jsonError("Task not found.", 404);
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
