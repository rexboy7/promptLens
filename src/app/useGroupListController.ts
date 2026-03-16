import { useCallback, useState } from "react";
import { countGroups, listGroups } from "../data/galleryApi";
import type { Group, GroupMode } from "../data/types";

const GROUPS_PER_PAGE = 200;
const GROUP_FETCH_SIZE = GROUPS_PER_PAGE + 1;

type LoadGroupsParams = {
  rootPath: string;
  dateFilter: string;
  searchText: string;
  currentMode: GroupMode;
  nextMode?: GroupMode;
  pageOverride?: number;
};

export function useGroupListController() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupPage, setGroupPage] = useState(0);
  const [totalGroupCount, setTotalGroupCount] = useState(0);

  const totalGroupPages =
    totalGroupCount > 0 ? Math.ceil(totalGroupCount / GROUPS_PER_PAGE) : 0;

  const resetGroupList = useCallback(() => {
    setGroups([]);
    setGroupPage(0);
    setTotalGroupCount(0);
  }, []);

  const loadGroups = useCallback(async (params: LoadGroupsParams) => {
    const trimmedRoot = params.rootPath.trim();
    if (!trimmedRoot) {
      setGroups([]);
      setGroupPage(0);
      setTotalGroupCount(0);
      return { pageItems: [] as Group[], requestedPage: 0 };
    }

    const mode = params.nextMode ?? params.currentMode;
    let requestedPage = Math.max(
      0,
      params.pageOverride ?? (mode === params.currentMode ? groupPage : 0)
    );

    const normalizedDateFilter = params.dateFilter.trim()
      ? params.dateFilter.trim()
      : null;
    const normalizedSearchText = params.searchText.trim()
      ? params.searchText.trim()
      : null;

    while (true) {
      const [result, count] = await Promise.all([
        listGroups({
          rootPath: trimmedRoot,
          dateFilter: normalizedDateFilter,
          searchText: normalizedSearchText,
          groupMode: mode,
          limit: GROUP_FETCH_SIZE,
          offset: requestedPage * GROUPS_PER_PAGE,
        }),
        countGroups({
          rootPath: trimmedRoot,
          dateFilter: normalizedDateFilter,
          searchText: normalizedSearchText,
          groupMode: mode,
        }),
      ]);

      const maxPage = Math.max(0, Math.ceil(count / GROUPS_PER_PAGE) - 1);
      if (requestedPage > maxPage && count > 0) {
        requestedPage = maxPage;
        continue;
      }

      const pageItems = result.slice(0, GROUPS_PER_PAGE);
      setGroups(pageItems);
      setTotalGroupCount(count);
      setGroupPage(requestedPage);
      return { pageItems, requestedPage };
    }
  }, [groupPage]);

  return {
    groups,
    groupPage,
    totalGroupCount,
    totalGroupPages,
    groupsPerPage: GROUPS_PER_PAGE,
    setGroupPage,
    resetGroupList,
    loadGroups,
  };
}
