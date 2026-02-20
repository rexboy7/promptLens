import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useGallery } from "../../app/GalleryContext";
import "./RankingPanel.css";

export default function RankingPanel() {
  const {
    rankingActive,
    rankingPair,
    startRanking,
    stopRanking,
    submitRankingChoice,
    rerollRankingImages,
  } = useGallery();

  useEffect(() => {
    if (!rankingActive || !rankingPair) {
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
        rerollRankingImages("both");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rankingActive, rankingPair, submitRankingChoice]);

  if (!rankingActive) {
    return (
      <section className="ranking-panel">
        <button type="button" onClick={startRanking}>
          Start Ranking
        </button>
      </section>
    );
  }

  if (!rankingPair) {
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
    <div className="ranking-overlay">
      <section className="ranking-panel ranking-panel--overlay">
        <div className="ranking-column">
          <div className="ranking-images">
            {rankingPair.leftImages.map((img) => (
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
          <div className="rating-chip">{rankingPair.leftRating.toFixed(1)}</div>
        </div>
        <div className="ranking-column">
          <div className="ranking-images">
            {rankingPair.rightImages.map((img) => (
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
          <div className="rating-chip">{rankingPair.rightRating.toFixed(1)}</div>
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
