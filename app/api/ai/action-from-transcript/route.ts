import { NextResponse } from "next/server";
import { commandFromTranscript } from "@/lib/ai";
import { errorResponse, readJson } from "@/lib/http";
import {
  addTaskNote,
  addTaskSubtask,
  createTask,
  deleteTask,
  listTasks,
  updateTask,
  updateTaskSubtask
} from "@/lib/tasks";
import type { TaskDTO } from "@/lib/types";
import { transcriptionRequestSchema } from "@/lib/validation";
import type { aiCommandOperationSchema, updateTaskSchema } from "@/lib/validation";
import type { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CommandOperation = z.infer<typeof aiCommandOperationSchema>;
type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

type ActionResult = {
  type: CommandOperation["type"];
  status: "applied" | "skipped";
  message: string;
  taskId?: string;
  taskTitle?: string;
};

function uniquePeople(people: string[]) {
  return Array.from(new Set(people.map((person) => person.trim()).filter(Boolean)));
}

function buildUpdateInput(task: TaskDTO, patch: Extract<CommandOperation, { type: "update_task" }>["patch"]) {
  const input: UpdateTaskInput = {};

  if (patch.title) input.title = patch.title;
  if (patch.description_replace) {
    input.description = patch.description_replace;
  } else if (patch.description_append) {
    input.description = `${task.description}\n\n${patch.description_append}`;
  }
  if (patch.category) input.category = patch.category;
  if (patch.deadline_clear) {
    input.deadline = null;
  } else if (patch.deadline) {
    input.deadline = patch.deadline;
  }
  if (patch.estimatedMinutes_clear) {
    input.estimatedMinutes = null;
  } else if (typeof patch.estimatedMinutes === "number") {
    input.estimatedMinutes = patch.estimatedMinutes;
  }
  if (patch.priority) input.priority = patch.priority;
  if (patch.status) input.status = patch.status;

  if (patch.people_set !== undefined && patch.people_set !== null) {
    input.people = patch.people_set;
  } else if (patch.people_add?.length || patch.people_remove?.length) {
    const removeSet = new Set((patch.people_remove ?? []).map((person) => person.toLowerCase()));
    input.people = uniquePeople([
      ...task.people.filter((person) => !removeSet.has(person.toLowerCase())),
      ...(patch.people_add ?? [])
    ]);
  }

  if (patch.note) {
    input.note = patch.note;
    input.noteType = "AI voice command";
  }

  return input;
}

function hasUpdateInput(input: UpdateTaskInput) {
  return Object.keys(input).some((key) => key !== "noteType");
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const { transcript } = transcriptionRequestSchema.parse(body);
    const initialTasks = await listTasks();
    const command = await commandFromTranscript(transcript, initialTasks);
    const results: ActionResult[] = [];
    const taskMap = new Map(initialTasks.map((task) => [task.id, task]));

    for (const operation of command.operations) {
      if (operation.type === "create_task") {
        const created = await createTask({
          ...operation.task,
          note: operation.task.note ?? `Created from voice command: ${transcript}`,
          noteType: "AI voice command"
        });
        taskMap.set(created.id, created);
        results.push({
          type: operation.type,
          status: "applied",
          message: `Created "${created.title}".`,
          taskId: created.id,
          taskTitle: created.title
        });
        continue;
      }

      const task = taskMap.get(operation.taskId);
      if (!task) {
        results.push({
          type: operation.type,
          status: "skipped",
          message: `Could not find task ${operation.taskId}.`,
          taskId: operation.taskId
        });
        continue;
      }

      if (operation.type === "update_task") {
        const input = buildUpdateInput(task, operation.patch);
        if (!hasUpdateInput(input)) {
          results.push({
            type: operation.type,
            status: "skipped",
            message: `No clear updates for "${task.title}".`,
            taskId: task.id,
            taskTitle: task.title
          });
          continue;
        }

        const updated = await updateTask(task.id, input);
        if (!updated) {
          results.push({
            type: operation.type,
            status: "skipped",
            message: `Could not update "${task.title}".`,
            taskId: task.id,
            taskTitle: task.title
          });
          continue;
        }

        taskMap.set(updated.id, updated);
        results.push({
          type: operation.type,
          status: "applied",
          message: `Updated "${updated.title}".`,
          taskId: updated.id,
          taskTitle: updated.title
        });
        continue;
      }

      if (operation.type === "add_note") {
        const updated = await addTaskNote(task.id, {
          type: operation.note.type,
          text: operation.note.text,
          createdBy: "AI voice command"
        });
        if (updated) taskMap.set(updated.id, updated);
        results.push({
          type: operation.type,
          status: updated ? "applied" : "skipped",
          message: updated ? `Added note to "${updated.title}".` : `Could not add note to "${task.title}".`,
          taskId: task.id,
          taskTitle: task.title
        });
        continue;
      }

      if (operation.type === "add_subtask") {
        const updated = await addTaskSubtask(task.id, {
          title: operation.title
        });
        if (updated) taskMap.set(updated.id, updated);
        results.push({
          type: operation.type,
          status: updated ? "applied" : "skipped",
          message: updated ? `Added subtask to "${updated.title}".` : `Could not add subtask to "${task.title}".`,
          taskId: task.id,
          taskTitle: task.title
        });
        continue;
      }

      if (operation.type === "update_subtask") {
        if (operation.title === undefined && operation.completed === undefined) {
          results.push({
            type: operation.type,
            status: "skipped",
            message: `No clear subtask update for "${task.title}".`,
            taskId: task.id,
            taskTitle: task.title
          });
          continue;
        }

        const updated = await updateTaskSubtask(task.id, operation.subtaskId, {
          title: operation.title,
          completed: operation.completed
        });
        if (updated) taskMap.set(updated.id, updated);
        results.push({
          type: operation.type,
          status: updated ? "applied" : "skipped",
          message: updated ? `Updated subtask on "${updated.title}".` : `Could not update subtask on "${task.title}".`,
          taskId: task.id,
          taskTitle: task.title
        });
        continue;
      }

      if (operation.type === "delete_task") {
        const deleted = await deleteTask(task.id);
        if (deleted) taskMap.delete(task.id);
        results.push({
          type: operation.type,
          status: deleted ? "applied" : "skipped",
          message: deleted ? `Deleted "${task.title}".` : `Could not delete "${task.title}".`,
          taskId: task.id,
          taskTitle: task.title
        });
      }
    }

    const tasks = await listTasks();
    return NextResponse.json({
      transcript,
      summary: command.summary,
      warnings: command.warnings,
      operations: command.operations,
      results,
      tasks
    });
  } catch (error) {
    return errorResponse(error);
  }
}
