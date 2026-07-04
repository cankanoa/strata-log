import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPlatformApi } from "@/lib/platform";

type PathInputProps = {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function PathInput({ value, placeholder, disabled = false, onChange }: PathInputProps) {
  async function handleBrowse() {
    if (disabled) {
      return;
    }
    const selected = await getPlatformApi().choosePath();
    if (selected) {
      onChange(selected);
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="min-w-0 flex-1"
      />
      <Button type="button" variant="outline" size="icon" disabled={disabled} onClick={() => void handleBrowse()}>
        <FolderOpen className="size-4" />
        <span className="sr-only">Browse</span>
      </Button>
    </div>
  );
}
