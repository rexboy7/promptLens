import { useGallery } from "../../app/GalleryContext";

export default function Filters() {
  const {
    searchText,
    dateFilter,
    groupMode,
    status,
    setSearchText,
    setDateFilter,
    setGroupMode,
    refreshGroups,
    extractPromptsAction,
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
      <button type="button" onClick={() => refreshGroups()}>
        Apply
      </button>
      <div className="mode-toggle">
        <button
          type="button"
          className={groupMode === "prompt" ? "mode active" : "mode"}
          onClick={() => {
            setGroupMode("prompt");
            void refreshGroups("prompt");
          }}
        >
          Prompt
        </button>
        <button
          type="button"
          className={groupMode === "prompt_date" ? "mode active" : "mode"}
          onClick={() => {
            setGroupMode("prompt_date");
            void refreshGroups("prompt_date");
          }}
        >
          Prompt + Date
        </button>
        <button
          type="button"
          className={groupMode === "date_prompt" ? "mode active" : "mode"}
          onClick={() => {
            setGroupMode("date_prompt");
            void refreshGroups("date_prompt");
          }}
        >
          Date + Prompt
        </button>
        <button
          type="button"
          className={groupMode === "date" ? "mode active" : "mode"}
          onClick={() => {
            setGroupMode("date");
            void refreshGroups("date");
          }}
        >
          Date
        </button>
        <button
          type="button"
          className={groupMode === "score" ? "mode active" : "mode"}
          onClick={() => {
            setGroupMode("score");
            void refreshGroups("score");
          }}
        >
          Score
        </button>
      </div>
      <button type="button" onClick={extractPromptsAction}>
        Extract Prompts
      </button>
      <span className="status">{status}</span>
    </section>
  );
}
