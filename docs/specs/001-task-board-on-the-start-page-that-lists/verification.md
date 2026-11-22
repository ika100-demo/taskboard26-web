# Verification — 001 Task board on the start page that lists and creates tasks

**Result:** pass
**Commit:** a4ee4fc · **Base:** 965194c · **Trace:** 8/8 criteria named by tests (`tests/acceptance/task-board.test.tsx`)

| Criterion | Verdict | Tests | Implementation | Notes |
|---|---|---|---|---|
| AC-001.1 | met | `tests/acceptance/task-board.test.tsx::AC-001.1 shows the API's tasks in the API's order…`, `::AC-001.1 shows 'No tasks yet' for an empty list` | `lib/tasks/api.ts:48`, `app/page.tsx:8`, `app/_components/task-board.tsx:46-56` | The order in the fixture matches none of the title, id or date orders. The test asserts exactly 3 items, each title and `YYYY-MM-DD` or "No due date", and "No tasks yet" for `[]`. |
| AC-001.2 | met | `::AC-001.2 POSTs the task, shows the API's returned task at the end and empties the fields`, `::AC-001.2 sends no due_date when the field is empty` | `app/_components/task-board.tsx:20-34`, `app/actions.ts:13`, `lib/tasks/api.ts:70-101` | Asserts one POST to `TASK_API_URL/tasks` with the body, that the API's returned task (not the input) is appended last, and that both fields are emptied. `preventDefault` plus a Server Action means no full reload. |
| AC-001.3 | met | `::AC-001.3 empty/whitespace title shows 'Enter a title'…`, `::AC-001.3 a title over 200 characters…`, `::AC-001.3 exactly 200 characters with surrounding spaces…` | `lib/tasks/validate.ts:7-15`, `app/_components/task-board.tsx:24-28` | Asserts the exact messages, kept values and zero POSTs. The boundary of 200 after trimming is covered. The messages are asserted within `main`, not within the form. They render inside the form (`task-board.tsx:82-91`), so this is acceptable for the loose phrase "next to the form". |
| AC-001.4 | met | `::AC-001.4 409 shows 'Task limit reached'…` | `lib/tasks/api.ts:81-84`, `app/_components/task-board.tsx:39` | Shows the fixed message, never the API's `detail`. Values are kept and no list appears. |
| AC-001.5 | met | `::AC-001.5 %s shows the load error in place of the list` (unreachable, 500, 503, 418), `::AC-001.5 a call that never answers shows the load error at 5 s and not before` | `lib/tasks/api.ts:48-67` (`AbortSignal.timeout(5000)` at :52), `app/_components/task-board.tsx:55-56` | "Loads with 200" is proven only as `HomePage()` resolving without throwing, which is what yields `200` in Next. A unit test cannot observe the HTTP status. Accepted. |
| AC-001.6 | met | `::AC-001.6 POST %s shows 'Task could not be saved. Try again.'…` (unreachable, 500, 503, 422 naming only `due_date`, 418), `::AC-001.6 a POST that never answers shows the save error at 5 s and not before` | `lib/tasks/api.ts:85-105`, `app/_components/task-board.tsx:37-39` | Asserts the message, that the API's detail and `msg` are not shown, that values are kept and that no list appears. The timeout is asserted at 4999 ms and at 5000 ms. |
| AC-001.7 | met | `::AC-001.7 /api/health and /api/ready answer 200 while the API is unreachable…` | `app/api/health/route.ts`, `app/api/ready/route.ts` (unchanged; neither imports `lib/tasks/api`) | Asserts both are `200` and that `fetch` is never called. See the unresolved test-review finding below. |
| AC-001.8 | met | `::AC-001.8 a 422 naming title shows the API msg at Title, keeps values and lists no task` | `lib/tasks/api.ts:30-42` (first title entry, A1), `lib/tasks/api.ts:85-90`, `app/_components/task-board.tsx:35-36,68-69,82-86` | Re-checked after the tightening in a4ee4fc. `tests/acceptance/task-board.test.tsx:311` now asserts `expect(screen.getByLabelText("Title")).toHaveAccessibleDescription(msg)`. The Title input links `#title-error` via `aria-describedby`, so the `msg` is placed at the Title field; a `#form-error` or list-level placement would fail the test. The test also asserts that the generic save message is absent, that both values are kept and that no list appears. The `msg` is a React text child, so it is plain text (A2). The previous TEST LOOSER finding is resolved. The code is unchanged since a8be65a: `git diff a8be65a..HEAD` touches only this test. |

## Non-goals

The spec lists no non-goals. Nothing out of scope was found: no sign-in, no `NEXT_PUBLIC_*` exposure of `TASK_API_URL` (it is read server-side only, `lib/tasks/api.ts:14`), and no client-side task counting. The template-owned layout is untouched: `app/layout.tsx` is not in the diff, the `globals.css` changes affect only starter-page classes (`.hero`, `.card`, `.steps` …) and the new board classes, and `e2e/home.spec.ts` still asserts `banner`, `main#main-content` and `contentinfo`. ✔

## Deviations from the plan

- `e2e/home.spec.ts` is changed but in no task's `files`. The h1 is now "Tasks", and the "Check health" link test was dropped because that starter-page link no longer exists. The health request check is kept. Acceptable, because it follows from t3 replacing the start page.
- `contract/001-persistent-tasks-and-web-task-board.json`, `docs/backlog.md`, `docs/specs/001-*/…` and `tests/acceptance/task-board.test.tsx` are in no task's `files`. They are written by `/component:spec --from-plan`, `cplat spec index` and the acceptance-test phase. Acceptable.
- `docs/backlog.md` shows 7 criteria; the spec now has 8 (stale generated index). Acceptable; the next `cplat spec index` fixes it.
- Every task (t1–t5) is `done: true`.
- `.secrets.baseline.json` gains only the contract copy's commit SHA, as t4 requires. Acceptable.

## Contract

The code matches the spec's contract and `design.md`. GET maps only `200` with a valid task array to the list, and everything else to the load error. POST maps `201` → append, `409` → limit, `422` with a title entry → its first `msg` (A1, rendered as a React text child per A2), and every other answer → "Task could not be saved. Try again.". Both calls time out at 5 s with no retry, and `due_date` is omitted when empty. ✔

## Tightened acceptance tests

| File | Reason | Asserts the criterion as written |
|---|---|---|
| `tests/acceptance/task-board.test.tsx` (AC-001.8, commit a4ee4fc) | The previous verification found the test looser than "next to the 'Title' field". One assertion was added: the Title input's accessible description equals the API `msg`. The user approved it via `cplat spec test-diff red --approve`. | Yes. It asserts the placement at Title, the kept values and that no task is listed. No assertion was removed. |

## Unresolved test-review findings

| Test | Criterion | Finding |
|---|---|---|
| AC-001.7 probes test | AC-001.7 | The probes already satisfy the criterion. The test stays red only via its AC-001.5 load-error assertion and is kept as a regression guard. Acceptable: the probe assertions are correct and pass, so the verdict stands. |

## Mutation check (report only)

Skipped: no mutation check for shape web-nextjs yet.
