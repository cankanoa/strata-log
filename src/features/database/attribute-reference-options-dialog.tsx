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
    setLabels((current) => [...current, newLabel]);
    setNewLabel("");
  }

  async function handleSave() {
    await onSave(labels.map((label) => label.trim()).filter((label) => label.length > 0));
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
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
