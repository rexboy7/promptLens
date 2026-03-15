import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  listViewedGroupIds,
  listGroups,
  listImages,
  markGroupUnviewed as markGroupUnviewedApi,
  markGroupViewed as markGroupViewedApi,
  scanDirectory as scanDirectoryApi,
  setGroupRating,
} from "../data/galleryApi";
import type { Group, GroupMode, ImageItem, RatingItem, RankingMode } from "../data/types";
import { ShuffleBag } from "../utils/shuffleBag";

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
  const [groupMode, setGroupMode] = useLocalStorageEnum<GroupMode>(
    "promptlens.groupMode",
    ["prompt", "date", "score"],
    "prompt"
  );
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] =
    useLocalStorageOptionalString("promptlens.selectedGroupId");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] =
    useLocalStorageOptionalNumber("promptlens.selectedImageIndex");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [status, setStatus] = useState("");
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
  const [viewedGroupIds, setViewedGroupIds] = useState<string[]>([]);

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
  const viewedGroupRef = useRef<string | null>(null);
  const viewedIndexSetRef = useRef<Set<number>>(new Set());
  const lastAutoScanRootRef = useRef<string | null>(null);

  const markGroupViewed = async (groupId: string) => {
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
  };

  const markGroupUnviewed = async (groupId: string) => {
    setViewedGroupIds((prev) => prev.filter((id) => id !== groupId));
    const trimmedRoot = rootPath.trim();
    if (!trimmedRoot) return;
    try {
      await markGroupUnviewedApi(trimmedRoot, groupId);
    } catch (error) {
      console.warn("Failed to mark group unviewed", error);
    }
  };

  const adjustGroupRating = async (groupId: string, delta: number) => {
    const current = ratingByGroupId[groupId]?.rating ?? 1000;
    const next = Math.round(current + delta);
    await setGroupRating({ rootPath: rootPath.trim(), groupId, rating: next });
    await loadRatings(true);
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
    if (selectedGroupId !== viewedGroupRef.current) {
      viewedGroupRef.current = selectedGroupId;
      viewedIndexSetRef.current = new Set();
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId || selectedImageIndex === null) return;
    if (viewedGroupRef.current !== selectedGroupId) return;
    if (images.length === 0) return;
    viewedIndexSetRef.current.add(selectedImageIndex);
    if (viewedIndexSetRef.current.size / images.length >= 0.6) {
      void markGroupViewed(selectedGroupId);
    }
  }, [images.length, selectedGroupId, selectedImageIndex]);

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

  const goPrevGroup = () => {
    const currentIndex = groups.findIndex(
      (group) => group.id === selectedGroupId
    );
    if (currentIndex > 0) {
      setSelectedGroupId(groups[currentIndex - 1].id);
    }
  };

  const goNextGroup = () => {
    const currentIndex = groups.findIndex(
      (group) => group.id === selectedGroupId
    );
    if (currentIndex >= 0 && currentIndex < groups.length - 1) {
      setSelectedGroupId(groups[currentIndex + 1].id);
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
        if (selectedGroupId) {
          void markGroupViewed(selectedGroupId);
        }
        break;
      case "MARK_GROUP_UNREAD":
        if (selectedGroupId) {
          void markGroupUnviewed(selectedGroupId);
        }
        break;
      case "SCORE_UP":
        if (selectedGroupId && selectedGroup?.group_type === "prompt") {
          void adjustGroupRating(selectedGroupId, 40);
        }
        break;
      case "SCORE_DOWN":
        if (selectedGroupId && selectedGroup?.group_type === "prompt") {
          void adjustGroupRating(selectedGroupId, -40);
        }
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

  async function refreshGroups(nextMode: GroupMode = groupMode) {
    if (!rootPath.trim()) {
      setGroups([]);
      setSelectedGroupId(null);
      setImages([]);
      return;
    }
    try {
      const desiredGroupId =
        pendingSelectionRef.current.groupId ?? selectedGroupId;
      const desiredImageIndex =
        pendingSelectionRef.current.imageIndex ?? selectedImageIndex;
      const result = await listGroups({
        rootPath: rootPath.trim(),
        dateFilter: dateFilter.trim() ? dateFilter.trim() : null,
        searchText: searchText.trim() ? searchText.trim() : null,
        groupMode: nextMode,
      });
      setGroups(result);
      const nextGroup =
        desiredGroupId && result.some((group) => group.id === desiredGroupId)
          ? desiredGroupId
          : result.length > 0
          ? result[0].id
          : null;
      if (nextGroup === desiredGroupId && desiredImageIndex !== null) {
        resumeImageIndexRef.current = desiredImageIndex;
      }
      setSelectedGroupId(nextGroup);
      pendingSelectionRef.current = { groupId: null, imageIndex: null };
    } catch (error) {
      setStatus(`Group refresh failed: ${String(error)}`);
    }
  }

  async function scanDirectoryAction() {
    if (!rootPath.trim()) {
      setStatus("Please enter a root folder path.");
      return;
    }
    setStatus("Scanning...");
    try {
      const result = await scanDirectoryApi(rootPath.trim());
      setStatus(
        `Indexed ${result.total_images} images in ${result.total_batches} groups.`
      );
      updateRecentRoots(rootPath.trim());
      await refreshGroups();
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
    setStatus("Scanning...");
    try {
      const scanResult = await scanDirectoryApi(path);
      setStatus(
        `Indexed ${scanResult.total_images} images in ${scanResult.total_batches} groups.`
      );
      updateRecentRoots(path);
      await refreshGroups();
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
      setRootPath(selection);
    }
  }

  function handleRootChange(value: string) {
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
    setSelectedGroupId(nextGroup.id);
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
    if (!selectedGroupId) return;
    const confirmed = await confirm("Delete all images in this category?", {
      title: "Delete Group",
      kind: "warning",
    });
    if (!confirmed) return;
    const deleted = await deleteGroup(rootPath.trim(), selectedGroupId);
    setStatus(`Deleted ${deleted} images.`);
    await refreshGroups();
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

  const loadViewedGroups = async () => {
    if (groups.length === 0 || !rootPath.trim()) {
      setViewedGroupIds([]);
      return;
    }
    try {
      const viewed = await listViewedGroupIds(
        rootPath.trim(),
        groups.map((group) => group.id)
      );
      setViewedGroupIds(viewed);
    } catch (error) {
      console.warn("Failed to load viewed groups", error);
    }
  };

  useEffect(() => {
    void loadViewedGroups();
  }, [groups, rootPath]);

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
    groupMode,
    setGroupMode,
    groups,
    selectedGroupId,
    setSelectedGroupId,
    images,
    selectedImageIndex,
    setSelectedImageIndex,
    viewerOpen,
    setViewerOpen,
    status,
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
