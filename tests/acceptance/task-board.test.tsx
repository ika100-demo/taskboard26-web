import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/page";
import { GET as health } from "@/app/api/health/route";
import { GET as ready } from "@/app/api/ready/route";

type Task = { id: string; title: string; due_date: string | null; created_at: string };

const task = (id: string, title: string, due: string | null): Task => ({
  id,
  title,
  due_date: due,
  created_at: "2026-01-01T00:00:00Z",
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
const posts = (fn: ReturnType<typeof stubApi>) => fn.mock.calls.filter(([, init]) => isPost(init as RequestInit | undefined));

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

beforeEach(() => {
  vi.stubEnv("TASK_API_URL", "http://task-api.test");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AC-001.1 list", () => {
  it("AC-001.1 shows the API's tasks in order with title and due date or 'No due date'", async () => {
    stubApi(() =>
      json(200, [task("1", "A task", "2026-12-24"), task("2", "B task", null), task("3", "C task", "2027-01-02")]),
    );
    const main = await renderPage();
    const items = within(main.getByRole("list", { name: "Tasks" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("A task");
    expect(items[0]).toHaveTextContent("2026-12-24");
    expect(items[1]).toHaveTextContent("B task");
    expect(items[1]).toHaveTextContent("No due date");
    expect(items[2]).toHaveTextContent("C task");
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
  it("AC-001.2 POSTs the task, appends it at the end and empties the fields", async () => {
    const created = task("9", "Buy milk", "2026-12-24");
    const fn = stubApi((url, init) => {
      if (isPost(init)) return json(201, created);
      return json(200, [task("1", "A task", null)]);
    });
    const main = await renderPage();
    fill("Buy milk", "2026-12-24");
    submit();
    await waitFor(() => expect(main.getByText("Buy milk")).toBeInTheDocument());

    const items = within(main.getByRole("list", { name: "Tasks" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent("Buy milk");
    expect(items[1]).toHaveTextContent("2026-12-24");
    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toHaveValue("");
      expect(screen.getByLabelText("Due date")).toHaveValue("");
    });

    const sent = posts(fn);
    expect(sent).toHaveLength(1);
    expect(String(sent[0][0])).toBe("http://task-api.test/tasks");
    expect(JSON.parse(String((sent[0][1] as RequestInit).body))).toEqual({ title: "Buy milk", due_date: "2026-12-24" });
  });

  it("AC-001.2 sends no due_date when the field is empty", async () => {
    const fn = stubApi((url, init) => (isPost(init) ? json(201, task("9", "Buy milk", null)) : json(200, [])));
    const main = await renderPage();
    fill("Buy milk");
    submit();
    await waitFor(() => expect(main.getByText("Buy milk")).toBeInTheDocument());
    expect(JSON.parse(String((posts(fn)[0][1] as RequestInit).body))).toEqual({ title: "Buy milk" });
  });
});

describe("AC-001.3 validation", () => {
  it.each([["empty", ""], ["whitespace", "   "]])("AC-001.3 %s title shows 'Enter a title' and sends no request", async (_n, value) => {
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
});

describe("AC-001.4 task limit", () => {
  it("AC-001.4 409 shows 'Task limit reached', keeps values, lists no new task", async () => {
    stubApi((url, init) => (isPost(init) ? json(409, { detail: "limit" }) : json(200, [])));
    const main = await renderPage();
    fill("Buy milk", "2026-12-24");
    submit();
    expect(await main.findByText("Task limit reached")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Buy milk");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-12-24");
    expect(main.queryByRole("list", { name: "Tasks" })).not.toBeInTheDocument();
    expect(main.getByText("No tasks yet")).toBeInTheDocument();
  });
});

describe("AC-001.5 list load failure", () => {
  const failures: Array<[string, Handler]> = [
    ["unreachable", () => Promise.reject(new TypeError("fetch failed"))],
    ["timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
    ["500", () => json(500, { detail: "boom" })],
    ["503", () => json(503, { detail: "down" })],
    ["unlisted status 418", () => json(418, {})],
  ];
  it.each(failures)("AC-001.5 %s shows the load error in place of the list", async (_n, handler) => {
    stubApi(handler);
    const main = await renderPage();
    expect(main.getByText("Tasks could not be loaded. Try again later.")).toBeInTheDocument();
    expect(main.queryByText("No tasks yet")).not.toBeInTheDocument();
    expect(main.queryByRole("list", { name: "Tasks" })).not.toBeInTheDocument();
  });
});

describe("AC-001.6 save failure", () => {
  const failures: Array<[string, Handler]> = [
    ["unreachable", () => Promise.reject(new TypeError("fetch failed"))],
    ["timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
    ["500", () => json(500, { detail: "boom" })],
    ["503", () => json(503, { detail: "down" })],
    ["422", () => json(422, { detail: [{ msg: "bad title", loc: ["body", "title"] }] })],
    ["unlisted status 418", () => json(418, {})],
  ];
  it.each(failures)("AC-001.6 POST %s shows 'Task could not be saved. Try again.' and keeps values", async (_n, handler) => {
    stubApi((url, init) => (isPost(init) ? handler(url, init) : json(200, [])));
    const main = await renderPage();
    fill("Buy milk", "2026-12-24");
    submit();
    expect(await main.findByText("Task could not be saved. Try again.")).toBeInTheDocument();
    expect(main.queryByText("bad title")).not.toBeInTheDocument();
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
