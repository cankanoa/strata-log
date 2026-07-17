import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Github, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { OnlineAccount, TaskSource, TaskSourceType } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

const NO_ACCOUNT = "__none__";

function sourceLabel(type: TaskSourceType): string {
  return type === "Github" ? "Github" : "Markdown";
}

function taskSourceDisplayName(source: TaskSource): string {
  return source.name?.trim() || (source.type === "Github" ? source.url.replace(/^https:\/\/github\.com\//i, "") : source.url);
}

export function TaskSettingsSection() {
  const { file, updateTaskSources, updateAccounts, syncTaskSource } = useAppStore(
    useShallow((state) => ({
      file: state.file,
      updateTaskSources: state.updateTaskSources,
      updateAccounts: state.updateAccounts,
      syncTaskSource: state.syncTaskSource
    }))
  );
  const [newSourceType, setNewSourceType] = useState<TaskSourceType>("Markdown");
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountToken, setNewAccountToken] = useState("");
  const sources = file?.taskSources ?? [];
  const accounts = file?.accounts ?? [];

  async function saveSource(source: TaskSource, patch: Partial<TaskSource>) {
    await updateTaskSources(sources.map((candidate) => candidate.id === source.id ? { ...candidate, ...patch } : candidate));
  }

  async function addSource() {
    if (!newSourceUrl.trim()) {
      return;
    }
    await updateTaskSources([
      ...sources,
      {
        id: uuidv4(),
        name: newSourceName.trim() || undefined,
        type: newSourceType,
        url: newSourceUrl.trim()
      }
    ]);
    setNewSourceName("");
    setNewSourceUrl("");
  }

  async function syncSource(sourceId: string) {
    const result = await syncTaskSource(sourceId);
    if (!result.authRequired) {
      return;
    }
    const token = window.prompt("GitHub token");
    if (token?.trim()) {
      await syncTaskSource(sourceId, token);
    }
  }

  async function syncAllSources() {
    for (const source of sources) {
      await syncSource(source.id);
    }
  }

  async function saveAccount(account: OnlineAccount, patch: Partial<OnlineAccount>) {
    await updateAccounts(accounts.map((candidate) => candidate.id === account.id ? { ...candidate, ...patch } : candidate));
  }

  async function addAccount() {
    if (!newAccountName.trim() || !newAccountToken.trim()) {
      return;
    }
    await updateAccounts([
      ...accounts,
      {
        id: uuidv4(),
        type: "Github",
        name: newAccountName.trim(),
        token: newAccountToken.trim()
      }
    ]);
    setNewAccountName("");
    setNewAccountToken("");
  }

  return (
    <div className="grid gap-6">
      <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader>
          <CardTitle>Task Sources</CardTitle>
          <CardAction>
            <Button type="button" variant="outline" size="sm" disabled={!file || sources.length === 0} onClick={() => void syncAllSources()}>
              <RefreshCw className="size-4" />
              Sync
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Type</TableHead>
                <TableHead className="w-48">Name</TableHead>
                <TableHead>URL</TableHead>
                <TableHead className="w-48">Account</TableHead>
                <TableHead className="w-36 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((source) => (
                <TableRow key={source.id}>
                  <TableCell>
                    <Select value={source.type} onValueChange={(value) => void saveSource(source, { type: value as TaskSourceType })}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{sourceLabel(source.type)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Markdown">Markdown</SelectItem>
                        <SelectItem value="Github">Github</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      key={source.name ?? ""}
                      defaultValue={source.name ?? ""}
                      onBlur={(event) => void saveSource(source, { name: event.target.value.trim() || undefined })}
                      placeholder={taskSourceDisplayName(source)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      key={source.url}
                      defaultValue={source.url}
                      onBlur={(event) => {
                        const url = event.target.value.trim();
                        if (url && url !== source.url) {
                          void saveSource(source, { url });
                        }
                      }}
                      placeholder={source.type === "Github" ? "https://github.com/owner/repo" : "**/*.md"}
                    />
                  </TableCell>
                  <TableCell>
                    {source.type === "Github" ? (
                      <Select
                        value={source.accountId ?? NO_ACCOUNT}
                        onValueChange={(value) => {
                          const accountId = value && value !== NO_ACCOUNT ? String(value) : undefined;
                          void saveSource(source, { accountId });
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>{accounts.find((account) => account.id === source.accountId)?.name ?? "None"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ACCOUNT}>None</SelectItem>
                          {accounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="icon" onClick={() => void syncSource(source.id)}>
                        <RefreshCw className="size-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" onClick={() => void updateTaskSources(sources.filter((candidate) => candidate.id !== source.id))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>
                  <Select value={newSourceType} onValueChange={(value) => setNewSourceType(value as TaskSourceType)} disabled={!file}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{sourceLabel(newSourceType)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Markdown">Markdown</SelectItem>
                      <SelectItem value="Github">Github</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    value={newSourceName}
                    disabled={!file}
                    onChange={(event) => setNewSourceName(event.target.value)}
                    placeholder="Optional"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={newSourceUrl}
                    disabled={!file}
                    onChange={(event) => setNewSourceUrl(event.target.value)}
                    placeholder={newSourceType === "Github" ? "https://github.com/owner/repo" : "**/*.md"}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">New source</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button type="button" size="icon" disabled={!file || !newSourceUrl.trim()} onClick={() => void addSource()}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader>
          <CardTitle>Online Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Token</TableHead>
                <TableHead className="w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <Github className="size-4" />
                      Github
                    </span>
                  </TableCell>
                  <TableCell>
                    <Input key={account.name} defaultValue={account.name} onBlur={(event) => void saveAccount(account, { name: event.target.value.trim() || account.name })} />
                  </TableCell>
                  <TableCell>
                    <Input key={account.username} defaultValue={account.username ?? ""} onBlur={(event) => void saveAccount(account, { username: event.target.value.trim() || undefined })} />
                  </TableCell>
                  <TableCell>
                    <Input key={account.token} type="password" defaultValue={account.token ?? ""} onBlur={(event) => void saveAccount(account, { token: event.target.value.trim() || undefined })} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button type="button" variant="ghost" size="icon" onClick={() => void updateAccounts(accounts.filter((candidate) => candidate.id !== account.id))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <Github className="size-4" />
                    Github
                  </span>
                </TableCell>
                <TableCell>
                  <Input value={newAccountName} disabled={!file} onChange={(event) => setNewAccountName(event.target.value)} placeholder="Personal" />
                </TableCell>
                <TableCell className="text-muted-foreground">Optional</TableCell>
                <TableCell>
                  <Input type="password" value={newAccountToken} disabled={!file} onChange={(event) => setNewAccountToken(event.target.value)} placeholder="Token" />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button type="button" size="icon" disabled={!file || !newAccountName.trim() || !newAccountToken.trim()} onClick={() => void addAccount()}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
