import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useKeyboard } from "../hooks/useKeyboard";
import { useMenuEvents } from "../hooks/useMenuEvents";
import {
  useLocalStorageEnum,
  useLocalStorageJson,
  useLocalStorageOptionalNumber,
  useLocalStorageOptionalString,
  useLocalStorageString,
} from "../hooks/useLocalStorage";
import type { Command } from "./commands";
import {
  deleteGroup,
  deleteImage,
  fixBatches,
  getRatings,
  listImages,
  startScan,
  setGroupRating,
} from "../data/galleryApi";
import type {
  GroupMode,
  ImageItem,
  RatingItem,
  RankingMode,
  ScanProgressEvent,
} from "../data/types";
import { useGroupListController } from "./useGroupListController";
import { useViewedGroups } from "./useViewedGroups";
import { ShuffleBag } from "../utils/shuffleBag";

type GroupSelectionState = {
  activeId: string | null;
  selectedIds: string[];
};

export function useGalleryController() {
  const [rootPath, setRootPath] = useState("");
  const [dateFilter, setDateFilter] = useLocalStorageString(
    "promptlens.dateFilter",
    ""
  );
  const [searchText, setSearchText] = useLocalStorageString(
    "promptlens.searchText",
    ""
  );
  const [minGroupSize, setMinGroupSize] = useLocalStorageString(
    "promptlens.minGroupSize",
    ""
  );
  const [maxGroupSize, setMaxGroupSize] = useLocalStorageString(
    "promptlens.maxGroupSize",
    ""
  );
  const [groupMode, setGroupMode] = useLocalStorageEnum<GroupMode>(
    "promptlens.groupMode",
    ["prompt", "date", "score"],
    "prompt"
  );
  const {
    groups,
    groupPage,
    totalGroupCount,
    totalGroupPages,
    groupsPerPage,
    resetGroupList,
    loadGroups,
    setGroupPage,
  } = useGroupListController();
  const [storedSelectedGroupId, setStoredSelectedGroupId] =
    useLocalStorageOptionalString("promptlens.selectedGroupId");
  const [groupSelection, setGroupSelectionState] = useState<GroupSelectionState>({
    activeId: storedSelectedGroupId,
    selectedIds: storedSelectedGroupId ? [storedSelectedGroupId] : [],
  });
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] =
    useLocalStorageOptionalNumber("promptlens.selectedImageIndex");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const [recentRoots, setRecentRoots] = useLocalStorageJson<string[]>(
    "promptlens.recentRoots",
    []
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSlideshowRunning, setIsSlideshowRunning] = useState(false);
  const [rankingActive, setRankingActive] = useState(false);
  const [rankingMode, setRankingMode] = useState<RankingMode>("sequential");
  const [ratingByGroupId, setRatingByGroupId] = useState<
    Record<string, RatingItem>
  >({});
  const [ratingsVersion, setRatingsVersion] = useState(0);
  const selectedGroupId = groupSelection.activeId;
  const selectedGroupIds = groupSelection.selectedIds;

  const viewerRef = useRef<HTMLDivElement | null>(null);
  const slideshowRef = useRef<number | null>(null);
  const suppressGroupFetchRef = useRef(false);
  const resumeImageIndexRef = useRef<number | null>(null);
  const pendingSelectionRef = useRef<{
    groupId: string | null;
    imageIndex: number | null;
  }>({ groupId: null, imageIndex: null });
  const groupRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const imageRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const imageBagRef = useRef<ShuffleBag<ImageItem> | null>(null);
  const imageBagGroupRef = useRef<string | null>(null);
  const lastAutoScanRootRef = useRef<string | null>(null);
  const activeScanIdRef = useRef<string | null>(null);
  const activeScanRootRef = useRef<string | null>(null);
  const refreshGroupsRef = useRef<
    (nextMode?: GroupMode, pageOverride?: number) => Promise<void>
  >(async () => {});
  const { viewedGroupIds, markGroupViewed, markGroupUnviewed } =
    useViewedGroups({
      rootPath,
      groups,
      selectedGroupId,
      selectedImageIndex,
      imagesLength: images.length,
      recentRoots,
    });

  const adjustGroupRating = async (groupId: string, delta: number) => {
    const current = ratingByGroupId[groupId]?.rating ?? 1000;
    const next = Math.round(current + delta);
    await setGroupRating({ rootPath: rootPath.trim(), groupId, rating: next });
    await loadRatings(true);
  };

  const applyGroupSelection = (next: GroupSelectionState) => {
    setGroupSelectionState(next);
    setStoredSelectedGroupId(next.activeId);
  };

  const resolveTargetGroupIds = (
    options?: { anchor?: string }
  ): string[] => {
    const anchor = options?.anchor;
    if (anchor && selectedGroupIds.includes(anchor) && selectedGroupIds.length > 0) {
      return selectedGroupIds;
    }
    if (anchor) {
      return [anchor];
    }
    if (selectedGroupIds.length > 0) {
      return selectedGroupIds;
    }
    if (selectedGroupId) {
      return [selectedGroupId];
    }
    return [];
  };

  const setGroupSelection = (groupId: string, multiSelect = false) => {
    if (!multiSelect) {
      applyGroupSelection({ activeId: groupId, selectedIds: [groupId] });
      return;
    }

    if (selectedGroupIds.includes(groupId)) {
      const next = selectedGroupIds.filter((id) => id !== groupId);
      applyGroupSelection({
        activeId: selectedGroupId === groupId ? next[0] ?? null : selectedGroupId,
        selectedIds: next,
      });
      return;
    }

    applyGroupSelection({
      activeId: groupId,
      selectedIds: [...selectedGroupIds, groupId],
    });
  };

  const markGroupsViewed = async (options?: { anchor?: string }) => {
    const targets = resolveTargetGroupIds(options);
    if (targets.length === 0) return;
    for (const groupId of targets) {
      await markGroupViewed(groupId);
    }
  };

  const markGroupsUnviewed = async (options?: { anchor?: string }) => {
    const targets = resolveTargetGroupIds(options);
    if (targets.length === 0) return;
    for (const groupId of targets) {
      await markGroupUnviewed(groupId);
    }
  };

  const adjustGroupsRating = async (
    delta: number,
    options?: { anchor?: string }
  ) => {
    const targets = resolveTargetGroupIds(options);
    const promptTargets = targets.filter((groupId) =>
      groups.some(
        (group) => group.id === groupId && group.group_type === "prompt"
      )
    );
    if (promptTargets.length === 0) return;
    for (const groupId of promptTargets) {
      const current = ratingByGroupId[groupId]?.rating ?? 1000;
      const next = Math.round(current + delta);
      await setGroupRating({ rootPath: rootPath.trim(), groupId, rating: next });
    }
    await loadRatings(true);
  };

  const deleteGroups = async (options?: { anchor?: string }) => {
    const targets = resolveTargetGroupIds(options);
    if (targets.length === 0) return;
    const confirmed = await confirm(
      targets.length > 1
        ? `Delete all images in ${targets.length} selected categories?`
        : "Delete all images in this category?",
      {
        title: "Delete Group",
        kind: "warning",
      }
    );
    if (!confirmed) return;
    let deleted = 0;
    for (const groupId of targets) {
      deleted += await deleteGroup(rootPath.trim(), groupId);
    }
    setStatus(`Deleted ${deleted} images.`);
    await refreshGroups();
  };

  const getNextImageIndex = (groupId: string | null, items: ImageItem[]) => {
    if (!groupId || items.length === 0) return null;
    if (!imageBagRef.current || imageBagGroupRef.current !== groupId) {
      imageBagRef.current = new ShuffleBag(items, (item) => item.path);
      imageBagGroupRef.current = groupId;
    } else {
      imageBagRef.current.update(items);
    }
    const [pick] = imageBagRef.current.next(1);
    if (!pick) return null;
    const index = items.findIndex((item) => item.path === pick.path);
    return index >= 0 ? index : null;
  };

  useEffect(() => {
    if (selectedGroupId === null) {
      setImages([]);
      return;
    }
    if (!rootPath.trim()) {
      return;
    }
    if (suppressGroupFetchRef.current) {
      suppressGroupFetchRef.current = false;
      return;
    }
    void (async () => {
      const result = await listImages(rootPath.trim(), selectedGroupId);
      setImages(result);
      if (resumeImageIndexRef.current !== null) {
        const clampedIndex =
          result.length > 0
            ? Math.min(
                result.length - 1,
                Math.max(0, resumeImageIndexRef.current)
              )
            : null;
        setSelectedImageIndex(clampedIndex);
        resumeImageIndexRef.current = null;
      } else {
        setSelectedImageIndex(result.length > 0 ? 0 : null);
      }
    })();
  }, [selectedGroupId]);

  useEffect(() => {
    if (selectedGroupId) {
      const node = groupRefs.current[selectedGroupId];
      if (node) {
        requestAnimationFrame(() => {
          node.scrollIntoView({ block: "center" });
        });
      }
    }
  }, [selectedGroupId, groups]);

  useEffect(() => {
    if (selectedImageIndex !== null) {
      const node = imageRefs.current[selectedImageIndex];
      if (node) {
        requestAnimationFrame(() => {
          node.scrollIntoView({ block: "center", inline: "center" });
        });
      }
    }
  }, [selectedImageIndex, images]);

  useEffect(() => {
    const groupIds = new Set(groups.map((group) => group.id));
    const nextSelectedIds = selectedGroupIds.filter((groupId) =>
      groupIds.has(groupId)
    );
    const nextActiveId =
      selectedGroupId && groupIds.has(selectedGroupId)
        ? selectedGroupId
        : nextSelectedIds[0] ?? null;
    if (
      nextActiveId !== selectedGroupId ||
      nextSelectedIds.length !== selectedGroupIds.length
    ) {
      applyGroupSelection({ activeId: nextActiveId, selectedIds: nextSelectedIds });
    }
  }, [groups, selectedGroupId, selectedGroupIds]);

  const goPrevGroup = () => {
    const currentIndex = groups.findIndex(
      (group) => group.id === selectedGroupId
    );
    if (currentIndex > 0) {
      const nextId = groups[currentIndex - 1].id;
      applyGroupSelection({ activeId: nextId, selectedIds: [nextId] });
      return;
    }
    if (currentIndex === 0 && groupPage > 0) {
      const prevPage = groupPage - 1;
      pendingSelectionRef.current = { groupId: null, imageIndex: null };
      setGroupPage(prevPage);
      void refreshGroups(groupMode, prevPage);
    }
  };

  const goNextGroup = () => {
    const currentIndex = groups.findIndex(
      (group) => group.id === selectedGroupId
    );
    if (currentIndex >= 0 && currentIndex < groups.length - 1) {
      const nextId = groups[currentIndex + 1].id;
      applyGroupSelection({ activeId: nextId, selectedIds: [nextId] });
      return;
    }
    if (currentIndex === groups.length - 1 && groupPage + 1 < totalGroupPages) {
      const nextPage = groupPage + 1;
      pendingSelectionRef.current = { groupId: null, imageIndex: null };
      setGroupPage(nextPage);
      void refreshGroups(groupMode, nextPage);
    }
  };

  const goPrevImage = () => {
    setSelectedImageIndex((index) => {
      if (index === null) return null;
      return Math.max(0, index - 1);
    });
  };

  const goNextImage = () => {
    setSelectedImageIndex((index) => {
      if (index === null) return null;
      return Math.min(images.length - 1, index + 1);
    });
  };

  const openViewer = () => {
    if (selectedImageIndex !== null && images[selectedImageIndex]) {
      setViewerOpen(true);
    }
  };

  const dispatch = (command: Command) => {
    switch (command.type) {
      case "ESCAPE":
        stopSlideshowAndCloseViewer();
        break;
      case "TOGGLE_FULLSCREEN":
        void toggleFullscreen();
        break;
      case "NEXT_IMAGE":
        goNextImage();
        break;
      case "PREV_IMAGE":
        goPrevImage();
        break;
      case "NEXT_GROUP":
        goNextGroup();
        break;
      case "PREV_GROUP":
        goPrevGroup();
        break;
      case "OPEN_VIEWER":
        openViewer();
        break;
      case "OPEN_FOLDER":
        void browseForRoot();
        break;
      case "RESCAN":
        void scanDirectoryAction();
        break;
      case "FIX_BATCHES":
        void fixBatchesAction();
        break;
      case "RANDOM_IMAGE":
        randomImageInGroup();
        break;
      case "RANDOM_ANY":
        void randomCategoryImage();
        break;
      case "TOGGLE_SLIDESHOW":
        toggleSlideshow({ acrossGroups: command.acrossGroups });
        break;
      case "MARK_GROUP_READ":
        void markGroupsViewed();
        break;
      case "MARK_GROUP_UNREAD":
        void markGroupsUnviewed();
        break;
      case "SCORE_UP":
        void adjustGroupsRating(40);
        break;
      case "SCORE_DOWN":
        void adjustGroupsRating(-40);
        break;
      case "DELETE_IMAGE":
        void deleteCurrentImage();
        break;
      case "DELETE_GROUP":
        void deleteCurrentGroup();
        break;
      case "START_RANKING":
        void startRanking("pair");
        break;
      case "START_SEQUENTIAL_RANKING":
        void startRanking("sequential");
        break;
    }
  };

  useKeyboard({
    dispatch,
    canNavigateImages: selectedImageIndex !== null,
  });

  useMenuEvents({ dispatch });

  useEffect(() => {
    const unlistenPromise = listen<ScanProgressEvent>("scan-progress", (event) => {
      const payload = event.payload;
      if (activeScanIdRef.current && payload.scan_id !== activeScanIdRef.current) {
        return;
      }
      setScanProgress(payload);
      setStatus(payload.message);
      if (!payload.done) {
        return;
      }
      const scanRoot = activeScanRootRef.current;
      activeScanIdRef.current = null;
      activeScanRootRef.current = null;
      if (payload.success && scanRoot) {
        updateRecentRoots(scanRoot);
        void refreshGroupsRef.current();
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [recentRoots]);

  useEffect(() => {
    pendingSelectionRef.current = {
      groupId: selectedGroupId,
      imageIndex: selectedImageIndex,
    };
  }, []);

  useEffect(() => {
    if (recentRoots.length > 0) {
      setRootPath(recentRoots[0]);
    }
  }, []);

  useEffect(() => {
    if (groupMode === "score") {
      void refreshGroups("score");
    }
  }, [groupMode, ratingsVersion]);

  useEffect(() => {
    const trimmed = rootPath.trim();
    if (!trimmed) return;
    if (lastAutoScanRootRef.current === trimmed) return;
    lastAutoScanRootRef.current = trimmed;
    void autoscanRoot(trimmed);
  }, [rootPath]);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const hasImages = images.length > 0;
  const hasGroups = groups.length > 0;

  function truncateLabel(text: string, maxLength = 120) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength).trim()}…`;
  }

  function updateRecentRoots(path: string) {
    const next = [path, ...recentRoots.filter((item) => item !== path)].slice(0, 8);
    setRecentRoots(next);
  }

  async function refreshGroups(
    nextMode: GroupMode = groupMode,
    pageOverride?: number
  ) {
    if (!rootPath.trim()) {
      resetGroupList();
      applyGroupSelection({ activeId: null, selectedIds: [] });
      setImages([]);
      return;
    }
    try {
      const desiredGroupId =
        pendingSelectionRef.current.groupId ?? selectedGroupId;
      const desiredImageIndex =
        pendingSelectionRef.current.imageIndex ?? selectedImageIndex;
      const { pageItems } = await loadGroups({
        rootPath,
        dateFilter,
        searchText,
        minGroupSize,
        maxGroupSize,
        currentMode: groupMode,
        nextMode,
        pageOverride,
      });
      const nextGroup =
        desiredGroupId && pageItems.some((group) => group.id === desiredGroupId)
          ? desiredGroupId
          : pageItems.length > 0
          ? pageItems[0].id
          : null;
      if (nextGroup === desiredGroupId && desiredImageIndex !== null) {
        resumeImageIndexRef.current = desiredImageIndex;
      }
      applyGroupSelection({
        activeId: nextGroup,
        selectedIds: nextGroup ? [nextGroup] : [],
      });
      pendingSelectionRef.current = { groupId: null, imageIndex: null };
    } catch (error) {
      setStatus(`Group refresh failed: ${String(error)}`);
    }
  }

  useEffect(() => {
    refreshGroupsRef.current = refreshGroups;
  }, [refreshGroups]);

  function goToGroupPage(nextPage: number) {
    if (nextPage < 0 || nextPage >= totalGroupPages) return;
    pendingSelectionRef.current = { groupId: null, imageIndex: null };
    setGroupPage(nextPage);
    void refreshGroups(groupMode, nextPage);
  }

  async function scanDirectoryAction() {
    const trimmed = rootPath.trim();
    if (!trimmed) {
      setStatus("Please enter a root folder path.");
      return;
    }
    if (activeScanIdRef.current) {
      setStatus("Scan already running...");
      return;
    }
    setStatus("Starting scan...");
    setScanProgress(null);
    try {
      const { scan_id } = await startScan(trimmed);
      activeScanIdRef.current = scan_id;
      activeScanRootRef.current = trimmed;
    } catch (error) {
      setStatus(`Scan failed: ${String(error)}`);
    }
  }

  async function fixBatchesAction() {
    if (!rootPath.trim()) {
      setStatus("Please enter a root folder path.");
      return;
    }
    const confirmed = await confirm(
      "Fix batch splits across date folders? This will rename/move files and then rescan.",
      { title: "Fix Batch Splits", kind: "warning" }
    );
    if (!confirmed) {
      return;
    }
    setStatus("Fixing batch splits...");
    try {
      const result = await fixBatches(rootPath.trim());
      await scanDirectoryAction();
      setStatus(
        `Fixed batches: ${result.moved} moved, ${result.renamed} renumbered across ${result.transitions} transition(s).`
      );
    } catch (error) {
      setStatus(`Fix batches failed: ${String(error)}`);
    }
  }

  async function autoscanRoot(path: string) {
    if (!path.trim()) return;
    if (activeScanIdRef.current) {
      return;
    }
    setStatus("Starting scan...");
    setScanProgress(null);
    try {
      const { scan_id } = await startScan(path);
      activeScanIdRef.current = scan_id;
      activeScanRootRef.current = path;
    } catch (error) {
      setStatus(`Scan failed: ${String(error)}`);
    }
  }

  async function browseForRoot() {
    const selection = await open({
      multiple: false,
      directory: true,
      title: "Select image root folder",
    });
    if (typeof selection === "string") {
      resetGroupList();
      setRootPath(selection);
    }
  }

  function handleRootChange(value: string) {
    resetGroupList();
    setRootPath(value);
  }

  async function toggleFullscreen() {
    const win = getCurrentWindow();
    const next = !isFullscreen;
    await win.setFullscreen(next);
    setIsFullscreen(next);
  }

  function stopSlideshowAndCloseViewer() {
    if (slideshowRef.current) {
      window.clearInterval(slideshowRef.current);
      slideshowRef.current = null;
    }
    setViewerOpen(false);
    setIsSlideshowRunning(false);
  }

  function stopSlideshowOnly() {
    if (slideshowRef.current) {
      window.clearInterval(slideshowRef.current);
      slideshowRef.current = null;
    }
    setIsSlideshowRunning(false);
  }

  function randomImageInGroup() {
    if (images.length === 0) return;
    const nextIndex = getNextImageIndex(selectedGroupId ?? null, images);
    if (nextIndex === null) return;
    setSelectedImageIndex(nextIndex);
    setViewerOpen(true);
  }

  async function randomCategoryImage() {
    if (groups.length === 0) return;
    const nextGroup = groups[Math.floor(Math.random() * groups.length)];
    suppressGroupFetchRef.current = true;
    applyGroupSelection({ activeId: nextGroup.id, selectedIds: [nextGroup.id] });
    const result = await listImages(rootPath.trim(), nextGroup.id);
    setImages(result);
    if (result.length > 0) {
      const nextIndex = getNextImageIndex(nextGroup.id, result);
      if (nextIndex !== null) {
        setSelectedImageIndex(nextIndex);
        setViewerOpen(true);
      }
    }
  }

  function toggleSlideshow({ acrossGroups = false } = {}) {
    if (slideshowRef.current) {
      stopSlideshowOnly();
      return;
    }
    if (images.length === 0) return;
    setIsSlideshowRunning(true);
    randomImageInGroup();
    slideshowRef.current = window.setInterval(() => {
      acrossGroups ? randomCategoryImage() : randomImageInGroup();
    }, 2000);
  }

  async function deleteCurrentImage() {
    if (selectedImageIndex === null || !images[selectedImageIndex]) return;
    const target = images[selectedImageIndex];
    const confirmed = await confirm("Delete this image from disk?", {
      title: "Delete Image",
      kind: "warning",
    });
    if (!confirmed) return;
    await deleteImage(rootPath.trim(), target.path);
    setStatus("Image deleted.");
    await refreshGroups();
  }

  async function deleteCurrentGroup() {
    await deleteGroups();
  }

  const loadRatings = async (bumpVersion = false) => {
    if (groups.length === 0 || !rootPath.trim()) {
      setRatingByGroupId({});
      return;
    }
    try {
      const ratings = await getRatings(
        rootPath.trim(),
        groups.map((group) => group.id)
      );
      const next: Record<string, RatingItem> = {};
      ratings.forEach((item) => {
        next[item.group_id] = item;
      });
      setRatingByGroupId(next);
      if (bumpVersion) {
        setRatingsVersion((value) => value + 1);
      }
    } catch (error) {
      console.warn("Failed to load ratings", error);
    }
  };

  useEffect(() => {
    void loadRatings();
  }, [groups]);

  async function startRanking(mode: RankingMode = "sequential") {
    setRankingMode(mode);
    setRankingActive(true);
  }

  function stopRanking() {
    setRankingActive(false);
    void loadRatings(true);
  }

  return {
    rootPath,
    setRootPath,
    dateFilter,
    setDateFilter,
    searchText,
    setSearchText,
    minGroupSize,
    setMinGroupSize,
    maxGroupSize,
    setMaxGroupSize,
    groupMode,
    setGroupMode,
    groups,
    groupPage,
    totalGroupCount,
    totalGroupPages,
    groupsPerPage,
    selectedGroupId,
    selectedGroupIds,
    setGroupSelection,
    images,
    selectedImageIndex,
    setSelectedImageIndex,
    viewerOpen,
    setViewerOpen,
    status,
    scanProgress,
    recentRoots,
    viewerRef,
    isFullscreen,
    isSlideshowRunning,
    groupRefs,
    imageRefs,
    selectedGroup,
    hasImages,
    hasGroups,
    truncateLabel,
    refreshGroups,
    goToGroupPage,
    scanDirectoryAction,
    browseForRoot,
    handleRootChange,
    toggleFullscreen,
    stopSlideshowAndCloseViewer,
    randomImageInGroup,
    randomCategoryImage,
    toggleSlideshow,
    deleteCurrentImage,
    deleteCurrentGroup,
    rankingActive,
    rankingMode,
    ratingByGroupId,
    ratingsVersion,
    viewedGroupIds,
    markGroupViewed,
    markGroupUnviewed,
    adjustGroupRating,
    markGroupsViewed,
    markGroupsUnviewed,
    adjustGroupsRating,
    deleteGroups,
    startRanking,
    stopRanking,
    goPrevGroup,
    goNextGroup,
    goPrevImage,
    goNextImage,
    openViewer,
    dispatch,
  };
}
