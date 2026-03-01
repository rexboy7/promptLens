import { invoke } from "@tauri-apps/api/core";
import type {
  Group,
  GroupMode,
  ImageItem,
  PromptResult,
  RatingItem,
  ScanResult,
} from "./types";

export async function scanDirectory(rootPath: string): Promise<ScanResult> {
  return invoke<ScanResult>("scan_directory", { rootPath });
}

export async function listGroups(params: {
  rootPath: string;
  dateFilter?: string | null;
  searchText?: string | null;
  groupMode: GroupMode;
}): Promise<Group[]> {
  return invoke<Group[]>("list_groups", {
    rootPath: params.rootPath,
    dateFilter: params.dateFilter ?? null,
    searchText: params.searchText ?? null,
    groupMode: params.groupMode,
  });
}

export async function listImages(
  rootPath: string,
  groupId: string
): Promise<ImageItem[]> {
  return invoke<ImageItem[]>("list_images", { rootPath, groupId });
}

export async function extractPrompts(rootPath: string): Promise<PromptResult> {
  return invoke<PromptResult>("extract_prompts", { rootPath });
}

export async function deleteImage(
  rootPath: string,
  imagePath: string
): Promise<boolean> {
  return invoke<boolean>("delete_image", { rootPath, imagePath });
}

export async function deleteGroup(
  rootPath: string,
  groupId: string
): Promise<number> {
  return invoke<number>("delete_group", { rootPath, groupId });
}

export async function getRatings(
  rootPath: string,
  groupIds: string[]
): Promise<RatingItem[]> {
  return invoke<RatingItem[]>("get_ratings", { rootPath, groupIds });
}

export async function submitComparison(params: {
  rootPath: string;
  leftId: string;
  rightId: string;
  winnerId: string;
}): Promise<boolean> {
  return invoke<boolean>("submit_comparison", params);
}

export async function setGroupRating(params: {
  rootPath: string;
  groupId: string;
  rating: number;
}): Promise<boolean> {
  return invoke<boolean>("set_group_rating", params);
}

export async function getRatingPercentiles(
  rootPath: string,
  percentiles: number[]
): Promise<number[]> {
  return invoke<number[]>("get_rating_percentiles", { rootPath, percentiles });
}
