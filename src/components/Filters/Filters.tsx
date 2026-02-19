import type { GroupMode } from "../../data/types";

type FiltersProps = {
  searchText: string;
  dateFilter: string;
  groupMode: GroupMode;
  status: string;
  onSearchChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onApply: () => void;
  onGroupModeChange: (mode: GroupMode) => void;
  onExtractPrompts: () => void;
};

export default function Filters({
  searchText,
  dateFilter,
  groupMode,
  status,
  onSearchChange,
  onDateChange,
  onApply,
  onGroupModeChange,
  onExtractPrompts,
}: FiltersProps) {
  return (
    <section className="filters">
      <input
        value={searchText}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        placeholder="Search prompts or dates"
      />
      <input
        value={dateFilter}
        onChange={(event) => onDateChange(event.currentTarget.value)}
        placeholder="Date filter YYYY-MM-DD"
      />
      <button type="button" onClick={onApply}>
        Apply
      </button>
      <div className="mode-toggle">
        <button
          type="button"
          className={groupMode === "prompt" ? "mode active" : "mode"}
          onClick={() => onGroupModeChange("prompt")}
        >
          Prompt
        </button>
        <button
          type="button"
          className={groupMode === "prompt_date" ? "mode active" : "mode"}
          onClick={() => onGroupModeChange("prompt_date")}
        >
          Prompt + Date
        </button>
        <button
          type="button"
          className={groupMode === "date_prompt" ? "mode active" : "mode"}
          onClick={() => onGroupModeChange("date_prompt")}
        >
          Date + Prompt
        </button>
        <button
          type="button"
          className={groupMode === "date" ? "mode active" : "mode"}
          onClick={() => onGroupModeChange("date")}
        >
          Date
        </button>
      </div>
      <button type="button" onClick={onExtractPrompts}>
        Extract Prompts
      </button>
      <span className="status">{status}</span>
    </section>
  );
}
