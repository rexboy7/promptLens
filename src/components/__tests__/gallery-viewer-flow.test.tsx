import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

    galleryState = {
      groups,
      groupPage: 0,
      totalGroupPages: 1,
      goToGroupPage: () => {},
      selectedGroupId: "p:1",
      groupRefs: { current: {} as Record<string, HTMLButtonElement | null> },
      truncateLabel: (label: string) => label,
      setSelectedGroupId: (groupId: string) => {
        galleryState.selectedGroupId = groupId;
        syncSelectedGroup();
        galleryState.images = imagesByGroup[groupId] ?? [];
        galleryState.selectedImageIndex = galleryState.images.length > 0 ? 0 : null;
        galleryState.viewerOpen = false;
      },
      ratingByGroupId: {},
      viewedGroupIds: [],
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
});
