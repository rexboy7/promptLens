import "./Toolbar.css";
import diceIcon from "../assets/toolbar/dice.svg";
import diceStackIcon from "../assets/toolbar/dice-stack.svg";
import slideshowIcon from "../assets/toolbar/slideshow.svg";
import slideshowAnyIcon from "../assets/toolbar/slideshow-any.svg";
import groupPrevIcon from "../assets/toolbar/group-prev.svg";
import groupNextIcon from "../assets/toolbar/group-next.svg";
import imagePrevIcon from "../assets/toolbar/image-prev.svg";
import imageNextIcon from "../assets/toolbar/image-next.svg";
import openViewerIcon from "../assets/toolbar/open-viewer.svg";
import closeViewerIcon from "../assets/toolbar/close-viewer.svg";
import fullscreenIcon from "../assets/toolbar/fullscreen.svg";
import fullscreenExitIcon from "../assets/toolbar/fullscreen-exit.svg";
import deleteImageIcon from "../assets/toolbar/delete-image.svg";
import deleteGroupIcon from "../assets/toolbar/delete-group.svg";

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
    <section className="toolbar ribbon">
      <div className="toolbar-actions">
        <button
          type="button"
          onClick={onRandomImage}
          disabled={!hasImages}
          title="Random image in category (R)"
          className="icon-button"
        >
          <img src={diceIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRandomAny}
          disabled={!hasGroups}
          title="Random category + image (⌘R)"
          className="icon-button"
        >
          <img src={diceStackIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onSlideshow}
          disabled={!hasImages}
          title="Slideshow in category (S)"
          className="icon-button"
        >
          <img src={slideshowIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onSlideshowAny}
          disabled={!hasGroups}
          title="Slideshow across categories (⌘S)"
          className="icon-button"
        >
          <img src={slideshowAnyIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onPrevGroup}
          disabled={!hasGroups}
          title="Previous category (⌘↑)"
          className="icon-button"
        >
          <img src={groupPrevIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onNextGroup}
          disabled={!hasGroups}
          title="Next category (⌘↓)"
          className="icon-button"
        >
          <img src={groupNextIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onPrevImage}
          disabled={!hasImages}
          title="Previous image (←)"
          className="icon-button"
        >
          <img src={imagePrevIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onNextImage}
          disabled={!hasImages}
          title="Next image (→)"
          className="icon-button"
        >
          <img src={imageNextIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onOpenViewer}
          disabled={!hasImages}
          title="Open viewer (Enter)"
          className="icon-button"
        >
          <img src={openViewerIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onCloseViewer}
          title="Close viewer (Esc)"
          className="icon-button"
        >
          <img src={closeViewerIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleFullscreen}
          title="Fullscreen (F)"
          className="icon-button"
        >
          <img
            src={isFullscreen ? fullscreenExitIcon : fullscreenIcon}
            alt=""
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={onDeleteImage}
          disabled={!hasImages}
          title="Delete image (⌘D)"
          className="icon-button danger"
        >
          <img src={deleteImageIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDeleteGroup}
          disabled={!hasSelectedGroup}
          title="Delete category (⌘⌥D)"
          className="icon-button danger"
        >
          <img src={deleteGroupIcon} alt="" aria-hidden="true" />
        </button>
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
