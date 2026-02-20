import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useGallery } from "../../app/GalleryContext";
import "./RankingPanel.css";

export default function RankingPanel() {
  const {
    rankingActive,
    rankingPair,
    rankingMode,
    rankingSequence,
    startRanking,
    stopRanking,
    submitRankingChoice,
    rerollRankingImages,
    rerollRankingSequenceImage,
    rerollRankingSequencePreviousImage,
  } = useGallery();
  const [showPreviousFull, setShowPreviousFull] = useState(false);

  useEffect(() => {
    if (!rankingActive || rankingMode !== "sequential") {
      setShowPreviousFull(false);
    }
  }, [rankingActive, rankingMode]);

  useEffect(() => {
    if (!rankingActive) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "1") {
        event.preventDefault();
        submitRankingChoice("left");
      }
      if (event.key === "2") {
        event.preventDefault();
        submitRankingChoice("right");
      }
      if (event.key === "3") {
        event.preventDefault();
        submitRankingChoice("both_good");
      }
      if (event.key === "4") {
        event.preventDefault();
        submitRankingChoice("both_bad");
      }
      if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        if (rankingMode === "sequential") {
          if (event.metaKey) {
            rerollRankingSequencePreviousImage();
          } else {
            rerollRankingSequenceImage();
          }
        } else {
          rerollRankingImages("both");
        }
      }
      if (event.key.toLowerCase() === "q" && rankingMode === "sequential") {
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
  ]);

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
    return (
      <div className="ranking-overlay ranking-overlay--sequential">
        <section className="ranking-panel ranking-panel--overlay ranking-panel--sequential">
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
          <div className="ranking-seq-current">
            <img
              src={convertFileSrc(rankingSequence.currentImage.path)}
              alt="Current"
            />
          </div>
          <div className="ranking-controls ranking-controls--sequential">
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
            <button type="button" onClick={rerollRankingSequencePreviousImage}>
              Swap Previous (Cmd+W)
            </button>
            <button type="button" onClick={stopRanking}>
              Stop Ranking
            </button>
          </div>
          <div className="ranking-current-statusbar">
            <div className="rating-chip">
              {rankingSequence.currentRating.toFixed(1)}
            </div>
          </div>
          {showPreviousFull && (
            <div
              className="ranking-seq-preview"
              onClick={() => setShowPreviousFull(false)}
            >
              <img
                src={convertFileSrc(rankingSequence.previousImage.path)}
                alt="Previous fullscreen"
              />
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
              <img
                key={img.path}
                src={convertFileSrc(img.path)}
                alt="Left choice"
              />
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
              <img
                key={img.path}
                src={convertFileSrc(img.path)}
                alt="Right choice"
              />
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
