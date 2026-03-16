import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type { MouseEvent } from "react";
import { useGallery } from "../../app/GalleryContext";
import type { Group } from "../../data/types";
import { useContextMenu } from "../../hooks/useContextMenu";
import { usePagination } from "../../hooks/usePagination";

export default function GroupList() {
  const {
    groups,
    groupPage,
    totalGroupPages,
    goToGroupPage,
    selectedGroupId,
    groupRefs,
    truncateLabel,
    setSelectedGroupId,
    ratingByGroupId,
    viewedGroupIds,
    markGroupViewed,
    markGroupUnviewed,
    adjustGroupRating,
  } = useGallery();
  const {
    menuId,
    menuPosition,
    openMenu,
    closeMenu,
    isOpen: isMenuOpen,
  } = useContextMenu<string>({ width: 180, height: 164, padding: 8 });
  const menuGroup = useMemo<Group | null>(() => {
    if (!menuId) return null;
    return groups.find((group) => group.id === menuId) ?? null;
  }, [groups, menuId]);

  const isViewed = (groupId: string) => viewedGroupIds.includes(groupId);
  const paginationItems = usePagination(groupPage, totalGroupPages);
  const canGoPrev = groupPage > 0;
  const canGoNext = groupPage + 1 < totalGroupPages;

  return (
    <aside className="group-list">
      <div className="group-list-pagination">
        <button
          type="button"
          className="group-page-nav"
          disabled={!canGoPrev}
          onClick={() => goToGroupPage(groupPage - 1)}
        >
          {"<"}
        </button>
        {paginationItems.map((item) =>
          item.type === "ellipsis" ? (
            <span key={item.key} className="group-page-ellipsis">
              .
            </span>
          ) : item.page === groupPage ? (
            <span key={`page-${item.page}`} className="group-page-current">
              {item.page + 1}
            </span>
          ) : (
            <button
              key={`page-${item.page}`}
              type="button"
              className="group-page-number"
              onClick={() => goToGroupPage(item.page)}
            >
              {item.page + 1}
            </button>
          )
        )}
        <button
          type="button"
          className="group-page-nav"
          disabled={!canGoNext}
          onClick={() => goToGroupPage(groupPage + 1)}
        >
          {">"}
        </button>
      </div>
      {groups.map((group) => {
        const thumbSrc = convertFileSrc(group.representative_path);
        const displayLabel = truncateLabel(group.label, 120);
        const rating = ratingByGroupId[group.id];
        const ratingText = rating
          ? `${Math.round(rating.rating)} • ${rating.matches} matches`
          : "Score —";
        const viewed = isViewed(group.id);
        return (
          <button
            key={group.id}
            type="button"
            className={[
              "group",
              group.id === selectedGroupId ? "active" : "",
              viewed ? "viewed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            ref={(node) => {
              groupRefs.current[group.id] = node;
            }}
            onClick={() => setSelectedGroupId(group.id)}
            onContextMenu={(event: MouseEvent) => openMenu(event, group.id)}
          >
            <img src={thumbSrc} alt={`Group ${group.id}`} />
            <div className="group-meta">
              <span className="group-rating">{ratingText}</span>
              <span className="group-id">ID: {group.id}</span>
              <span className="group-count" title={group.label}>
                {displayLabel}
              </span>
              {group.date && <span className="group-subtle">{group.date}</span>}
            </div>
            {viewed && <span className="group-viewed-badge">Viewed</span>}
          </button>
        );
      })}
      {isMenuOpen && menuGroup && menuPosition && (
        <div
          className="group-context-menu"
          style={{ top: menuPosition.y, left: menuPosition.x }}
        >
          <button
            type="button"
            className="group-context-item"
            onClick={() => {
              void markGroupViewed(menuGroup.id);
              closeMenu();
            }}
          >
            Mark viewed
          </button>
          <button
            type="button"
            className="group-context-item"
            onClick={() => {
              void markGroupUnviewed(menuGroup.id);
              closeMenu();
            }}
          >
            Mark unread
          </button>
          <div className="group-context-divider" />
          <button
            type="button"
            className="group-context-item"
            disabled={menuGroup.group_type !== "prompt"}
            onClick={() => {
              void adjustGroupRating(menuGroup.id, 40);
              closeMenu();
            }}
          >
            Score up
          </button>
          <button
            type="button"
            className="group-context-item"
            disabled={menuGroup.group_type !== "prompt"}
            onClick={() => {
              void adjustGroupRating(menuGroup.id, -40);
              closeMenu();
            }}
          >
            Score down
          </button>
        </div>
      )}
      {groups.length === 0 && (
        <div className="empty">No groups yet. Choose a folder.</div>
      )}
    </aside>
  );
}
