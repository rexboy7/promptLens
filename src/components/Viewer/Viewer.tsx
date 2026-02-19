import { convertFileSrc } from "@tauri-apps/api/core";
import { useGallery } from "../../app/GalleryContext";

export default function Viewer() {
  const {
    images,
    selectedImageIndex,
    selectedGroup,
    isFullscreen,
    viewerRef,
    stopSlideshowAndCloseViewer,
    toggleFullscreen,
    goPrevImage,
    goNextImage,
  } = useGallery();
  if (selectedImageIndex === null) return null;
  const image = images[selectedImageIndex];
  if (!image) return null;

  return (
    <div className="viewer" onClick={stopSlideshowAndCloseViewer} ref={viewerRef}>
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
          goPrevImage();
        }}
        disabled={selectedImageIndex === 0}
      >
        Prev
      </button>
      <img
        src={convertFileSrc(image.path)}
        alt="Selected"
        onClick={(event) => event.stopPropagation()}
        className={isFullscreen ? "viewer-image fullscreen" : "viewer-image"}
      />
      <button
        type="button"
        className="viewer-nav next"
        onClick={(event) => {
          event.stopPropagation();
          goNextImage();
        }}
        disabled={selectedImageIndex >= images.length - 1}
      >
        Next
      </button>
      <div className="viewer-hint">
        Arrow keys: prev/next image, up/down group, Enter to open, Esc to close
      </div>
    </div>
  );
}
