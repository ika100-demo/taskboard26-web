"use client";

import { useState, useTransition, type FormEvent } from "react";

import { createTaskAction } from "@/app/actions";
import type { Task } from "@/lib/tasks/api";
import { MSG } from "@/lib/tasks/messages";
import { validateTask } from "@/lib/tasks/validate";

export type TaskBoardProps = { initialTasks: Task[]; loadFailed: boolean };

export function TaskBoard({ initialTasks, loadFailed }: TaskBoardProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTitleError(null);
    setFormError(null);
    const errors = validateTask({ title });
    if (errors.title) {
      setTitleError(errors.title);
      return;
    }
    startTransition(async () => {
      const result = await createTaskAction({ title, due_date: dueDate });
      if (result.ok) {
        setTasks((current) => [...current, result.task]);
        setTitle("");
        setDueDate("");
      } else if ("fieldErrors" in result) {
        if (result.fieldErrors.title) setTitleError(result.fieldErrors.title);
        else setFormError(MSG.saveFailed);
      } else {
        setFormError(result.error === "limit" ? MSG.limitReached : MSG.saveFailed);
      }
    });
  }

  return (
    <>
      {tasks.length > 0 ? (
        <ul aria-label="Tasks" className="task-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <span>{task.title}</span>
              <span className="task-due">{task.due_date ?? MSG.noDueDate}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{loadFailed ? MSG.loadFailed : MSG.emptyList}</p>
      )}
      {loadFailed && tasks.length > 0 ? <p>{MSG.loadFailed}</p> : null}
      <form aria-label="Add task" noValidate onSubmit={onSubmit} className="task-form">
        <div className="field">
          <label htmlFor="task-title">Title</label>
          <input
            id="task-title"
            name="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? "title-error" : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor="task-due-date">Due date</label>
          <input
            id="task-due-date"
            name="due_date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        {titleError ? (
          <p id="title-error" role="alert" className="error-text">
            {titleError}
          </p>
        ) : null}
        {formError ? (
          <p id="form-error" role="alert" className="error-text">
            {formError}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          Add task
        </button>
      </form>
    </>
  );
}
