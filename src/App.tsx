import Toolbar from "./components/Toolbar";
import Filters from "./components/Filters/Filters";
import GroupList from "./components/GroupList/GroupList";
import ImageGrid from "./components/ImageGrid/ImageGrid";
import Viewer from "./components/Viewer/Viewer";
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

      <Filters
        searchText={searchText}
        dateFilter={dateFilter}
        groupMode={groupMode}
        status={status}
        onSearchChange={setSearchText}
        onDateChange={setDateFilter}
        onApply={() => refreshGroups()}
        onGroupModeChange={(mode) => {
          setGroupMode(mode);
          void refreshGroups(mode);
        }}
        onExtractPrompts={extractPromptsAction}
      />

      <section className="workspace">
        <GroupList
          groups={groups}
          selectedGroupId={selectedGroupId}
          groupRefs={groupRefs}
          truncateLabel={truncateLabel}
          onSelectGroup={setSelectedGroupId}
        />

        <ImageGrid
          images={images}
          selectedImageIndex={selectedImageIndex}
          imageRefs={imageRefs}
          onSelectImage={setSelectedImageIndex}
          onOpenViewer={() => setViewerOpen(true)}
        />
      </section>

      {viewerOpen && selectedImageIndex !== null && images[selectedImageIndex] && (
        <Viewer
          images={images}
          selectedImageIndex={selectedImageIndex}
          selectedGroup={selectedGroup}
          isFullscreen={isFullscreen}
          viewerRef={viewerRef}
          onClose={stopSlideshowAndCloseViewer}
          onToggleFullscreen={toggleFullscreen}
          onPrev={goPrevImage}
          onNext={goNextImage}
        />
      )}
    </main>
  );
}

export default App;
