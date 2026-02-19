import type { GroupKey } from "./types";

export function parseGroupKey(key: string): GroupKey | null {
  if (key.startsWith("p:")) {
    const id = Number(key.slice(2));
    return Number.isFinite(id) ? { type: "prompt", id } : null;
  }
  if (key.startsWith("b:")) {
    const id = Number(key.slice(2));
    return Number.isFinite(id) ? { type: "batch", id } : null;
  }
  if (key.startsWith("d:")) {
    return { type: "date", date: key.slice(2) };
  }
  if (key.startsWith("pd:")) {
    const parts = key.split(":");
    if (parts.length === 3) {
      const id = Number(parts[1]);
      const date = parts[2];
      if (Number.isFinite(id) && date) {
        return { type: "prompt_date", id, date };
      }
    }
  }
  return null;
}

export function formatGroupKey(group: GroupKey): string {
  if (group.type === "prompt") return `p:${group.id}`;
  if (group.type === "batch") return `b:${group.id}`;
  if (group.type === "date") return `d:${group.date}`;
  return `pd:${group.id}:${group.date}`;
}
