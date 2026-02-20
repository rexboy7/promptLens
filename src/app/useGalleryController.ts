import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { useKeyboard } from "../hooks/useKeyboard";
import { useMenuEvents } from "../hooks/useMenuEvents";
import type { Command } from "./commands";
import {
  deleteGroup,
  deleteImage,
  extractPrompts as extractPromptsApi,
  listGroups,
  listImages,
  scanDirectory as scanDirectoryApi,
} from "../data/galleryApi";
import type { Group, GroupMode, ImageItem } from "../data/types";
import { useRankingController } from "./useRankingController";

export function useGalleryController() {
  const [rootPath, setRootPath] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>("prompt");
  const [groupSort, setGroupSort] = useState<"default" | "score">("default");
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [recentRoots, setRecentRoots] = useState<string[]>([]);
  const [autoScanned, setAutoScanned] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSlideshowRunning, setIsSlideshowRunning] = useState(false);
  const ranking = useRankingController(groups);
  const orderedGroups = useMemo(() => {
    if (groupSort !== "score") {
      return groups;
    }
    const ratedGroups = [...groups];
    ratedGroups.sort((a, b) => {
      const aRating = ranking.ratingByGroupId[a.id]?.rating ?? 1000;
      const bRating = ranking.ratingByGroupId[b.id]?.rating ?? 1000;
      if (bRating !== aRating) {
        return bRating - aRating;
      }
      const aMatches = ranking.ratingByGroupId[a.id]?.matches ?? 0;
      const bMatches = ranking.ratingByGroupId[b.id]?.matches ?? 0;
      if (aMatches !== bMatches) {
        return aMatches - bMatches;
      }
      return a.label.localeCompare(b.label);
    });
    return ratedGroups;
  }, [groupSort, groups, ranking.ratingByGroupId]);

  const viewerRef = useRef<HTMLDivElement | null>(null);
  const slideshowRef = useRef<number | null>(null);
  const suppressGroupFetchRef = useRef(false);
  const groupRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const imageRefs = useRef<Record<number, HTMLButtonElement | null>>({});

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
      setSelectedImageIndex(result.length > 0 ? 0 : null);
    })();
  }, [selectedGroupId]);

  useEffect(() => {
    if (selectedGroupId) {
      const node = groupRefs.current[selectedGroupId];
      if (node) {
        node.scrollIntoView({ block: "center" });
      }
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (selectedImageIndex !== null) {
      const node = imageRefs.current[selectedImageIndex];
      if (node) {
        node.scrollIntoView({ block: "center", inline: "center" });
      }
    }
  }, [selectedImageIndex, images.length]);

  const goPrevGroup = () => {
    const currentIndex = orderedGroups.findIndex(
      (group) => group.id === selectedGroupId
    );
    if (currentIndex > 0) {
      setSelectedGroupId(orderedGroups[currentIndex - 1].id);
    }
  };

  const goNextGroup = () => {
    const currentIndex = orderedGroups.findIndex(
      (group) => group.id === selectedGroupId
    );
    if (currentIndex >= 0 && currentIndex < orderedGroups.length - 1) {
      setSelectedGroupId(orderedGroups[currentIndex + 1].id);
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
    const stored = localStorage.getItem("promptlens.recentRoots");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const roots = parsed.filter((item) => typeof item === "string");
          setRecentRoots(roots);
          if (roots.length > 0) {
            setRootPath(roots[0]);
          }
        }
      } catch {
        setRecentRoots([]);
      }
    }
  }, []);

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
    localStorage.setItem("promptlens.recentRoots", JSON.stringify(next));
  }

  async function refreshGroups(nextMode: GroupMode = groupMode) {
    try {
      const result = await listGroups({
        dateFilter: dateFilter.trim() ? dateFilter.trim() : null,
        searchText: searchText.trim() ? searchText.trim() : null,
        groupMode: nextMode,
      });
      setGroups(result);
      if (result.length > 0) {
        setSelectedGroupId(result[0].id);
      } else {
        setSelectedGroupId(null);
      }
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
    const nextIndex = Math.floor(Math.random() * images.length);
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
      const nextIndex = Math.floor(Math.random() * result.length);
      setSelectedImageIndex(nextIndex);
      setViewerOpen(true);
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

  return {
    rootPath,
    setRootPath,
    dateFilter,
    setDateFilter,
    searchText,
    setSearchText,
    groupMode,
    setGroupMode,
    groups: orderedGroups,
    groupSort,
    setGroupSort,
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
    ...ranking,
    goPrevGroup,
    goNextGroup,
    goPrevImage,
    goNextImage,
    openViewer,
    dispatch,
  };
}
