import { z } from "zod";

export const prioritySchema = z.enum(["Low", "Medium", "High"]);
export const statusSchema = z.enum(["active", "completed"]);
export const categorySchema = z.enum(["work", "personal"]);

const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .nullable()
  .optional();

const estimatedMinutesSchema = z
  .number()
  .int()
  .min(1)
  .max(24 * 60)
  .nullable()
  .optional();

export const peopleSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(25)
  .default([])
  .transform((people) => Array.from(new Set(people.map((person) => person.trim()).filter(Boolean))));

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(5000),
  category: categorySchema.default("work"),
  people: peopleSchema,
  deadline: dateOnlySchema,
  estimatedMinutes: estimatedMinutesSchema,
  priority: prioritySchema.default("Medium"),
  status: statusSchema.default("active"),
  color: z.string().trim().min(1).max(32).optional(),
  note: z.string().trim().max(5000).optional().nullable(),
  noteType: z.string().trim().min(1).max(80).optional()
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  category: categorySchema.optional(),
  people: peopleSchema.optional(),
  deadline: dateOnlySchema,
  estimatedMinutes: estimatedMinutesSchema,
  priority: prioritySchema.optional(),
  status: statusSchema.optional(),
  color: z.string().trim().min(1).max(32).optional(),
  note: z.string().trim().max(5000).optional().nullable(),
  noteType: z.string().trim().min(1).max(80).optional()
});

export const createNoteSchema = z.object({
  type: z.string().trim().min(1).max(80).default("Quick note"),
  text: z.string().trim().min(1).max(5000),
  createdBy: z.string().trim().max(120).optional().nullable()
});

export const createSubtaskSchema = z.object({
  title: z.string().trim().min(1).max(180)
});

export const updateSubtaskSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  completed: z.boolean().optional(),
  position: z.number().int().min(0).max(10000).optional()
});

export const statusUpdateSchema = z.object({
  status: statusSchema
});

export const transcriptionRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(20000)
});

export const aiTaskSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(5000),
  category: categorySchema.default("work"),
  people: peopleSchema,
  deadline: dateOnlySchema,
  estimatedMinutes: estimatedMinutesSchema,
  priority: prioritySchema.default("Medium"),
  status: statusSchema.default("active"),
  note: z.string().trim().max(5000).optional().nullable()
});

export const aiPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).nullable().optional(),
    description_replace: z.string().trim().min(1).max(5000).nullable().optional(),
    description_append: z.string().trim().min(1).max(3000).nullable().optional(),
    people_add: peopleSchema.optional(),
    people_remove: peopleSchema.optional(),
    category: categorySchema.nullable().optional(),
    deadline: dateOnlySchema,
    estimatedMinutes: estimatedMinutesSchema,
    priority: prioritySchema.nullable().optional(),
    status: statusSchema.nullable().optional(),
    note: z.string().trim().max(5000).nullable().optional()
  })
  .strict();

export const aiPatchRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(20000),
  task: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    category: categorySchema.optional(),
    people: z.array(z.string()),
    deadline: z.string().nullable(),
    estimatedMinutes: z.number().nullable().optional(),
    priority: prioritySchema,
    status: statusSchema,
    notes: z.array(
      z.object({
        type: z.string(),
        text: z.string()
      })
    )
  })
});

export const aiCommandPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).nullable().optional(),
    description_replace: z.string().trim().min(1).max(5000).nullable().optional(),
    description_append: z.string().trim().min(1).max(3000).nullable().optional(),
    people_set: peopleSchema.nullable().optional(),
    people_add: peopleSchema.optional(),
    people_remove: peopleSchema.optional(),
    category: categorySchema.nullable().optional(),
    deadline: dateOnlySchema,
    deadline_clear: z.boolean().optional(),
    estimatedMinutes: estimatedMinutesSchema,
    estimatedMinutes_clear: z.boolean().optional(),
    priority: prioritySchema.nullable().optional(),
    status: statusSchema.nullable().optional(),
    note: z.string().trim().max(5000).nullable().optional()
  })
  .strict();

const actionReasonSchema = {
  reason: z.string().trim().max(300).optional()
};

export const aiCommandOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("create_task"),
      task: aiTaskSchema
    })
    .extend(actionReasonSchema),
  z
    .object({
      type: z.literal("update_task"),
      taskId: z.string().trim().min(1),
      patch: aiCommandPatchSchema
    })
    .extend(actionReasonSchema),
  z
    .object({
      type: z.literal("add_note"),
      taskId: z.string().trim().min(1),
      note: z.object({
        type: z.string().trim().min(1).max(80).default("AI voice note"),
        text: z.string().trim().min(1).max(5000)
      })
    })
    .extend(actionReasonSchema),
  z
    .object({
      type: z.literal("add_subtask"),
      taskId: z.string().trim().min(1),
      title: z.string().trim().min(1).max(180)
    })
    .extend(actionReasonSchema),
  z
    .object({
      type: z.literal("update_subtask"),
      taskId: z.string().trim().min(1),
      subtaskId: z.string().trim().min(1),
      title: z.string().trim().min(1).max(180).optional(),
      completed: z.boolean().optional()
    })
    .extend(actionReasonSchema),
  z
    .object({
      type: z.literal("delete_task"),
      taskId: z.string().trim().min(1)
    })
    .extend(actionReasonSchema)
]);

export const aiCommandSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    operations: z.array(aiCommandOperationSchema).max(10).default([]),
    warnings: z.array(z.string().trim().min(1).max(300)).max(5).default([])
  })
  .strict();
