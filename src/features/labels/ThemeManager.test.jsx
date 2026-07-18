import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeManager } from "./ThemeManager.jsx";

afterEach(cleanup);

const rainy = { id: "t-rainy", kind: "theme", seasonKey: null, name: "Rainy day", locked: false };

function noop() {
  return vi.fn().mockResolvedValue(undefined);
}

describe("ThemeManager", () => {
  it("creates a theme and clears the input on success", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ id: "t-new", name: "Regn" });
    render(<ThemeManager themes={[]} onCreate={onCreate} onRename={noop()} onDelete={noop()} />);

    await user.type(screen.getByLabelText("Nytt tema"), "Regn");
    await user.click(screen.getByRole("button", { name: "Skapa" }));

    expect(onCreate).toHaveBeenCalledWith("Regn");
    await waitFor(() => expect(screen.getByLabelText("Nytt tema")).toHaveValue(""));
  });

  it("keeps the attempted name and shows a server duplicate error", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(new Error("Temat finns redan."));
    render(<ThemeManager themes={[]} onCreate={onCreate} onRename={noop()} onDelete={noop()} />);

    await user.type(screen.getByLabelText("Nytt tema"), "Regn");
    await user.click(screen.getByRole("button", { name: "Skapa" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Temat finns redan.");
    expect(screen.getByLabelText("Nytt tema")).toHaveValue("Regn");
  });

  it("renames one theme inline", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue({ id: "t-rainy", name: "Storm" });
    render(<ThemeManager themes={[rainy]} onCreate={noop()} onRename={onRename} onDelete={noop()} />);

    await user.click(screen.getByRole("button", { name: "Byt namn på Rainy day" }));
    const input = screen.getByLabelText("Nytt namn för Rainy day");
    await user.clear(input);
    await user.type(input, "Storm");
    await user.click(screen.getByRole("button", { name: "Spara" }));

    expect(onRename).toHaveBeenCalledWith("t-rainy", "Storm");
  });

  it("requires a two-step confirmation before deleting", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<ThemeManager themes={[rainy]} onCreate={noop()} onRename={noop()} onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: "Ta bort Rainy day" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/Kläder och outfits behålls/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Bekräfta borttagning" }));
    expect(onDelete).toHaveBeenCalledWith("t-rainy");
  });
});
