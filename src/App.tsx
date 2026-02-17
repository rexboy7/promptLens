import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [rootPath, setRootPath] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [groupMode, setGroupMode] = useState<"prompt" | "prompt_date">(
    "prompt"
  );
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(
    null
  );
  const [viewerOpen, setViewerOpen] = useState(false);
  const [status, setStatus] = useState("");

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewerOpen(false);
        return;
      }
      if (selectedImageIndex === null) return;
      if (event.key === "ArrowRight") {
        setSelectedImageIndex((index) => {
          if (index === null) return null;
          return Math.min(images.length - 1, index + 1);
        });
      } else if (event.key === "ArrowLeft") {
        setSelectedImageIndex((index) => {
          if (index === null) return null;
          return Math.max(0, index - 1);
        });
      } else if (event.key === "ArrowDown") {
        const currentIndex = groups.findIndex(
          (group) => group.id === selectedGroupId
        );
        if (currentIndex >= 0 && currentIndex < groups.length - 1) {
          setSelectedGroupId(groups[currentIndex + 1].id);
        }
      } else if (event.key === "ArrowUp") {
        const currentIndex = groups.findIndex(
          (group) => group.id === selectedGroupId
        );
        if (currentIndex > 0) {
          setSelectedGroupId(groups[currentIndex - 1].id);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [groups, images.length, selectedGroupId, selectedImageIndex]);

  async function refreshGroups(nextMode: "prompt" | "prompt_date" = groupMode) {
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
      await refreshGroups();
    } catch (error) {
      setStatus(`Scan failed: ${String(error)}`);
    }
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
            onChange={(event) => setRootPath(event.currentTarget.value)}
            placeholder="Root folder path (e.g. /Users/me/Images)"
          />
          <button type="button" onClick={scanDirectory}>
            Scan
          </button>
        </div>
      </header>

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
        <button type="button" onClick={refreshGroups}>
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
            return (
              <button
                key={group.id}
                type="button"
                className={
                  group.id === selectedGroupId ? "group active" : "group"
                }
                onClick={() => setSelectedGroupId(group.id)}
              >
                <img src={thumbSrc} alt={`Group ${group.id}`} />
                <div className="group-meta">
                  <span className="group-date">
                    {group.group_type === "prompt"
                      ? "Prompt"
                      : group.group_type === "prompt_date"
                      ? "Prompt + Date"
                      : "Batch"}{" "}
                    • {group.size} images
                  </span>
                  <span className="group-count">{group.label}</span>
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
        <div className="viewer" onClick={() => setViewerOpen(false)}>
          <img
            src={convertFileSrc(images[selectedImageIndex].path)}
            alt="Selected"
            onClick={(event) => event.stopPropagation()}
          />
          <div className="viewer-hint">
            Arrow keys: prev/next image, up/down group, Esc to close
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
