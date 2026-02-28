import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
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
  extractPrompts as extractPromptsApi,
  getRatings,
  listGroups,
  listImages,
  scanDirectory as scanDirectoryApi,
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
  const [autoScanned, setAutoScanned] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSlideshowRunning, setIsSlideshowRunning] = useState(false);
  const [rankingActive, setRankingActive] = useState(false);
  const [rankingMode, setRankingMode] = useState<RankingMode>("sequential");
  const [ratingByGroupId, setRatingByGroupId] = useState<
    Record<string, RatingItem>
  >({});
  const [ratingsVersion, setRatingsVersion] = useState(0);

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
    if (suppressGroupFetchRef.current) {
      suppressGroupFetchRef.current = false;
      return;
    }
    void (async () => {
      const result = await listImages(selectedGroupId);
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
      case "RANDOM_IMAGE":
        randomImageInGroup();
        break;
      case "RANDOM_ANY":
        void randomCategoryImage();
        break;
      case "TOGGLE_SLIDESHOW":
        toggleSlideshow({ acrossGroups: command.acrossGroups });
        break;
      case "DELETE_IMAGE":
        void deleteCurrentImage();
        break;
      case "DELETE_GROUP":
        void deleteCurrentGroup();
        break;
      case "EXTRACT_PROMPTS":
        void extractPromptsAction();
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
    if (!autoScanned && rootPath.trim()) {
      setAutoScanned(true);
      void scanDirectoryAction();
    }
  }, [autoScanned, rootPath]);

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
    try {
      const desiredGroupId =
        pendingSelectionRef.current.groupId ?? selectedGroupId;
      const desiredImageIndex =
        pendingSelectionRef.current.imageIndex ?? selectedImageIndex;
      const result = await listGroups({
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
    const result = await listImages(nextGroup.id);
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
    if (!window.confirm("Delete this image from disk?")) return;
    await deleteImage(target.path);
    setStatus("Image deleted.");
    await refreshGroups();
  }

  async function deleteCurrentGroup() {
    if (!selectedGroupId) return;
    if (!window.confirm("Delete all images in this category?")) return;
    const deleted = await deleteGroup(selectedGroupId);
    setStatus(`Deleted ${deleted} images.`);
    await refreshGroups();
  }

  async function extractPromptsAction() {
    setStatus("Extracting prompts...");
    try {
      const result = await extractPromptsApi();
      setStatus(
        `Scanned ${result.scanned} images, updated ${result.updated} prompts.`
      );
      await refreshGroups();
    } catch (error) {
      setStatus(`Prompt extraction failed: ${String(error)}`);
    }
  }

  const loadRatings = async (bumpVersion = false) => {
    if (groups.length === 0) {
      setRatingByGroupId({});
      return;
    }
    try {
      const ratings = await getRatings(groups.map((group) => group.id));
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
    extractPromptsAction,
    rankingActive,
    rankingMode,
    ratingByGroupId,
    ratingsVersion,
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
