// Project-owned: wires the contract check (tests/contract.test.ts) to the task board (spec 110, spec 001).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { vi } from "vitest";

import { TaskBoard } from "@/app/_components/task-board";
import type { ContractAdapter, FieldErrors } from "@/lib/contract/engine";
import { validateTask } from "@/lib/tasks/validate";

export const adapter: ContractAdapter = {
  base: () => ({ title: "Buy milk" }),
  validate: (_endpoint, body) => validateTask(body),
  async showResponse(_endpoint, response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(response.body), { status: response.status })),
    );
    try {
      const { container } = render(createElement(TaskBoard, { initialTasks: [], loadFailed: false }));
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Buy milk" } });
      fireEvent.click(screen.getByRole("button", { name: "Add task" }));
      await screen.findByRole("alert");
      const fields: FieldErrors = {};
      const title = container.querySelector("#title-error")?.textContent;
      if (title) fields.title = title;
      const form = container.querySelector("#form-error")?.textContent ?? undefined;
      return { fields, form };
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  },
};
