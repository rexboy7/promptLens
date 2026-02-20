import { useGallery } from "../app/GalleryContext";
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
import rankIcon from "../assets/toolbar/rank.svg";

export default function Toolbar() {
  const {
    hasImages,
    hasGroups,
    selectedGroupId,
    isFullscreen,
    randomImageInGroup,
    randomCategoryImage,
    toggleSlideshow,
    deleteCurrentImage,
    deleteCurrentGroup,
    toggleFullscreen,
    goPrevGroup,
    goNextGroup,
    goPrevImage,
    goNextImage,
    openViewer,
    stopSlideshowAndCloseViewer,
    rankingActive,
    startRanking,
    stopRanking,
  } = useGallery();
  const hasSelectedGroup = Boolean(selectedGroupId);
  return (
    <section className="toolbar ribbon">
      <div className="toolbar-actions">
        <button
          type="button"
          onClick={randomImageInGroup}
          disabled={!hasImages}
          title="Random image in category (R)"
          className="icon-button"
        >
          <img src={diceIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => void randomCategoryImage()}
          disabled={!hasGroups}
          title="Random category + image (⌘R)"
          className="icon-button"
        >
          <img src={diceStackIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => toggleSlideshow({ acrossGroups: false })}
          disabled={!hasImages}
          title="Slideshow in category (S)"
          className="icon-button"
        >
          <img src={slideshowIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => toggleSlideshow({ acrossGroups: true })}
          disabled={!hasGroups}
          title="Slideshow across categories (⌘S)"
          className="icon-button"
        >
          <img src={slideshowAnyIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={goPrevGroup}
          disabled={!hasGroups}
          title="Previous category (⌘↑)"
          className="icon-button"
        >
          <img src={groupPrevIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={goNextGroup}
          disabled={!hasGroups}
          title="Next category (⌘↓)"
          className="icon-button"
        >
          <img src={groupNextIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={goPrevImage}
          disabled={!hasImages}
          title="Previous image (←)"
          className="icon-button"
        >
          <img src={imagePrevIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={goNextImage}
          disabled={!hasImages}
          title="Next image (→)"
          className="icon-button"
        >
          <img src={imageNextIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={openViewer}
          disabled={!hasImages}
          title="Open viewer (Enter)"
          className="icon-button"
        >
          <img src={openViewerIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={stopSlideshowAndCloseViewer}
          title="Close viewer (Esc)"
          className="icon-button"
        >
          <img src={closeViewerIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
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
          onClick={() => void deleteCurrentImage()}
          disabled={!hasImages}
          title="Delete image (⌘D)"
          className="icon-button danger"
        >
          <img src={deleteImageIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => void deleteCurrentGroup()}
          disabled={!hasSelectedGroup}
          title="Delete category (⌘⌥D)"
          className="icon-button danger"
        >
          <img src={deleteGroupIcon} alt="" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={rankingActive ? stopRanking : startRanking}
          title="Ranking mode"
          className="icon-button"
        >
          <img src={rankIcon} alt="" aria-hidden="true" />
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
