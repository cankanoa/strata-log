import { describe, expect, it } from "vitest";
import { EntryQueryService } from "@/services/entry-query-service";
import type { EntryInterval } from "@/lib/types";

const entries: EntryInterval[] = [
  {
    id: "550e8400-e29b-41d4-a716-446655440000",
    type: "interval",
    intervals: [
      {
        start: "2026-05-26T09:00:00-10:00",
        end: "2026-05-26T11:00:00-10:00"
      }
    ],
    metadata: { project: "Alpha" }
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440001",
    type: "interval",
    intervals: [
      {
        start: "2026-05-27T08:00:00-10:00",
        end: "2026-05-27T09:30:00-10:00"
      }
    ],
    metadata: { project: "Beta" }
  }
];

describe("EntryQueryService", () => {
  it("sorts by metadata column", () => {
    const sorted = EntryQueryService.sortEntries(entries, { key: "project", direction: "asc" });
    expect(sorted.map((entry) => entry.metadata?.project)).toEqual(["Alpha", "Beta"]);
  });

  it("filters by metadata value", () => {
    const filtered = EntryQueryService.filterEntries(entries, [{ field: "project", value: "alp" }]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.metadata?.project).toBe("Alpha");
  });
});
