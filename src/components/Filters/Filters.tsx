import { useGallery } from "../../app/GalleryContext";

export default function Filters() {
  const {
    searchText,
    dateFilter,
    minGroupSize,
    maxGroupSize,
    groupMode,
    status,
    scanProgress,
    setSearchText,
    setDateFilter,
    setMinGroupSize,
    setMaxGroupSize,
    setGroupMode,
    refreshGroups,
  } = useGallery();
  return (
    <section className="filters">
      <input
        value={searchText}
        onChange={(event) => setSearchText(event.currentTarget.value)}
        placeholder="Search prompts or dates"
      />
      <input
        value={dateFilter}
        onChange={(event) => setDateFilter(event.currentTarget.value)}
        placeholder="Date filter YYYY-MM-DD"
      />
      <input
        value={minGroupSize}
        onChange={(event) => setMinGroupSize(event.currentTarget.value)}
        placeholder="Min images"
        inputMode="numeric"
      />
      <input
        value={maxGroupSize}
        onChange={(event) => setMaxGroupSize(event.currentTarget.value)}
        placeholder="Max images"
        inputMode="numeric"
      />
      <button type="button" onClick={() => refreshGroups(groupMode, 0)}>
        Apply
      </button>
      <div className="mode-toggle">
        <button
          type="button"
          className={groupMode === "prompt" ? "mode active" : "mode"}
          onClick={() => {
            setGroupMode("prompt");
            void refreshGroups("prompt", 0);
          }}
        >
          Prompt
        </button>
        <button
          type="button"
          className={groupMode === "date" ? "mode active" : "mode"}
          onClick={() => {
            setGroupMode("date");
            void refreshGroups("date", 0);
          }}
        >
          Date
        </button>
        <button
          type="button"
          className={groupMode === "score" ? "mode active" : "mode"}
          onClick={() => {
            setGroupMode("score");
            void refreshGroups("score", 0);
          }}
        >
          Score
        </button>
      </div>
      <div className="status-wrap">
        <span className="status">{status}</span>
        {scanProgress && !scanProgress.done && (
          <progress
            className="scan-progress"
            value={scanProgress.processed}
            max={Math.max(1, scanProgress.total)}
          />
        )}
      </div>
    </section>
  );
}
