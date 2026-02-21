import { useEffect, useState } from "react";
import { getRatings, listImages, submitComparison } from "../data/galleryApi";
import type {
  Group,
  ImageItem,
  RatingItem,
  RankingMode,
  RankingPair,
  RankingSequence,
} from "../data/types";

export function useRankingController(groups: Group[]) {
  const [rankingActive, setRankingActive] = useState(false);
  const [rankingPair, setRankingPair] = useState<RankingPair | null>(null);
  const [rankingMode, setRankingMode] = useState<RankingMode>("pair");
  const [rankingSequence, setRankingSequence] =
    useState<RankingSequence | null>(null);
  const [ratingByGroupId, setRatingByGroupId] = useState<
    Record<string, RatingItem>
  >({});
  const [ratingsVersion, setRatingsVersion] = useState(0);

  const loadRatings = async (bumpVersion = false) => {
    if (groups.length === 0) {
      setRatingByGroupId({});
      return;
    }
    try {
      const ratings = await getRatings(groups.map((group) => group.id));
      const next: Record<string, RatingItem> = {};
      ratings.forEach((item) => {
        next[item.group_id] = item;
      });
      setRatingByGroupId(next);
      if (bumpVersion) {
        setRatingsVersion((value) => value + 1);
      }
    } catch (error) {
      console.warn("Failed to load ratings", error);
    }
  };

  useEffect(() => {
    void loadRatings();
  }, [groups]);

  const pickTwo = (items: ImageItem[]) => {
    const first = items[Math.floor(Math.random() * items.length)];
    let second = items[Math.floor(Math.random() * items.length)];
    while (second.path === first.path && items.length > 1) {
      second = items[Math.floor(Math.random() * items.length)];
    }
    return [first, second];
  };

  const pickOne = (items: ImageItem[]) =>
    items[Math.floor(Math.random() * items.length)];

  const pickWeighted = <T,>(items: T[], weightFn: (item: T) => number) => {
    const weights = items.map((item) => Math.max(0.01, weightFn(item)));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < items.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) {
        return items[i];
      }
    }
    return items[items.length - 1];
  };

  const pickTiered = <T extends { matches: number }>(
    items: T[],
    weightFn: (item: T) => number
  ) => {
    if (items.length === 0) {
      throw new Error("No items to pick from");
    }
    if (items.length < 3) {
      return pickWeighted(items, weightFn);
    }
    const sorted = [...items].sort((a, b) => a.matches - b.matches);
    const third = Math.ceil(sorted.length / 3);
    const low = sorted.slice(0, third);
    const mid = sorted.slice(third, Math.min(sorted.length, third * 2));
    const high = sorted.slice(Math.min(sorted.length, third * 2));
    const roll = Math.random();
    const tier =
      roll < 0.6 ? low : roll < 0.85 ? mid : high.length > 0 ? high : mid;
    return pickWeighted(tier.length > 0 ? tier : sorted, weightFn);
  };

  async function buildRankingPair() {
    if (groups.length < 2) {
      setRankingPair(null);
      return;
    }
    const eligible = groups.filter((group) => group.size >= 2);
    if (eligible.length < 2) {
      setRankingPair(null);
      return;
    }
    const ratings = await getRatings(eligible.map((group) => group.id));
    const ratingsById = new Map(ratings.map((item) => [item.group_id, item]));
    const withMeta = eligible.map((group) => ({
      group,
      rating: ratingsById.get(group.id)?.rating ?? 1000,
      matches: ratingsById.get(group.id)?.matches ?? 0,
    }));
    const leftMeta = pickTiered(withMeta, (item) => 1 / (1 + item.matches));
    const leftRating = leftMeta.rating;
    const rightPool = withMeta.filter((item) => item.group.id !== leftMeta.group.id);
    const rightMeta = pickTiered(rightPool, (item) => {
      const ratingDistance = Math.abs(item.rating - leftRating);
      return (1 / (1 + item.matches)) * (1 + ratingDistance / 250);
    });
    const leftGroup = leftMeta.group;
    const rightGroup = rightMeta.group;
    const leftImages = await listImages(leftGroup.id);
    const rightImages = await listImages(rightGroup.id);
    if (leftImages.length < 2 || rightImages.length < 2) {
      setRankingPair(null);
      return;
    }
    const leftPick = pickTwo(leftImages);
    const rightPick = pickTwo(rightImages);
    const rightRating = ratingsById.get(rightGroup.id)?.rating ?? 1000;
    setRankingPair({
      leftId: leftGroup.id,
      rightId: rightGroup.id,
      leftImages: leftPick,
      rightImages: rightPick,
      leftRating,
      rightRating,
    });
  }

  async function buildRankingSequence(previousId?: string) {
    if (groups.length < 2) {
      setRankingSequence(null);
      return;
    }
    const eligible = groups.filter((group) => group.size >= 1);
    if (eligible.length < 2) {
      setRankingSequence(null);
      return;
    }
    const ratings = await getRatings(eligible.map((group) => group.id));
    const ratingsById = new Map(ratings.map((item) => [item.group_id, item]));
    const withMeta = eligible.map((group) => ({
      group,
      rating: ratingsById.get(group.id)?.rating ?? 1000,
      matches: ratingsById.get(group.id)?.matches ?? 0,
    }));
    const previousMeta = previousId
      ? withMeta.find((item) => item.group.id === previousId)
      : pickTiered(withMeta, (item) => 1 / (1 + item.matches));
    if (!previousMeta) {
      setRankingSequence(null);
      return;
    }
    const previousRating = previousMeta.rating;
    const currentPool = withMeta.filter(
      (item) => item.group.id !== previousMeta.group.id
    );
    const currentMeta = pickTiered(currentPool, (item) => {
      const ratingDistance = Math.abs(item.rating - previousRating);
      return (1 / (1 + item.matches)) * (1 + ratingDistance / 250);
    });
    const previousImages = await listImages(previousMeta.group.id);
    const currentImages = await listImages(currentMeta.group.id);
    if (previousImages.length === 0 || currentImages.length === 0) {
      setRankingSequence(null);
      return;
    }
    const previousImage = pickOne(previousImages);
    const currentImage = pickOne(currentImages);
    const currentRating = ratingsById.get(currentMeta.group.id)?.rating ?? 1000;
    setRankingSequence({
      previousId: previousMeta.group.id,
      currentId: currentMeta.group.id,
      previousImage,
      currentImage,
      previousRating,
      currentRating,
    });
  }

  async function rerollRankingImages(target: "left" | "right" | "both" = "both") {
    if (!rankingPair) return;
    const [leftImages, rightImages] = await Promise.all([
      target === "right"
        ? Promise.resolve(rankingPair.leftImages)
        : listImages(rankingPair.leftId),
      target === "left"
        ? Promise.resolve(rankingPair.rightImages)
        : listImages(rankingPair.rightId),
    ]);
    if (leftImages.length < 2 || rightImages.length < 2) {
      return;
    }
    const leftPick = target === "right" ? rankingPair.leftImages : pickTwo(leftImages);
    const rightPick = target === "left" ? rankingPair.rightImages : pickTwo(rightImages);
    setRankingPair({
      ...rankingPair,
      leftImages: leftPick,
      rightImages: rightPick,
    });
  }

  async function rerollRankingSequenceImage() {
    if (!rankingSequence) return;
    const currentImages = await listImages(rankingSequence.currentId);
    if (currentImages.length === 0) return;
    const currentImage = pickOne(currentImages);
    setRankingSequence({
      ...rankingSequence,
      currentImage,
    });
  }

  async function rerollRankingSequencePreviousImage() {
    if (!rankingSequence) return;
    const previousImages = await listImages(rankingSequence.previousId);
    if (previousImages.length === 0) return;
    const previousImage = pickOne(previousImages);
    setRankingSequence({
      ...rankingSequence,
      previousImage,
    });
  }

  async function startRanking(mode: RankingMode = "sequential") {
    setRankingMode(mode);
    setRankingActive(true);
    if (mode === "pair") {
      await buildRankingPair();
    } else {
      await buildRankingSequence();
    }
  }

  function stopRanking() {
    setRankingActive(false);
    setRankingPair(null);
    setRankingSequence(null);
    void loadRatings(true);
  }

  async function submitRankingChoice(
    side: "left" | "right" | "both_good" | "both_bad"
  ) {
    if (rankingMode === "pair") {
      if (!rankingPair) return;
      const winnerId =
        side === "left"
          ? rankingPair.leftId
          : side === "right"
            ? rankingPair.rightId
            : side;
      await submitComparison({
        leftId: rankingPair.leftId,
        rightId: rankingPair.rightId,
        winnerId,
      });
      await buildRankingPair();
      return;
    }
    if (!rankingSequence) return;
    const winnerId =
      side === "left"
        ? rankingSequence.previousId
        : side === "right"
          ? rankingSequence.currentId
          : side;
    await submitComparison({
      leftId: rankingSequence.previousId,
      rightId: rankingSequence.currentId,
      winnerId,
    });
    await buildRankingSequence(rankingSequence.currentId);
  }

  return {
    rankingActive,
    rankingPair,
    rankingMode,
    rankingSequence,
    ratingByGroupId,
    ratingsVersion,
    startRanking,
    stopRanking,
    submitRankingChoice,
    rerollRankingImages,
    rerollRankingSequenceImage,
    rerollRankingSequencePreviousImage,
  };
}
