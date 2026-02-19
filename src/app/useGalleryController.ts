import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  deleteGroup,
  deleteImage,
  extractPrompts as extractPromptsApi,
  listGroups,
  listImages,
  scanDirectory as scanDirectoryApi,
} from "../data/galleryApi";
import type { Group, GroupMode, ImageItem } from "../data/types";

export function useGalleryController() {
  const [rootPath, setRootPath] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>("prompt");
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
    const currentIndex = groups.findIndex((group) => group.id === selectedGroupId);
    if (currentIndex > 0) {
      setSelectedGroupId(groups[currentIndex - 1].id);
    }
  };

  const goNextGroup = () => {
    const currentIndex = groups.findIndex((group) => group.id === selectedGroupId);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        stopSlideshowAndCloseViewer();
        return;
      }
      if (event.repeat) {
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (event.key === "ArrowRight") {
        if (selectedImageIndex === null) return;
        event.preventDefault();
        goNextImage();
      } else if (event.key === "ArrowLeft") {
        if (selectedImageIndex === null) return;
        event.preventDefault();
        goPrevImage();
      } else if (event.key === "ArrowDown") {
        if (!event.metaKey) return;
        event.preventDefault();
        goNextGroup();
      } else if (event.key === "ArrowUp") {
        if (!event.metaKey) return;
        event.preventDefault();
        goPrevGroup();
      } else if (event.key === "Enter") {
        event.preventDefault();
        openViewer();
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        if (event.metaKey) {
          void randomCategoryImage();
        } else {
          randomImageInGroup();
        }
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        toggleSlideshow({ acrossGroups: event.metaKey });
      } else if (event.key === "d" || event.key === "D") {
        if (!event.metaKey) return;
        event.preventDefault();
        if (event.altKey) {
          void deleteCurrentGroup();
        } else {
          void deleteCurrentImage();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [groups, images.length, selectedGroupId, selectedImageIndex, isFullscreen]);

  useEffect(() => {
    const unlistenPromise = listen<string>("menu-action", (event) => {
      const action = event.payload;
      if (action === "random_image") {
        randomImageInGroup();
      } else if (action === "random_any") {
        void randomCategoryImage();
      } else if (action === "slideshow") {
        toggleSlideshow({ acrossGroups: false });
      } else if (action === "slideshow_any") {
        toggleSlideshow({ acrossGroups: true });
      } else if (action === "delete_image") {
        void deleteCurrentImage();
      } else if (action === "delete_group") {
        void deleteCurrentGroup();
      } else if (action === "fullscreen") {
        void toggleFullscreen();
      } else if (action === "extract_prompts") {
        void extractPromptsAction();
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [groups.length, images.length, selectedGroupId, selectedImageIndex, isFullscreen]);

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
    goPrevGroup,
    goNextGroup,
    goPrevImage,
    goNextImage,
    openViewer,
  };
}
