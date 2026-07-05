import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FieldOptionValueChange, FieldOptionValueResolution } from "@/lib/time-log-database";

type FieldOptionValueResolutionDialogProps = {
  open: boolean;
  fieldName: string;
  changes: FieldOptionValueChange[];
  onOpenChange: (open: boolean) => void;
  onResolve: (resolution: FieldOptionValueResolution) => Promise<void> | void;
};

export function FieldOptionValueResolutionDialog({
  open,
  fieldName,
  changes,
  onOpenChange,
  onResolve
}: FieldOptionValueResolutionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Update Existing Values?</DialogTitle>
          <DialogDescription>
            Some tracked rows already use options that changed in {fieldName}. Choose how to handle those stored values.
          </DialogDescription>
        </DialogHeader>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Current</TableHead>
              <TableHead>New</TableHead>
              <TableHead className="w-20 text-right">Uses</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changes.map((change) => (
              <TableRow key={`${change.previousValue}-${change.nextValue ?? "removed"}`}>
                <TableCell>{change.previousDisplay}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ArrowRight className="size-3 text-muted-foreground" />
                    <span>{change.nextDisplay ?? "Removed"}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">{change.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => void onResolve("remove")}>
            Remove
          </Button>
          <Button type="button" onClick={() => void onResolve("update")}>
            Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
