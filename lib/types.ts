export type Priority = "Low" | "Medium" | "High";
export type TaskStatus = "active" | "completed";
export type BoardView = "all" | "active" | "completed";
export type TaskCategory = "work" | "personal";

export type TaskNoteDTO = {
  id: string;
  taskId: string;
  type: string;
  text: string;
  createdBy: string | null;
  createdAt: string;
};

export type TaskEventDTO = {
  id: string;
  taskId: string;
  eventType: string;
  summary: string;
  oldValue: unknown;
  newValue: unknown;
  createdBy: string | null;
  createdAt: string;
};

export type TaskSubtaskDTO = {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskDTO = {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  people: string[];
  deadline: string | null;
  priority: Priority;
  estimatedMinutes: number | null;
  status: TaskStatus;
  color: string;
  notes: TaskNoteDTO[];
  subtasks: TaskSubtaskDTO[];
  events: TaskEventDTO[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type VoicePatch = {
  title?: string | null;
  description_replace?: string | null;
  description_append?: string | null;
  people_add?: string[];
  people_remove?: string[];
  deadline?: string | null;
  priority?: Priority | null;
  category?: TaskCategory | null;
  estimatedMinutes?: number | null;
  status?: TaskStatus | null;
  note?: string | null;
};
