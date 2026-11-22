# Design — 001 Task board on the start page that lists and creates tasks

## Decisions

- The start page `/` is an async Server Component that loads the list through a server-only Task API client; the create goes through a Server Action. `TASK_API_URL` never reaches the browser (spec "Notes for this repo").
- The page is `export const dynamic = "force-dynamic"`: without it `next build` prerenders `/` and calls the Task API at build time, then serves a stale list (AC-001.1, AC-001.5).
- The form is a client component with **controlled inputs and `onSubmit` + `preventDefault`**, and it calls the Server Action as a plain async function inside `startTransition`. It does not use `<form action={...}>`, because React resets a form after a form action, and the board must keep the entered values on every error (AC-001.3, AC-001.4, AC-001.6). No full page reload happens (AC-001.2).
- Validation runs twice, with one shared pure function (`lib/tasks/validate.ts`): in the client before the action is called, so an invalid title sends no request (AC-001.3), and again in the Server Action before `fetch`, so a crafted call cannot reach the API with an invalid title either.
- The title input has **no `required` and no `maxLength`**, and the form has `noValidate`: native validation would show the browser's text instead of "Enter a title", and `maxLength` would cut typing off at 200 characters, so the over-200 message could never appear (AC-001.3).
- The Server Action and the API client never throw to the UI. They return a discriminated result, and the UI maps it to the board's own fixed English messages. The API's `detail` text is never shown (system A8). Every non-success is logged once through `@/lib/logger` (`warn`, fields `op`, `status` or `error`), without the title.
- `due_date` is shown as the string the API returns, never parsed into a `Date`, so a timezone can never shift the date (AC-001.1).
- The list keeps the order the API returns (oldest first per the contract). The board does not sort it again (AC-001.1).
- `TASK_API_URL` is read on every call, not when the module loads, so tests and the runtime can set it per process. The default is `http://localhost:8080` (spec note).
- `/api/health` and `/api/ready` stay unchanged and never import the Task API client (AC-001.7, contract "Probes").
- No ADR: every choice here is local to this feature.

## Modules

| Module | Responsibility | New / changed |
|---|---|---|
| `lib/tasks/messages.ts` | the board's fixed UI strings | new |
| `lib/tasks/validate.ts` | pure title validation, shared by client, Server Action and contract adapter | new |
| `lib/tasks/api.ts` | server-only Task API client: `listTasks`, `createTask`, the `Task` type and its runtime check | new |
| `app/actions.ts` | `"use server"`: `createTaskAction` = validate, then `createTask` | new |
| `app/_components/task-board.tsx` | `"use client"`: list, empty or load-error text, form, messages | new |
| `app/page.tsx` | async Server Component: `listTasks()`, renders `<h1>` and `<TaskBoard>` | changed (starter content replaced) |
| `app/_components/feature-card.tsx`, `app/_components/icons.tsx` | starter-page only | deleted (unused; would drag `app/**` coverage under 80 %) |
| `app/globals.css` | board styles (list, form, error text) | changed |
| `tests/contract/adapter.ts` | wires the contract check to `validateTask` and `TaskBoard` | changed |
| `docs/env-vars.md` | documents `TASK_API_URL` | changed |

## Contract

### Upstream (Task API, consumed server-side)

As fixed by the spec's system contract. Both calls: `fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) })`, `Content-Type: application/json` on the POST, no retry.

```ts
// lib/tasks/api.ts
export type Task = { id: string; title: string; due_date: string | null; created_at: string };
export type ListResult = { ok: true; tasks: Task[] } | { ok: false };
export type CreateResult = { ok: true; task: Task } | { ok: false; error: "limit" | "failed" };

export function taskApiUrl(): string;                       // process.env.TASK_API_URL || "http://localhost:8080", trailing "/" stripped
export function isTask(value: unknown): value is Task;      // id, title, created_at strings; due_date string or null
export async function listTasks(): Promise<ListResult>;
export async function createTask(input: { title: string; due_date?: string }): Promise<CreateResult>;
```

| Call | Upstream answer | Result |
|---|---|---|
| `GET {TASK_API_URL}/tasks` | `200` and the body is an array whose every item passes `isTask` | `{ ok: true, tasks }` (the API's order) |
| | anything else: other status, a body that is not such an array, invalid JSON, connection error, abort after 5 s | `{ ok: false }` |
| `POST {TASK_API_URL}/tasks` body `{"title": <as entered>}` plus `"due_date"` only when it is non-empty | `201` and the body passes `isTask` | `{ ok: true, task }` |
| | `409` | `{ ok: false, error: "limit" }` |
| | anything else: `422`, `5xx`, an unlisted status, a `201` with a bad body, connection error, abort after 5 s | `{ ok: false, error: "failed" }` |

### Server Action

```ts
// app/actions.ts  ("use server")
export type CreateTaskInput = { title: string; due_date: string };       // due_date "" when the field is empty
export type CreateTaskState =
  | { ok: true; task: Task }
  | { ok: false; fieldErrors: FieldErrors }                              // client-side rules failed; no fetch made
  | { ok: false; error: "limit" | "failed" };
export async function createTaskAction(input: CreateTaskInput): Promise<CreateTaskState>;
// pseudocode: errors = validateTask(input); if any -> { ok:false, fieldErrors }
//             else createTask({ title: input.title, ...(input.due_date ? { due_date: input.due_date } : {}) })
```

### Validation and messages

```ts
// lib/tasks/messages.ts
export const MSG = {
  emptyList: "No tasks yet",
  noDueDate: "No due date",
  loadFailed: "Tasks could not be loaded. Try again later.",
  titleRequired: "Enter a title",
  titleTooLong: "Title must be at most 200 characters",
  limitReached: "Task limit reached",
  saveFailed: "Task could not be saved. Try again.",
} as const;

// lib/tasks/validate.ts
export type FieldErrors = Record<string, string>;                         // same shape as lib/contract/engine FieldErrors
export const TITLE_MAX = 200;
export function validateTask(body: Record<string, unknown>): FieldErrors;
// title missing, not a string, or trim() === ""  -> { title: MSG.titleRequired }   (title-required, title-min)
// title.trim().length > 200                      -> { title: MSG.titleTooLong }    (title-max)
// otherwise                                      -> {}
```

### UI (what the acceptance tests can query)

`app/page.tsx` renders `<main id="main-content">` with exactly one `<h1>` with the text `Tasks`. Then comes `<TaskBoard initialTasks={Task[]} loadFailed={boolean} />`.

| Element | Markup |
|---|---|
| Task list | `<ul aria-label="Tasks">`, one `<li>` per task in order, containing the title and, after it, the `due_date` string or `No due date` |
| Empty list | `<p>No tasks yet</p>` in place of the `<ul>` |
| Load failed | `<p>Tasks could not be loaded. Try again later.</p>` in place of the `<ul>` (the page still answers `200`). The form stays usable. A task created in this state is appended to a list shown below the message |
| Form | `<form aria-label="Add task" noValidate>` |
| Title | `<label for="task-title">Title</label><input id="task-title" name="title" type="text">`, `aria-invalid` and `aria-describedby="title-error"` while a title error is shown |
| Due date | `<label for="task-due-date">Due date</label><input id="task-due-date" name="due_date" type="date">` |
| Submit | `<button type="submit">Add task</button>`, disabled while a submit is pending |
| Title error | `<p id="title-error" role="alert">Enter a title</p>` or `…Title must be at most 200 characters` |
| Form error | `<p id="form-error" role="alert">Task limit reached</p>` or `…Task could not be saved. Try again.` |

At most one `role="alert"` element is shown at a time. A new submit clears the previous message. On success the returned task is appended at the end of the list, both inputs are set to `""`, and any message is cleared (AC-001.2). On any error both inputs keep their values and the list is unchanged (AC-001.3, AC-001.4, AC-001.6).

### Contract check adapter (`tests/contract/adapter.ts`)

- `base("POST /tasks")` → `{ title: "Buy milk" }`.
- `validate(_, body)` → `validateTask(body)`.
- `showResponse(_, { status, body })`: stubs `globalThis.fetch` to answer `new Response(JSON.stringify(body), { status })`, renders `<TaskBoard initialTasks={[]} loadFailed={false} />`, types a valid title, clicks "Add task", waits for an alert, and returns `{ fields: { title: <#title-error text> } if shown, form: <#form-error text> }`. The real `createTaskAction` and `createTask` run, so the mapping under test is the production one.

## Data

None in this repo. Tasks live in the Task API.
