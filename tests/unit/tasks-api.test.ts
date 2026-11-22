import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, listTasks } from "@/lib/tasks/api";

const task = { id: "1", title: "a", due_date: null, created_at: "2026-01-01T00:00:00Z" };

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.env.TASK_API_URL = "http://api.test/";
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.TASK_API_URL;
});

describe("listTasks", () => {
  it("returns tasks on 200", async () => {
    fetchMock.mockResolvedValue(reply(200, [task]));
    expect(await listTasks()).toEqual({ ok: true, tasks: [task] });
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/tasks");
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
  });

  it.each([
    ["non-array", reply(200, { a: 1 })],
    ["bad item", reply(200, [{ id: 1 }])],
    ["invalid json", reply(200, "not json")],
    ["503", reply(503, { detail: "x" })],
    ["500", reply(500, {})],
    ["418", reply(418, {})],
  ])("fails on %s", async (_n, res) => {
    fetchMock.mockResolvedValue(res);
    expect(await listTasks()).toEqual({ ok: false });
  });

  it.each(["Error", "AbortError", "TimeoutError"])("fails on rejected fetch (%s)", async (name) => {
    const err = new Error("boom");
    err.name = name;
    fetchMock.mockRejectedValue(err);
    expect(await listTasks()).toEqual({ ok: false });
  });
});

describe("createTask", () => {
  it("returns the task on 201", async () => {
    fetchMock.mockResolvedValue(reply(201, task));
    expect(await createTask({ title: "a" })).toEqual({ ok: true, task });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("omits due_date when empty and sends it otherwise", async () => {
    fetchMock.mockResolvedValue(reply(201, task));
    await createTask({ title: "a", due_date: "" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ title: "a" });
    await createTask({ title: "a", due_date: "2026-02-01" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ title: "a", due_date: "2026-02-01" });
  });

  it("maps 409 to limit", async () => {
    fetchMock.mockResolvedValue(reply(409, { detail: "x" }));
    expect(await createTask({ title: "a" })).toEqual({ ok: false, error: "limit" });
  });

  it.each([
    ["422", reply(422, {})],
    ["500", reply(500, {})],
    ["418", reply(418, {})],
    ["201 bad body", reply(201, { id: 1 })],
  ])("maps %s to failed", async (_n, res) => {
    fetchMock.mockResolvedValue(res);
    expect(await createTask({ title: "a" })).toEqual({ ok: false, error: "failed" });
  });

  it("maps rejected fetch and timeout to failed", async () => {
    const err = new Error("t");
    err.name = "TimeoutError";
    fetchMock.mockRejectedValue(err);
    expect(await createTask({ title: "a" })).toEqual({ ok: false, error: "failed" });
  });
});
