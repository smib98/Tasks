import { NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/tasks";
import { createTaskSchema } from "@/lib/validation";
import { errorResponse, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tasks = await listTasks();
    return NextResponse.json({ tasks });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const input = createTaskSchema.parse(body);
    const task = await createTask(input);
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
