import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GroupList from "../GroupList/GroupList";
import ImageGrid from "../ImageGrid/ImageGrid";
import Viewer from "../Viewer/Viewer";
import type { Group, ImageItem } from "../../data/types";

let galleryState: any;

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));

vi.mock("../../app/GalleryContext", () => ({
  useGallery: () => galleryState,
}));

function renderGalleryFlow() {
  return (
    <>
      <GroupList />
      <ImageGrid />
      {galleryState.viewerOpen ? <Viewer /> : null}
    </>
  );
}

describe("gallery interaction flow", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    const groups: Group[] = [
      {
        id: "p:1",
        label: "sunset mountain",
        group_type: "prompt",
        date: "2026-03-15",
        size: 1,
        representative_path: "/tmp/sunset.png",
      },
      {
        id: "p:2",
        label: "rainy neon street",
        group_type: "prompt",
        date: "2026-03-16",
        size: 1,
        representative_path: "/tmp/rainy.png",
      },
    ];
    const imagesByGroup: Record<string, ImageItem[]> = {
      "p:1": [{ path: "/tmp/11-1001.png", serial: 11, seed: 1001 }],
      "p:2": [{ path: "/tmp/21-2001.png", serial: 21, seed: 2001 }],
    };

    const syncSelectedGroup = () => {
      galleryState.selectedGroup =
        groups.find((group) => group.id === galleryState.selectedGroupId) ?? null;
    };

    const markGroupsViewed = vi.fn(async () => true);
    const markGroupsUnviewed = vi.fn(async () => true);
    const adjustGroupsRating = vi.fn(async () => true);

    galleryState = {
      groups,
      groupPage: 0,
      totalGroupPages: 1,
      goToGroupPage: () => {},
      selectedGroupId: "p:1",
      selectedGroupIds: ["p:1"],
      groupRefs: { current: {} as Record<string, HTMLButtonElement | null> },
      truncateLabel: (label: string) => label,
      setGroupSelection: (groupId: string, multiSelect = false) => {
        if (multiSelect) {
          galleryState.selectedGroupId = groupId;
          galleryState.selectedGroupIds = Array.from(
            new Set([...galleryState.selectedGroupIds, groupId])
          );
        } else {
          galleryState.selectedGroupId = groupId;
          galleryState.selectedGroupIds = [groupId];
        }
        syncSelectedGroup();
        galleryState.images = imagesByGroup[groupId] ?? [];
        galleryState.selectedImageIndex = galleryState.images.length > 0 ? 0 : null;
        galleryState.viewerOpen = false;
      },
      ratingByGroupId: {},
      viewedGroupIds: [],
      markGroupsViewed,
      markGroupsUnviewed,
      adjustGroupsRating,
      markGroupViewed: async () => true,
      markGroupUnviewed: async () => true,
      adjustGroupRating: async () => {},
      images: [],
      selectedImageIndex: null,
      imageRefs: { current: {} as Record<number, HTMLButtonElement | null> },
      setSelectedImageIndex: (
        value: number | null | ((prev: number | null) => number | null)
      ) => {
        galleryState.selectedImageIndex =
          typeof value === "function" ? value(galleryState.selectedImageIndex) : value;
      },
      setViewerOpen: (
        value: boolean | ((prev: boolean) => boolean)
      ) => {
        galleryState.viewerOpen =
          typeof value === "function" ? value(galleryState.viewerOpen) : value;
      },
      viewerOpen: false,
      selectedGroup: null,
      isFullscreen: false,
      viewerRef: { current: null as HTMLDivElement | null },
      stopSlideshowAndCloseViewer: () => {
        galleryState.viewerOpen = false;
      },
      toggleFullscreen: async () => {},
      goPrevImage: () => {},
      goNextImage: () => {},
    };
  });

  it("selects a group, opens an image, and shows viewer metadata", () => {
    const { rerender } = render(renderGalleryFlow());

    const targetGroupButton = screen.getByText("ID: p:2").closest("button");
    expect(targetGroupButton).not.toBeNull();
    fireEvent.click(targetGroupButton as HTMLButtonElement);
    rerender(renderGalleryFlow());

    const imageButton = screen.getByRole("button", { name: /21-2001/ });
    fireEvent.click(imageButton);
    rerender(renderGalleryFlow());

    expect(screen.getByText(/Serial: 21/)).toBeInTheDocument();
    expect(screen.getByText(/Group: p:2/)).toBeInTheDocument();
    expect(screen.getByText(/Prompt: rainy neon street/)).toBeInTheDocument();
  });

  it("closes the viewer when clicking the backdrop", () => {
    const { rerender } = render(renderGalleryFlow());

    const targetGroupButton = screen.getByText("ID: p:2").closest("button");
    expect(targetGroupButton).not.toBeNull();
    fireEvent.click(targetGroupButton as HTMLButtonElement);
    rerender(renderGalleryFlow());

    const imageButton = screen.getByRole("button", { name: /21-2001/ });
    fireEvent.click(imageButton);
    rerender(renderGalleryFlow());

    expect(screen.getByText(/Serial: 21/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Serial: 21/).closest(".viewer") as HTMLElement);
    rerender(renderGalleryFlow());

    expect(screen.queryByText(/Serial: 21/)).not.toBeInTheDocument();
  });

  it("navigates images with next and prev buttons and respects boundaries", () => {
    const { rerender } = render(renderGalleryFlow());

    galleryState.groups = [
      {
        id: "p:multi",
        label: "multi image prompt",
        group_type: "prompt",
        date: "2026-03-16",
        size: 2,
        representative_path: "/tmp/multi.png",
      },
    ];
    galleryState.selectedGroupId = "p:multi";
    galleryState.selectedGroupIds = ["p:multi"];
    galleryState.selectedGroup = galleryState.groups[0];
    galleryState.images = [
      { path: "/tmp/31-3001.png", serial: 31, seed: 3001 },
      { path: "/tmp/32-3002.png", serial: 32, seed: 3002 },
    ];
    galleryState.selectedImageIndex = 0;
    galleryState.viewerOpen = true;
    galleryState.goNextImage = () => {
      galleryState.selectedImageIndex = Math.min(
        galleryState.images.length - 1,
        galleryState.selectedImageIndex + 1
      );
    };
    galleryState.goPrevImage = () => {
      galleryState.selectedImageIndex = Math.max(0, galleryState.selectedImageIndex - 1);
    };
    rerender(renderGalleryFlow());

    expect(screen.getByText(/Serial: 31/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    rerender(renderGalleryFlow());
    expect(screen.getByText(/Serial: 32/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prev" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Prev" }));
    rerender(renderGalleryFlow());
    expect(screen.getByText(/Serial: 31/)).toBeInTheDocument();
  });

  it("renders empty states for groups and images", () => {
    const { rerender } = render(renderGalleryFlow());

    galleryState.groups = [];
    galleryState.images = [];
    galleryState.selectedGroupId = null;
    galleryState.selectedGroupIds = [];
    galleryState.selectedGroup = null;
    galleryState.selectedImageIndex = null;
    galleryState.viewerOpen = false;
    rerender(renderGalleryFlow());

    expect(screen.getByText("No groups yet. Choose a folder.")).toBeInTheDocument();
    expect(screen.getByText("Select a group to view images.")).toBeInTheDocument();
  });

  it("invokes pagination callbacks when navigating group pages", () => {
    const goToGroupPage = vi.fn();
    galleryState.groupPage = 1;
    galleryState.totalGroupPages = 3;
    galleryState.goToGroupPage = goToGroupPage;

    render(<GroupList />);

    fireEvent.click(screen.getByRole("button", { name: "<" }));
    fireEvent.click(screen.getByRole("button", { name: ">" }));
    fireEvent.click(screen.getByRole("button", { name: "3" }));

    expect(goToGroupPage).toHaveBeenCalledWith(0);
    expect(goToGroupPage).toHaveBeenCalledWith(2);
    expect(goToGroupPage).toHaveBeenCalledTimes(3);
  });

  it("supports ctrl/cmd multi-select in group list", () => {
    const { rerender } = render(<GroupList />);

    const targetGroupButton = screen.getByText("ID: p:2").closest("button");
    expect(targetGroupButton).not.toBeNull();
    fireEvent.click(targetGroupButton as HTMLButtonElement, { ctrlKey: true });
    rerender(<GroupList />);

    expect(galleryState.selectedGroupIds).toEqual(["p:1", "p:2"]);
  });

  it("shows bulk context actions for selected groups and dispatches viewed action", () => {
    const { rerender } = render(<GroupList />);

    const secondGroupButton = screen.getByText("ID: p:2").closest("button");
    expect(secondGroupButton).not.toBeNull();
    fireEvent.click(secondGroupButton as HTMLButtonElement, { ctrlKey: true });
    rerender(<GroupList />);

    fireEvent.contextMenu(secondGroupButton as HTMLButtonElement, {
      clientX: 100,
      clientY: 100,
    });
    rerender(<GroupList />);

    const markViewedButton = screen.getByRole("button", {
      name: "Mark 2 selected viewed",
    });
    fireEvent.click(markViewedButton);

    expect(galleryState.markGroupsViewed).toHaveBeenCalledWith("p:2");
  });
});
