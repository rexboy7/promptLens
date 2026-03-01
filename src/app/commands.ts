export type Command =
  | { type: "ESCAPE" }
  | { type: "TOGGLE_FULLSCREEN" }
  | { type: "NEXT_IMAGE" }
  | { type: "PREV_IMAGE" }
  | { type: "NEXT_GROUP" }
  | { type: "PREV_GROUP" }
  | { type: "OPEN_VIEWER" }
  | { type: "OPEN_FOLDER" }
  | { type: "RESCAN" }
  | { type: "RANDOM_IMAGE" }
  | { type: "RANDOM_ANY" }
  | { type: "TOGGLE_SLIDESHOW"; acrossGroups: boolean }
  | { type: "DELETE_IMAGE" }
  | { type: "DELETE_GROUP" }
  | { type: "START_RANKING" }
  | { type: "START_SEQUENTIAL_RANKING" };
