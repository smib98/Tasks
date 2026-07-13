import { NextResponse } from "next/server";
import { deleteTask, getTask, updateTask } from "@/lib/tasks";
import { jsonError, errorResponse, readJson } from "@/lib/http";
import { updateTaskSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const task = await getTask(id);
    if (!task) return jsonError("Task not found.", 404);
    return NextResponse.json({ task });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await readJson(request);
    const input = updateTaskSchema.parse(body);
    const task = await updateTask(id, input);
    if (!task) return jsonError("Task not found.", 404);
    return NextResponse.json({ task });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const deleted = await deleteTask(id);
    if (!deleted) return jsonError("Task not found.", 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
