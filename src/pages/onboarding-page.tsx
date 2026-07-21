import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, FilePlus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createDatabaseRegistryEntry,
  parseDatabaseRegistry,
  parseDatabaseRegistrySettings,
  serializeDatabaseRegistry,
  setActiveDatabaseEntry,
  type DatabaseLocation
} from "@/lib/database-registry";
import { getPlatformApi } from "@/lib/platform";
import { serializeTimeLogYaml } from "@/lib/yaml";
import { TEMPLATE_OPTIONS, TemplateService } from "@/services/template-service";
import { useAppStore } from "@/store/app-store";

const FEATURE_PAGES = [
  {
    title: "Track",
    description: "Capture where your time goes with flexible, structured entries. Start a live timer or add time manually, record breaks, and review your work across list, week, and month views.",
    faqs: [
      {
        question: "Where is the data stored?",
        answer: "Taskasaur stores your work in portable .csdb database files that you control. CSDB combines table schemas, metadata, and CSV-style tabular data in a structured, human-readable format.",
        link: { href: "https://csvdatabase.net", label: "Learn more at csvdatabase.net" }
      },
      {
        question: "What can I track with custom fields?",
        answer: "Tracking fields are completely customizable. They support text and Markdown, numbers, true/false values, dates and times, paths and file search, single- and multi-select options, attribute references, and task-source filters."
      }
    ]
  },
  {
    title: "Tasks",
    description: "Bring your work into one clear view, organize it around the way you work, and keep the next action close at hand. Switch between table and Kanban views, then group, filter, and sort until the work that matters is easy to see.",
    faqs: [
      { question: "Where do tasks come from?", answer: "Tasks can be created directly inside Taskasaur or synced from Markdown files, GitHub issues, and linked mail. Mail can become an actionable task alongside the rest of your work, so requests do not stay buried in an inbox." },
      { question: "Can tasks connect to tracked time?", answer: "Yes. Track selections can filter your task sources and show the tasks that matter for the work you are recording—even before a timer is running. Choose a relevant task to keep the work, its context, and the time spent together." }
    ]
  },
  {
    title: "Focus",
    description: "Set a focused work interval and give one task your full attention.",
    faqs: [
      { question: "Can I change the focus length?", answer: "Yes. Choose a preset or enter a custom focus length to follow a Pomodoro rhythm, such as 25 minutes of focused work followed by a short break. Switch between Focus and Break whenever you are ready." },
      { question: "What platforms is Taskasaur available on?", answer: "Taskasaur is designed for macOS, iOS, and Windows, so your tracking, tasks, and focus workflow can stay familiar across desktop and mobile." }
    ]
  }
] as const;

export function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(-1);
  const [location, setLocation] = useState<DatabaseLocation>("Internal");
  const [url, setUrl] = useState("");
  const [templateId, setTemplateId] = useState("blank");
  const [saving, setSaving] = useState(false);

  async function finish(extraEntries?: ReturnType<typeof createDatabaseRegistryEntry>[], activeId?: string) {
    const raw = await getPlatformApi().readDatabaseRegistry();
    const entries = raw.trim() ? parseDatabaseRegistry(raw) : [];
    const settings = { ...parseDatabaseRegistrySettings(raw), onboarding_complete: true };
    const combined = extraEntries ? [...entries, ...extraEntries] : entries;
    await getPlatformApi().saveDatabaseRegistry(
      serializeDatabaseRegistry(activeId ? setActiveDatabaseEntry(combined, activeId) : combined, settings)
    );
    onComplete();
  }

  async function choosePath() {
    const chosen = await getPlatformApi().chooseDatabaseUrl(url || "taskasaur");
    if (chosen) setUrl(chosen);
  }

  async function createDatabase() {
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error(location === "Internal" ? "Database name required" : "Database URL required");
      return;
    }
    setSaving(true);
    try {
      const rawRegistry = await getPlatformApi().readDatabaseRegistry();
      const entries = rawRegistry.trim() ? parseDatabaseRegistry(rawRegistry) : [];
      const registryUrl = location === "Internal" ? trimmed.replace(/\.csdb$/i, "") : trimmed;
      if (entries.some((entry) => entry.location === location && entry.url === registryUrl)) {
        toast.error("Database already exists", { description: "Choose a different name or path." });
        return;
      }
      const template = TemplateService.getTemplate(templateId) ?? TemplateService.getTemplate("blank");
      if (!template) throw new Error("No database template is available.");
      const created = await getPlatformApi().createDatabaseFile({
        location,
        url: trimmed,
        raw: serializeTimeLogYaml(template.content)
      });
      if (!created) return;
      const entry = createDatabaseRegistryEntry(location, created.registryUrl);
      const loaded = await useAppStore.getState().loadDatabaseFile({ location, url: created.registryUrl });
      await finish([entry], loaded ? entry.id : undefined);
    } catch (error) {
      toast.error("Couldn't create database", {
        description: error instanceof Error ? error.message : "Please try again."
      });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  if (step === -1) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-6 text-center">
        <img src="/taskasaur_icon.png" alt="Taskasaur" draggable={false} className="pointer-events-none aspect-square max-h-[78vh] w-[min(98vw,46rem)] select-none object-contain" />
        <Button size="lg" className="h-14 min-w-64 rounded-xl px-8 text-lg" onClick={() => setStep(0)}>Continue</Button>
      </main>
    );
  }

  const isDatabaseStep = step === FEATURE_PAGES.length;
  const feature = FEATURE_PAGES[step];

  return (
    <main className="flex min-h-screen flex-col bg-background px-5 py-8 sm:px-10">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center py-8">
        {feature ? (
          <section className="mx-auto w-full max-w-2xl">
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">{feature.title}</h1>
            <p className="mt-5 text-lg text-muted-foreground sm:text-xl">{feature.description}</p>
            <div className="mt-10 space-y-3">
              {feature.faqs.map((faq) => (
                <details key={faq.question} className="group rounded-xl border bg-card px-5 py-4">
                  <summary className="cursor-pointer list-none font-semibold marker:hidden">{faq.question}</summary>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {faq.answer}
                    {"link" in faq ? (
                      <> <a href={faq.link.href} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-4">{faq.link.label}</a>.</>
                    ) : null}
                  </p>
                </details>
              ))}
            </div>
          </section>
        ) : null}

        {isDatabaseStep ? (
          <section className="w-full">
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Create your CSDB text database</h1>
            <p className="mt-4 text-muted-foreground">Choose where your data lives and a starting template. You can change everything later.</p>
            <div className="mt-8 overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader><TableRow><TableHead>Location</TableHead><TableHead>URL</TableHead><TableHead>Template</TableHead><TableHead className="text-right">Create</TableHead></TableRow></TableHeader>
                <TableBody><TableRow>
                  <TableCell><Select value={location} onValueChange={(value) => setLocation(value as DatabaseLocation)}><SelectTrigger className="w-[140px]"><SelectValue>{location}</SelectValue></SelectTrigger><SelectContent><SelectItem value="Internal">Internal</SelectItem><SelectItem value="Path">Path</SelectItem></SelectContent></Select></TableCell>
                  <TableCell><div className="flex min-w-[240px] gap-2"><Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={location === "Internal" ? "Database name" : "Database URL"} />{location === "Path" ? <Button variant="outline" size="icon" onClick={choosePath}><FilePlus className="size-4" /></Button> : null}</div></TableCell>
                  <TableCell><Select value={templateId} onValueChange={(value) => value && setTemplateId(value)}><SelectTrigger className="w-[180px]"><SelectValue>{TEMPLATE_OPTIONS.find((item) => item.id === templateId)?.name}</SelectValue></SelectTrigger><SelectContent>{TEMPLATE_OPTIONS.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></TableCell>
                  <TableCell className="text-right"><Button size="icon" disabled={saving} onClick={createDatabase} aria-label="Create database"><Plus className="size-4" /></Button></TableCell>
                </TableRow></TableBody>
              </Table>
            </div>
          </section>
        ) : null}
      </div>

      <nav className="mx-auto grid w-full max-w-md grid-cols-3 items-center gap-8" aria-label="Onboarding navigation">
        <div><Button variant="outline" size="icon-lg" className="size-12 rounded-xl" onClick={() => setStep((value) => value - 1)} aria-label={step === 0 ? "Back to welcome" : "Previous"}><ArrowLeft className="size-6" /></Button></div>
        <Button variant="ghost" size="icon-lg" className="size-12 justify-self-center rounded-xl" onClick={() => void finish()} aria-label="Cancel onboarding"><X className="size-7" /></Button>
        <div className="justify-self-end">{!isDatabaseStep ? <Button size="icon-lg" className="size-12 rounded-xl" onClick={() => setStep((value) => value + 1)} aria-label="Next"><ArrowRight className="size-6" /></Button> : null}</div>
      </nav>
    </main>
  );
}
