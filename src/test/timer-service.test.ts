import { describe, expect, it } from "vitest";
import { emptyMetadata } from "@/lib/metadata";
import { applySessionPreset, getPresetMissingFieldNames } from "@/lib/session-presets";
import { TimeLogDatabase } from "@/lib/time-log-database";
import { formatDateTime, parseDate, formatDuration, netDurationMs } from "@/lib/time";
import { parseTimeLogYaml, serializeTimeLogYaml } from "@/lib/yaml";
import { validateFile } from "@/lib/validation";
import type { TimeLogFile } from "@/lib/types";
import { TimerService } from "@/services/timer-service";

const baseFile: TimeLogFile = {
  version: 1,
  fields: {
    id: { type: "uuid", choose: "single" },
    type: { type: "string", choose: "single" },
    start_time: { type: "datetime", choose: "single" },
    end_time: { type: "datetime", choose: "single" },
    session_id: { type: "uuid", choose: "single" },
    Project: { type: "string", choose: "single" },
    Job: { type: "string", choose: "select", options: ["Client Work", "Internal"] }
  },
  attributeReferenceGroups: [],
  entries: []
};

describe("TimerService", () => {
  it("starts and stops a live entry", () => {
    const started = TimerService.startLiveEntry(
      baseFile,
      { Project: "Strata", Job: "Client Work" },
      "2026-05-24T09:00:00-10:00"
    );

    expect(started.entries).toHaveLength(1);
    expect(started.entries[0]?.type).toBe("running");
    expect(started.entries[0]?.intervals?.[0]?.end).toBe("2026-05-24T09:00:00-10:00");

    const stopped = TimerService.stopLiveEntry(started, "2026-05-24T10:30:00-10:00");
    expect(stopped.entries[0]?.type).toBe("interval");
    expect(stopped.entries[0]?.intervals?.[0]?.end).toBe("2026-05-24T10:30:00-10:00");
    expect(formatDuration(netDurationMs(stopped.entries[0]!))).toBe("01:30");
  });

});

describe("CSDB services", () => {
  it("round-trips a valid file", () => {
    const file: TimeLogFile = {
      ...baseFile,
      entries: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "interval",
          intervalMetadata: false,
          metadata: { Project: "Strata" },
          intervals: [
            {
              id: "550e8400-e29b-41d4-a716-446655440010",
              start: "2026-05-24T09:00:00-10:00",
              end: "2026-05-24T10:00:00-10:00"
            }
          ]
        }
      ]
    };

    const raw = serializeTimeLogYaml(file);
    expect(raw).toContain("--- table:sessions:data");
    expect(raw).toContain("--- table:intervals:data");
    expect(raw).toContain("--- table:metadata:data");
    const parsed = parseTimeLogYaml(raw);
    expect(parsed.errors).toEqual([]);
    expect(parsed.file?.entries[0]?.metadata).toEqual({ Project: "Strata" });
    expect(parsed.file?.entries[0]?.intervals?.[0]?.metadata).toEqual({});
  });

  it("round-trips session presets with stale metadata fields", () => {
    const file: TimeLogFile = {
      ...baseFile,
      sessionPresets: [
        {
          id: "550e8400-e29b-41d4-a716-446655440020",
          name: "Client Morning",
          metadata: {
            Project: "Strata",
            DeletedLater: "Legacy"
          }
        }
      ]
    };

    const raw = serializeTimeLogYaml(file);
    expect(raw).toContain("--- table:session_presets:data");
    const parsed = parseTimeLogYaml(raw);

    expect(parsed.errors).toEqual([]);
    expect(parsed.file?.sessionPresets?.[0]).toEqual(file.sessionPresets?.[0]);
  });

  it("applies session presets without deleted fields", () => {
    const preset = {
      id: "550e8400-e29b-41d4-a716-446655440020",
      name: "Client Morning",
      metadata: {
        Project: "Strata",
        DeletedLater: "Legacy"
      }
    };

    expect(getPresetMissingFieldNames(baseFile, preset)).toEqual(["DeletedLater"]);
    expect(applySessionPreset(baseFile, preset).DeletedLater).toBeUndefined();
    expect(applySessionPreset(baseFile, preset).Project).toBe("Strata");
  });

  it("rejects invalid select values", () => {
    const invalid: TimeLogFile = {
      ...baseFile,
      entries: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "interval",
          intervalMetadata: true,
          metadata: {},
          intervals: [
            {
              id: "550e8400-e29b-41d4-a716-446655440010",
              start: "2026-05-24T09:00:00-10:00",
              end: "2026-05-24T10:00:00-10:00",
              metadata: { Job: "Not Allowed" }
            }
          ]
        }
      ]
    };

    const result = validateFile(invalid);
    expect(result.errors[0]).toContain("not a valid option");
  });

  it("renames a metadata column across the file", () => {
    const file: TimeLogFile = {
      ...baseFile,
      entries: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "interval",
          intervalMetadata: false,
          metadata: { Project: "Strata" },
          intervals: [
            {
              id: "550e8400-e29b-41d4-a716-446655440010",
              start: "2026-05-24T09:00:00-10:00",
              end: "2026-05-24T10:00:00-10:00",
              metadata: {}
            }
          ]
        }
      ]
    };

    const renamed = TimeLogDatabase.renameField(file, "Project", "Client");
    expect(renamed.fields.Project).toBeUndefined();
    expect(renamed.fields.Client?.type).toBe("string");
    expect(renamed.entries[0]?.metadata?.Client).toBe("Strata");
  });

  it("deletes a metadata column across the file", () => {
    const file: TimeLogFile = {
      ...baseFile,
      entries: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "interval",
          intervalMetadata: true,
          metadata: {},
          intervals: [
            {
              id: "550e8400-e29b-41d4-a716-446655440010",
              start: "2026-05-24T09:00:00-10:00",
              end: "2026-05-24T10:00:00-10:00",
              metadata: { Job: "Client Work" }
            }
          ]
        }
      ]
    };

    const deleted = TimeLogDatabase.deleteField(file, "Job");
    expect(deleted.fields.Job).toBeUndefined();
    expect(deleted.entries[0]?.intervals?.[0]?.metadata?.Job).toBeUndefined();
  });

  it("adds a metadata column to the file definition", () => {
    const added = TimeLogDatabase.addField(baseFile, "Billable", {
      type: "bool",
      choose: "single"
    });

    expect(added.fields.Billable?.type).toBe("bool");
  });

  it("creates attribute reference groups when adding a field with options", () => {
    const added = TimeLogDatabase.addField(baseFile, "Additional", {
      type: "attribute_reference",
      choose: "multiselect",
      options: ["Paid"]
    });

    expect(added.fields.Additional?.options).toEqual(["Paid"]);
    expect(added.attributeReferenceGroups.map((group) => group.label)).toEqual(["Paid"]);
  });

  it("adds another attribute reference option to a multiselect field", () => {
    const file: TimeLogFile = {
      ...baseFile,
      fields: {
        ...baseFile.fields,
        Additional: {
          type: "attribute_reference",
          choose: "multiselect",
          options: ["Paid"]
        }
      },
      attributeReferenceGroups: [
        {
          label: "Paid",
          fields: {}
        }
      ]
    };

    const updated = TimeLogDatabase.setAttributeReferenceGroupsForField(file, "Additional", ["Paid", "Unpaid"]);

    expect(updated.fields.Additional?.options).toEqual(["Paid", "Unpaid"]);
    expect(updated.attributeReferenceGroups.map((group) => group.label)).toEqual(["Paid", "Unpaid"]);
  });

  it("converts existing values when choose changes to multiselect", () => {
    const file: TimeLogFile = {
      ...baseFile,
      fields: {
        ...baseFile.fields,
        Project: { type: "string", choose: "single", default: "Strata" }
      },
      entries: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "interval",
          intervalMetadata: false,
          metadata: { Project: "Strata" },
          intervals: [
            {
              id: "550e8400-e29b-41d4-a716-446655440010",
              start: "2026-05-24T09:00:00-10:00",
              end: "2026-05-24T10:00:00-10:00",
              metadata: {}
            }
          ]
        }
      ]
    };

    const updated = TimeLogDatabase.updateField(file, "Project", {
      ...file.fields.Project,
      choose: "multiselect"
    });

    expect(updated.fields.Project?.default).toEqual(["Strata"]);
    expect(updated.entries[0]?.metadata?.Project).toEqual(["Strata"]);
  });

  it("derives select options from existing values when choose changes from single", () => {
    const file: TimeLogFile = {
      ...baseFile,
      fields: {
        ...baseFile.fields,
        Project: { type: "string", choose: "single", default: "Strata" }
      },
      entries: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "interval",
          intervalMetadata: false,
          metadata: { Project: "Client Alpha" },
          intervals: [
            {
              id: "550e8400-e29b-41d4-a716-446655440010",
              start: "2026-05-24T09:00:00-10:00",
              end: "2026-05-24T10:00:00-10:00",
              metadata: {}
            }
          ]
        }
      ]
    };

    const updated = TimeLogDatabase.updateField(file, "Project", {
      ...file.fields.Project,
      choose: "select"
    });

    expect(updated.fields.Project?.options).toEqual(["Strata", "Client Alpha"]);
    expect(updated.entries[0]?.metadata?.Project).toBe("Client Alpha");
  });

  it("converts interval values when choose changes back to single", () => {
    const file: TimeLogFile = {
      ...baseFile,
      fields: {
        ...baseFile.fields,
        Job: { type: "string", choose: "multiselect", options: ["Client Work", "Internal"] }
      },
      entries: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "interval",
          intervalMetadata: true,
          metadata: {},
          intervals: [
            {
              id: "550e8400-e29b-41d4-a716-446655440010",
              start: "2026-05-24T09:00:00-10:00",
              end: "2026-05-24T10:00:00-10:00",
              metadata: { Job: ["Client Work", "Internal"] }
            }
          ]
        }
      ]
    };

    const updated = TimeLogDatabase.updateField(file, "Job", {
      ...file.fields.Job,
      choose: "single",
      options: undefined
    });

    expect(updated.entries[0]?.intervals?.[0]?.metadata?.Job).toBe("Client Work");
  });

  it("formats datetimes with seconds", () => {
    expect(formatDateTime(parseDate("2026-01-01 00:00:00"))).toBe("2026-01-01 00:00:00");
  });

  it("uses default metadata values in empty drafts", () => {
    const draft = emptyMetadata({
      Project: { type: "string", default: "Strata" }
    });

    expect(draft.Project).toBe("Strata");
  });

  it("requires required metadata fields", () => {
    const requiredFile: TimeLogFile = {
      ...baseFile,
      fields: {
        ...baseFile.fields,
        Project: { type: "string", required: true }
      },
      entries: [
        {
          id: "550e8400-e29b-41d4-a716-446655440000",
          type: "interval",
          intervalMetadata: false,
          metadata: {},
          intervals: [
            {
              id: "550e8400-e29b-41d4-a716-446655440010",
              start: "2026-05-24T09:00:00-10:00",
              end: "2026-05-24T10:00:00-10:00",
              metadata: {}
            }
          ]
        }
      ]
    };

    const result = validateFile(requiredFile);
    expect(result.errors.some((message) => message.includes("required"))).toBe(true);
  });
});
