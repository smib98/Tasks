import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dateToInput, inputToDate } from "@/lib/date";
import type { TaskDTO } from "@/lib/types";
import type {
  createNoteSchema,
  createSubtaskSchema,
  createTaskSchema,
  updateSubtaskSchema,
  updateTaskSchema
} from "@/lib/validation";
import type { z } from "zod";

const colors = ["yellow", "pink", "blue", "green", "lavender", "peach"];

const taskInclude = {
  people: {
    orderBy: {
      createdAt: "asc"
    }
  },
  notes: {
    orderBy: {
      createdAt: "desc"
    }
  },
  subtasks: {
    orderBy: [
      {
        position: "asc"
      },
      {
        createdAt: "asc"
      }
    ]
  },
  events: {
    orderBy: {
      createdAt: "desc"
    },
    take: 30
  }
} satisfies Prisma.TaskInclude;

type TaskWithRelations = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;

function normalizePeople(people: string[]) {
  return Array.from(new Set(people.map((person) => person.trim()).filter(Boolean)));
}

export function serializeTask(task: TaskWithRelations): TaskDTO {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    category: task.category as TaskDTO["category"],
    people: task.people.map((person) => person.personName),
    deadline: dateToInput(task.deadline),
    priority: task.priority as TaskDTO["priority"],
    estimatedMinutes: task.estimatedMinutes,
    status: task.status as TaskDTO["status"],
    color: task.color,
    notes: task.notes.map((note) => ({
      id: note.id,
      taskId: note.taskId,
      type: note.type,
      text: note.text,
      createdBy: note.createdBy,
      createdAt: note.createdAt.toISOString()
    })),
    subtasks: task.subtasks.map((subtask) => ({
      id: subtask.id,
      taskId: subtask.taskId,
      title: subtask.title,
      completed: subtask.completed,
      position: subtask.position,
      completedAt: subtask.completedAt?.toISOString() ?? null,
      createdAt: subtask.createdAt.toISOString(),
      updatedAt: subtask.updatedAt.toISOString()
    })),
    events: task.events.map((event) => ({
      id: event.id,
      taskId: event.taskId,
      eventType: event.eventType,
      summary: event.summary,
      oldValue: parseEventJson(event.oldValue),
      newValue: parseEventJson(event.newValue),
      createdBy: event.createdBy,
      createdAt: event.createdAt.toISOString()
    })),
    createdBy: task.createdBy,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null
  };
}

function eventJson(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function parseEventJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function listTasks() {
  const tasks = await prisma.task.findMany({
    include: taskInclude,
    orderBy: [
      {
        status: "asc"
      },
      {
        deadline: "asc"
      },
      {
        updatedAt: "desc"
      }
    ]
  });

  return tasks.map(serializeTask);
}

export async function getTask(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    include: taskInclude
  });

  return task ? serializeTask(task) : null;
}

export async function createTask(input: z.infer<typeof createTaskSchema>) {
  const taskCount = await prisma.task.count();
  const color = input.color ?? colors[taskCount % colors.length];
  const people = normalizePeople(input.people);
  const note = input.note?.trim();
  const status = input.status ?? "active";

  const task = await prisma.task.create({
    data: {
      title: input.title,
      description: input.description,
      category: input.category,
      deadline: inputToDate(input.deadline),
      estimatedMinutes: input.estimatedMinutes ?? null,
      priority: input.priority,
      status,
      color,
      createdBy: "Local user",
      completedAt: status === "completed" ? new Date() : null,
      people: {
        create: people.map((personName) => ({ personName }))
      },
      notes: note
        ? {
            create: {
              type: input.noteType ?? "Manual note",
              text: note,
              createdBy: "Local user"
            }
          }
        : undefined,
      events: {
        create: {
          eventType: "created",
          summary: "Task created.",
          newValue: eventJson({
            title: input.title,
            category: input.category,
            priority: input.priority,
            estimatedMinutes: input.estimatedMinutes ?? null,
            status,
            deadline: input.deadline ?? null,
            people
          }),
          createdBy: "Local user"
        }
      }
    },
    include: taskInclude
  });

  return serializeTask(task);
}

export async function updateTask(id: string, input: z.infer<typeof updateTaskSchema>) {
  const before = await prisma.task.findUnique({
    where: { id },
    include: taskInclude
  });

  if (!before) {
    return null;
  }

  const data: Prisma.TaskUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.category !== undefined) data.category = input.category;
  if (input.deadline !== undefined) data.deadline = inputToDate(input.deadline);
  if (input.estimatedMinutes !== undefined) data.estimatedMinutes = input.estimatedMinutes;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.status !== undefined) {
    data.status = input.status;
    data.completedAt = input.status === "completed" ? before.completedAt ?? new Date() : null;
  }
  if (input.color !== undefined) data.color = input.color;

  const note = input.note?.trim();
  const after = await prisma.$transaction(async (tx) => {
    if (input.people !== undefined) {
      await tx.taskPerson.deleteMany({
        where: { taskId: id }
      });
      const people = normalizePeople(input.people);
      if (people.length) {
        await tx.taskPerson.createMany({
          data: people.map((personName) => ({
            taskId: id,
            personName
          }))
        });
      }
    }

    if (note) {
      await tx.taskNote.create({
        data: {
          taskId: id,
          type: input.noteType ?? "Manual edit note",
          text: note,
          createdBy: "Local user"
        }
      });
    }

    await tx.taskEvent.create({
      data: {
        taskId: id,
        eventType: "updated",
        summary: "Task updated.",
        oldValue: eventJson({
          title: before.title,
          description: before.description,
          category: before.category,
          priority: before.priority,
          estimatedMinutes: before.estimatedMinutes,
          status: before.status,
          deadline: dateToInput(before.deadline),
          people: before.people.map((person) => person.personName)
        }),
        newValue: eventJson({
          ...input,
          note: note ? "[note attached]" : undefined
        }),
        createdBy: "Local user"
      }
    });

    return tx.task.update({
      where: { id },
      data,
      include: taskInclude
    });
  });

  return serializeTask(after);
}

export async function deleteTask(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true }
  });

  if (!task) {
    return false;
  }

  await prisma.task.delete({
    where: { id }
  });

  return true;
}

export async function addTaskNote(id: string, input: z.infer<typeof createNoteSchema>) {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true }
  });

  if (!task) {
    return null;
  }

  await prisma.$transaction([
    prisma.taskNote.create({
      data: {
        taskId: id,
        type: input.type,
        text: input.text,
        createdBy: input.createdBy ?? "Local user"
      }
    }),
    prisma.taskEvent.create({
      data: {
        taskId: id,
        eventType: "note_added",
        summary: `${input.type} added.`,
        newValue: eventJson({
          type: input.type
        }),
        createdBy: input.createdBy ?? "Local user"
      }
    })
  ]);

  return getTask(id);
}

export async function setTaskStatus(id: string, status: "active" | "completed") {
  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      completedAt: true
    }
  });

  if (!task) {
    return null;
  }

  const text = status === "completed" ? "Task marked as completed." : "Task moved back to active.";

  const updated = await prisma.task.update({
    where: { id },
    data: {
      status,
      completedAt: status === "completed" ? task.completedAt ?? new Date() : null,
      notes: {
        create: {
          type: "Status update",
          text,
          createdBy: "Local user"
        }
      },
      events: {
        create: {
          eventType: "status_changed",
          summary: text,
          oldValue: eventJson({
            status: task.status
          }),
          newValue: eventJson({
            status
          }),
          createdBy: "Local user"
        }
      }
    },
    include: taskInclude
  });

  return serializeTask(updated);
}

export async function addTaskSubtask(id: string, input: z.infer<typeof createSubtaskSchema>) {
  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      _count: {
        select: {
          subtasks: true
        }
      }
    }
  });

  if (!task) {
    return null;
  }

  await prisma.$transaction([
    prisma.taskSubtask.create({
      data: {
        taskId: id,
        title: input.title,
        position: task._count.subtasks
      }
    }),
    prisma.taskEvent.create({
      data: {
        taskId: id,
        eventType: "subtask_added",
        summary: "Subtask added.",
        newValue: eventJson({
          title: input.title
        }),
        createdBy: "Local user"
      }
    })
  ]);

  return getTask(id);
}

export async function updateTaskSubtask(
  taskId: string,
  subtaskId: string,
  input: z.infer<typeof updateSubtaskSchema>
) {
  const subtask = await prisma.taskSubtask.findFirst({
    where: {
      id: subtaskId,
      taskId
    }
  });

  if (!subtask) {
    return null;
  }

  const completed = input.completed;
  await prisma.$transaction([
    prisma.taskSubtask.update({
      where: { id: subtaskId },
      data: {
        title: input.title,
        completed,
        position: input.position,
        completedAt:
          completed === undefined ? undefined : completed ? subtask.completedAt ?? new Date() : null
      }
    }),
    prisma.taskEvent.create({
      data: {
        taskId,
        eventType: "subtask_updated",
        summary:
          completed === undefined
            ? "Subtask updated."
            : completed
              ? "Subtask completed."
              : "Subtask reopened.",
        oldValue: eventJson({
          title: subtask.title,
          completed: subtask.completed
        }),
        newValue: eventJson(input),
        createdBy: "Local user"
      }
    })
  ]);

  return getTask(taskId);
}

export async function deleteTaskSubtask(taskId: string, subtaskId: string) {
  const subtask = await prisma.taskSubtask.findFirst({
    where: {
      id: subtaskId,
      taskId
    }
  });

  if (!subtask) {
    return null;
  }

  await prisma.$transaction([
    prisma.taskSubtask.delete({
      where: { id: subtaskId }
    }),
    prisma.taskEvent.create({
      data: {
        taskId,
        eventType: "subtask_deleted",
        summary: "Subtask deleted.",
        oldValue: eventJson({
          title: subtask.title,
          completed: subtask.completed
        }),
        createdBy: "Local user"
      }
    })
  ]);

  return getTask(taskId);
}
