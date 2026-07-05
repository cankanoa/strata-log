import { useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { SessionPresetsDialog } from "@/features/session/session-presets-dialog";
import {
  applySessionPreset,
  getPresetMetadataForFile,
  getPresetMissingFieldNames,
  replaceSessionPreset
} from "@/lib/session-presets";
import type { SessionMetadata, SessionPreset, TimeLogFile } from "@/lib/types";

type SessionPresetsMenuProps = {
  file: TimeLogFile | null;
  disabled: boolean;
  currentMetadata: SessionMetadata;
  onApply: (metadata: SessionMetadata) => void;
  onSave: (presets: SessionPreset[]) => Promise<boolean>;
};

export function SessionPresetsMenu({
  file,
  disabled,
  currentMetadata,
  onApply,
  onSave
}: SessionPresetsMenuProps) {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<{
    preset: SessionPreset;
    missingFields: string[];
    updated: boolean;
  } | null>(null);
  const presets = file?.sessionPresets ?? [];

  function applyPreset(preset: SessionPreset) {
    if (file) {
      onApply(applySessionPreset(file, preset));
    }
  }

  function selectPreset(preset: SessionPreset) {
    if (!file) {
      return;
    }
    const missingFields = getPresetMissingFieldNames(file, preset);
    if (missingFields.length > 0) {
      setPendingPreset({ preset, missingFields, updated: false });
      return;
    }
    applyPreset(preset);
  }

  async function updatePendingPreset() {
    if (!file || !pendingPreset) {
      return;
    }
    const cleanedPreset = {
      ...pendingPreset.preset,
      metadata: getPresetMetadataForFile(file, pendingPreset.preset)
    };
    const saved = await onSave(
      replaceSessionPreset(presets, cleanedPreset)
    );
    if (saved) {
      setPendingPreset({ ...pendingPreset, preset: cleanedPreset, updated: true });
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" disabled={disabled} />}>
          Presets
          <ChevronDown className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {presets.length > 0 ? (
            presets.map((preset) => (
              <DropdownMenuItem key={preset.id} onClick={() => selectPreset(preset)}>
                {preset.name}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>No presets</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsEditorOpen(true)}>
            <Settings2 className="size-4" />
            Edit Presets
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SessionPresetsDialog
        open={isEditorOpen}
        initialPresets={presets}
        currentMetadata={currentMetadata}
        onOpenChange={setIsEditorOpen}
        onSave={onSave}
      />

      <AlertDialog
        open={Boolean(pendingPreset)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPreset(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Preset fields changed</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingPreset
                ? `${pendingPreset.preset.name} includes deleted fields: ${pendingPreset.missingFields.join(", ")}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="outline"
              disabled={!pendingPreset || pendingPreset.updated}
              onClick={() => void updatePendingPreset()}
            >
              Update
            </AlertDialogAction>
            <AlertDialogAction
              type="button"
              onClick={() => {
                if (pendingPreset) {
                  applyPreset(pendingPreset.preset);
                }
                setPendingPreset(null);
              }}
            >
              Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
