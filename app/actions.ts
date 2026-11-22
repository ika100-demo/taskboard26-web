"use server";

import { createTask, type Task } from "@/lib/tasks/api";
import { validateTask, type FieldErrors } from "@/lib/tasks/validate";

export type CreateTaskInput = { title: string; due_date: string };
export type CreateTaskState =
  | { ok: true; task: Task }
  // fieldErrors: board's own rules failed (no fetch made) or the API's 422 named title
  | { ok: false; fieldErrors: FieldErrors }
  | { ok: false; error: "limit" | "failed" };

export async function createTaskAction(input: CreateTaskInput): Promise<CreateTaskState> {
  const title: unknown = input?.title;
  const dueDate: unknown = input?.due_date;
  const fieldErrors = validateTask({ title });
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  const result = await createTask({
    title: title as string,
    ...(typeof dueDate === "string" && dueDate ? { due_date: dueDate } : {}),
  });
  return result;
}
