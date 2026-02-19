import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

type MenuHandlers = {
  onRandomImage: () => void;
  onRandomAny: () => void;
  onSlideshow: () => void;
  onSlideshowAny: () => void;
  onDeleteImage: () => void;
  onDeleteGroup: () => void;
  onToggleFullscreen: () => void;
  onExtractPrompts: () => void;
};

export function useMenuEvents({
  onRandomImage,
  onRandomAny,
  onSlideshow,
  onSlideshowAny,
  onDeleteImage,
  onDeleteGroup,
  onToggleFullscreen,
  onExtractPrompts,
}: MenuHandlers) {
  useEffect(() => {
    const unlistenPromise = listen<string>("menu-action", (event) => {
      const action = event.payload;
      if (action === "random_image") {
        onRandomImage();
      } else if (action === "random_any") {
        onRandomAny();
      } else if (action === "slideshow") {
        onSlideshow();
      } else if (action === "slideshow_any") {
        onSlideshowAny();
      } else if (action === "delete_image") {
        onDeleteImage();
      } else if (action === "delete_group") {
        onDeleteGroup();
      } else if (action === "fullscreen") {
        onToggleFullscreen();
      } else if (action === "extract_prompts") {
        onExtractPrompts();
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    onRandomImage,
    onRandomAny,
    onSlideshow,
    onSlideshowAny,
    onDeleteImage,
    onDeleteGroup,
    onToggleFullscreen,
    onExtractPrompts,
  ]);
}
