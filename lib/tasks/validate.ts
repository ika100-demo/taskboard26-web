import { MSG } from "@/lib/tasks/messages";

export type FieldErrors = Record<string, string>;

export const TITLE_MAX = 200;

export function validateTask(body: Record<string, unknown>): FieldErrors {
  const title = body.title;
  if (typeof title !== "string" || title.trim().length === 0) {
    return { title: MSG.titleRequired };
  }
  if (title.trim().length > TITLE_MAX) {
    return { title: MSG.titleTooLong };
  }
  return {};
}
