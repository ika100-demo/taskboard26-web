---
spec_id: 001-task-board-on-the-start-page-that-lists
shape: web-nextjs
spec_hash: 7876f0a0fb8a
summary: Start page becomes the task board, listing tasks from the Task API server-side and creating them through a Server Action
tasks:
  - id: t1
    title: Add task validation and the board's fixed messages
    files: [lib/tasks/messages.ts, lib/tasks/validate.ts, tests/unit/tasks-validate.test.ts]
    covers: [AC-001.3]
    parallel_safe: true
    depends_on: []
  - id: t2
    title: Add the server-only Task API client with 5 s timeouts
    files: [lib/tasks/api.ts, docs/env-vars.md, tests/unit/tasks-api.test.ts]
    covers: [AC-001.1, AC-001.2, AC-001.4, AC-001.5, AC-001.6, AC-001.7]
    parallel_safe: true
    depends_on: []
  - id: t3
    title: Replace the start page with the task board (page, client board, Server Action)
    files: [app/page.tsx, app/actions.ts, app/_components/task-board.tsx, app/_components/feature-card.tsx, app/_components/icons.tsx, app/globals.css, tests/page.test.tsx, e2e/board-smoke.spec.ts]
    covers: [AC-001.1, AC-001.2, AC-001.3, AC-001.4, AC-001.5, AC-001.6]
    parallel_safe: false
    depends_on: [t1, t2]
  - id: t4
    title: Wire the contract check adapter to the board
    files: [tests/contract/adapter.ts]
    covers: [AC-001.3, AC-001.6]
    parallel_safe: false
    depends_on: [t1, t3]
---

# Plan — 001 Task board on the start page that lists and creates tasks

Design: [design.md](design.md). `TASK_API_URL` is wired by the system plan's gitops part, so this plan has no gitops task.

## t1 — Add task validation and the board's fixed messages

**Files:** lib/tasks/messages.ts, lib/tasks/validate.ts, tests/unit/tasks-validate.test.ts
**Covers:** AC-001.3
**Goal:** One pure, client-safe module that decides whether a title may be sent, plus the board's fixed English strings. The client, the Server Action and the contract adapter all use it.

**Implementation notes:**
- `messages.ts`: `MSG` exactly as in design.md "Validation and messages" (`as const`).
- `validate.ts`: `FieldErrors`, `TITLE_MAX = 200`, `validateTask(body)`. If the title is missing, not a string, or empty after `trim()`, return `{ title: MSG.titleRequired }`. If its trimmed length is over 200, return `{ title: MSG.titleTooLong }`. Otherwise return `{}`.
- No imports from `next/*` and no server-only code, because the client component imports this.
- Unit tests: missing, `""`, `"   "`, 200 `x` (valid), 201 `x` (too long), `"  " + 200 x + "  "` (valid after trim).

**Done when:** the unit tests pass. AC-001.3 acceptance tests pass after t3.

## t2 — Add the server-only Task API client with 5 s timeouts

**Files:** lib/tasks/api.ts, docs/env-vars.md, tests/unit/tasks-api.test.ts
**Covers:** AC-001.1, AC-001.2, AC-001.4, AC-001.5, AC-001.6, AC-001.7
**Goal:** `listTasks` and `createTask` call the Task API at `TASK_API_URL` and map every answer to the result types in design.md "Upstream", so no caller ever sees an exception or the API's `detail` text.

**Implementation notes:**
- Export `Task`, `ListResult`, `CreateResult`, `taskApiUrl()`, `isTask()`, `listTasks()`, `createTask()` with the signatures in design.md.
- `taskApiUrl()` reads `process.env.TASK_API_URL` on each call. It defaults to `http://localhost:8080` and strips a trailing `/`.
- `fetch` with `cache: "no-store"` and `signal: AbortSignal.timeout(5000)`, and no retry. The POST sends `Content-Type: application/json` and includes `due_date` only when it is non-empty.
- Mapping exactly per the design table. A `200` list whose body is not an array of valid tasks means `{ ok: false }`. A `201` with an invalid body means `failed`. Only `409` means `limit`.
- Wrap the fetch and JSON parse in `try/catch`. Log each failure once with `logger.warn("task api call failed", { op: "list"|"create", status?, error? })`. Never log the title.
- Do not touch `app/api/health` or `app/api/ready`. The client is never imported there (AC-001.7).
- `docs/env-vars.md`: add `TASK_API_URL`, default `http://localhost:8080`: "Base URL of the Task API, called server-side only; in the cluster `http://taskboard26-api`. Never expose as `NEXT_PUBLIC_*`."
- Unit tests stub `globalThis.fetch`: 200 list, 200 non-array, 503, 500, 418, rejected fetch, an `AbortError`/`TimeoutError`, 201, 201 with a bad body, 409, 422, and `due_date` omitted when empty.

**Done when:** the unit tests pass. The AC-001.7 acceptance tests pass (the probes stay independent). The other covered criteria pass after t3.

## t3 — Replace the start page with the task board (page, client board, Server Action)

**Files:** app/page.tsx, app/actions.ts, app/_components/task-board.tsx, app/_components/feature-card.tsx, app/_components/icons.tsx, app/globals.css, tests/page.test.tsx, e2e/board-smoke.spec.ts
**Covers:** AC-001.1, AC-001.2, AC-001.3, AC-001.4, AC-001.5, AC-001.6
**Goal:** `/` shows the task list (or "No tasks yet", or the load error) and the "Add task" form, with the exact markup in design.md "UI". A create runs through the Server Action without a page reload.

**Implementation notes:**
- `app/actions.ts` (`"use server"`): `createTaskAction(input)` per design.md. It runs `validateTask` first and returns `fieldErrors` without fetching. Otherwise it calls `createTask` and passes the result through.
- `app/_components/task-board.tsx` (`"use client"`): props `initialTasks: Task[]` and `loadFailed: boolean` (import the `Task` type only). Keep state for tasks, title, dueDate, titleError and formError, plus `useTransition` for pending.
- On submit: `preventDefault`, then clear the messages and run `validateTask({ title })`. If it fails, show `#title-error` and stop: no action call. Otherwise call `await createTaskAction({ title, due_date: dueDate })` inside `startTransition`.
- On `ok`: append the task and set both inputs to `""`. On `fieldErrors`: show the title error. On `limit`: show `MSG.limitReached`. On `failed`: show `MSG.saveFailed`. Inputs keep their values on every error.
- The form has `noValidate`. The title input has no `required` and no `maxLength`. Use the labels, ids, `aria-label`s and `role="alert"` exactly as in the design. Render `due_date ?? MSG.noDueDate` as a string.
- `app/page.tsx`: `export const dynamic = "force-dynamic"`, an async default export, `const result = await listTasks()`. Render `<main id="main-content">`, a single `<h1>Tasks</h1>`, then `<TaskBoard initialTasks={result.ok ? result.tasks : []} loadFailed={!result.ok} />`.
- Delete `app/_components/feature-card.tsx` and `app/_components/icons.tsx`, which become unused. Remove the starter-only styles from `app/globals.css` that nothing uses any more, and add the list, form and error styles with the existing tokens.
- `tests/page.test.tsx`: rewrite it for the board, rendering `await HomePage()` with `listTasks` mocked. Cover the main landmark, the single `h1`, the list, empty and load-failed states, and board interactions such as submit success, field error, limit and failed, so that `app/**` stays at 80 % or more.
- `e2e/board-smoke.spec.ts`: a read-only `@smoke` test. `/` shows the "Add task" form and does not show "Tasks could not be loaded. Try again later.", which checks the `TASK_API_URL` wiring after a deploy. The existing `e2e/smoke.spec.ts` (an h1 on `/`) keeps passing unchanged.

**Done when:** the acceptance tests for AC-001.1 through AC-001.6 pass. `devbox run quality` is clean, and `devbox run test` meets the coverage gate (the contract check is wired in t4).

## t4 — Wire the contract check adapter to the board

**Files:** tests/contract/adapter.ts
**Covers:** AC-001.3, AC-001.6
**Goal:** `tests/contract.test.ts` exercises the board's real validation and response handling for every consumer rule of `contract/001-persistent-tasks-and-web-task-board.json`.

**Implementation notes:**
- `base` → `{ title: "Buy milk" }`, and `validate` → `validateTask(body)`.
- `showResponse`: `vi.stubGlobal("fetch", …)` answering `new Response(JSON.stringify(body), { status })`. Render `<TaskBoard initialTasks={[]} loadFailed={false} />`, type "Buy milk", click "Add task", wait for a `role="alert"`, and return `{ fields: { title } if #title-error shown, form: #form-error text }`. Unstub and clean up afterwards.
- The real `createTaskAction` and `createTask` run, with no mocks of the board's own modules.

**Done when:** the contract check's validation cases (title-required, title-min, title-max) and the `POST /tasks:unlisted` case pass. The three `…:response` cases (422 with `detail[].msg` expected at `title`) contradict AC-001.6 and system A8: see the BLOCKER in the architect report.
