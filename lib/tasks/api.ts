import { logger } from "@/lib/logger";

export type Task = { id: string; title: string; due_date: string | null; created_at: string };
export type ListResult = { ok: true; tasks: Task[] } | { ok: false };
export type CreateResult = { ok: true; task: Task } | { ok: false; error: "limit" | "failed" };

const TIMEOUT_MS = 5000;

export function taskApiUrl(): string {
  const url = process.env.TASK_API_URL || "http://localhost:8080";
  return url.replace(/\/+$/, "");
}

export function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.created_at === "string" &&
    (typeof v.due_date === "string" || v.due_date === null)
  );
}

function fail(op: "list" | "create", fields: { status?: number; error?: string }): void {
  logger.warn("task api call failed", { op, ...fields });
}

export async function listTasks(): Promise<ListResult> {
  try {
    const res = await fetch(`${taskApiUrl()}/tasks`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) {
      fail("list", { status: res.status });
      return { ok: false };
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body) || !body.every(isTask)) {
      fail("list", { status: res.status, error: "invalid body" });
      return { ok: false };
    }
    return { ok: true, tasks: body };
  } catch (err) {
    fail("list", { error: err instanceof Error ? err.name : "unknown" });
    return { ok: false };
  }
}

export async function createTask(input: { title: string; due_date?: string }): Promise<CreateResult> {
  const payload: { title: string; due_date?: string } = { title: input.title };
  if (input.due_date) payload.due_date = input.due_date;
  try {
    const res = await fetch(`${taskApiUrl()}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 409) {
      fail("create", { status: 409 });
      return { ok: false, error: "limit" };
    }
    if (res.status !== 201) {
      fail("create", { status: res.status });
      return { ok: false, error: "failed" };
    }
    const body: unknown = await res.json();
    if (!isTask(body)) {
      fail("create", { status: res.status, error: "invalid body" });
      return { ok: false, error: "failed" };
    }
    return { ok: true, task: body };
  } catch (err) {
    fail("create", { error: err instanceof Error ? err.name : "unknown" });
    return { ok: false, error: "failed" };
  }
}
