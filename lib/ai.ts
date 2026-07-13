import { GoogleGenAI } from "@google/genai";
import { todayInput } from "@/lib/date";
import type { TaskDTO, VoicePatch } from "@/lib/types";
import { aiCommandSchema, aiPatchSchema, aiTaskSchema } from "@/lib/validation";

function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
  return key;
}

function modelCandidates() {
  return Array.from(
    new Set([
      process.env.GEMINI_MODEL?.trim(),
      "gemini-3.5-flash",
      "gemini-2.5-flash"
    ].filter(Boolean) as string[])
  );
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
  }
  return trimmed;
}

async function generateJson(prompt: string) {
  const genAI = new GoogleGenAI({ apiKey: apiKey() });
  let lastError: unknown;

  for (const modelName of modelCandidates()) {
    try {
      const response = await genAI.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      });
      const text = response.text;
      if (!text) throw new Error(`${modelName} returned an empty response.`);
      return JSON.parse(extractJson(text));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini request failed.");
}

export async function taskFromTranscript(transcript: string) {
  const prompt = `
You convert rough spoken notes into a clean task for a sticky-note task tracker.

Current date: ${todayInput()}.

Return only valid JSON matching this exact shape:
{
  "title": "short task title",
  "description": "clear task description",
  "category": "work | personal",
  "people": ["names or groups mentioned"],
  "deadline": "YYYY-MM-DD or null",
  "estimatedMinutes": "number of minutes expected for completion or null",
  "priority": "Low | Medium | High",
  "status": "active",
  "note": "short summary of the original spoken context"
}

Rules:
- Resolve relative dates, such as Friday or next week, against the current date.
- Use null for deadline if no date is implied.
- Use null for estimatedMinutes if no effort or duration is implied.
- Choose "personal" only for non-work/private/home/life admin tasks; otherwise use "work".
- Keep the title under 12 words.
- Do not invent people who were not mentioned.
- Choose High only when urgency, risk, blockers, or importance are clearly present.

User transcription:
${transcript}
`;

  const json = await generateJson(prompt);
  return aiTaskSchema.parse(json);
}

export async function patchFromTranscript(
  task: Pick<
    TaskDTO,
    "title" | "description" | "category" | "people" | "deadline" | "estimatedMinutes" | "priority" | "status"
  > & {
    notes: Array<{
      type: string;
      text: string;
    }>;
  },
  transcript: string
): Promise<VoicePatch> {
  const prompt = `
You convert a spoken edit instruction into a safe patch for an existing task.

Current date: ${todayInput()}.

Return only valid JSON matching this exact shape:
{
  "title": "new title or null",
  "description_replace": "full replacement description or null",
  "description_append": "text to append to the existing description or null",
  "category": "work | personal or null",
  "people_add": ["people/groups to add"],
  "people_remove": ["people/groups to remove"],
  "deadline": "YYYY-MM-DD or null",
  "estimatedMinutes": "new estimate in minutes or null",
  "priority": "Low | Medium | High or null",
  "status": "active | completed or null",
  "note": "short audit note describing the voice edit"
}

Rules:
- Return only fields that are clearly requested; use null or empty arrays otherwise.
- Do not delete the task.
- Only change category when the user explicitly says it should be work or personal.
- Do not remove people unless the user explicitly asks to remove them.
- Resolve relative dates, such as next Friday, against the current date.
- Only change estimatedMinutes when the user gives an explicit effort estimate.
- Use description_append for extra context unless the user explicitly asks to replace the description.
- Keep note concise and useful as a task note.

Current task:
${JSON.stringify(
  {
    title: task.title,
    description: task.description,
    category: task.category,
    people: task.people,
    deadline: task.deadline,
    estimatedMinutes: task.estimatedMinutes,
    priority: task.priority,
    status: task.status,
    recentNotes: task.notes.slice(0, 5).map((note) => ({
      type: note.type,
      text: note.text
    }))
  },
  null,
  2
)}

User transcription:
${transcript}
`;

  const json = await generateJson(prompt);
  return aiPatchSchema.parse(json);
}

export async function commandFromTranscript(transcript: string, tasks: TaskDTO[]) {
  const taskContext = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    category: task.category,
    people: task.people,
    deadline: task.deadline,
    estimatedMinutes: task.estimatedMinutes,
    priority: task.priority,
    status: task.status,
    notes: task.notes.map((note) => ({
      type: note.type,
      text: note.text,
      createdAt: note.createdAt
    })),
    subtasks: task.subtasks.map((subtask) => ({
      id: subtask.id,
      title: subtask.title,
      completed: subtask.completed
    }))
  }));

  const prompt = `
You convert a spoken general-purpose command into safe structured actions for NoteTasks.

Current date: ${todayInput()}.

Return only valid JSON matching this exact shape:
{
  "summary": "short summary of what you will do",
  "operations": [
    {
      "type": "create_task",
      "task": {
        "title": "short task title",
        "description": "clear task description",
        "category": "work | personal",
        "people": ["names or groups mentioned"],
        "deadline": "YYYY-MM-DD or null",
        "estimatedMinutes": null,
        "priority": "Low | Medium | High",
        "status": "active",
        "note": "short audit note"
      },
      "reason": "why this action matches the transcript"
    },
    {
      "type": "update_task",
      "taskId": "exact existing task id",
      "patch": {
        "title": "new title or null",
        "description_replace": "full replacement description or null",
        "description_append": "extra description text or null",
        "people_set": null,
        "people_add": ["people/groups to add"],
        "people_remove": ["people/groups to remove"],
        "category": "work | personal or null",
        "deadline": "YYYY-MM-DD or null",
        "deadline_clear": false,
        "estimatedMinutes": null,
        "estimatedMinutes_clear": false,
        "priority": "Low | Medium | High or null",
        "status": "active | completed or null",
        "note": "short audit note or null"
      },
      "reason": "why this action matches the transcript"
    },
    {
      "type": "add_note",
      "taskId": "exact existing task id",
      "note": { "type": "AI voice note", "text": "note text" },
      "reason": "why this action matches the transcript"
    },
    {
      "type": "add_subtask",
      "taskId": "exact existing task id",
      "title": "subtask title",
      "reason": "why this action matches the transcript"
    },
    {
      "type": "update_subtask",
      "taskId": "exact existing task id",
      "subtaskId": "exact existing subtask id",
      "title": "new subtask title if requested",
      "completed": true,
      "reason": "why this action matches the transcript"
    },
    {
      "type": "delete_task",
      "taskId": "exact existing task id",
      "reason": "why this explicit delete is safe"
    }
  ],
  "warnings": ["short warning if part of the command was ambiguous or not actioned"]
}

Rules:
- Use exact taskId and subtaskId values from the task context. Never invent ids.
- If the user says close, finish, done, tick off, mark complete, or complete a task, return update_task with status "completed".
- If the user says reopen, bring back, or mark active, return update_task with status "active".
- Do not use delete_task for close, finish, done, archive, complete, or tidy up.
- Only use delete_task when the user explicitly says delete, remove entirely, remove permanently, or get rid of the task itself.
- If the user describes a new task rather than a change to an existing task, create a task.
- Created tasks must have category "work" or "personal"; infer personal only for private/home/life admin tasks, otherwise use work.
- Resolve relative dates, such as tomorrow or next Friday, against the current date.
- Use deadline_clear only when the user asks to remove the deadline/date.
- Use estimatedMinutes_clear only when the user asks to remove the estimate.
- Use people_set only when the user asks to replace the people list; otherwise use people_add and people_remove.
- If a task reference is ambiguous, do not guess. Add a warning and skip that operation.
- Keep operations focused on the user's words. Do not invent extra cleanup actions.
- Return an empty operations array if the transcript does not ask to change anything.

Existing tasks:
${JSON.stringify(taskContext, null, 2)}

User transcription:
${transcript}
`;

  const json = await generateJson(prompt);
  return aiCommandSchema.parse(json);
}
