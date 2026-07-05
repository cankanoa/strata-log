import { useEffect, useState } from "react";
import { Plus, RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cloneSessionPresets, createSessionPreset } from "@/lib/session-presets";
import type { SessionMetadata, SessionPreset } from "@/lib/types";

type SessionPresetsDialogProps = {
  open: boolean;
  initialPresets: SessionPreset[];
  currentMetadata: SessionMetadata;
  onOpenChange: (open: boolean) => void;
  onSave: (presets: SessionPreset[]) => Promise<boolean | void> | boolean | void;
};

export function SessionPresetsDialog({
  open,
  initialPresets,
  currentMetadata,
  onOpenChange,
  onSave
}: SessionPresetsDialogProps) {
  const [presets, setPresets] = useState<SessionPreset[]>([]);
  const [newPresetName, setNewPresetName] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setPresets(cloneSessionPresets(initialPresets));
    setNewPresetName("");
  }, [initialPresets, open]);

  function updatePreset(index: number, patch: Partial<SessionPreset>) {
    setPresets((current) =>
      current.map((preset, presetIndex) =>
        presetIndex === index
          ? {
              ...preset,
              ...patch
            }
          : preset
      )
    );
  }

  function removePreset(index: number) {
    setPresets((current) => current.filter((_, presetIndex) => presetIndex !== index));
  }

  function appendPreset() {
    setPresets((current) => [...current, createSessionPreset(newPresetName, currentMetadata, current.length)]);
    setNewPresetName("");
  }

  async function handleSave() {
    const saved = await onSave(presets);
    if (saved === false) {
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Session Presets</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {presets.map((preset, index) => (
                <TableRow key={preset.id}>
                  <TableCell className="align-top">
                    <Input
                      value={preset.name}
                      onChange={(event) => updatePreset(index, { name: event.target.value })}
                      placeholder="Preset name"
                    />
                  </TableCell>
                  <TableCell className="w-28 align-top">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        onClick={() => updatePreset(index, { metadata: { ...currentMetadata } })}
                        title="Update from current session fields"
                      >
                        <RefreshCcw className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        onClick={() => removePreset(index)}
                        title="Remove preset"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="align-top">
                  <Input
                    value={newPresetName}
                    onChange={(event) => setNewPresetName(event.target.value)}
                    placeholder="Preset name"
                  />
                </TableCell>
                <TableCell className="w-28 align-top">
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={appendPreset}
                      title="Add preset from current session fields"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSave()}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
