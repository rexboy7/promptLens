import { convertFileSrc } from "@tauri-apps/api/core";
import { useGallery } from "../../app/GalleryContext";
import "./RankingPanel.css";

export default function RankingPanel() {
  const {
    rankingActive,
    rankingPair,
    startRanking,
    stopRanking,
    submitRankingChoice,
  } = useGallery();

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
      <section className="ranking-panel">
        <span>Preparing next comparison...</span>
        <button type="button" onClick={stopRanking}>
          Stop Ranking
        </button>
      </section>
    );
  }

  return (
    <section className="ranking-panel">
      <div className="ranking-column">
        {rankingPair.leftImages.map((img) => (
          <img key={img.path} src={convertFileSrc(img.path)} alt="Left choice" />
        ))}
        <button type="button" onClick={() => submitRankingChoice("left")}>
          Choose Left
        </button>
        <div className="rating-chip">{rankingPair.leftRating.toFixed(1)}</div>
      </div>
      <div className="ranking-column">
        {rankingPair.rightImages.map((img) => (
          <img key={img.path} src={convertFileSrc(img.path)} alt="Right choice" />
        ))}
        <button type="button" onClick={() => submitRankingChoice("right")}>
          Choose Right
        </button>
        <div className="rating-chip">{rankingPair.rightRating.toFixed(1)}</div>
      </div>
      <div className="ranking-controls">
        <button type="button" onClick={stopRanking}>
          Stop Ranking
        </button>
      </div>
    </section>
  );
}
