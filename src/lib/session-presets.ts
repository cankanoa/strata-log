import { v4 as uuidv4 } from "uuid";
import { getResolvedMetadataFields } from "@/lib/attribute-references";
import { emptyMetadata } from "@/lib/metadata";
import type { SessionMetadata, SessionPreset, TimeLogFile } from "@/lib/types";

export function cloneSessionPresets(presets: SessionPreset[]): SessionPreset[] {
  return presets.map((preset) => ({
    ...preset,
    metadata: { ...(preset.metadata ?? {}) }
  }));
}

export function createSessionPreset(name: string, metadata: SessionMetadata, index: number): SessionPreset {
  return {
    id: uuidv4(),
    name: normalizeSessionPresetName(name, `Preset ${index + 1}`),
    metadata: { ...metadata }
  };
}

export function normalizeSessionPresetName(name: string, fallback = "Untitled Preset"): string {
  return name.trim() || fallback;
}

export function normalizeSessionPresets(presets: SessionPreset[]): SessionPreset[] {
  return presets.map((preset) => ({
    ...preset,
    id: preset.id || uuidv4(),
    name: normalizeSessionPresetName(preset.name),
    metadata: preset.metadata ?? {}
  }));
}

export function replaceSessionPreset(presets: SessionPreset[], nextPreset: SessionPreset): SessionPreset[] {
  return presets.map((preset) => preset.id === nextPreset.id ? nextPreset : preset);
}

export function getPresetMissingFieldNames(file: TimeLogFile, preset: SessionPreset): string[] {
  const fieldNames = new Set(Object.keys(getResolvedMetadataFields(file)));
  return Object.keys(preset.metadata ?? {}).filter((key) => !fieldNames.has(key));
}

export function getPresetMetadataForFile(file: TimeLogFile, preset: SessionPreset): SessionMetadata {
  const fieldNames = new Set(Object.keys(getResolvedMetadataFields(file)));
  return Object.fromEntries(
    Object.entries(preset.metadata ?? {}).filter(([key]) => fieldNames.has(key))
  );
}

export function applySessionPreset(file: TimeLogFile, preset: SessionPreset): SessionMetadata {
  return {
    ...emptyMetadata(file.fields),
    ...getPresetMetadataForFile(file, preset)
  };
}
