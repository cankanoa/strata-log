import { DatabaseSection } from "@/features/database/database-section";

export function SettingsPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-5 xl:p-7">
      <section id="settings-section" className="scroll-mt-6 pb-10">
        <DatabaseSection />
      </section>
    </main>
  );
}
