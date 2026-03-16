import { invoke } from "@tauri-apps/api/core";
import type {
  Group,
  GroupMode,
  ImageItem,
  RatingItem,
  ScanProgressEvent,
  ScanResult,
  ScanStartResponse,
} from "./types";

export async function scanDirectory(rootPath: string): Promise<ScanResult> {
  return invoke<ScanResult>("scan_directory", { rootPath });
}

export async function startScan(rootPath: string): Promise<ScanStartResponse> {
  return invoke<ScanStartResponse>("start_scan", { rootPath });
}

export type { ScanProgressEvent };

export async function listGroups(params: {
  rootPath: string;
  dateFilter?: string | null;
  searchText?: string | null;
  groupMode: GroupMode;
  limit?: number | null;
  offset?: number | null;
}): Promise<Group[]> {
  return invoke<Group[]>("list_groups", {
    rootPath: params.rootPath,
    dateFilter: params.dateFilter ?? null,
    searchText: params.searchText ?? null,
    groupMode: params.groupMode,
    limit: params.limit ?? null,
    offset: params.offset ?? null,
  });
}

export async function listImages(
  rootPath: string,
  groupId: string
): Promise<ImageItem[]> {
  return invoke<ImageItem[]>("list_images", { rootPath, groupId });
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

export async function markGroupViewed(
  rootPath: string,
  groupId: string
): Promise<boolean> {
  return invoke<boolean>("mark_group_viewed", { rootPath, groupId });
}

export async function markGroupUnviewed(
  rootPath: string,
  groupId: string
): Promise<boolean> {
  return invoke<boolean>("mark_group_unviewed", { rootPath, groupId });
}

export async function listViewedGroupIds(
  rootPath: string,
  groupIds: string[]
): Promise<string[]> {
  return invoke<string[]>("list_viewed_group_ids", { rootPath, groupIds });
}

export type FixBatchesResult = {
  transitions: number;
  moved: number;
  renamed: number;
};

export async function fixBatches(rootPath: string): Promise<FixBatchesResult> {
  return invoke<FixBatchesResult>("fix_batches", { rootPath });
}
