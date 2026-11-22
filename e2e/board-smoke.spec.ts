import { expect, test } from "@playwright/test";

test.skip(!process.env.SMOKE_BASE_URL, "SMOKE_BASE_URL not set");

// Read-only: checks that TASK_API_URL is wired after a deploy (the list loaded).
test("the board shows the add form and no load error @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("form", { name: "Add task" })).toBeVisible();
  await expect(page.getByText("Tasks could not be loaded. Try again later.")).toHaveCount(0);
});
