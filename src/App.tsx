import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

function App() {
  const [rootPath, setRootPath] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [groupMode, setGroupMode] = useState<
    "prompt" | "prompt_date" | "date_prompt" | "date"
  >("prompt");
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(
    null
  );
  const [viewerOpen, setViewerOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [recentRoots, setRecentRoots] = useState<string[]>([]);
  const [autoScanned, setAutoScanned] = useState(false);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const groupRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const imageRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (selectedGroupId === null) {
      setImages([]);
      return;
    }
    void (async () => {
      const result = await invoke<ImageItem[]>("list_images", {
        groupId: selectedGroupId,
      });
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
        setViewerOpen(false);
        return;
      }
      if (selectedImageIndex === null) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setSelectedImageIndex((index) => {
          if (index === null) return null;
          return Math.min(images.length - 1, index + 1);
        });
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSelectedImageIndex((index) => {
          if (index === null) return null;
          return Math.max(0, index - 1);
        });
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        const currentIndex = groups.findIndex(
          (group) => group.id === selectedGroupId
        );
        if (currentIndex >= 0 && currentIndex < groups.length - 1) {
          setSelectedGroupId(groups[currentIndex + 1].id);
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const currentIndex = groups.findIndex(
          (group) => group.id === selectedGroupId
        );
        if (currentIndex > 0) {
          setSelectedGroupId(groups[currentIndex - 1].id);
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (images[selectedImageIndex]) {
          setViewerOpen(true);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [groups, images.length, selectedGroupId, selectedImageIndex]);

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
      void scanDirectory();
    }
  }, [autoScanned, rootPath]);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId);

  function truncateLabel(text: string, maxLength = 120) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength).trim()}…`;
  }

  function updateRecentRoots(path: string) {
    const next = [path, ...recentRoots.filter((item) => item !== path)].slice(
      0,
      8
    );
    setRecentRoots(next);
    localStorage.setItem("promptlens.recentRoots", JSON.stringify(next));
  }

  async function refreshGroups(
    nextMode: "prompt" | "prompt_date" | "date_prompt" | "date" = groupMode
  ) {
    try {
      const result = await invoke<GroupItem[]>("list_groups", {
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

  async function scanDirectory() {
    if (!rootPath.trim()) {
      setStatus("Please enter a root folder path.");
      return;
    }
    setStatus("Scanning...");
    try {
      const result = await invoke<ScanResult>("scan_directory", {
        rootPath: rootPath.trim(),
      });
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

  async function extractPrompts() {
    setStatus("Extracting prompts...");
    try {
      const result = await invoke<PromptResult>("extract_prompts");
      setStatus(
        `Scanned ${result.scanned} images, updated ${result.updated} prompts.`
      );
      await refreshGroups();
    } catch (error) {
      setStatus(`Prompt extraction failed: ${String(error)}`);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>PromptGallery</h1>
          <p className="subtitle">Batch-first AI image viewer</p>
        </div>
        <div className="controls">
          <input
            value={rootPath}
            onChange={(event) => handleRootChange(event.currentTarget.value)}
            placeholder="Root folder path (e.g. /Users/me/Images)"
            list="recent-roots"
          />
          {recentRoots.length > 0 && (
            <select
              className="recent-select"
              value=""
              onChange={(event) => handleRootChange(event.currentTarget.value)}
            >
              <option value="" disabled>
                Recent
              </option>
              {recentRoots.map((root) => (
                <option key={root} value={root}>
                  {root}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={scanDirectory}>
            Scan
          </button>
          <button type="button" onClick={browseForRoot}>
            Browse
          </button>
        </div>
      </header>
      <datalist id="recent-roots">
        {recentRoots.map((root) => (
          <option key={root} value={root} />
        ))}
      </datalist>

      <section className="filters">
        <input
          value={searchText}
          onChange={(event) => setSearchText(event.currentTarget.value)}
          placeholder="Search prompts or dates"
        />
        <input
          value={dateFilter}
          onChange={(event) => setDateFilter(event.currentTarget.value)}
          placeholder="Date filter YYYY-MM-DD"
        />
        <button type="button" onClick={() => refreshGroups()}>
          Apply
        </button>
        <div className="mode-toggle">
          <button
            type="button"
            className={groupMode === "prompt" ? "mode active" : "mode"}
            onClick={() => {
              setGroupMode("prompt");
              void refreshGroups("prompt");
            }}
          >
            Prompt
          </button>
          <button
            type="button"
            className={groupMode === "prompt_date" ? "mode active" : "mode"}
            onClick={() => {
              setGroupMode("prompt_date");
              void refreshGroups("prompt_date");
            }}
          >
            Prompt + Date
          </button>
          <button
            type="button"
            className={groupMode === "date_prompt" ? "mode active" : "mode"}
            onClick={() => {
              setGroupMode("date_prompt");
              void refreshGroups("date_prompt");
            }}
          >
            Date + Prompt
          </button>
          <button
            type="button"
            className={groupMode === "date" ? "mode active" : "mode"}
            onClick={() => {
              setGroupMode("date");
              void refreshGroups("date");
            }}
          >
            Date
          </button>
        </div>
        <button type="button" onClick={extractPrompts}>
          Extract Prompts
        </button>
        <span className="status">{status}</span>
      </section>

      <section className="workspace">
        <aside className="group-list">
          {groups.map((group) => {
            const thumbSrc = convertFileSrc(group.representative_path);
            const displayLabel = truncateLabel(group.label, 120);
            return (
              <button
                key={group.id}
                type="button"
                className={
                  group.id === selectedGroupId ? "group active" : "group"
                }
                ref={(node) => {
                  groupRefs.current[group.id] = node;
                }}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <img src={thumbSrc} alt={`Group ${group.id}`} />
                <div className="group-meta">
                  <span className="group-date">
                    {group.group_type === "prompt"
                      ? "Prompt"
                      : group.group_type === "prompt_date"
                      ? "Prompt + Date"
                      : group.group_type === "date_prompt"
                      ? "Date + Prompt"
                      : group.group_type === "date"
                      ? "Date"
                      : "Batch"}{" "}
                    • {group.size} images
                  </span>
                  <span className="group-count" title={group.label}>
                    {displayLabel}
                  </span>
                  {group.date && (
                    <span className="group-subtle">{group.date}</span>
                  )}
                </div>
              </button>
            );
          })}
          {groups.length === 0 && (
            <div className="empty">No groups yet. Scan a folder.</div>
          )}
        </aside>

        <section className="image-grid">
          {images.map((image, index) => {
            const src = convertFileSrc(image.path);
            return (
              <button
                key={`${image.path}-${image.serial}`}
                type="button"
                className={
                  index === selectedImageIndex ? "image active" : "image"
                }
                ref={(node) => {
                  imageRefs.current[index] = node;
                }}
                onClick={() => {
                  setSelectedImageIndex(index);
                  setViewerOpen(true);
                }}
              >
                <img src={src} alt={`${image.serial}-${image.seed}`} />
                <span className="image-caption">
                  {image.serial}-{image.seed}
                </span>
              </button>
            );
          })}
          {images.length === 0 && (
            <div className="empty">Select a group to view images.</div>
          )}
        </section>
      </section>

      {viewerOpen && selectedImageIndex !== null && images[selectedImageIndex] && (
        <div
          className="viewer"
          onClick={() => setViewerOpen(false)}
          ref={viewerRef}
        >
          <div className="viewer-toolbar" onClick={(event) => event.stopPropagation()}>
            <span>
              {selectedImageIndex + 1} / {images.length}
            </span>
            {selectedGroup?.date && <span>{selectedGroup.date}</span>}
            <button
              type="button"
              className="viewer-toggle"
              onClick={(event) => {
                event.stopPropagation();
                void toggleFullscreen();
              }}
            >
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </button>
          </div>
          <button
            type="button"
            className="viewer-nav prev"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedImageIndex((index) =>
                index === null ? null : Math.max(0, index - 1)
              );
            }}
            disabled={selectedImageIndex === 0}
          >
            Prev
          </button>
          <img
            src={convertFileSrc(images[selectedImageIndex].path)}
            alt="Selected"
            onClick={(event) => event.stopPropagation()}
            className={isFullscreen ? "viewer-image fullscreen" : "viewer-image"}
          />
          <button
            type="button"
            className="viewer-nav next"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedImageIndex((index) =>
                index === null ? null : Math.min(images.length - 1, index + 1)
              );
            }}
            disabled={selectedImageIndex >= images.length - 1}
          >
            Next
          </button>
          <div className="viewer-hint">
            Arrow keys: prev/next image, up/down group, Enter to open, Esc to close
          </div>
        </div>
      )}
    </main>
  );
}

export default App;

type GroupItem = {
  id: string;
  label: string;
  group_type: string;
  date?: string | null;
  size: number;
  representative_path: string;
};

type ImageItem = {
  path: string;
  serial: number;
  seed: number;
};

type ScanResult = {
  total_images: number;
  total_batches: number;
};

type PromptResult = {
  scanned: number;
  updated: number;
};
