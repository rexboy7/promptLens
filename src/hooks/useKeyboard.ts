import { useEffect } from "react";
import type { Command } from "../app/commands";

type KeyboardHandlers = {
  dispatch: (command: Command) => void;
  canNavigateImages: boolean;
};

export function useKeyboard({ dispatch, canNavigateImages }: KeyboardHandlers) {
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
        dispatch({ type: "ESCAPE" });
        return;
      }
      if (event.repeat) {
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        dispatch({ type: "TOGGLE_FULLSCREEN" });
        return;
      }
      if (event.key === "ArrowRight") {
        if (!canNavigateImages) return;
        event.preventDefault();
        dispatch({ type: "NEXT_IMAGE" });
      } else if (event.key === "ArrowLeft") {
        if (!canNavigateImages) return;
        event.preventDefault();
        dispatch({ type: "PREV_IMAGE" });
      } else if (event.key === "ArrowDown") {
        if (!event.metaKey) return;
        event.preventDefault();
        dispatch({ type: "NEXT_GROUP" });
      } else if (event.key === "ArrowUp") {
        if (!event.metaKey) return;
        event.preventDefault();
        dispatch({ type: "PREV_GROUP" });
      } else if (event.key === "Enter") {
        event.preventDefault();
        dispatch({ type: "OPEN_VIEWER" });
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        if (event.metaKey) {
          dispatch({ type: "RANDOM_ANY" });
        } else {
          dispatch({ type: "RANDOM_IMAGE" });
        }
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        dispatch({ type: "TOGGLE_SLIDESHOW", acrossGroups: event.metaKey });
      } else if (event.key === "d" || event.key === "D") {
        if (!event.metaKey) return;
        event.preventDefault();
        if (event.altKey) {
          dispatch({ type: "DELETE_GROUP" });
        } else {
          dispatch({ type: "DELETE_IMAGE" });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, canNavigateImages]);
}
