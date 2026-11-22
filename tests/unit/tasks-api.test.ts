import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, listTasks, titleErrorMessage } from "@/lib/tasks/api";

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

describe("titleErrorMessage", () => {
  it.each([
    [null, null],
    ["x", null],
    [{}, null],
    [{ detail: [] }, null],
    [{ detail: ["x", null, { loc: ["title"], msg: "m" }] }, "m"],
    [{ detail: [{ loc: ["body", "title", 0], msg: "m" }] }, null],
    [{ detail: [{ loc: 3, msg: "m" }] }, null],
  ])("titleErrorMessage(%j) is %j", (body, expected) => {
    expect(titleErrorMessage(body)).toBe(expected);
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

  it.each([
    ["loc list", { detail: [{ loc: ["body", "title"], msg: "too long" }] }, "too long"],
    ["loc string", { detail: [{ loc: "title", msg: "bad" }] }, "bad"],
    [
      "due_date first",
      { detail: [{ loc: ["body", "due_date"], msg: "d" }, { loc: ["body", "title"], msg: "t" }] },
      "t",
    ],
    [
      "two title entries",
      { detail: [{ loc: ["body", "title"], msg: "first" }, { loc: ["body", "title"], msg: "second" }] },
      "first",
    ],
  ])("maps a 422 with a title entry (%s) to fieldErrors", async (_n, body, msg) => {
    fetchMock.mockResolvedValue(reply(422, body));
    expect(await createTask({ title: "a" })).toEqual({ ok: false, fieldErrors: { title: msg } });
  });

  it.each([
    ["only due_date", reply(422, { detail: [{ loc: ["body", "due_date"], msg: "d" }] })],
    ["empty msg", reply(422, { detail: [{ loc: ["body", "title"], msg: "" }] })],
    ["non-string msg", reply(422, { detail: [{ loc: ["body", "title"], msg: 5 }] })],
    ["non-list detail", reply(422, { detail: "title" })],
    ["invalid json", reply(422, "not json")],
  ])("maps a 422 without a usable title msg (%s) to failed", async (_n, res) => {
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
