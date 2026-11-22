import { describe, expect, it } from "vitest";
import { MSG } from "@/lib/tasks/messages";
import { validateTask } from "@/lib/tasks/validate";

describe("validateTask", () => {
  it("requires a title when missing", () => {
    expect(validateTask({})).toEqual({ title: MSG.titleRequired });
  });
  it("requires a non-string title", () => {
    expect(validateTask({ title: 5 })).toEqual({ title: MSG.titleRequired });
  });
  it("rejects an empty title", () => {
    expect(validateTask({ title: "" })).toEqual({ title: MSG.titleRequired });
  });
  it("rejects a whitespace-only title", () => {
    expect(validateTask({ title: "   " })).toEqual({
      title: MSG.titleRequired,
    });
  });
  it("accepts 200 characters", () => {
    expect(validateTask({ title: "x".repeat(200) })).toEqual({});
  });
  it("rejects 201 characters", () => {
    expect(validateTask({ title: "x".repeat(201) })).toEqual({
      title: MSG.titleTooLong,
    });
  });
  it("accepts 200 characters after trimming", () => {
    expect(validateTask({ title: `  ${"x".repeat(200)}  ` })).toEqual({});
  });
});
