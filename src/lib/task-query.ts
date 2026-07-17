import type { TaskSource } from "@/lib/types";

export function taskSourceLabel(source: TaskSource | undefined): string {
  if (!source) {
    return "Unknown";
  }
  if (source.name?.trim()) {
    return source.name.trim();
  }
  return source.type === "Github"
    ? source.url.replace(/^https:\/\/github\.com\//i, "")
    : source.url;
}
