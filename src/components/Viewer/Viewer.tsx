import { convertFileSrc } from "@tauri-apps/api/core";
import type { Group, ImageItem } from "../../data/types";

type ViewerProps = {
  images: ImageItem[];
  selectedImageIndex: number;
  selectedGroup?: Group | null;
  isFullscreen: boolean;
  viewerRef: React.MutableRefObject<HTMLDivElement | null>;
  onClose: () => void;
  onToggleFullscreen: () => void;
  onPrev: () => void;
  onNext: () => void;
};

export default function Viewer({
  images,
  selectedImageIndex,
  selectedGroup,
  isFullscreen,
  viewerRef,
  onClose,
  onToggleFullscreen,
  onPrev,
  onNext,
}: ViewerProps) {
  const image = images[selectedImageIndex];
  if (!image) return null;

  return (
    <div className="viewer" onClick={onClose} ref={viewerRef}>
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
            onToggleFullscreen();
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
          onPrev();
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
          onNext();
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
