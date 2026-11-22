import { listTasks } from "@/lib/tasks/api";

import { TaskBoard } from "./_components/task-board";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const result = await listTasks();
  return (
    <main id="main-content">
      <div className="board">
        <h1 className="section-title">Tasks</h1>
        <TaskBoard initialTasks={result.ok ? result.tasks : []} loadFailed={!result.ok} />
      </div>
    </main>
  );
}
