import { convertFileSrc } from "@tauri-apps/api/core";
import { useGallery } from "../../app/GalleryContext";

export default function GroupList() {
  const {
    groups,
    selectedGroupId,
    groupRefs,
    truncateLabel,
    setSelectedGroupId,
    ratingByGroupId,
  } = useGallery();
  return (
    <aside className="group-list">
      {groups.map((group) => {
        const thumbSrc = convertFileSrc(group.representative_path);
        const displayLabel = truncateLabel(group.label, 120);
        const rating = ratingByGroupId[group.id];
        const ratingText = rating
          ? `${Math.round(rating.rating)} • ${rating.matches} matches`
          : "Score —";
        return (
          <button
            key={group.id}
            type="button"
            className={group.id === selectedGroupId ? "group active" : "group"}
            ref={(node) => {
              groupRefs.current[group.id] = node;
            }}
            onClick={() => setSelectedGroupId(group.id)}
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
              <span className="group-rating">{ratingText}</span>
              <span className="group-id">ID: {group.id}</span>
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
