import { NextResponse } from "next/server";
import { deleteTaskSubtask, updateTaskSubtask } from "@/lib/tasks";
import { errorResponse, jsonError, readJson } from "@/lib/http";
import { updateSubtaskSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{
    id: string;
    subtaskId: string;
  }>;
};

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, subtaskId } = await params;
    const body = await readJson(request);
    const input = updateSubtaskSchema.parse(body);
    const task = await updateTaskSubtask(id, subtaskId, input);
    if (!task) return jsonError("Subtask not found.", 404);
    return NextResponse.json({ task });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id, subtaskId } = await params;
    const task = await deleteTaskSubtask(id, subtaskId);
    if (!task) return jsonError("Subtask not found.", 404);
    return NextResponse.json({ task });
  } catch (error) {
    return errorResponse(error);
  }
}
