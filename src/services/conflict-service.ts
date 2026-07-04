import type { ConflictState, TimeLogFile } from "@/lib/types";

export const ConflictService = {
  clean(): ConflictState {
    return { status: "clean" };
  },
  conflict(message: string, diskVersion: TimeLogFile): ConflictState {
    return {
      status: "conflict",
      message,
      diskVersion
    };
  }
};
