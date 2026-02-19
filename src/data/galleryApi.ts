import { invoke } from "@tauri-apps/api/core";
import type { Group, GroupMode, ImageItem, PromptResult, ScanResult } from "./types";

export async function scanDirectory(rootPath: string): Promise<ScanResult> {
  return invoke<ScanResult>("scan_directory", { rootPath });
}

export async function listGroups(params: {
  dateFilter?: string | null;
  searchText?: string | null;
  groupMode: GroupMode;
}): Promise<Group[]> {
  return invoke<Group[]>("list_groups", {
    dateFilter: params.dateFilter ?? null,
    searchText: params.searchText ?? null,
    groupMode: params.groupMode,
  });
}

export async function listImages(groupId: string): Promise<ImageItem[]> {
  return invoke<ImageItem[]>("list_images", { groupId });
}

export async function extractPrompts(): Promise<PromptResult> {
  return invoke<PromptResult>("extract_prompts");
}

export async function deleteImage(imagePath: string): Promise<boolean> {
  return invoke<boolean>("delete_image", { imagePath });
}

export async function deleteGroup(groupId: string): Promise<number> {
  return invoke<number>("delete_group", { groupId });
}
