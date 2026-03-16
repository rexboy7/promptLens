import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Filters from "../Filters";

const galleryState = {
  searchText: "",
  dateFilter: "",
  minGroupSize: "",
  groupMode: "prompt" as const,
  status: "",
  scanProgress: null,
  setSearchText: vi.fn(),
  setDateFilter: vi.fn(),
  setMinGroupSize: vi.fn(),
  setGroupMode: vi.fn(),
  refreshGroups: vi.fn(),
};

vi.mock("../../../app/GalleryContext", () => ({
  useGallery: () => galleryState,
}));

describe("Filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates min images input and applies current mode filters", () => {
    render(<Filters />);

    fireEvent.change(screen.getByPlaceholderText("Min images"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(galleryState.setMinGroupSize).toHaveBeenCalledWith("3");
    expect(galleryState.refreshGroups).toHaveBeenCalledWith("prompt", 0);
  });
});
