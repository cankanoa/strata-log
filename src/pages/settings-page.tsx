import { DatabaseSection } from "@/features/database/database-section";
import { TaskSettingsSection } from "@/features/tasks/task-settings-section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { defaultGeneralSettings } from "@/lib/defaults";
import { restartOnboarding } from "@/lib/app-settings";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

function SettingsHeading({ children }: { children: string }) {
  return <h2 className="text-lg font-semibold text-foreground">{children}</h2>;
}

function SourceRefreshSettings() {
  const { file, updateSettings } = useAppStore(
    useShallow((state) => ({
      file: state.file,
      updateSettings: state.updateSettings
    }))
  );
  const settings = file?.settings ?? defaultGeneralSettings;

  return (
    <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
      <CardHeader>
        <CardTitle>Refresh Rate</CardTitle>
      </CardHeader>
      <CardContent>
        <Input
          type="number"
          min={0}
          step={1}
          value={settings.refreshRateSeconds}
          disabled={!file}
          onChange={(event) => {
            const refreshRateSeconds = Math.max(0, Math.floor(Number(event.target.value) || 0));
            void updateSettings({
              ...settings,
              refreshRateSeconds
            });
          }}
        />
        <p className="mt-2 text-sm text-muted-foreground">Seconds between source checks. 0 disables automatic refresh.</p>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 p-5 xl:p-7">
      <section id="sources-settings-section" className="grid scroll-mt-6 gap-4">
        <SettingsHeading>Sources</SettingsHeading>
        <DatabaseSection sections={["sources"]} />
        <SourceRefreshSettings />
        <TaskSettingsSection sections={["accounts"]} />
      </section>

      <section id="settings-section" className="grid scroll-mt-6 gap-4">
        <SettingsHeading>Track</SettingsHeading>
        <DatabaseSection sections={["track"]} />
      </section>

      <section id="task-settings-section" className="grid scroll-mt-6 gap-4">
        <SettingsHeading>Tasks</SettingsHeading>
        <TaskSettingsSection sections={["tasks"]} />
      </section>

      <section id="information-settings-section" className="grid scroll-mt-6 gap-4 pb-10">
        <SettingsHeading>Information</SettingsHeading>
        <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
          <CardHeader>
            <CardTitle>Open Source Project</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              Source code, releases, and project information is available here:{" "}
              <a
                href="https://github.com/taskasaur/taskasaur"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
              >
                taskasaur/taskasaur
              </a>.
            </p>
            <p className="text-sm text-muted-foreground">
              The homepage of the site is available here:{" "}
              <a
                href="https://taskasaur.net"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
              >
                taskasaur.net
              </a>.
            </p>
          </CardContent>
        </Card>
        <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
          <CardHeader>
            <CardTitle>Onboarding</CardTitle>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={() => void restartOnboarding()}>
              Restart Onboarding
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
