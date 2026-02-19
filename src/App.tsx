import { GalleryProvider, useGallery } from "./app/GalleryContext";
import Toolbar from "./components/Toolbar";
import Filters from "./components/Filters/Filters";
import GroupList from "./components/GroupList/GroupList";
import ImageGrid from "./components/ImageGrid/ImageGrid";
import Viewer from "./components/Viewer/Viewer";
import RootSelector from "./components/RootSelector/RootSelector";
import "./App.css";

function AppContent() {
  const {
    rootPath,
    recentRoots,
    scanDirectoryAction,
    browseForRoot,
    handleRootChange,
    viewerOpen,
    stopSlideshowAndCloseViewer,
  } = useGallery();

  return (
    <main className="app-shell">
      <Toolbar />
      <header className="app-header">
        <div>
          <h1>PromptGallery</h1>
          <p className="subtitle">Batch-first AI image viewer</p>
        </div>
        <RootSelector
          rootPath={rootPath}
          recentRoots={recentRoots}
          onRootChange={handleRootChange}
          onScan={scanDirectoryAction}
          onBrowse={browseForRoot}
        />
      </header>

      <Filters />

      <section className="workspace">
        <GroupList />
        <ImageGrid />
      </section>

      {viewerOpen && <Viewer />}
    </main>
  );
}

export default function App() {
  return (
    <GalleryProvider>
      <AppContent />
    </GalleryProvider>
  );
}
