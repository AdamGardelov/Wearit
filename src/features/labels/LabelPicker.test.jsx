import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LabelPicker } from "./LabelPicker.jsx";

afterEach(cleanup);

const labels = [
  { id: "s-spring", kind: "season", seasonKey: "spring", name: "Spring", locked: true },
  { id: "s-summer", kind: "season", seasonKey: "summer", name: "Summer", locked: true },
  { id: "t-rainy", kind: "theme", seasonKey: null, name: "Rainy day", locked: false },
];

describe("LabelPicker", () => {
  it("adds and removes label ids by id, not by display name", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LabelPicker labels={labels} selectedIds={["s-summer"]} onChange={onChange} />);

    expect(screen.getByRole("checkbox", { name: "Sommar" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Rainy day" }));
    expect(onChange).toHaveBeenCalledWith(["s-summer", "t-rainy"]);

    await user.click(screen.getByRole("checkbox", { name: "Sommar" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("prunes an assignment whose label no longer exists", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <LabelPicker labels={labels} selectedIds={["t-rainy", "s-summer"]} onChange={onChange} />,
    );
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <LabelPicker
        labels={labels.filter((label) => label.id !== "t-rainy")}
        selectedIds={["t-rainy", "s-summer"]}
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledWith(["s-summer"]);
  });
});
