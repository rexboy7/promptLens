import { render } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKeyboard } from "../useKeyboard";
import type { Command } from "../../app/commands";

function KeyboardHarness({
  dispatch,
  canNavigateImages = true,
}: {
  dispatch: (command: Command) => void;
  canNavigateImages?: boolean;
}) {
  useKeyboard({ dispatch, canNavigateImages });
  return <div>keyboard harness</div>;
}

describe("useKeyboard", () => {
  it("dispatches OPEN_VIEWER on Enter", () => {
    const dispatch = vi.fn();
    render(<KeyboardHarness dispatch={dispatch} canNavigateImages />);

    fireEvent.keyDown(window, { key: "Enter" });

    expect(dispatch).toHaveBeenCalledWith({ type: "OPEN_VIEWER" });
  });
});
