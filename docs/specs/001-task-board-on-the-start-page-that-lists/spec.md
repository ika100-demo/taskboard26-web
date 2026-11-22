---
spec_id: 001-task-board-on-the-start-page-that-lists
title: Task board on the start page that lists and creates tasks
status: approved
priority: P1
shape: web-nextjs
parent: ika100-demo/taskboard26-gitops:001-persistent-tasks-and-web-task-board
---

# 001 — Task board on the start page that lists and creates tasks

## Problem

The Task API keeps tasks only in the memory of its running process. Every restart or new deploy empties the list, so in dev and staging people lose what they wrote down each time a new version goes out. Also, a person can reach tasks only by calling the API directly: the Task board web UI is deployed but shows nothing yet. Keeping tasks in a Postgres database and giving the web UI a board that lists and creates tasks makes the taskboard usable by people, not only by API clients.

## System context

Slice of the system plan `001-persistent-tasks-and-web-task-board` in `ika100-demo/taskboard26-gitops` for `taskboard26-web` (web-nextjs). The system criteria and the contract below are binding: every criterion of this spec implements one of them and names it: `(system AC-<NNN>.<n>)`.

### System criteria

- **AC-001.4** Given tasks A, B and C exist in the Task API of the same environment, when a person opens the start page of the Task board web UI, then the page shows exactly these three tasks, oldest first, each with its title and its due date as `YYYY-MM-DD` or the text "No due date"; given no task exists, the page shows "No tasks yet".
- **AC-001.5** Given the board is open, when a person enters the title "Buy milk" and, optionally, the due date 2026-12-24 and submits the form, then without a full page reload the task appears at the end of the list with that title and due date, the form is emptied, and `GET /tasks` of the Task API lists the task.
- **AC-001.6** Given the board is open, when a person submits a title that is empty or only whitespace, or longer than 200 characters after trimming, or the Task API answers `409` (10,000 tasks reached), then the board shows "Enter a title", "Title must be at most 200 characters" or "Task limit reached" respectively next to the form, keeps the entered values, and no new task is listed by the board or by `GET /tasks`.
- **AC-001.7** Given the Task API is unreachable or answers `5xx`, when a person opens the board, then the page loads and shows "Tasks could not be loaded. Try again later." in place of the list; when a person submits the form in that state, the board shows "Task could not be saved. Try again." and keeps the entered values.

### Contract

Provider: `taskboard26-api`. Consumer: `taskboard26-web`, server-side only, at the base URL `TASK_API_URL` (in the cluster `http://taskboard26-api`). All bodies are JSON (`Content-Type: application/json`). No authentication (system A9). Everything except the `503` answers is the API's existing contract from API spec 001, unchanged (system A1).

**Task object**

| Field | Type | Notes |
|---|---|---|
| `id` | string, UUID | server-generated, never reused |
| `title` | string | trimmed, 1 to 200 characters |
| `due_date` | string `YYYY-MM-DD` or `null` | calendar date, no time; past dates allowed |
| `created_at` | string, UTC ISO 8601 with microseconds and `Z`, e.g. `2026-11-22T10:15:30.123456Z` | server-set, unchanged by restarts |

**`GET /tasks`** — list all tasks.

| Status | Body | Meaning |
|---|---|---|
| `200` | JSON array of task objects, oldest first (by `created_at`), no pagination; `[]` when none | stored tasks, the same across restarts and redeploys |
| `503` | `{"detail": "storage unavailable"}` | the database is unreachable |

**`POST /tasks`** — create a task.

Request: `{"title": "<string>", "due_date": "<YYYY-MM-DD>" | null}`; `due_date` may be omitted (same as `null`); unknown fields are ignored. The board sends the title as entered (the API trims it) and omits `due_date` when the field is empty.

| Status | Body | Meaning |
|---|---|---|
| `201` | the created task object | stored durably before the answer |
| `422` | `{"detail": [{"loc": ["body", "<field>"], "msg": "<text>", "type": "<rule>"}, ...]}` | invalid `title` or `due_date`; nothing stored |
| `409` | `{"detail": "task limit reached"}` | 10,000 tasks are stored; nothing stored |
| `503` | `{"detail": "storage unavailable"}` | the database is unreachable; nothing stored |

**Probes of the API:** `GET /health` answers `200` `{"status": "ok"}` whenever the process runs, independent of the database. `GET /ready` answers `200` `{"status": "ready"}` when a database ping succeeds, else `503`. The board's probes `/api/health` and `/api/ready` never call the Task API.

**Events:** none.

### Rules

```yaml
rules:
  - id: title-required
    endpoint: POST /tasks
    field: title
    kind: required
    value: true
    provider: taskboard26-api
    consumers: [taskboard26-web]
  - id: title-min
    endpoint: POST /tasks
    field: title
    kind: min_length
    value: 1
    provider: taskboard26-api
    consumers: [taskboard26-web]
  - id: title-max
    endpoint: POST /tasks
    field: title
    kind: max_length
    value: 200
    provider: taskboard26-api
    consumers: [taskboard26-web]
```

Rules no tool checks:

- Both length rules apply to the title **after trimming** leading and trailing whitespace: a title of only whitespace counts as empty. The board checks them before sending and shows "Enter a title" for `title-required` / `title-min` and "Title must be at most 200 characters" for `title-max`; the API enforces them again with `422`.
- `due_date` must be a calendar date in `YYYY-MM-DD` form or `null`/absent; anything else is `422` naming `due_date`. The board uses a date input, so it only ever sends a valid date or omits the field.
- At most 10,000 tasks are stored; a further valid create is `409` `"task limit reached"`. The board does not count tasks itself, it maps the `409`.
- The board shows its own fixed English messages, never the API's `detail` text (system A8).

### Errors

```yaml
errors:
  status: 422
  body:
    list: detail
    field: loc
    rule: type
    message: msg
  unlisted:
    message: "Task could not be saved. Try again."
```

A validation error is `422` with `detail` a list; each entry's `loc` is a list whose last element is the field name (`title` or `due_date`), `type` the rule that failed and `msg` a text for logs only. Other answers carry `detail` as one string: `409` `"task limit reached"`, `503` `"storage unavailable"`.

How the board treats answers:

| Call | Answer | Board shows |
|---|---|---|
| `GET /tasks` | `200` | the list, or "No tasks yet" for `[]` |
| `GET /tasks` | `503`, any other `5xx`, any status not listed above, a body that is not a task array, connection error, timeout | "Tasks could not be loaded. Try again later." in place of the list; the page itself answers `200` |
| `POST /tasks` | `201` | the returned task appended at the end of the list, form emptied |
| `POST /tasks` | `409` | "Task limit reached" next to the form, values kept |
| `POST /tasks` | `422` (its own checks passed, so the API disagrees), `503`, any other `5xx`, any status not listed above, connection error, timeout | "Task could not be saved. Try again." next to the form, values kept, no task added to the list |

### Timeouts

- **Board → Task API, `GET /tasks`:** 5 seconds for the whole request (connect and response). On timeout or connection error the board renders the page with "Tasks could not be loaded. Try again later."; no retry while rendering, a reload tries again.
- **Board → Task API, `POST /tasks`:** 5 seconds. On timeout or connection error the board shows "Task could not be saved. Try again." and keeps the values; it never retries by itself, because a create that timed out may have been stored (a reload shows it).
- **Task API → Postgres:** connect timeout 2 seconds, statement timeout 3 seconds, so a request answers `503` `"storage unavailable"` within 5 seconds of the database becoming unreachable or slow and the board's 5 seconds are not exceeded. A broken pooled connection is discarded and a new one is opened on the next request; no request waits for the database to come back.
- **Task API readiness:** `GET /ready` pings the database with a 2-second timeout and answers `503` when it fails. Kubernetes probes readiness every 5 seconds, so after the database returns the API is ready again within seconds, well inside the 60 seconds of AC-001.3. Liveness never touches the database, so an outage never restarts the API (system A5).
- **When the API is down or unready in the cluster:** an unready API pod is removed from its Service, so the board may see a connection error instead of the API's `503`; it treats both alike (the rows above). A client going through the Gateway may likewise get the Gateway's own `503` instead of the API's body during an outage; AC-001.2's body is checked by the API's own tests against the process.

### Contract rules

Copy: `contract/001-persistent-tasks-and-web-task-board.json`, from plan `001-persistent-tasks-and-web-task-board` at `ika100-demo/taskboard26-gitops@17f66c2`. The repo's contract check reads it.

| Rule | Endpoint | Field | Kind | Value | Status | Role |
|---|---|---|---|---|---|---|
| title-max | POST /tasks | title | max_length | 200 | 422 | consumer |
| title-min | POST /tasks | title | min_length | 1 | 422 | consumer |
| title-required | POST /tasks | title | required | True | 422 | consumer |

Errors: status 422; body `detail[]` of objects with `loc`, `type`, `msg`; responses the contract does not list: show "Task could not be saved. Try again.".

### Provided by the system

The gitops part of this plan wires these for this repo; rely on them, do not ask for them again:

- env `TASK_API_URL=http://taskboard26-api`

### Notes for this repo

The start page `/` is the board (system A6): the list, then a form with "Title" (required), "Due date" (optional,
a date input sending `YYYY-MM-DD`) and an "Add task" button. The Task API is called only from the Next.js server
(Server Component for the list, a Server Action or route handler for the create) at `TASK_API_URL`, which is an
in-cluster URL the browser cannot reach; never expose it as `NEXT_PUBLIC_*`. Add `TASK_API_URL` to
`docs/env-vars.md` (local default `http://localhost:8080`). Dev only (system A10); no sign-in (system A9).

## Stories

<!-- As a <persona>, I want <goal>, so that <benefit>. -->

## Acceptance criteria

- **AC-001.1** Given the Task API at `TASK_API_URL` returns tasks A, B and C from `GET /tasks`, when a person opens `/`, then the page shows exactly these three tasks in that order (oldest first), each with its title and its `due_date` as `YYYY-MM-DD` or the text "No due date"; given it returns `[]`, the page shows "No tasks yet" (system AC-001.4)
- **AC-001.2** Given the board is open, when a person enters the title "Buy milk" and optionally the due date 2026-12-24 and clicks "Add task", then the board sends `POST /tasks` to the Task API and on `201` shows the returned task at the end of the list without a full page reload, and the "Title" and "Due date" fields are emptied (system AC-001.5)
- **AC-001.3** Given the board is open, when a person submits a title that is empty or only whitespace, then the board shows "Enter a title" next to the form, keeps the entered values and sends no request to the Task API; when the title is longer than 200 characters after trimming, it shows "Title must be at most 200 characters" in the same way (system AC-001.6)
- **AC-001.4** Given the board is open, when a person submits a valid task and the Task API answers `409`, then the board shows "Task limit reached" next to the form, keeps the entered values and lists no new task (system AC-001.6)
- **AC-001.5** Given the Task API is unreachable, does not answer within 5 seconds or answers `5xx` (including `503` "storage unavailable") or a status the contract does not list, when a person opens `/`, then the page loads with `200` and shows "Tasks could not be loaded. Try again later." in place of the list (system AC-001.7)
- **AC-001.6** Given the Task API is unreachable, does not answer within 5 seconds, answers `5xx`, a `422` or a status the contract does not list, when a person submits the form, then the board shows "Task could not be saved. Try again.", keeps the entered values and lists no new task (system AC-001.7)
- **AC-001.7** Given the Task API is unreachable, when the platform probes the board, then `/api/health` and `/api/ready` keep answering `200`, so the board stays served (system AC-001.7)

## Non-goals

## Assumptions

<!-- Spec 149: decisions taken by default, approved with the spec. One bullet each: - **A1** <the decision> (other option: <…>; affects AC-…). A revised one is struck through (~~…~~), never deleted. -->

## Open questions

<!-- Only what may not be decided by default (spec 149): security or access, money, destroying or migrating data, or a request too ambiguous to build. Approval is refused while any is open. Strike answered ones (~~…~~) and fold the answer into the criteria. -->

<!-- Priority levels (spec 196) for the product-manager's PRIORITY line: P0 an outage, data loss, a security problem, or something that blocks all other work; P1 a normal bug or feature; the fallback when nothing signals urgency; P2 cosmetic, a convenience, or something with an easy workaround. A reason is "P<n>: <phrase>", one of: P0: outage, data loss, security problem, blocks all other work; P1: normal bug or feature; P2: cosmetic, convenience, easy workaround. -->

## Changelog

- 2026-11-22 created from the system plan, with its criteria (spec 147)
- 2026-11-22 approved
