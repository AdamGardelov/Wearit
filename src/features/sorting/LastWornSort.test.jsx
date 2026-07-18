import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LastWornMeta, LastWornSort } from "./LastWornSort.jsx";
import { LAST_WORN_SORT } from "../../domain/lastWorn.js";

afterEach(cleanup);

describe("LastWornSort", () => {
  it("renders the three orders with the context in its accessible name", () => {
    render(<LastWornSort value={LAST_WORN_SORT.STANDARD} onChange={() => {}} context="garderob" />);
    const select = screen.getByRole("combobox", { name: "Sortera garderob" });
    expect(select).toHaveValue("standard");
    expect(screen.getByRole("option", { name: "Standard" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Längst sedan använd" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Senast använd" })).toBeInTheDocument();
  });

  it("reports the chosen order", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LastWornSort value={LAST_WORN_SORT.STANDARD} onChange={onChange} context="outfits" />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Sortera outfits" }), "oldest");

    expect(onChange).toHaveBeenCalledWith("oldest");
  });
});

describe("LastWornMeta", () => {
  it("renders never-used copy without a date", () => {
    render(<LastWornMeta value={null} />);
    expect(screen.getByText("Aldrig använd")).toBeInTheDocument();
  });

  it("renders a Swedish last-worn date", () => {
    render(<LastWornMeta value="2026-07-14T12:00:00Z" />);
    expect(screen.getByText("Senast använd 14 juli")).toBeInTheDocument();
  });
});
