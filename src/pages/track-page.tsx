import { EntriesPanel } from "@/features/entries/entries-panel";
import { SessionSection } from "@/features/session/session-section";

export function TrackPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-5 xl:p-7">
      <section id="session-section" className="scroll-mt-6">
        <SessionSection />
      </section>

      <section id="entries-section" className="scroll-mt-6 pb-10">
        <EntriesPanel />
      </section>
    </main>
  );
}
