import { convertFileSrc } from "@tauri-apps/api/core";
import type { Group } from "../../data/types";

type GroupListProps = {
  groups: Group[];
  selectedGroupId: string | null;
  groupRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  truncateLabel: (text: string, maxLength?: number) => string;
  onSelectGroup: (id: string) => void;
};

export default function GroupList({
  groups,
  selectedGroupId,
  groupRefs,
  truncateLabel,
  onSelectGroup,
}: GroupListProps) {
  return (
    <aside className="group-list">
      {groups.map((group) => {
        const thumbSrc = convertFileSrc(group.representative_path);
        const displayLabel = truncateLabel(group.label, 120);
        return (
          <button
            key={group.id}
            type="button"
            className={group.id === selectedGroupId ? "group active" : "group"}
            ref={(node) => {
              groupRefs.current[group.id] = node;
            }}
            onClick={() => onSelectGroup(group.id)}
          >
            <img src={thumbSrc} alt={`Group ${group.id}`} />
            <div className="group-meta">
              <span className="group-date">
                {group.group_type === "prompt"
                  ? "Prompt"
                  : group.group_type === "prompt_date"
                  ? "Prompt + Date"
                  : group.group_type === "date_prompt"
                  ? "Date + Prompt"
                  : group.group_type === "date"
                  ? "Date"
                  : "Batch"}{" "}
                • {group.size} images
              </span>
              <span className="group-count" title={group.label}>
                {displayLabel}
              </span>
              {group.date && <span className="group-subtle">{group.date}</span>}
            </div>
          </button>
        );
      })}
      {groups.length === 0 && (
        <div className="empty">No groups yet. Scan a folder.</div>
      )}
    </aside>
  );
}
