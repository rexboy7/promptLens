import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Command } from "../app/commands";

type MenuHandlers = {
  dispatch: (command: Command) => void;
};

export function useMenuEvents({ dispatch }: MenuHandlers) {
  useEffect(() => {
    const unlistenPromise = listen<string>("menu-action", (event) => {
      const action = event.payload;
      if (action === "random_image") {
        dispatch({ type: "RANDOM_IMAGE" });
      } else if (action === "open_folder") {
        dispatch({ type: "OPEN_FOLDER" });
      } else if (action === "rescan") {
        dispatch({ type: "RESCAN" });
      } else if (action === "random_any") {
        dispatch({ type: "RANDOM_ANY" });
      } else if (action === "slideshow") {
        dispatch({ type: "TOGGLE_SLIDESHOW", acrossGroups: false });
      } else if (action === "slideshow_any") {
        dispatch({ type: "TOGGLE_SLIDESHOW", acrossGroups: true });
      } else if (action === "delete_image") {
        dispatch({ type: "DELETE_IMAGE" });
      } else if (action === "delete_group") {
        dispatch({ type: "DELETE_GROUP" });
      } else if (action === "start_ranking") {
        dispatch({ type: "START_RANKING" });
      } else if (action === "start_sequential_ranking") {
        dispatch({ type: "START_SEQUENTIAL_RANKING" });
      } else if (action === "fullscreen") {
        dispatch({ type: "TOGGLE_FULLSCREEN" });
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [dispatch]);
}
