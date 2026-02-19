import { useEffect } from "react";

type KeyboardHandlers = {
  onEscape: () => void;
  onToggleFullscreen: () => void;
  onNextImage: () => void;
  onPrevImage: () => void;
  onNextGroup: () => void;
  onPrevGroup: () => void;
  onOpenViewer: () => void;
  onRandomImage: () => void;
  onRandomAny: () => void;
  onToggleSlideshow: (acrossGroups: boolean) => void;
  onDeleteImage: () => void;
  onDeleteGroup: () => void;
  canNavigateImages: boolean;
};

export function useKeyboard({
  onEscape,
  onToggleFullscreen,
  onNextImage,
  onPrevImage,
  onNextGroup,
  onPrevGroup,
  onOpenViewer,
  onRandomImage,
  onRandomAny,
  onToggleSlideshow,
  onDeleteImage,
  onDeleteGroup,
  canNavigateImages,
}: KeyboardHandlers) {
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
        onEscape();
        return;
      }
      if (event.repeat) {
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        onToggleFullscreen();
        return;
      }
      if (event.key === "ArrowRight") {
        if (!canNavigateImages) return;
        event.preventDefault();
        onNextImage();
      } else if (event.key === "ArrowLeft") {
        if (!canNavigateImages) return;
        event.preventDefault();
        onPrevImage();
      } else if (event.key === "ArrowDown") {
        if (!event.metaKey) return;
        event.preventDefault();
        onNextGroup();
      } else if (event.key === "ArrowUp") {
        if (!event.metaKey) return;
        event.preventDefault();
        onPrevGroup();
      } else if (event.key === "Enter") {
        event.preventDefault();
        onOpenViewer();
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        if (event.metaKey) {
          onRandomAny();
        } else {
          onRandomImage();
        }
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        onToggleSlideshow(event.metaKey);
      } else if (event.key === "d" || event.key === "D") {
        if (!event.metaKey) return;
        event.preventDefault();
        if (event.altKey) {
          onDeleteGroup();
        } else {
          onDeleteImage();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    onEscape,
    onToggleFullscreen,
    onNextImage,
    onPrevImage,
    onNextGroup,
    onPrevGroup,
    onOpenViewer,
    onRandomImage,
    onRandomAny,
    onToggleSlideshow,
    onDeleteImage,
    onDeleteGroup,
    canNavigateImages,
  ]);
}
