import { convertFileSrc } from "@tauri-apps/api/core";
import Toolbar from "./components/Toolbar";
import { useGalleryController } from "./app/useGalleryController";
import "./App.css";

function App() {
  const {
    rootPath,
    dateFilter,
    searchText,
    groupMode,
    groups,
    selectedGroupId,
    images,
    selectedImageIndex,
    viewerOpen,
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
    setDateFilter,
    setSearchText,
    setGroupMode,
    setSelectedGroupId,
    setSelectedImageIndex,
    setViewerOpen,
  } = useGalleryController();

  return (
    <main className="app-shell">
      <Toolbar
        hasImages={hasImages}
        hasGroups={hasGroups}
        hasSelectedGroup={Boolean(selectedGroupId)}
        isFullscreen={isFullscreen}
        isSlideshowRunning={isSlideshowRunning}
        onRandomImage={randomImageInGroup}
        onRandomAny={() => void randomCategoryImage()}
        onSlideshow={() => toggleSlideshow({ acrossGroups: false })}
        onSlideshowAny={() => toggleSlideshow({ acrossGroups: true })}
        onDeleteImage={() => void deleteCurrentImage()}
        onDeleteGroup={() => void deleteCurrentGroup()}
        onToggleFullscreen={() => void toggleFullscreen()}
        onPrevGroup={goPrevGroup}
        onNextGroup={goNextGroup}
        onPrevImage={goPrevImage}
        onNextImage={goNextImage}
        onOpenViewer={openViewer}
        onCloseViewer={stopSlideshowAndCloseViewer}
      />
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
          <button type="button" onClick={scanDirectoryAction}>
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
        <button type="button" onClick={extractPromptsAction}>
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
                className={group.id === selectedGroupId ? "group active" : "group"}
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
                  {group.date && <span className="group-subtle">{group.date}</span>}
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
                className={index === selectedImageIndex ? "image active" : "image"}
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
          onClick={stopSlideshowAndCloseViewer}
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
