import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useGallery } from "../../app/GalleryContext";
import {
  getRatings,
  getRatingPercentiles,
  listGroups,
  listImages,
  setGroupRating,
  submitComparison,
} from "../../data/galleryApi";
import type { Group, ImageItem, RankingPair, RankingSequence } from "../../data/types";
import ImageMeta from "../ImageMeta";
import "./RankingPanel.css";

export default function RankingPanel() {
  const {
    rankingActive,
    rankingMode,
    startRanking,
    stopRanking,
  } = useGallery();
  const [showPreviousFull, setShowPreviousFull] = useState(false);
  const [rankingGroups, setRankingGroups] = useState<Group[]>([]);
  const [rankingPair, setRankingPair] = useState<RankingPair | null>(null);
  const [rankingSequence, setRankingSequence] = useState<RankingSequence | null>(
    null
  );
  const [ratingPercentileValues, setRatingPercentileValues] = useState<number[]>([]);
  const groupById = useMemo(
    () => new Map(rankingGroups.map((group) => [group.id, group])),
    [rankingGroups]
  );

  const getGroupMeta = (groupId?: string) => {
    if (!groupId) return { date: null, prompt: null, groupId: null };
    const group = groupById.get(groupId);
    return {
      date: group?.date ?? null,
      prompt: group?.label ?? null,
      groupId: group?.id ?? null,
    };
  };

  async function fetchRankingGroups() {
    try {
      const result = await listGroups({
        groupMode: "prompt",
        dateFilter: null,
        searchText: null,
      });
      setRankingGroups(result);
      return result;
    } catch (error) {
      console.warn("Failed to load ranking groups", error);
      setRankingGroups([]);
      return [];
    }
  }

  useEffect(() => {
    if (!rankingActive || rankingMode !== "sequential") {
      setShowPreviousFull(false);
    }
  }, [rankingActive, rankingMode]);

  useEffect(() => {
    if (rankingSequence?.currentMatches === 0) {
      setShowPreviousFull(false);
    }
  }, [rankingSequence?.currentMatches]);

  useEffect(() => {
    if (!rankingActive) {
      setRankingPair(null);
      setRankingSequence(null);
      setRankingGroups([]);
      return;
    }
    void (async () => {
      const groups = await fetchRankingGroups();
      if (rankingMode === "pair") {
        await buildRankingPair(groups);
      } else {
        await buildRankingSequence(groups);
      }
    })();
  }, [rankingActive, rankingMode]);

  useEffect(() => {
    if (!rankingActive) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (rankingMode === "sequential" && rankingSequence?.currentMatches === 0) {
        if (event.key >= "1" && event.key <= "5") {
          event.preventDefault();
          void submitInitialRating(Number(event.key));
          return;
        }
      } else {
        if (event.key === "1") {
          event.preventDefault();
          void submitRankingChoice("left");
        }
        if (event.key === "2") {
          event.preventDefault();
          void submitRankingChoice("right");
        }
        if (event.key === "3") {
          event.preventDefault();
          void submitRankingChoice("both_good");
        }
        if (event.key === "4") {
          event.preventDefault();
          void submitRankingChoice("both_bad");
        }
      }
      if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        if (rankingMode === "sequential") {
          if (showPreviousFull) {
            void rerollRankingSequencePreviousImage();
          } else {
            void rerollRankingSequenceImage();
          }
        } else {
          void rerollRankingImages("both");
        }
      }
      if (
        event.key.toLowerCase() === "q" &&
        rankingMode === "sequential" &&
        rankingSequence?.currentMatches !== 0
      ) {
        event.preventDefault();
        setShowPreviousFull((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    rankingActive,
    rankingMode,
    submitRankingChoice,
    rerollRankingImages,
    rerollRankingSequenceImage,
    rerollRankingSequencePreviousImage,
    showPreviousFull,
    rankingSequence,
    submitInitialRating,
    ratingPercentileValues,
  ]);

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

  const ratingPercentiles = [0.1, 0.3, 0.5, 0.7, 0.9];
  const ratingFallback = (score: number) => 1000 + (score - 3) * 40;
  const ratingAtIndex = (values: number[], index: number) => {
    if (values.length === 0) return 1000;
    return values[Math.min(values.length - 1, Math.max(0, index))];
  };

  async function buildRankingPair(groups: Group[]) {
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

  async function buildRankingSequence(groups: Group[], previousId?: string) {
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
    const percentiles = await getRatingPercentiles(ratingPercentiles);
    setRatingPercentileValues(percentiles);
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
    const freshCurrentPool = currentPool.filter((item) => item.matches === 0);
    const currentCandidates =
      freshCurrentPool.length > 0 ? freshCurrentPool : currentPool;
    const currentMeta = pickTiered(currentCandidates, (item) => {
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
    const currentMatches = ratingsById.get(currentMeta.group.id)?.matches ?? 0;
    const previousMatches = ratingsById.get(previousMeta.group.id)?.matches ?? 0;
    setRankingSequence({
      previousId: previousMeta.group.id,
      currentId: currentMeta.group.id,
      previousImage,
      currentImage,
      previousRating,
      currentRating,
      previousMatches,
      currentMatches,
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
      await buildRankingPair(rankingGroups);
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
    await buildRankingSequence(rankingGroups, rankingSequence.currentId);
  }

  async function submitInitialRating(score: number) {
    if (!rankingSequence) return;
    const index = Math.max(1, Math.min(5, score)) - 1;
    const rating =
      ratingPercentileValues.length === ratingPercentiles.length
        ? ratingAtIndex(ratingPercentileValues, index)
        : ratingFallback(score);
    await setGroupRating({ groupId: rankingSequence.currentId, rating });
    await buildRankingSequence(rankingGroups, rankingSequence.currentId);
  }

  if (!rankingActive) {
    return (
      <section className="ranking-panel">
        <button type="button" onClick={() => startRanking("pair")}>
          Start Ranking
        </button>
        <button type="button" onClick={() => startRanking("sequential")}>
          Start Sequential
        </button>
      </section>
    );
  }

  if (rankingMode === "pair" && !rankingPair) {
    return (
      <div className="ranking-overlay">
        <section className="ranking-panel ranking-panel--overlay">
          <span>Preparing next comparison...</span>
          <button type="button" onClick={stopRanking}>
            Stop Ranking
          </button>
        </section>
      </div>
    );
  }

  if (rankingMode === "sequential") {
    if (!rankingSequence) {
      return (
        <div className="ranking-overlay">
          <section className="ranking-panel ranking-panel--overlay">
            <span>Preparing next comparison...</span>
            <button type="button" onClick={stopRanking}>
              Stop Ranking
            </button>
          </section>
        </div>
      );
    }
    const isCurrentFresh = rankingSequence.currentMatches === 0;
    return (
      <div className="ranking-overlay ranking-overlay--sequential">
        <section className="ranking-panel ranking-panel--overlay ranking-panel--sequential">
          {!isCurrentFresh && (
            <div className="ranking-seq-previous">
              <img
                src={convertFileSrc(rankingSequence.previousImage.path)}
                alt="Previous"
                onClick={() => setShowPreviousFull(true)}
              />
              <div className="rating-chip">
                {rankingSequence.previousRating.toFixed(1)}
              </div>
            </div>
          )}
          <div className="ranking-seq-current">
            <div className="ranking-seq-image">
              <img
                src={convertFileSrc(rankingSequence.currentImage.path)}
                alt="Current"
              />
              <ImageMeta
                className="image-meta--overlay image-meta--ranking"
                serial={rankingSequence.currentImage.serial}
                {...getGroupMeta(rankingSequence.currentId)}
              />
            </div>
          </div>
          <div className="ranking-controls ranking-controls--sequential">
            {isCurrentFresh ? (
              <>
                <button type="button" onClick={() => submitInitialRating(1)}>
                  Rate 1 (1)
                </button>
                <button type="button" onClick={() => submitInitialRating(2)}>
                  Rate 2 (2)
                </button>
                <button type="button" onClick={() => submitInitialRating(3)}>
                  Rate 3 (3)
                </button>
                <button type="button" onClick={() => submitInitialRating(4)}>
                  Rate 4 (4)
                </button>
                <button type="button" onClick={() => submitInitialRating(5)}>
                  Rate 5 (5)
                </button>
                <button type="button" onClick={rerollRankingSequenceImage}>
                  Swap Current (W)
                </button>
                <button type="button" onClick={stopRanking}>
                  Stop Ranking
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => submitRankingChoice("left")}>
                  Choose Previous (1)
                </button>
                <button type="button" onClick={() => submitRankingChoice("right")}>
                  Choose Current (2)
                </button>
                <button
                  type="button"
                  onClick={() => submitRankingChoice("both_good")}
                >
                  Both Good (3)
                </button>
                <button
                  type="button"
                  onClick={() => submitRankingChoice("both_bad")}
                >
                  Both Bad (4)
                </button>
                <button type="button" onClick={rerollRankingSequenceImage}>
                  Swap Current (W)
                </button>
                <button type="button" onClick={stopRanking}>
                  Stop Ranking
                </button>
              </>
            )}
          </div>
          <div className="ranking-current-statusbar">
            <div className="rating-chip">
              {rankingSequence.currentRating.toFixed(1)}
            </div>
          </div>
          {showPreviousFull && !isCurrentFresh && (
            <div
              className="ranking-seq-preview"
              onClick={() => setShowPreviousFull(false)}
            >
              <div
                className="ranking-seq-preview-card"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ranking-seq-preview-image">
                  <img
                    src={convertFileSrc(rankingSequence.previousImage.path)}
                    alt="Previous fullscreen"
                  />
                  <ImageMeta
                    className="image-meta--overlay image-meta--ranking"
                    serial={rankingSequence.previousImage.serial}
                    {...getGroupMeta(rankingSequence.previousId)}
                  />
                </div>
                <div className="ranking-seq-preview-actions">
                  <button
                    type="button"
                    onClick={rerollRankingSequencePreviousImage}
                  >
                    Swap Previous (W)
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="ranking-overlay">
      <section className="ranking-panel ranking-panel--overlay">
        <div className="ranking-column">
          <div className="ranking-images">
            {rankingPair?.leftImages.map((img) => (
              <div key={img.path} className="ranking-image-card">
                <img src={convertFileSrc(img.path)} alt="Left choice" />
                <ImageMeta
                  className="image-meta--overlay image-meta--ranking"
                  serial={img.serial}
                  {...getGroupMeta(rankingPair?.leftId)}
                />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => submitRankingChoice("left")}>
            Choose Left (1)
          </button>
          <div className="rating-chip">{rankingPair?.leftRating.toFixed(1)}</div>
        </div>
        <div className="ranking-column">
          <div className="ranking-images">
            {rankingPair?.rightImages.map((img) => (
              <div key={img.path} className="ranking-image-card">
                <img src={convertFileSrc(img.path)} alt="Right choice" />
                <ImageMeta
                  className="image-meta--overlay image-meta--ranking"
                  serial={img.serial}
                  {...getGroupMeta(rankingPair?.rightId)}
                />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => submitRankingChoice("right")}>
            Choose Right (2)
          </button>
          <div className="rating-chip">
            {rankingPair?.rightRating.toFixed(1)}
          </div>
        </div>
        <div className="ranking-controls">
          <button type="button" onClick={() => rerollRankingImages("both")}>
            Swap Images (W)
          </button>
          <button type="button" onClick={() => submitRankingChoice("both_good")}>
            Both Good (3)
          </button>
          <button type="button" onClick={() => submitRankingChoice("both_bad")}>
            Both Bad (4)
          </button>
          <button type="button" onClick={stopRanking}>
            Stop Ranking
          </button>
        </div>
      </section>
    </div>
  );
}
