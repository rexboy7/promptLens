export type GroupMode = "prompt" | "prompt_date" | "date_prompt" | "date";

export type Group = {
  id: string;
  label: string;
  group_type: string;
  date?: string | null;
  size: number;
  representative_path: string;
};

export type ImageItem = {
  path: string;
  serial: number;
  seed: number;
};

export type ScanResult = {
  total_images: number;
  total_batches: number;
};

export type PromptResult = {
  scanned: number;
  updated: number;
};

export type RatingItem = {
  group_id: string;
  rating: number;
  matches: number;
};

export type RankingMode = "pair" | "sequential";

export type RankingPair = {
  leftId: string;
  rightId: string;
  leftImages: ImageItem[];
  rightImages: ImageItem[];
  leftRating: number;
  rightRating: number;
};

export type RankingSequence = {
  previousId: string;
  currentId: string;
  previousImage: ImageItem;
  currentImage: ImageItem;
  previousRating: number;
  currentRating: number;
};

export type GroupKey =
  | { type: "prompt"; id: number }
  | { type: "batch"; id: number }
  | { type: "date"; date: string }
  | { type: "prompt_date"; id: number; date: string };
