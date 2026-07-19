import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { MarkdownEditor } from "@/components/forms/markdown-editor";
import type { MetadataValue } from "@/lib/types";

type MarkdownValueDialogProps = {
  open: boolean;
  title: string;
  description: string;
  initialValue: MetadataValue;
  saveLabel?: string;
  onOpenChange: (open: boolean) => void;
  onSave: (value: MetadataValue) => Promise<void> | void;
};

function markdownText(value: MetadataValue): string {
  return typeof value === "string" ? value : "";
}

function savedMarkdown(value: string): MetadataValue {
  return value.trim().length > 0 ? value : undefined;
}

export function MarkdownValueDialog({
  open,
  title,
  description,
  initialValue,
  saveLabel = "Save",
  onOpenChange,
  onSave
}: MarkdownValueDialogProps) {
  const [value, setValue] = useState(markdownText(initialValue));
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (open) {
      setValue(markdownText(initialValue));
      setEditorKey((key) => key + 1);
    }
  }, [initialValue, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-none grid-rows-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="px-5 pb-4 pt-5">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <MarkdownEditor key={editorKey} value={value} onChange={setValue} className="min-h-0 flex-1 overflow-y-auto rounded-none border-y border-border" />
        <div className="flex justify-end gap-2 bg-muted/50 px-5 py-4">
          <Button variant="ghost" onClick={() => setValue("")}>
            Clear
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void onSave(savedMarkdown(value))}>{saveLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
