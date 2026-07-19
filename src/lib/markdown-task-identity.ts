const STANDARD_MARKDOWN_DATA_KEYS = new Set([
  "__strata",
  "checked",
  "content",
  "filePath",
  "parentIssue",
  "parentUrl",
  "rank",
  "status",
  "title",
  "url"
]);

function normalizeIdentityPart(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "");
}

export function normalizeMarkdownTaskFields(fields: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key.trim(), normalizeIdentityPart(value)] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0)
      .sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase()))
  );
}

export function extractMarkdownFieldsFromData(data: Record<string, unknown>): Record<string, string> {
  const strata = data.__strata;
  const markdownFields = strata && typeof strata === "object" && "markdownFields" in strata
    ? (strata as { markdownFields?: unknown }).markdownFields
    : undefined;
  if (markdownFields && typeof markdownFields === "object" && !Array.isArray(markdownFields)) {
    return normalizeMarkdownTaskFields(markdownFields as Record<string, unknown>);
  }
  return normalizeMarkdownTaskFields(
    Object.fromEntries(
      Object.entries(data).filter(([key, value]) =>
        !STANDARD_MARKDOWN_DATA_KEYS.has(key) &&
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      )
    )
  );
}

export function markdownTaskIdentity(contents: string, fields: Record<string, unknown>): string {
  const title = normalizeIdentityPart(contents);
  const fieldText = Object.entries(normalizeMarkdownTaskFields(fields))
    .map(([key, value]) => `${normalizeIdentityPart(key).toLowerCase()}:${value}`)
    .join("|");
  return `${title}|${fieldText}`;
}

export function hashMarkdownTask(contents: string, fields: Record<string, unknown>): string {
  const identity = markdownTaskIdentity(contents, fields);
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `md-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
