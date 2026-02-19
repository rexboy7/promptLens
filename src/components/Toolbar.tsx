import "./Toolbar.css";

type ToolbarProps = {
  hasImages: boolean;
  hasGroups: boolean;
  hasSelectedGroup: boolean;
  isFullscreen: boolean;
  isSlideshowRunning: boolean;
  onRandomImage: () => void;
  onRandomAny: () => void;
  onSlideshow: () => void;
  onSlideshowAny: () => void;
  onDeleteImage: () => void;
  onDeleteGroup: () => void;
  onToggleFullscreen: () => void;
  onPrevGroup: () => void;
  onNextGroup: () => void;
  onPrevImage: () => void;
  onNextImage: () => void;
  onOpenViewer: () => void;
  onCloseViewer: () => void;
};

export default function Toolbar({
  hasImages,
  hasGroups,
  hasSelectedGroup,
  isFullscreen,
  isSlideshowRunning,
  onRandomImage,
  onRandomAny,
  onSlideshow,
  onSlideshowAny,
  onDeleteImage,
  onDeleteGroup,
  onToggleFullscreen,
  onPrevGroup,
  onNextGroup,
  onPrevImage,
  onNextImage,
  onOpenViewer,
  onCloseViewer,
}: ToolbarProps) {
  return (
    <section className="toolbar">
      <div className="toolbar-actions">
        <div className="toolbar-group">
          <span className="toolbar-label">Randomize</span>
          <div className="toolbar-row">
            <button
              type="button"
              onClick={onRandomImage}
              disabled={!hasImages}
              title="Random image in category (R)"
            >
              Random
            </button>
            <button
              type="button"
              onClick={onRandomAny}
              disabled={!hasGroups}
              title="Random category + image (⌘R)"
            >
              Random Any
            </button>
          </div>
        </div>
        <div className="toolbar-group">
          <span className="toolbar-label">Slideshow</span>
          <div className="toolbar-row">
            <button
              type="button"
              onClick={onSlideshow}
              disabled={!hasImages}
              title="Slideshow in category (S)"
            >
              {isSlideshowRunning ? "Stop" : "Slideshow"}
            </button>
            <button
              type="button"
              onClick={onSlideshowAny}
              disabled={!hasGroups}
              title="Slideshow across categories (⌘S)"
            >
              {isSlideshowRunning ? "Stop Any" : "Slideshow Any"}
            </button>
          </div>
        </div>
        <div className="toolbar-group">
          <span className="toolbar-label">Navigate</span>
          <div className="toolbar-row">
            <button
              type="button"
              onClick={onPrevGroup}
              disabled={!hasGroups}
              title="Previous category (⌘↑)"
            >
              Prev Group
            </button>
            <button
              type="button"
              onClick={onNextGroup}
              disabled={!hasGroups}
              title="Next category (⌘↓)"
            >
              Next Group
            </button>
            <button
              type="button"
              onClick={onPrevImage}
              disabled={!hasImages}
              title="Previous image (←)"
            >
              Prev Image
            </button>
            <button
              type="button"
              onClick={onNextImage}
              disabled={!hasImages}
              title="Next image (→)"
            >
              Next Image
            </button>
          </div>
        </div>
        <div className="toolbar-group">
          <span className="toolbar-label">Viewer</span>
          <div className="toolbar-row">
            <button
              type="button"
              onClick={onOpenViewer}
              disabled={!hasImages}
              title="Open viewer (Enter)"
            >
              Open Viewer
            </button>
            <button
              type="button"
              onClick={onCloseViewer}
              title="Close viewer (Esc)"
            >
              Close Viewer
            </button>
            <button
              type="button"
              onClick={onToggleFullscreen}
              title="Fullscreen (F)"
            >
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </button>
          </div>
        </div>
        <div className="toolbar-group">
          <span className="toolbar-label">Danger</span>
          <div className="toolbar-row">
            <button
              type="button"
              onClick={onDeleteImage}
              disabled={!hasImages}
              title="Delete image (⌘D)"
            >
              Delete Image
            </button>
            <button
              type="button"
              onClick={onDeleteGroup}
              disabled={!hasSelectedGroup}
              title="Delete category (⌘⌥D)"
            >
              Delete Group
            </button>
          </div>
        </div>
      </div>
      <details className="shortcut-menu">
        <summary>Shortcuts</summary>
        <ul>
          <li>R — random image in category</li>
          <li>⌘R — random category + image</li>
          <li>S — slideshow in category</li>
          <li>⌘S — slideshow across categories</li>
          <li>⌘D — delete image</li>
          <li>⌘⌥D — delete category</li>
          <li>F — toggle fullscreen</li>
          <li>⌘↑ / ⌘↓ — previous/next category</li>
          <li>Enter — open selected image</li>
          <li>Esc — close viewer and stop slideshow</li>
        </ul>
      </details>
    </section>
  );
}
