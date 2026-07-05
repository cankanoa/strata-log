import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AttributeReferenceOptionsDialogProps = {
  open: boolean;
  title: string;
  description: string;
  initialLabels: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (labels: string[]) => Promise<void> | void;
};

export function AttributeReferenceOptionsDialog({
  open,
  title,
  description,
  initialLabels,
  onOpenChange,
  onSave
}: AttributeReferenceOptionsDialogProps) {
  const [labels, setLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");

  function normalizedLabels(includeNewLabel = false) {
    const seen = new Set<string>();
    return [...labels, ...(includeNewLabel ? [newLabel] : [])]
      .map((label) => label.trim())
      .filter((label) => label.length > 0)
      .filter((label) => {
        if (seen.has(label)) {
          return false;
        }
        seen.add(label);
        return true;
      });
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    setLabels(initialLabels);
    setNewLabel("");
  }, [initialLabels, open]);

  function updateLabel(index: number, value: string) {
    setLabels((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function removeLabel(index: number) {
    setLabels((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function appendLabel() {
    if (!newLabel.trim()) {
      return;
    }
    setLabels(normalizedLabels(true));
    setNewLabel("");
  }

  async function handleSave() {
    await onSave(normalizedLabels(true));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-14" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {labels.map((label, index) => (
                <TableRow key={index}>
                  <TableCell className="align-top">
                    <Input
                      value={label}
                      onChange={(event) => updateLabel(index, event.target.value)}
                      placeholder="Attribute reference name"
                    />
                  </TableCell>
                  <TableCell className="w-14 align-top">
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => removeLabel(index)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="align-top">
                  <Input
                    value={newLabel}
                    onChange={(event) => setNewLabel(event.target.value)}
                    placeholder="Attribute reference name"
                  />
                </TableCell>
                <TableCell className="w-14 align-top">
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    disabled={!newLabel.trim()}
                    onClick={appendLabel}
                  >
                    <Plus className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <div className="flex justify-end gap-2">
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleSave()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
