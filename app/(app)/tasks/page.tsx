import Link from "next/link";
import { readPageData } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import {
  getCurrentOrgId, listBoardTasks, listOpenReminders, loadOperationsData,
} from "@/lib/db/queries";
import { detectRecurring } from "@/lib/ops/recurring";
import { RecurringSuggestions } from "@/components/tasks/RecurringSuggestions";
import { TaskViews } from "@/components/tasks/TaskViews";
import { ReminderStrip } from "@/components/tasks/ReminderStrip";
import { PageHeader, EmptyState, buttonStyle, pageStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const orgId = await getCurrentOrgId("/tasks");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Task board" />
      <EmptyState
        title="Sign in to see your board"
        body="Every commitment you approve lands here, with whatever has slipped past its date at the top."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const [board, reminders, operations] = await Promise.all([
    readPageData("/tasks: task board with commitment/client", () => listBoardTasks(orgId)),
    readPageData("/tasks: reminder with task", () => listOpenReminders(orgId)),
    readPageData("/tasks: recurring data", () => loadOperationsData(orgId, "/tasks")),
  ]);
  const tasks = board.data ?? [];
  const opsData = operations.data;
  const recurringUnavailable = !opsData || Object.values(opsData.unavailable).some(Boolean);

  const now = new Date();
  // Only what is due, and only patterns still alive: a promise last made three cycles ago
  // is an abandoned habit, not a prediction. Flagged by the detector's author as the main
  // false-positive risk, so it is filtered here rather than shown and explained away.
  const suggestions = (recurringUnavailable ? [] : detectRecurring(opsData, now))
    .filter((p) => p.isDue)
    .filter((p) => (now.getTime() - Date.parse(p.lastSeenIso)) / 86_400_000
      <= p.medianGapDays * 3)
    .slice(0, 5);

  const late = tasks.filter(
    (t) => t.status !== "done" && !!t.due && Date.parse(t.due) < now.getTime()).length;
  const live = tasks.filter((t) => t.status !== "done").length;

  return (
    <main style={pageStyle}>
      <PageHeader
        title="Task board"
        lede="Every approved commitment lands here. Moving a card to delivered closes the promise it came from."
        meta={tasks.length > 0
          ? `${live} open · ${late} late · ${tasks.length - live} delivered`
          : undefined}
      />

      {/*
        Order of the screen, deliberately:
          1. what is already broken   (overdue promises)
          2. what is in front of you  (the board)
          3. what might be coming     (recurring guesses)
        Reminders and suggestions both used to claim the top and competed for it. A broken
        promise to a client is the highest-stakes thing on the page and the reason the
        product exists; a prediction is the lowest, because nobody has promised it yet.
        Putting guesses above failures inverted that, so the guesses moved below the board.
      */}
      {reminders.unavailable ? <Unavailable section="Reminders are" /> : <ReminderStrip items={reminders.data ?? []} nowIso={now.toISOString()} />}

      {board.unavailable ? <Unavailable section="The task board is" /> : tasks.length === 0 ? (
        <EmptyState
          title="Nothing on the board yet"
          body="Approve a commitment in the queue and it becomes a task here, with its client, owner, and date attached."
          action={<Link href="/queue" className="cf-btn"
            style={buttonStyle("primary")}>Go to the queue</Link>}
        />
      ) : (
        <TaskViews items={tasks} nowIso={now.toISOString()} />
      )}

      {recurringUnavailable ? <Unavailable section="Recurring suggestions are" /> : <RecurringSuggestions patterns={suggestions} />}
    </main>
  );
}
