import { useCallback, useEffect, useRef, useState } from "react";
import {
  listViewedGroupIds,
  markGroupUnviewed as markGroupUnviewedApi,
  markGroupViewed as markGroupViewedApi,
} from "../data/galleryApi";
import type { Group } from "../data/types";

const LEGACY_VIEWED_GROUP_IDS_KEY = "promptlens.viewedGroupIds";

type UseViewedGroupsParams = {
  rootPath: string;
  groups: Group[];
  selectedGroupId: string | null;
  selectedImageIndex: number | null;
  imagesLength: number;
  recentRoots: string[];
};

export function useViewedGroups({
  rootPath,
  groups,
  selectedGroupId,
  selectedImageIndex,
  imagesLength,
  recentRoots,
}: UseViewedGroupsParams) {
  const [viewedGroupIds, setViewedGroupIds] = useState<string[]>([]);
  const viewedGroupRef = useRef<string | null>(null);
  const viewedIndexSetRef = useRef<Set<number>>(new Set());
  const migratedViewedLegacyRef = useRef(false);
  const rootPathRef = useRef(rootPath);
  const groupsRef = useRef(groups);
  const reloadViewedGroupsRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    rootPathRef.current = rootPath;
    groupsRef.current = groups;
  }, [groups, rootPath]);

  const reloadViewedGroups = useCallback(async () => {
    const trimmedRoot = rootPathRef.current.trim();
    const nextGroups = groupsRef.current;
    if (nextGroups.length === 0 || !trimmedRoot) {
      setViewedGroupIds([]);
      return;
    }
    try {
      const viewed = await listViewedGroupIds(
        trimmedRoot,
        nextGroups.map((group) => group.id)
      );
      setViewedGroupIds(viewed);
    } catch (error) {
      console.warn("Failed to load viewed groups", error);
    }
  }, []);

  reloadViewedGroupsRef.current = reloadViewedGroups;

  const markGroupViewed = useCallback(
    async (groupId: string) => {
      setViewedGroupIds((prev) => {
        if (prev[0] === groupId) return prev;
        const next = prev.filter((id) => id !== groupId);
        next.unshift(groupId);
        return next.slice(0, 50);
      });
      const trimmedRoot = rootPath.trim();
      if (!trimmedRoot) return;
      try {
        await markGroupViewedApi(trimmedRoot, groupId);
      } catch (error) {
        console.warn("Failed to mark group viewed", error);
      }
    },
    [rootPath]
  );

  const markGroupUnviewed = useCallback(
    async (groupId: string) => {
      setViewedGroupIds((prev) => prev.filter((id) => id !== groupId));
      const trimmedRoot = rootPath.trim();
      if (!trimmedRoot) return;
      try {
        await markGroupUnviewedApi(trimmedRoot, groupId);
      } catch (error) {
        console.warn("Failed to mark group unviewed", error);
      }
    },
    [rootPath]
  );

  useEffect(() => {
    if (selectedGroupId !== viewedGroupRef.current) {
      viewedGroupRef.current = selectedGroupId;
      viewedIndexSetRef.current = new Set();
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId || selectedImageIndex === null) return;
    if (viewedGroupRef.current !== selectedGroupId) return;
    if (imagesLength === 0) return;
    viewedIndexSetRef.current.add(selectedImageIndex);
    if (viewedIndexSetRef.current.size / imagesLength >= 0.6) {
      void markGroupViewed(selectedGroupId);
    }
  }, [imagesLength, markGroupViewed, selectedGroupId, selectedImageIndex]);

  useEffect(() => {
    void reloadViewedGroups();
  }, [groups, reloadViewedGroups, rootPath]);

  useEffect(() => {
    if (migratedViewedLegacyRef.current) return;
    migratedViewedLegacyRef.current = true;
    void (async () => {
      const legacyRaw = localStorage.getItem(LEGACY_VIEWED_GROUP_IDS_KEY);
      if (legacyRaw === null) return;
      try {
        const legacyViewed = JSON.parse(legacyRaw) as unknown;
        if (!Array.isArray(legacyViewed)) return;
        const promptGroupIds = legacyViewed.filter(
          (value): value is string =>
            typeof value === "string" && value.startsWith("p:")
        );
        if (promptGroupIds.length === 0) return;
        const roots = Array.from(
          new Set(
            [...recentRoots, rootPath]
              .map((value) => value.trim())
              .filter((value) => value.length > 0)
          )
        );
        for (const root of roots) {
          for (const groupId of promptGroupIds) {
            await markGroupViewedApi(root, groupId);
          }
        }
      } catch (error) {
        console.warn("Failed to migrate legacy viewed groups", error);
      } finally {
        localStorage.removeItem(LEGACY_VIEWED_GROUP_IDS_KEY);
        await reloadViewedGroupsRef.current();
      }
    })();
  }, []);

  return {
    viewedGroupIds,
    markGroupViewed,
    markGroupUnviewed,
  };
}
