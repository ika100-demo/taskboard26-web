import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/page";
import { GET as health } from "@/app/api/health/route";
import { GET as ready } from "@/app/api/ready/route";

type Task = { id: string; title: string; due_date: string | null; created_at: string };

const task = (id: string, title: string, due: string | null, created = "2026-01-01T00:00:00Z"): Task => ({
  id,
  title,
  due_date: due,
  created_at: created,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function stubApi(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const isPost = (init?: RequestInit) => (init?.method ?? "GET").toUpperCase() === "POST";
const posts = (fn: ReturnType<typeof stubApi>) =>
  fn.mock.calls.filter(([, init]) => isPost(init as RequestInit | undefined));

// Never answers; rejects when the caller's signal aborts (as a real fetch does).
const hang: Handler = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      reject(new TypeError("no abort signal passed to fetch"));
      return;
    }
    const fail = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail);
  });

// AbortSignal.timeout runs on Node's own timers, which fake timers do not move: route it through setTimeout.
function routeAbortTimeoutThroughFakeTimers() {
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), ms);
    return controller.signal;
  });
}

async function renderPage() {
  const ui = await HomePage();
  render(ui);
  return within(screen.getByRole("main"));
}

function fill(title: string, due?: string) {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: title } });
  if (due !== undefined) fireEvent.change(screen.getByLabelText("Due date"), { target: { value: due } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
}

const listItems = (main: ReturnType<typeof within>) =>
  within(main.getByRole("list", { name: "Tasks" })).getAllByRole("listitem");

const pageText = () => document.body.textContent ?? "";

beforeEach(() => {
  vi.stubEnv("TASK_API_URL", "http://task-api.test");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AC-001.1 list", () => {
  it("AC-001.1 shows the API's tasks in the API's order with title and due date or 'No due date'", async () => {
    // Order matches neither title, id, due date nor created_at order.
    stubApi(() =>
      json(200, [
        task("3", "Zebra", "2026-12-24", "2026-03-01T00:00:00Z"),
        task("1", "Apple", null, "2026-01-01T00:00:00Z"),
        task("2", "Mango", "2027-01-02", "2026-02-01T00:00:00Z"),
      ]),
    );
    const main = await renderPage();
    const items = listItems(main);
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Zebra");
    expect(items[0]).toHaveTextContent("2026-12-24");
    expect(items[1]).toHaveTextContent("Apple");
    expect(items[1]).toHaveTextContent("No due date");
    expect(items[2]).toHaveTextContent("Mango");
    expect(items[2]).toHaveTextContent("2027-01-02");
    expect(main.queryByText("No tasks yet")).not.toBeInTheDocument();
  });

  it("AC-001.1 shows 'No tasks yet' for an empty list", async () => {
    stubApi(() => json(200, []));
    const main = await renderPage();
    expect(main.getByText("No tasks yet")).toBeInTheDocument();
    expect(main.queryByRole("list", { name: "Tasks" })).not.toBeInTheDocument();
  });
});

describe("AC-001.2 create", () => {
  it("AC-001.2 POSTs the task, shows the API's returned task at the end and empties the fields", async () => {
    // The API's answer differs from the input (trimmed title, other due date): the board must show the answer.
    const created = task("9", "Buy milk", "2026-12-25");
    const fn = stubApi((_url, init) => {
      if (isPost(init)) return json(201, created);
      return json(200, [task("1", "Existing", null)]);
    });
    const main = await renderPage();
    fill("  Buy milk  ", "2026-12-24");
    submit();
    await waitFor(() => expect(listItems(main)).toHaveLength(2));

    const items = listItems(main);
    expect(items[0]).toHaveTextContent("Existing");
    expect(items[1]).toHaveTextContent("Buy milk");
    expect(items[1]).toHaveTextContent("2026-12-25");
    expect(items[1]).not.toHaveTextContent("2026-12-24");
    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toHaveValue("");
      expect(screen.getByLabelText("Due date")).toHaveValue("");
    });

    const sent = posts(fn);
    expect(sent).toHaveLength(1);
    expect(String(sent[0][0])).toBe("http://task-api.test/tasks");
    const body = JSON.parse(String((sent[0][1] as RequestInit).body));
    expect(body.title.trim()).toBe("Buy milk");
    expect(body.due_date).toBe("2026-12-24");
  });

  it("AC-001.2 sends no due_date when the field is empty", async () => {
    const fn = stubApi((_url, init) => (isPost(init) ? json(201, task("9", "Buy milk", null)) : json(200, [])));
    const main = await renderPage();
    fill("Buy milk");
    submit();
    await waitFor(() => expect(listItems(main)).toHaveLength(1));
    expect(listItems(main)[0]).toHaveTextContent("Buy milk");
    expect(JSON.parse(String((posts(fn)[0][1] as RequestInit).body))).toEqual({ title: "Buy milk" });
  });
});

describe("AC-001.3 validation", () => {
  it.each([
    ["empty", ""],
    ["whitespace", "   "],
  ])("AC-001.3 %s title shows 'Enter a title' and sends no request", async (_n, value) => {
    const fn = stubApi(() => json(200, []));
    const main = await renderPage();
    fill(value, "2026-12-24");
    submit();
    expect(await main.findByText("Enter a title")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue(value);
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-12-24");
    expect(posts(fn)).toHaveLength(0);
  });

  it("AC-001.3 a title over 200 characters shows the length message and sends no request", async () => {
    const fn = stubApi(() => json(200, []));
    const main = await renderPage();
    const long = "x".repeat(201);
    fill(long);
    submit();
    expect(await main.findByText("Title must be at most 200 characters")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue(long);
    expect(posts(fn)).toHaveLength(0);
  });

  it("AC-001.3 exactly 200 characters with surrounding spaces is accepted and POSTed", async () => {
    const exact = "x".repeat(200);
    const fn = stubApi((_url, init) => (isPost(init) ? json(201, task("9", exact, null)) : json(200, [])));
    const main = await renderPage();
    fill(`  ${exact}  `);
    submit();
    await waitFor(() => expect(listItems(main)).toHaveLength(1));
    expect(main.queryByText("Title must be at most 200 characters")).not.toBeInTheDocument();
    expect(main.queryByText("Enter a title")).not.toBeInTheDocument();
    const sent = posts(fn);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String((sent[0][1] as RequestInit).body)).title.trim()).toBe(exact);
  });
});

describe("AC-001.4 task limit", () => {
  it("AC-001.4 409 shows 'Task limit reached' without the API's detail, keeps values, lists no new task", async () => {
    stubApi((_url, init) => (isPost(init) ? json(409, { detail: "task limit reached" }) : json(200, [])));
    const main = await renderPage();
    fill("Buy milk", "2026-12-24");
    submit();
    expect(await main.findByText("Task limit reached")).toBeInTheDocument();
    expect(pageText()).not.toContain("task limit reached");
    expect(screen.getByLabelText("Title")).toHaveValue("Buy milk");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-12-24");
    expect(main.queryByRole("list", { name: "Tasks" })).not.toBeInTheDocument();
    expect(main.getByText("No tasks yet")).toBeInTheDocument();
  });
});

describe("AC-001.5 list load failure", () => {
  const failures: Array<[string, Handler, string?]> = [
    ["unreachable", () => Promise.reject(new TypeError("fetch failed"))],
    ["500", () => json(500, { detail: "internal boom" }), "internal boom"],
    ["503", () => json(503, { detail: "storage unavailable" }), "storage unavailable"],
    ["unlisted status 418", () => json(418, { detail: "teapot" }), "teapot"],
  ];
  it.each(failures)("AC-001.5 %s shows the load error in place of the list", async (_n, handler, detail) => {
    stubApi(handler);
    const main = await renderPage();
    expect(main.getByText("Tasks could not be loaded. Try again later.")).toBeInTheDocument();
    expect(main.queryByText("No tasks yet")).not.toBeInTheDocument();
    expect(main.queryByRole("list", { name: "Tasks" })).not.toBeInTheDocument();
    if (detail) expect(pageText()).not.toContain(detail);
  });

  it("AC-001.5 a call that never answers shows the load error at 5 s and not before", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    routeAbortTimeoutThroughFakeTimers();
    stubApi(hang);
    let settled = false;
    const pending = Promise.resolve(HomePage()).then((ui) => {
      settled = true;
      return ui;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const ui = await pending;
    render(ui);
    expect(within(screen.getByRole("main")).getByText("Tasks could not be loaded. Try again later.")).toBeInTheDocument();
  });
});

describe("AC-001.6 save failure", () => {
  const failures: Array<[string, Handler, string?]> = [
    ["unreachable", () => Promise.reject(new TypeError("fetch failed"))],
    ["500", () => json(500, { detail: "internal boom" }), "internal boom"],
    ["503", () => json(503, { detail: "storage unavailable" }), "storage unavailable"],
    [
      "422 naming only due_date",
      () => json(422, { detail: [{ loc: ["body", "due_date"], msg: "Input should be a valid date", type: "date_from_datetime_parsing" }] }),
      "Input should be a valid date",
    ],
    ["unlisted status 418", () => json(418, { detail: "teapot" }), "teapot"],
  ];
  it.each(failures)(
    "AC-001.6 POST %s shows 'Task could not be saved. Try again.' without detail and keeps values",
    async (_n, handler, detail) => {
      stubApi((url, init) => (isPost(init) ? handler(url, init) : json(200, [])));
      const main = await renderPage();
      fill("Buy milk", "2026-12-24");
      submit();
      expect(await main.findByText("Task could not be saved. Try again.")).toBeInTheDocument();
      if (detail) expect(pageText()).not.toContain(detail);
      expect(screen.getByLabelText("Title")).toHaveValue("Buy milk");
      expect(screen.getByLabelText("Due date")).toHaveValue("2026-12-24");
      expect(main.queryByRole("list", { name: "Tasks" })).not.toBeInTheDocument();
    },
  );

  it("AC-001.6 a POST that never answers shows the save error at 5 s and not before", async () => {
    stubApi((_url, init) => (isPost(init) ? hang(_url, init) : json(200, [])));
    const main = await renderPage();
    fill("Buy milk", "2026-12-24");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    routeAbortTimeoutThroughFakeTimers();
    await act(async () => {
      submit();
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(main.queryByText("Task could not be saved. Try again.")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(main.getByText("Task could not be saved. Try again.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Buy milk");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-12-24");
    expect(main.queryByRole("list", { name: "Tasks" })).not.toBeInTheDocument();
  });
});

describe("AC-001.8 API title rejection", () => {
  it("AC-001.8 a 422 naming title shows the API msg at Title, keeps values and lists no task", async () => {
    const msg = "String should have at least 1 character";
    stubApi((_url, init) =>
      isPost(init)
        ? json(422, { detail: [{ loc: ["body", "title"], msg, type: "string_too_short" }] })
        : json(200, []),
    );
    const main = await renderPage();
    fill("Buy milk", "2026-12-24");
    submit();
    expect(await main.findByText(msg)).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveAccessibleDescription(msg);
    expect(main.queryByText("Task could not be saved. Try again.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Buy milk");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-12-24");
    expect(main.queryByRole("list", { name: "Tasks" })).not.toBeInTheDocument();
  });
});

describe("AC-001.7 probes independent of the Task API", () => {
  it("AC-001.7 /api/health and /api/ready answer 200 while the API is unreachable and the page still renders", async () => {
    const fn = stubApi(() => Promise.reject(new TypeError("fetch failed")));
    const h = await health();
    const r = await ready();
    expect(h.status).toBe(200);
    expect(r.status).toBe(200);
    expect(fn).not.toHaveBeenCalled();

    const main = await renderPage();
    expect(main.getByText("Tasks could not be loaded. Try again later.")).toBeInTheDocument();
  });
});
