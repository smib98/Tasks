"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock3,
  ListChecks,
  Loader2,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  Undo2,
  Users,
  X
} from "lucide-react";
import type { BoardView, Priority, TaskDTO, TaskStatus, VoicePatch } from "@/lib/types";
import type { TaskCategory } from "@/lib/types";

type EditorForm = {
  title: string;
  description: string;
  category: TaskCategory;
  people: string;
  deadline: string;
  estimatedMinutes: string;
  priority: Priority;
  status: TaskStatus;
  note: string;
};

type ApiTaskResponse = {
  task: TaskDTO;
};

type RecordingScope = "create" | "edit" | "command";
type VoicePhase = "idle" | "recording" | "transcribing" | "generating" | "done" | "error";
type PriorityFilter = Priority | "all" | "recommended";
type CategoryFilter = TaskCategory | "all";

type VoiceCommandResult = {
  transcript: string;
  summary: string;
  warnings: string[];
  results: Array<{
    type: string;
    status: "applied" | "skipped";
    message: string;
    taskId?: string;
    taskTitle?: string;
  }>;
  tasks: TaskDTO[];
};

const noteColors: Record<string, string> = {
  yellow: "#fff3b8",
  pink: "#ffd9e2",
  blue: "#dff0ff",
  green: "#dff7e7",
  lavender: "#ece6ff",
  peach: "#ffe6d6"
};

const emptyForm: EditorForm = {
  title: "",
  description: "",
  category: "work",
  people: "",
  deadline: "",
  estimatedMinutes: "",
  priority: "Medium",
  status: "active",
  note: ""
};

function splitPeople(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((person) => person.trim())
        .filter(Boolean)
    )
  );
}

function formatDate(dateString: string | null) {
  if (!dateString) return "No deadline";
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function todayInput() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysInput(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dueLabel(dateString: string | null) {
  if (!dateString) return "No deadline";
  const today = todayInput();
  if (dateString < today) return "Overdue";
  if (dateString === today) return "Due today";
  return `Due ${formatDate(dateString)}`;
}

function priorityRank(priority: Priority) {
  if (priority === "High") return 1;
  if (priority === "Medium") return 2;
  return 3;
}

function formatEstimate(minutes: number | null) {
  if (!minutes) return "No estimate";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
}

function parseEstimate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const minutes = Number(trimmed);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null;
}

function daysUntil(dateString: string | null) {
  if (!dateString) return 30;
  const today = new Date(`${todayInput()}T00:00:00`);
  const due = new Date(`${dateString}T00:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function recommendedScore(task: TaskDTO) {
  const priorityScore = task.priority === "High" ? 90 : task.priority === "Medium" ? 50 : 20;
  const days = daysUntil(task.deadline);
  const dueScore = days < 0 ? 80 : days === 0 ? 70 : days <= 2 ? 50 : days <= 7 ? 25 : 0;
  const estimate = task.estimatedMinutes ?? 120;
  const effortScore = estimate <= 15 ? 20 : estimate <= 30 ? 16 : estimate <= 60 ? 12 : estimate <= 120 ? 7 : 2;
  const subtaskPenalty = task.subtasks.filter((subtask) => !subtask.completed).length * 2;
  return priorityScore + dueScore + effortScore - subtaskPenalty;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload as T;
}

function applyPatchPreview(task: TaskDTO, patch: VoicePatch) {
  const removeSet = new Set((patch.people_remove ?? []).map((person) => person.toLowerCase()));
  const existing = task.people.filter((person) => !removeSet.has(person.toLowerCase()));
  const people = Array.from(
    new Set([...existing, ...(patch.people_add ?? [])].map((person) => person.trim()).filter(Boolean))
  );

  let description = task.description;
  if (patch.description_replace) {
    description = patch.description_replace;
  } else if (patch.description_append) {
    description = `${description}\n\n${patch.description_append}`;
  }

  return {
    title: patch.title ?? task.title,
    description,
    category: patch.category ?? task.category,
    people,
    deadline: patch.deadline ?? task.deadline,
    estimatedMinutes: patch.estimatedMinutes ?? task.estimatedMinutes,
    priority: patch.priority ?? task.priority,
    status: patch.status ?? task.status
  };
}

function hasPatchChanges(patch: VoicePatch) {
  return Boolean(
    patch.title ||
      patch.description_replace ||
      patch.description_append ||
      patch.category ||
      patch.deadline ||
      patch.estimatedMinutes ||
      patch.priority ||
      patch.status ||
      patch.people_add?.length ||
      patch.people_remove?.length ||
      patch.note
  );
}

function supportedMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

export function NoteTasksApp() {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [view, setView] = useState<BoardView>("all");
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditorForm>(emptyForm);
  const [toast, setToast] = useState("");
  const [voiceScope, setVoiceScope] = useState<RecordingScope | null>(null);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [voiceMessage, setVoiceMessage] = useState("Voice mode ready.");
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [voicePatch, setVoicePatch] = useState<VoicePatch | null>(null);
  const [voiceCommandOpen, setVoiceCommandOpen] = useState(false);
  const [voiceCommandResult, setVoiceCommandResult] = useState<VoiceCommandResult | null>(null);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const [quickNote, setQuickNote] = useState("");
  const [newSubtask, setNewSubtask] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2600);
  }, []);

  const refreshTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const payload = await apiJson<{ tasks: TaskDTO[] }>("/api/tasks");
      setTasks(payload.tasks);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not load tasks.");
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedId) ?? null,
    [selectedId, tasks]
  );

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks
      .filter((task) => {
        const matchesView = view === "all" || task.status === view;
        const matchesCategory = categoryFilter === "all" || task.category === categoryFilter;
        const matchesPriority =
          priority === "all" || (priority === "recommended" ? task.status === "active" : task.priority === priority);
        const searchBlob = [
          task.title,
          task.description,
          task.people.join(" "),
          task.subtasks.map((subtask) => subtask.title).join(" "),
          task.notes.map((note) => note.text).join(" ")
        ]
          .join(" ")
          .toLowerCase();
        return matchesView && matchesCategory && matchesPriority && (!query || searchBlob.includes(query));
      })
      .sort((a, b) => {
        if (priority === "recommended") return recommendedScore(b) - recommendedScore(a);
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
        if (a.priority !== b.priority) return priorityRank(a.priority) - priorityRank(b.priority);
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [categoryFilter, priority, search, tasks, view]);

  const counts = useMemo(() => {
    const today = todayInput();
    const soon = addDaysInput(3);
    return {
      all: tasks.length,
      active: tasks.filter((task) => task.status === "active").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      dueSoon: tasks.filter(
        (task) => task.status === "active" && task.deadline && task.deadline >= today && task.deadline <= soon
      ).length
    };
  }, [tasks]);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    setVoicePatch(null);
    setVoiceTranscript(null);
    setQuickNoteOpen(false);
    setQuickNote("");
    setNewSubtask("");
  }, [selectedId]);

  function upsertTask(task: TaskDTO) {
    setTasks((current) => {
      const exists = current.some((item) => item.id === task.id);
      if (!exists) return [task, ...current];
      return current.map((item) => (item.id === task.id ? task : item));
    });
  }

  function removeTask(id: string) {
    setTasks((current) => current.filter((task) => task.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function updateForm<K extends keyof EditorForm>(key: K, value: EditorForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function openCreateEditor() {
    setEditingId(null);
    setForm(emptyForm);
    setVoiceCommandOpen(false);
    setVoicePhase("idle");
    setVoiceMessage("Voice mode ready.");
    setVoiceTranscript(null);
    setEditorOpen(true);
  }

  function openEditEditor(task: TaskDTO) {
    setEditingId(task.id);
    setVoiceCommandOpen(false);
    setForm({
      title: task.title,
      description: task.description,
      category: task.category,
      people: task.people.join(", "),
      deadline: task.deadline ?? "",
      estimatedMinutes: task.estimatedMinutes ? String(task.estimatedMinutes) : "",
      priority: task.priority,
      status: task.status,
      note: ""
    });
    setVoicePhase("idle");
    setVoiceMessage("Voice mode ready.");
    setVoiceTranscript(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    if (isSaving || voicePhase === "recording" || voicePhase === "transcribing" || voicePhase === "generating") return;
    setEditorOpen(false);
    setEditingId(null);
  }

  async function saveEditor() {
    if (!form.title.trim()) {
      showToast("Add a title first.");
      return;
    }
    if (!form.description.trim()) {
      showToast("Add a description.");
      return;
    }

    setIsSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        people: splitPeople(form.people),
        deadline: form.deadline || null,
        estimatedMinutes: parseEstimate(form.estimatedMinutes),
        priority: form.priority,
        status: form.status,
        note: form.note.trim() || null,
        noteType: editingId ? "Manual edit note" : "Manual note"
      };

      const payload = editingId
        ? await apiJson<ApiTaskResponse>(`/api/tasks/${editingId}`, {
            method: "PATCH",
            body: JSON.stringify(body)
          })
        : await apiJson<ApiTaskResponse>("/api/tasks", {
            method: "POST",
            body: JSON.stringify(body)
          });

      upsertTask(payload.task);
      setSelectedId(payload.task.id);
      setEditorOpen(false);
      setEditingId(null);
      showToast(editingId ? "Note updated." : "New note created.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not save note.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteCurrentTask() {
    if (!editingId) return;
    await deleteTaskById(editingId);
  }

  async function deleteTaskById(id: string) {
    const ok = window.confirm("Delete this task permanently?");
    if (!ok) return;

    setIsSaving(true);
    try {
      await apiJson<{ ok: true }>(`/api/tasks/${id}`, {
        method: "DELETE"
      });
      removeTask(id);
      setEditorOpen(false);
      if (editingId === id) setEditingId(null);
      showToast("Task deleted.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not delete task.");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleStatus(task: TaskDTO) {
    const nextStatus: TaskStatus = task.status === "completed" ? "active" : "completed";
    try {
      const payload = await apiJson<ApiTaskResponse>(`/api/tasks/${task.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: nextStatus })
      });
      upsertTask(payload.task);
      showToast(nextStatus === "completed" ? "Task completed." : "Task reopened.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not update status.");
    }
  }

  async function addQuickNote() {
    if (!selectedTask || !quickNote.trim()) return;
    setIsSaving(true);
    try {
      const payload = await apiJson<ApiTaskResponse>(`/api/tasks/${selectedTask.id}/notes`, {
        method: "POST",
        body: JSON.stringify({
          type: "Quick note",
          text: quickNote.trim()
        })
      });
      upsertTask(payload.task);
      setQuickNote("");
      setQuickNoteOpen(false);
      showToast("Quick note attached.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not add note.");
    } finally {
      setIsSaving(false);
    }
  }

  async function addSubtask() {
    if (!selectedTask || !newSubtask.trim()) return;
    setIsSaving(true);
    try {
      const payload = await apiJson<ApiTaskResponse>(`/api/tasks/${selectedTask.id}/subtasks`, {
        method: "POST",
        body: JSON.stringify({
          title: newSubtask.trim()
        })
      });
      upsertTask(payload.task);
      setNewSubtask("");
      showToast("Subtask added.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not add subtask.");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleSubtask(subtaskId: string, completed: boolean) {
    if (!selectedTask) return;
    try {
      const payload = await apiJson<ApiTaskResponse>(`/api/tasks/${selectedTask.id}/subtasks/${subtaskId}`, {
        method: "PATCH",
        body: JSON.stringify({
          completed
        })
      });
      upsertTask(payload.task);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not update subtask.");
    }
  }

  async function deleteSubtask(subtaskId: string) {
    if (!selectedTask) return;
    try {
      const payload = await apiJson<ApiTaskResponse>(`/api/tasks/${selectedTask.id}/subtasks/${subtaskId}`, {
        method: "DELETE"
      });
      upsertTask(payload.task);
      showToast("Subtask removed.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not remove subtask.");
    }
  }

  async function startRecording(scope: RecordingScope) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showToast("This browser cannot record microphone audio.");
      return;
    }

    try {
      setVoicePatch(null);
      setVoiceTranscript(null);
      if (scope === "command") {
        setVoiceCommandOpen(true);
        setVoiceCommandResult(null);
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeType || "audio/webm"
        });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        void processRecording(scope, blob);
      };

      recorder.start();
      setVoiceScope(scope);
      setVoicePhase("recording");
      setVoiceMessage(
        scope === "create"
          ? "Recording new task..."
          : scope === "edit"
            ? "Recording edit instruction..."
            : "Recording voice command..."
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Microphone access failed.");
      setVoicePhase("error");
      setVoiceMessage("Microphone access failed.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      setVoicePhase("transcribing");
      setVoiceMessage("Transcribing with local Whisper...");
      recorderRef.current.stop();
    }
  }

  async function toggleRecording(scope: RecordingScope) {
    if (voicePhase === "recording" && voiceScope === scope) {
      stopRecording();
      return;
    }
    if (voicePhase === "recording" || voicePhase === "transcribing" || voicePhase === "generating") {
      showToast("Finish the current voice action first.");
      return;
    }
    await startRecording(scope);
  }

  async function transcribeBlob(blob: Blob) {
    const formData = new FormData();
    const extension = blob.type.includes("mp4") ? "mp4" : "webm";
    formData.append("audio", blob, `recording.${extension}`);
    return apiJson<{
      transcript: string;
      language: string | null;
      languageProbability: number | null;
      duration: number | null;
    }>("/api/voice/transcribe", {
      method: "POST",
      body: formData
    });
  }

  async function processRecording(scope: RecordingScope, blob: Blob) {
    try {
      if (blob.size < 600) {
        throw new Error("The recording was too short.");
      }

      setVoiceScope(scope);
      setVoicePhase("transcribing");
      setVoiceMessage("Transcribing with local Whisper...");
      const transcription = await transcribeBlob(blob);
      setVoiceTranscript(transcription.transcript);

      setVoicePhase("generating");
      setVoiceMessage(
        scope === "create"
          ? "Structuring the task with Gemini..."
          : scope === "edit"
            ? "Building a safe edit preview..."
            : "Asking Gemini to action this command..."
      );

      if (scope === "command") {
        const payload = await apiJson<VoiceCommandResult>("/api/ai/action-from-transcript", {
          method: "POST",
          body: JSON.stringify({
            transcript: transcription.transcript
          })
        });

        setTasks(payload.tasks);
        if (selectedId && !payload.tasks.some((task) => task.id === selectedId)) {
          setSelectedId(null);
        }
        setVoiceCommandResult(payload);
        setVoiceCommandOpen(true);
        setVoicePhase("done");
        setVoiceMessage(payload.summary || "Voice command complete.");
        const applied = payload.results.filter((result) => result.status === "applied").length;
        showToast(applied ? `${applied} voice action${applied === 1 ? "" : "s"} applied.` : "Voice command reviewed.");
      } else if (scope === "create") {
        const payload = await apiJson<{
          task: {
            title: string;
            description: string;
            category: TaskCategory;
            people: string[];
            deadline: string | null;
            estimatedMinutes?: number | null;
            priority: Priority;
            status: TaskStatus;
            note?: string | null;
          };
        }>("/api/ai/create-task-from-transcript", {
          method: "POST",
          body: JSON.stringify({
            transcript: transcription.transcript
          })
        });

        setForm((current) => ({
          ...current,
          title: payload.task.title,
          description: payload.task.description,
          category: payload.task.category,
          people: payload.task.people.join(", "),
          deadline: payload.task.deadline ?? "",
          estimatedMinutes: payload.task.estimatedMinutes ? String(payload.task.estimatedMinutes) : "",
          priority: payload.task.priority,
          status: payload.task.status,
          note: payload.task.note ? `AI voice summary: ${payload.task.note}` : current.note
        }));
        setVoicePhase("done");
        setVoiceMessage("Voice task is ready to review and save.");
        showToast("Voice converted into task fields.");
      } else {
        const task = selectedTask;
        if (!task) throw new Error("Open a task before using voice edit.");
        const payload = await apiJson<{ patch: VoicePatch }>("/api/ai/patch-task-from-transcript", {
          method: "POST",
          body: JSON.stringify({
            transcript: transcription.transcript,
            task
          })
        });

        setVoicePatch(payload.patch);
        setVoicePhase("done");
        setVoiceMessage("Voice edit is ready for review.");
        showToast("Voice edit preview ready.");
      }
    } catch (error) {
      if (scope === "command") {
        const message = error instanceof Error ? error.message : "Voice command failed.";
        setVoiceCommandOpen(true);
        setVoiceCommandResult({
          transcript: voiceTranscript ?? "",
          summary: message,
          warnings: [message],
          results: [],
          tasks
        });
      }
      setVoicePhase("error");
      setVoiceMessage(error instanceof Error ? error.message : "Voice processing failed.");
      showToast(error instanceof Error ? error.message : "Voice processing failed.");
    } finally {
      setVoiceScope(null);
    }
  }

  async function applyVoicePatch() {
    if (!selectedTask || !voicePatch || !hasPatchChanges(voicePatch)) return;
    const preview = applyPatchPreview(selectedTask, voicePatch);
    setIsSaving(true);
    try {
      const payload = await apiJson<ApiTaskResponse>(`/api/tasks/${selectedTask.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...preview,
          note: voicePatch.note || "Voice edit applied.",
          noteType: "AI voice edit"
        })
      });
      upsertTask(payload.task);
      setVoicePatch(null);
      setVoiceTranscript(null);
      setVoiceMessage("Voice mode ready.");
      setVoicePhase("idle");
      showToast("Voice edit applied.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not apply voice edit.");
    } finally {
      setIsSaving(false);
    }
  }

  const isBusyVoice = voicePhase === "transcribing" || voicePhase === "generating";
  const commandRecording = voicePhase === "recording" && voiceScope === "command";
  const commandProcessing = isBusyVoice && voiceScope === "command";

  return (
    <main className="min-h-dvh bg-[#f5f6f8] pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-[#18212f] sm:min-h-screen sm:pb-0">
      <div className="mx-auto max-w-[1500px] px-3 py-3 sm:px-7 sm:py-7">
        <header className="sticky top-0 z-20 -mx-3 mb-4 flex flex-col gap-3 border-b border-black/10 bg-[#f5f6f8]/95 px-3 py-3 backdrop-blur lg:static lg:mx-0 lg:mb-6 lg:flex-row lg:items-center lg:justify-between lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-0">
          <button
            type="button"
            onClick={() => setView("all")}
            className="flex w-fit max-w-full items-center gap-3 text-left"
            aria-label="Show all notes"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#111827] text-white shadow-panel sm:h-12 sm:w-12">
              <StickyNote className="h-5 w-5 sm:h-6 sm:w-6" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-2xl font-black leading-none sm:text-3xl">NoteTasks</span>
              <span className="mt-1 hidden text-sm font-medium text-[#697586] sm:block">
                Sticky-note task tracking with AI assisted voice capture
              </span>
            </span>
          </button>

          <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
            <button
              type="button"
              onClick={() => void toggleRecording("command")}
              disabled={commandProcessing || (voicePhase === "recording" && voiceScope !== "command")}
              className={clsx(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-extrabold shadow-panel transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70",
                commandRecording
                  ? "border-[#f5b7b1] bg-[#fff5f5] text-[#b42318]"
                  : "border-black/10 bg-white/80 text-[#18212f] hover:bg-white"
              )}
            >
              {commandRecording ? (
                <Square className="h-4 w-4" />
              ) : commandProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              {commandRecording ? "Stop command" : commandProcessing ? "Working..." : "Voice command"}
            </button>
            <ViewButton active={view === "all"} onClick={() => setView("all")}>
              View all notes
            </ViewButton>
            <ViewButton active={view === "active"} onClick={() => setView("active")}>
              Active only
            </ViewButton>
            <ViewButton active={view === "completed"} onClick={() => setView("completed")}>
              Completed
            </ViewButton>
            <button
              type="button"
              onClick={openCreateEditor}
              className="hidden min-h-11 items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-sm font-extrabold text-white shadow-[0_12px_24px_rgba(17,24,39,0.18)] transition hover:-translate-y-0.5 sm:inline-flex"
            >
              <Plus className="h-4 w-4" />
              Create new note
            </button>
          </div>
        </header>

        {voiceCommandOpen ? (
          <VoiceCommandPanel
            phase={voicePhase}
            message={voiceMessage}
            transcript={voiceTranscript}
            result={voiceCommandResult}
            onClose={() => {
              setVoiceCommandOpen(false);
              setVoiceCommandResult(null);
            }}
          />
        ) : null}

        <section className="mb-4 grid gap-3 sm:mb-6">
          <div className="rounded-2xl border border-black/10 bg-white/80 p-3 shadow-panel">
            <div className="grid gap-3 xl:grid-cols-[minmax(280px,1fr)_auto_auto] xl:items-center">
              <label className="relative min-w-0">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#697586]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-12 w-full rounded-xl border border-black/10 bg-white px-11 text-sm font-semibold outline-none transition focus:border-[#111827]"
                  placeholder="Search title, description, people or notes..."
                />
              </label>
              <div className="scrollbar-none flex min-w-0 items-center gap-1.5 overflow-x-auto rounded-xl border border-black/5 bg-[#f8fafc] p-1.5 sm:flex-wrap sm:overflow-visible">
                <FilterPill active={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>
                  All types
                </FilterPill>
                <FilterPill active={categoryFilter === "work"} onClick={() => setCategoryFilter("work")}>
                  Work
                </FilterPill>
                <FilterPill active={categoryFilter === "personal"} onClick={() => setCategoryFilter("personal")}>
                  Personal
                </FilterPill>
              </div>
              <div className="scrollbar-none flex min-w-0 items-center gap-1.5 overflow-x-auto rounded-xl border border-black/5 bg-[#f8fafc] p-1.5 sm:flex-wrap sm:overflow-visible">
                <FilterPill active={priority === "all"} onClick={() => setPriority("all")}>
                  All
                </FilterPill>
                <FilterPill active={priority === "recommended"} onClick={() => setPriority("recommended")}>
                  Recommended
                </FilterPill>
                {(["High", "Medium", "Low"] as const).map((item) => (
                  <FilterPill key={item} active={priority === item} onClick={() => setPriority(item)}>
                    {item}
                  </FilterPill>
                ))}
              </div>
            </div>
          </div>
          <div className="hidden gap-3 sm:grid sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="All notes" value={counts.all} />
            <Stat label="Active" value={counts.active} />
            <Stat label="Completed" value={counts.completed} />
            <Stat label="Due soon" value={counts.dueSoon} />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          {isLoading ? (
            <div className="col-span-full flex min-h-56 items-center justify-center rounded-2xl border border-black/10 bg-white/80 shadow-panel">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading notes
            </div>
          ) : filteredTasks.length ? (
            filteredTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => setSelectedId(task.id)}
                onStatusToggle={() => void toggleStatus(task)}
              />
            ))
          ) : (
            <div className="col-span-full rounded-2xl border border-black/10 bg-white/80 px-5 py-16 text-center text-sm font-semibold text-[#697586] shadow-panel">
              No notes match this view yet.
            </div>
          )}
        </section>
      </div>

      {selectedTask ? (
        <TaskDetail
          task={selectedTask}
          onClose={() => setSelectedId(null)}
          onEdit={() => openEditEditor(selectedTask)}
          onStatus={() => void toggleStatus(selectedTask)}
          onDelete={() => void deleteTaskById(selectedTask.id)}
          onVoice={() => void toggleRecording("edit")}
          voicePhase={voicePhase}
          voiceScope={voiceScope}
          voiceMessage={voiceMessage}
          voiceTranscript={voiceTranscript}
          voicePatch={voicePatch}
          quickNoteOpen={quickNoteOpen}
          quickNote={quickNote}
          newSubtask={newSubtask}
          onQuickNoteChange={setQuickNote}
          onNewSubtaskChange={setNewSubtask}
          onQuickNoteOpen={() => setQuickNoteOpen(true)}
          onQuickNoteCancel={() => {
            setQuickNoteOpen(false);
            setQuickNote("");
          }}
          onQuickNoteSave={() => void addQuickNote()}
          onSubtaskAdd={() => void addSubtask()}
          onSubtaskToggle={(subtaskId, completed) => void toggleSubtask(subtaskId, completed)}
          onSubtaskDelete={(subtaskId) => void deleteSubtask(subtaskId)}
          onApplyVoicePatch={() => void applyVoicePatch()}
          onDiscardVoicePatch={() => {
            setVoicePatch(null);
            setVoiceTranscript(null);
            setVoicePhase("idle");
            setVoiceMessage("Voice mode ready.");
          }}
          isSaving={isSaving}
        />
      ) : null}

      {editorOpen ? (
        <EditorModal
          form={form}
          editing={Boolean(editingId)}
          isSaving={isSaving}
          voicePhase={voicePhase}
          voiceScope={voiceScope}
          voiceMessage={voiceMessage}
          voiceTranscript={voiceTranscript}
          isBusyVoice={isBusyVoice}
          onChange={updateForm}
          onClose={closeEditor}
          onSave={() => void saveEditor()}
          onDelete={() => void deleteCurrentTask()}
          onVoice={() => void toggleRecording("create")}
        />
      ) : null}

      {!selectedTask && !editorOpen ? (
        <button
          type="button"
          onClick={openCreateEditor}
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-[#111827] text-white shadow-[0_18px_36px_rgba(17,24,39,0.28)] transition active:scale-95 sm:hidden"
          aria-label="Create new note"
          title="Create new note"
        >
          <Plus className="h-6 w-6" />
        </button>
      ) : null}

      <div
        className={clsx(
          "fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full bg-[#111827] px-5 py-3 text-sm font-bold text-white shadow-2xl transition sm:bottom-5",
          toast ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-10 opacity-0"
        )}
      >
        {toast}
      </div>
    </main>
  );
}

function ViewButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-extrabold shadow-panel transition hover:-translate-y-0.5",
        active
          ? "border-[#111827] bg-[#111827] text-white"
          : "border-black/10 bg-white/80 text-[#18212f] hover:bg-white"
      )}
    >
      {children}
    </button>
  );
}

function FilterPill({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "min-h-10 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-black transition",
        active ? "border-[#111827] bg-[#111827] text-white" : "border-black/10 bg-white text-[#697586]"
      )}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-panel">
      <span className="block text-xs font-bold text-[#697586]">{label}</span>
      <strong className="mt-1 block text-3xl font-black leading-none">{value}</strong>
    </div>
  );
}

function TaskCard({
  task,
  onClick,
  onStatusToggle
}: {
  task: TaskDTO;
  onClick: () => void;
  onStatusToggle: () => void;
}) {
  const people = task.people.slice(0, 2);
  const extraPeople = task.people.length - people.length;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      style={{ backgroundColor: noteColors[task.color] ?? noteColors.yellow }}
      className={clsx(
        "group flex min-h-[218px] w-full cursor-pointer flex-col overflow-hidden rounded-[24px] border border-black/10 p-4 text-left shadow-note outline-none transition hover:-translate-y-1 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-[#111827] sm:min-h-[260px] sm:rounded-[28px] sm:p-5",
        task.status === "completed" && "opacity-75"
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-black/10 bg-white/45 px-3 text-xs font-black">
            {task.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
            {task.status === "completed" ? "Completed" : task.priority}
          </span>
          <span className="inline-flex min-h-8 items-center rounded-full border border-black/10 bg-white/45 px-3 text-xs font-black">
            {task.category === "work" ? "Work" : "Personal"}
          </span>
          <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-black/10 bg-white/45 px-3 text-xs font-black">
            <CalendarDays className="h-3.5 w-3.5" />
            {dueLabel(task.deadline)}
          </span>
        </div>
        <button
          type="button"
          aria-label={task.status === "completed" ? "Reopen task" : "Complete task"}
          title={task.status === "completed" ? "Reopen task" : "Complete task"}
          onClick={(event) => {
            event.stopPropagation();
            onStatusToggle();
          }}
          className={clsx(
            "grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-black/10 shadow-sm transition hover:scale-105",
            task.status === "completed" ? "bg-[#111827] text-white" : "bg-white/70 text-[#18212f]"
          )}
        >
          <CheckCircle2 className="h-5 w-5" />
        </button>
      </div>
      <h2
        className={clsx(
          "mb-3 break-words text-xl font-black leading-tight sm:text-2xl",
          task.status === "completed" && "line-through decoration-2"
        )}
      >
        {task.title}
      </h2>
      <p className="line-clamp-4 flex-1 text-sm font-medium leading-6 text-[#18212f]/75 sm:line-clamp-5">{task.description}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {task.estimatedMinutes ? (
          <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-black/10 bg-white/45 px-3 text-xs font-bold">
            <Clock3 className="h-3.5 w-3.5" />
            {formatEstimate(task.estimatedMinutes)}
          </span>
        ) : null}
        {task.subtasks.length ? (
          <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-black/10 bg-white/45 px-3 text-xs font-bold">
            <ListChecks className="h-3.5 w-3.5" />
            {task.subtasks.filter((subtask) => subtask.completed).length}/{task.subtasks.length}
          </span>
        ) : null}
        {people.map((person) => (
          <span
            key={person}
            className="inline-flex min-h-8 items-center gap-1 rounded-full border border-black/10 bg-white/45 px-3 text-xs font-bold"
          >
            <Users className="h-3.5 w-3.5" />
            {person}
          </span>
        ))}
        {extraPeople > 0 ? (
          <span className="inline-flex min-h-8 items-center rounded-full border border-black/10 bg-white/45 px-3 text-xs font-bold">
            +{extraPeople} more
          </span>
        ) : null}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 text-sm font-bold text-[#18212f]/70">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-4 w-4" />
          {task.notes.length} note{task.notes.length === 1 ? "" : "s"}
        </span>
        <span>{task.status === "completed" ? "Done" : "Open task"}</span>
      </div>
    </article>
  );
}

function TaskDetail({
  task,
  onClose,
  onEdit,
  onStatus,
  onDelete,
  onVoice,
  voicePhase,
  voiceScope,
  voiceMessage,
  voiceTranscript,
  voicePatch,
  quickNoteOpen,
  quickNote,
  newSubtask,
  onQuickNoteChange,
  onNewSubtaskChange,
  onQuickNoteOpen,
  onQuickNoteCancel,
  onQuickNoteSave,
  onSubtaskAdd,
  onSubtaskToggle,
  onSubtaskDelete,
  onApplyVoicePatch,
  onDiscardVoicePatch,
  isSaving
}: {
  task: TaskDTO;
  onClose: () => void;
  onEdit: () => void;
  onStatus: () => void;
  onDelete: () => void;
  onVoice: () => void;
  voicePhase: VoicePhase;
  voiceScope: RecordingScope | null;
  voiceMessage: string;
  voiceTranscript: string | null;
  voicePatch: VoicePatch | null;
  quickNoteOpen: boolean;
  quickNote: string;
  newSubtask: string;
  onQuickNoteChange: (value: string) => void;
  onNewSubtaskChange: (value: string) => void;
  onQuickNoteOpen: () => void;
  onQuickNoteCancel: () => void;
  onQuickNoteSave: () => void;
  onSubtaskAdd: () => void;
  onSubtaskToggle: (subtaskId: string, completed: boolean) => void;
  onSubtaskDelete: (subtaskId: string) => void;
  onApplyVoicePatch: () => void;
  onDiscardVoicePatch: () => void;
  isSaving: boolean;
}) {
  const preview = voicePatch ? applyPatchPreview(task, voicePatch) : null;
  const editRecording = voicePhase === "recording" && voiceScope === "edit";
  const editProcessing = (voicePhase === "transcribing" || voicePhase === "generating") && voiceScope === "edit";

  return (
    <div className="fixed inset-0 z-30 flex items-stretch justify-stretch bg-[#101828]/40 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
      <section
        className="h-dvh w-full overflow-auto rounded-none bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:max-w-5xl sm:rounded-[30px] sm:border sm:border-black/10"
        role="dialog"
        aria-modal="true"
      >
        <div className="min-h-full p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:min-h-0 sm:p-6">
          <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 flex items-start justify-between gap-3 border-b border-black/10 bg-white/95 p-4 backdrop-blur sm:static sm:mx-0 sm:mt-0 sm:mb-5 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-0">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h1 className="max-w-full break-words text-2xl font-black leading-tight sm:text-5xl sm:leading-none">{task.title}</h1>
                <IconButton label="Edit" onClick={onEdit}>
                  <Pencil className="h-4 w-4" />
                </IconButton>
                <button
                  type="button"
                  onClick={onVoice}
                  disabled={editProcessing}
                  className={clsx(
                    "inline-flex min-h-10 items-center gap-2 rounded-xl border border-black/10 px-3 text-sm font-black transition",
                    editRecording ? "bg-[#fff5f5] text-[#b42318]" : "bg-[#f3f4f6] text-[#18212f]",
                    editProcessing && "cursor-wait opacity-70"
                  )}
                >
                  {editRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {editRecording ? "Stop voice edit" : "Voice edit"}
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isSaving}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#f5b7b1] bg-[#fff5f5] px-3 text-sm font-black text-[#b42318] transition disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
              {(editRecording || editProcessing || voicePatch) && voiceScope !== "create" ? (
                <VoiceStatus phase={voicePhase} message={voiceMessage} transcript={voiceTranscript} />
              ) : null}
            </div>
            <IconButton label="Close" onClick={onClose}>
              <X className="h-5 w-5" />
            </IconButton>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-black/10 bg-[#fbfbfc] p-4">
              <SectionTitle>Description</SectionTitle>
              <p className="whitespace-pre-wrap break-words text-base font-medium leading-7 text-[#18212f]/85">
                {task.description}
              </p>

              <div className="mt-5 grid gap-2 sm:flex sm:flex-wrap">
                <button
                  type="button"
                  onClick={onStatus}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-3 text-sm font-black transition hover:bg-[#f3f4f6]"
                >
                  {task.status === "completed" ? <RefreshCcw className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
                  {task.status === "completed" ? "Mark active" : "Complete task"}
                </button>
                <button
                  type="button"
                  onClick={onQuickNoteOpen}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-3 text-sm font-black transition hover:bg-[#f3f4f6]"
                >
                  <Plus className="h-4 w-4" />
                  Add quick note
                </button>
              </div>

              {quickNoteOpen ? (
                <div className="mt-4 rounded-2xl border border-black/10 bg-white p-3">
                  <textarea
                    value={quickNote}
                    onChange={(event) => onQuickNoteChange(event.target.value)}
                    className="min-h-24 w-full resize-y rounded-xl border border-black/10 bg-[#fafafb] p-3 text-sm font-medium outline-none focus:border-[#111827]"
                    placeholder="Type a quick note..."
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" onClick={onQuickNoteCancel} className="rounded-xl px-3 py-2 text-sm font-black">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={onQuickNoteSave}
                      disabled={isSaving || !quickNote.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#111827] px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      Save note
                    </button>
                  </div>
                </div>
              ) : null}

              {voicePatch && preview ? (
                <VoicePatchPreview
                  task={task}
                  preview={preview}
                  patch={voicePatch}
                  onApply={onApplyVoicePatch}
                  onDiscard={onDiscardVoicePatch}
                  isSaving={isSaving}
                />
              ) : null}

              <div className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <SectionTitle>Subtasks</SectionTitle>
                  {task.subtasks.length ? (
                    <span className="text-xs font-black text-[#697586]">
                      {task.subtasks.filter((subtask) => subtask.completed).length}/{task.subtasks.length} done
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 rounded-2xl border border-black/10 bg-white p-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={newSubtask}
                      onChange={(event) => onNewSubtaskChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onSubtaskAdd();
                        }
                      }}
                      className="field-input min-h-11 flex-1"
                      placeholder="Add a smaller step..."
                    />
                    <button
                      type="button"
                      onClick={onSubtaskAdd}
                      disabled={isSaving || !newSubtask.trim()}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#111827] px-3 text-sm font-black text-white disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2">
                    {task.subtasks.length ? (
                      task.subtasks.map((subtask) => (
                        <div
                          key={subtask.id}
                          className="flex items-center gap-3 rounded-xl border border-black/10 bg-[#f8fafc] p-3"
                        >
                          <button
                            type="button"
                            onClick={() => onSubtaskToggle(subtask.id, !subtask.completed)}
                            className={clsx(
                              "grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-sm font-black",
                              subtask.completed
                                ? "border-[#111827] bg-[#111827] text-white"
                                : "border-black/15 bg-white text-[#697586]"
                            )}
                            aria-label={subtask.completed ? "Reopen subtask" : "Complete subtask"}
                          >
                            {subtask.completed ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                          </button>
                          <span
                            className={clsx(
                              "min-w-0 flex-1 break-words text-sm font-bold",
                              subtask.completed && "text-[#697586] line-through"
                            )}
                          >
                            {subtask.title}
                          </span>
                          <IconButton label="Delete subtask" onClick={() => onSubtaskDelete(subtask.id)}>
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl bg-[#f8fafc] p-3 text-sm font-semibold text-[#697586]">
                        No subtasks yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <SectionTitle>Notes</SectionTitle>
                <div className="mt-3 grid gap-3">
                  {task.notes.length ? (
                    task.notes.map((note) => (
                      <article key={note.id} className="rounded-2xl border border-black/10 bg-white p-4">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <strong className="text-sm font-black">{note.type}</strong>
                          <span className="text-xs font-bold text-[#697586]">{formatDate(note.createdAt.slice(0, 10))}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm font-medium leading-6 text-[#18212f]/75">
                          {note.text}
                        </p>
                      </article>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-black/10 bg-white p-4 text-sm font-semibold text-[#697586]">
                      No attached notes yet.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <aside className="rounded-2xl border border-black/10 bg-[#fbfbfc] p-4">
              <SectionTitle>Task details</SectionTitle>
              <div className="mt-2 divide-y divide-black/10">
                <DetailRow label="Status" value={task.status === "completed" ? "Completed" : "Active"} />
                <DetailRow label="Category" value={task.category === "work" ? "Work" : "Personal"} />
                <DetailRow label="Priority" value={task.priority} />
                <DetailRow label="Estimate" value={formatEstimate(task.estimatedMinutes)} />
                <DetailRow label="Deadline" value={formatDate(task.deadline)} />
                <DetailRow label="People" value={task.people.join(", ") || "None assigned"} />
                <DetailRow
                  label="Subtasks"
                  value={
                    task.subtasks.length
                      ? `${task.subtasks.filter((subtask) => subtask.completed).length}/${task.subtasks.length}`
                      : "None"
                  }
                />
                <DetailRow label="Notes" value={String(task.notes.length)} />
                <DetailRow label="Updated" value={formatDate(task.updatedAt.slice(0, 10))} />
              </div>

              <div className="mt-6">
                <SectionTitle>Timeline</SectionTitle>
                <div className="mt-3 grid gap-2">
                  {task.events.length ? (
                    task.events.slice(0, 8).map((event) => (
                      <div key={event.id} className="rounded-xl border border-black/10 bg-white p-3">
                        <strong className="block text-xs font-black">{event.summary}</strong>
                        <span className="mt-1 block text-xs font-bold text-[#697586]">
                          {formatDate(event.createdAt.slice(0, 10))}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-black/10 bg-white p-3 text-xs font-bold text-[#697586]">
                      No timeline events yet.
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}

function EditorModal({
  form,
  editing,
  isSaving,
  voicePhase,
  voiceScope,
  voiceMessage,
  voiceTranscript,
  isBusyVoice,
  onChange,
  onClose,
  onSave,
  onDelete,
  onVoice
}: {
  form: EditorForm;
  editing: boolean;
  isSaving: boolean;
  voicePhase: VoicePhase;
  voiceScope: RecordingScope | null;
  voiceMessage: string;
  voiceTranscript: string | null;
  isBusyVoice: boolean;
  onChange: <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onVoice: () => void;
}) {
  const createRecording = voicePhase === "recording" && voiceScope === "create";
  const showVoice = voiceScope === "create" || voicePhase === "done" || voicePhase === "error";

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-stretch bg-[#101828]/40 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
      <section
        className="h-dvh w-full overflow-auto rounded-none bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:max-w-3xl sm:rounded-[30px] sm:border sm:border-black/10"
        role="dialog"
        aria-modal="true"
      >
        <div className="min-h-full p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:min-h-0 sm:p-6">
          <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 flex items-start justify-between gap-3 border-b border-black/10 bg-white/95 p-4 backdrop-blur sm:static sm:mx-0 sm:mt-0 sm:mb-5 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-0">
            <div>
              <h2 className="text-2xl font-black leading-none sm:text-3xl">{editing ? "Edit note" : "Create note"}</h2>
            </div>
            <IconButton label="Close" onClick={onClose}>
              <X className="h-5 w-5" />
            </IconButton>
          </div>

          <div
            className={clsx(
              "mb-4 rounded-2xl border border-dashed p-4",
              createRecording ? "border-[#f5b7b1] bg-[#fff5f5]" : "border-[#c7d0db] bg-[#f8fafc]"
            )}
          >
            <div className="flex items-center gap-3 text-sm font-semibold text-[#697586]">
              <span
                className={clsx(
                  "h-3 w-3 rounded-full bg-[#d92d20]",
                  createRecording ? "animate-pulse opacity-100" : "opacity-20"
                )}
              />
              <span>{showVoice ? voiceMessage : "Voice mode ready."}</span>
            </div>
            {voiceTranscript && voiceScope !== "edit" ? (
              <p className="mt-3 rounded-xl bg-white p-3 text-sm font-medium leading-6 text-[#18212f]/75">
                {voiceTranscript}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2">
              <input
                value={form.title}
                onChange={(event) => onChange("title", event.target.value)}
                className="field-input"
                placeholder="e.g. Finalise automation governance notes"
              />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <textarea
                value={form.description}
                onChange={(event) => onChange("description", event.target.value)}
                className="field-input min-h-32 resize-y"
                placeholder="Short explanation of the task..."
              />
            </Field>
            <Field label="Category">
              <select
                value={form.category}
                onChange={(event) => onChange("category", event.target.value as TaskCategory)}
                className="field-input"
                required
              >
                <option value="work">Work</option>
                <option value="personal">Personal</option>
              </select>
            </Field>
            <Field label="People">
              <input
                value={form.people}
                onChange={(event) => onChange("people", event.target.value)}
                className="field-input"
                placeholder="Alex, design team, project group"
              />
            </Field>
            <Field label="Deadline">
              <input
                type="date"
                value={form.deadline}
                onChange={(event) => onChange("deadline", event.target.value)}
                className="field-input"
              />
            </Field>
            <Field label="Estimate (minutes)">
              <input
                type="number"
                min="1"
                max="1440"
                value={form.estimatedMinutes}
                onChange={(event) => onChange("estimatedMinutes", event.target.value)}
                className="field-input"
                placeholder="e.g. 30"
              />
            </Field>
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={(event) => onChange("priority", event.target.value as Priority)}
                className="field-input"
              >
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(event) => onChange("status", event.target.value as TaskStatus)}
                className="field-input"
              >
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </Field>
            <Field label="Extra note" className="sm:col-span-2">
              <textarea
                value={form.note}
                onChange={(event) => onChange("note", event.target.value)}
                className="field-input min-h-28 resize-y"
                placeholder="Optional note to attach to this task..."
              />
            </Field>
          </div>

          <div className="mt-5 flex flex-col justify-between gap-3 sm:flex-row">
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <button
                type="button"
                onClick={onVoice}
                disabled={isBusyVoice || (voicePhase === "recording" && voiceScope !== "create")}
                className={clsx(
                  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/10 px-3 text-sm font-black transition",
                  createRecording ? "bg-[#fff5f5] text-[#b42318]" : "bg-[#f3f4f6]",
                  isBusyVoice && "cursor-wait opacity-70"
                )}
              >
                {createRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {createRecording ? "Stop recording" : "Speak task"}
              </button>
              {editing ? (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isSaving}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#f5b7b1] bg-[#fff5f5] px-3 text-sm font-black text-[#b42318] transition disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              ) : null}
            </div>
            <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-sm font-black">
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={isSaving || isBusyVoice || createRecording}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#111827] px-4 text-sm font-black text-white disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save note
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function VoiceCommandPanel({
  phase,
  message,
  transcript,
  result,
  onClose
}: {
  phase: VoicePhase;
  message: string;
  transcript: string | null;
  result: VoiceCommandResult | null;
  onClose: () => void;
}) {
  return (
    <section className="mb-4 rounded-2xl border border-black/10 bg-white/85 p-3 shadow-panel sm:mb-6 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-black text-[#18212f]">
            {phase === "recording" ? <span className="h-3 w-3 animate-pulse rounded-full bg-[#d92d20]" /> : null}
            {phase === "transcribing" || phase === "generating" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {phase === "error" ? <AlertCircle className="h-4 w-4 text-[#b42318]" /> : null}
            {phase === "done" && result ? <CheckCircle2 className="h-4 w-4 text-[#15803d]" /> : null}
            <span className="break-words">{result?.summary || message}</span>
          </div>
          {phase === "recording" ? (
            <p className="mt-1 text-xs font-bold text-[#697586]">Tap the command button again to stop recording.</p>
          ) : null}
        </div>
        <IconButton label="Close voice command" onClick={onClose}>
          <X className="h-5 w-5" />
        </IconButton>
      </div>

      {transcript ? (
        <p className="mt-3 rounded-xl bg-[#f8fafc] p-3 text-sm font-medium leading-6 text-[#18212f]/75">
          {transcript}
        </p>
      ) : null}

      {result ? (
        <div className="mt-3 grid gap-2">
          {result.results.length ? (
            result.results.map((item, index) => (
              <div
                key={`${item.type}-${item.taskId ?? "new"}-${index}`}
                className="flex items-start gap-2 rounded-xl border border-black/10 bg-[#fbfbfc] p-3 text-sm"
              >
                {item.status === "applied" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#15803d]" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#b45309]" />
                )}
                <span className="min-w-0 break-words font-bold text-[#18212f]/80">{item.message}</span>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-black/10 bg-[#fbfbfc] p-3 text-sm font-bold text-[#697586]">
              No task changes were needed.
            </div>
          )}

          {result.warnings.map((warning) => (
            <div key={warning} className="rounded-xl border border-[#fedf89] bg-[#fffbeb] p-3 text-sm font-bold text-[#92400e]">
              {warning}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function VoiceStatus({
  phase,
  message,
  transcript
}: {
  phase: VoicePhase;
  message: string;
  transcript: string | null;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[#c7d0db] bg-[#f8fafc] p-3">
      <div className="flex items-center gap-2 text-sm font-bold text-[#697586]">
        {phase === "recording" ? <span className="h-3 w-3 animate-pulse rounded-full bg-[#d92d20]" /> : null}
        {phase === "transcribing" || phase === "generating" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {phase === "error" ? <AlertCircle className="h-4 w-4 text-[#b42318]" /> : null}
        <span>{message}</span>
      </div>
      {transcript ? (
        <p className="mt-3 rounded-xl bg-white p-3 text-sm font-medium leading-6 text-[#18212f]/75">{transcript}</p>
      ) : null}
    </div>
  );
}

function VoicePatchPreview({
  task,
  preview,
  patch,
  onApply,
  onDiscard,
  isSaving
}: {
  task: TaskDTO;
  preview: ReturnType<typeof applyPatchPreview>;
  patch: VoicePatch;
  onApply: () => void;
  onDiscard: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-[#c7d0db] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4" />
        <strong className="text-sm font-black">Voice edit preview</strong>
      </div>
      <div className="grid gap-2 text-sm">
        {preview.title !== task.title ? <PreviewRow label="Title" before={task.title} after={preview.title} /> : null}
        {preview.description !== task.description ? (
          <PreviewRow label="Description" before={task.description} after={preview.description} />
        ) : null}
        {preview.people.join(", ") !== task.people.join(", ") ? (
          <PreviewRow label="People" before={task.people.join(", ") || "None"} after={preview.people.join(", ") || "None"} />
        ) : null}
        {preview.category !== task.category ? (
          <PreviewRow
            label="Category"
            before={task.category === "work" ? "Work" : "Personal"}
            after={preview.category === "work" ? "Work" : "Personal"}
          />
        ) : null}
        {preview.deadline !== task.deadline ? (
          <PreviewRow label="Deadline" before={formatDate(task.deadline)} after={formatDate(preview.deadline)} />
        ) : null}
        {preview.estimatedMinutes !== task.estimatedMinutes ? (
          <PreviewRow
            label="Estimate"
            before={formatEstimate(task.estimatedMinutes)}
            after={formatEstimate(preview.estimatedMinutes)}
          />
        ) : null}
        {preview.priority !== task.priority ? <PreviewRow label="Priority" before={task.priority} after={preview.priority} /> : null}
        {preview.status !== task.status ? (
          <PreviewRow
            label="Status"
            before={task.status === "completed" ? "Completed" : "Active"}
            after={preview.status === "completed" ? "Completed" : "Active"}
          />
        ) : null}
        {patch.note ? (
          <div className="rounded-xl bg-[#f8fafc] p-3">
            <span className="block text-xs font-black uppercase text-[#697586]">Note</span>
            <span className="mt-1 block whitespace-pre-wrap font-medium">{patch.note}</span>
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-black"
        >
          <Undo2 className="h-4 w-4" />
          Discard
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={isSaving || !hasPatchChanges(patch)}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#111827] px-3 text-sm font-black text-white disabled:opacity-60"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Apply changes
        </button>
      </div>
    </div>
  );
}

function PreviewRow({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="rounded-xl bg-[#f8fafc] p-3">
      <span className="block text-xs font-black uppercase text-[#697586]">{label}</span>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        <p className="whitespace-pre-wrap break-words font-medium text-[#697586]">{before}</p>
        <p className="whitespace-pre-wrap break-words font-bold">{after}</p>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-black uppercase tracking-[0.08em] text-[#697586]">{children}</h3>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="text-sm font-bold text-[#697586]">{label}</span>
      <span className="max-w-[65%] break-words text-right text-sm font-black">{value}</span>
    </div>
  );
}

function Field({
  label,
  className,
  children
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-2 block text-xs font-black uppercase tracking-[0.08em] text-[#697586]">{label}</span>
      {children}
    </label>
  );
}

function IconButton({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-xl border border-black/10 bg-[#f3f4f6] text-[#18212f] transition hover:bg-white"
    >
      {children}
    </button>
  );
}
