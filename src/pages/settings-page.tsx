import { DatabaseSection } from "@/features/database/database-section";
import { TaskSettingsSection } from "@/features/tasks/task-settings-section";

export function SettingsPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col p-5 xl:p-7">
      <section id="settings-section" className="scroll-mt-6 pb-6">
        <DatabaseSection />
      </section>
      <section id="task-settings-section" className="scroll-mt-6 pb-10">
        <TaskSettingsSection />
      </section>
    </main>
  );
}
