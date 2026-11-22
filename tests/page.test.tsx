import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/page";
import { createTaskAction } from "@/app/actions";
import { createTask, listTasks, type Task } from "@/lib/tasks/api";

vi.mock("@/lib/tasks/api", () => ({ listTasks: vi.fn(), createTask: vi.fn() }));

const task = (id: string, title: string, due: string | null = null): Task => ({
  id,
  title,
  due_date: due,
  created_at: "2026-01-01T00:00:00Z",
});

async function renderPage(result: Awaited<ReturnType<typeof listTasks>>) {
  vi.mocked(listTasks).mockResolvedValue(result);
  render(await HomePage());
}

const fill = (title: string, due?: string) => {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: title } });
  if (due !== undefined) fireEvent.change(screen.getByLabelText("Due date"), { target: { value: due } });
};
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Add task" }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("HomePage", () => {
  it("owns the main landmark the skip link targets and a single h1", async () => {
    await renderPage({ ok: true, tasks: [] });
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Tasks" })).toBeInTheDocument();
  });

  it("lists tasks with due date or 'No due date'", async () => {
    await renderPage({ ok: true, tasks: [task("1", "A", "2026-12-24"), task("2", "B")] });
    const items = within(screen.getByRole("list", { name: "Tasks" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("2026-12-24");
    expect(items[1]).toHaveTextContent("No due date");
  });

  it("shows the empty state", async () => {
    await renderPage({ ok: true, tasks: [] });
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows the load error and keeps the form", async () => {
    await renderPage({ ok: false });
    expect(screen.getByText("Tasks could not be loaded. Try again later.")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add task" })).toBeInTheDocument();
  });
});

describe("task board interactions", () => {
  it("appends the created task and clears the inputs", async () => {
    await renderPage({ ok: true, tasks: [] });
    vi.mocked(createTask).mockResolvedValue({ ok: true, task: task("9", "Buy milk", "2026-12-25") });
    fill("Buy milk", "2026-12-25");
    submit();
    await waitFor(() => expect(screen.getByRole("list", { name: "Tasks" })).toHaveTextContent("Buy milk"));
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Due date")).toHaveValue("");
  });

  it("shows a title error without calling the API", async () => {
    await renderPage({ ok: true, tasks: [] });
    fill("   ");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a title");
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-describedby", "title-error");
    expect(createTask).not.toHaveBeenCalled();
  });

  it("shows the limit message and keeps the values", async () => {
    await renderPage({ ok: true, tasks: [] });
    vi.mocked(createTask).mockResolvedValue({ ok: false, error: "limit" });
    fill("Buy milk");
    submit();
    expect(await screen.findByText("Task limit reached")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Buy milk");
  });

  it("shows the save error", async () => {
    await renderPage({ ok: true, tasks: [] });
    vi.mocked(createTask).mockResolvedValue({ ok: false, error: "failed" });
    fill("Buy milk");
    submit();
    expect(await screen.findByText("Task could not be saved. Try again.")).toBeInTheDocument();
  });

  it("appends a created task below the load error", async () => {
    await renderPage({ ok: false });
    vi.mocked(createTask).mockResolvedValue({ ok: true, task: task("9", "Buy milk") });
    fill("Buy milk");
    submit();
    await waitFor(() => expect(screen.getByRole("list", { name: "Tasks" })).toBeInTheDocument());
    expect(screen.getByText("Tasks could not be loaded. Try again later.")).toBeInTheDocument();
  });
});

describe("createTaskAction", () => {
  it("returns field errors without calling the API", async () => {
    expect(await createTaskAction({ title: " ", due_date: "" })).toEqual({
      ok: false,
      fieldErrors: { title: "Enter a title" },
    });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("omits an empty due date and passes the result through", async () => {
    vi.mocked(createTask).mockResolvedValue({ ok: false, error: "limit" });
    expect(await createTaskAction({ title: "A", due_date: "" })).toEqual({ ok: false, error: "limit" });
    expect(createTask).toHaveBeenCalledWith({ title: "A" });
    await createTaskAction({ title: "A", due_date: "2026-12-24" });
    expect(createTask).toHaveBeenLastCalledWith({ title: "A", due_date: "2026-12-24" });
  });
});
