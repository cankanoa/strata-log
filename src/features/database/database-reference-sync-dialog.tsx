import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DatabaseReferenceStatus } from "@/lib/database-registry-sync";

type DatabaseReferenceSyncDialogProps = {
  open: boolean;
  missingReferences: DatabaseReferenceStatus[];
  onKeep: () => void;
  onRemove: () => void | Promise<void>;
};

export function DatabaseReferenceSyncDialog({
  open,
  missingReferences,
  onKeep,
  onRemove
}: DatabaseReferenceSyncDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onKeep()}>
      <DialogContent className="w-[calc(100vw-2.5rem)] max-w-4xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Missing Databases</DialogTitle>
          <DialogDescription>
            These database references are saved in the app, but the files are not on this system.
          </DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Resolved location</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {missingReferences.map((status) => (
              <TableRow key={status.entry.id}>
                <TableCell>{status.entry.location}</TableCell>
                <TableCell className="font-mono text-xs">{status.entry.url}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{status.resolvedPath || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onKeep}>
            Keep references
          </Button>
          <Button type="button" variant="destructive" onClick={() => void onRemove()}>
            Remove references
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
