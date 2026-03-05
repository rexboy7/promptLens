import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Command } from "../app/commands";

type MenuHandlers = {
  dispatch: (command: Command) => void;
};

export function useMenuEvents({ dispatch }: MenuHandlers) {
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    const unlistenPromise = listen<string>("menu-action", (event) => {
      const action = event.payload;
      if (action === "random_image") {
        dispatchRef.current({ type: "RANDOM_IMAGE" });
      } else if (action === "open_folder") {
        dispatchRef.current({ type: "OPEN_FOLDER" });
      } else if (action === "rescan") {
        dispatchRef.current({ type: "RESCAN" });
      } else if (action === "fix_batches") {
        dispatchRef.current({ type: "FIX_BATCHES" });
      } else if (action === "random_any") {
        dispatchRef.current({ type: "RANDOM_ANY" });
      } else if (action === "slideshow") {
        dispatchRef.current({ type: "TOGGLE_SLIDESHOW", acrossGroups: false });
      } else if (action === "slideshow_any") {
        dispatchRef.current({ type: "TOGGLE_SLIDESHOW", acrossGroups: true });
      } else if (action === "mark_group_read") {
        dispatchRef.current({ type: "MARK_GROUP_READ" });
      } else if (action === "mark_group_unread") {
        dispatchRef.current({ type: "MARK_GROUP_UNREAD" });
      } else if (action === "score_up") {
        dispatchRef.current({ type: "SCORE_UP" });
      } else if (action === "score_down") {
        dispatchRef.current({ type: "SCORE_DOWN" });
      } else if (action === "delete_image") {
        dispatchRef.current({ type: "DELETE_IMAGE" });
      } else if (action === "delete_group") {
        dispatchRef.current({ type: "DELETE_GROUP" });
      } else if (action === "start_ranking") {
        dispatchRef.current({ type: "START_RANKING" });
      } else if (action === "start_sequential_ranking") {
        dispatchRef.current({ type: "START_SEQUENTIAL_RANKING" });
      } else if (action === "fullscreen") {
        dispatchRef.current({ type: "TOGGLE_FULLSCREEN" });
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
