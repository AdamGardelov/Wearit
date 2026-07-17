import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.jsx";
import { AlignmentEditor } from "./AlignmentEditor.jsx";
import { ImportAdminView } from "./ImportAdminView.jsx";

const FIRST_ID = "96541a13-deb2-51da-bc91-8d0505624551";
const SECOND_ID = "ac11134d-da21-59a3-8d86-c2ba944c923a";
const PLACEMENT = {
  anchorX: 0.5,
  anchorY: 0.38,
  scale: 0.66,
  rotationDegrees: 0,
  layerOrder: 40,
};

function item(id = FIRST_ID, name = "Navy cardigan", overrides = {}) {
  return {
    id,
    file: `assets/${id}/cutout.png`,
    detailFiles: [],
    name,
    category: "jacket",
    slot: "outerwear",
    colors: ["#172033"],
    tags: ["knit"],
    placement: PLACEMENT,
    status: "accepted",
    ...overrides,
  };
}

function bundleFile(path, contents = "asset", type = "application/octet-stream") {
  const file = new File([contents], path.split("/").at(-1), { type });
  Object.defineProperty(file, "webkitRelativePath", { value: `pilot/${path}` });
  return file;
}

function bundleFiles(items = [item()], extras = []) {
  return [
    bundleFile("manifest.json", JSON.stringify({ version: 1, items }), "application/json"),
    ...items.map((entry) => bundleFile(entry.file, "png", "image/png")),
    ...extras,
  ];
}

function repository(overrides = {}) {
  return {
    importWardrobeItem: vi.fn().mockResolvedValue({
      alreadyImported: false,
      stages: { cutout: true, details: true, database: true, all: true },
    }),
    reconcileWardrobeAssets: vi.fn().mockResolvedValue({
      orphanedStoragePaths: [],
      missingStorageItemIds: [],
    }),
    removeOrphanedWardrobeAssets: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

async function selectBundle(files = bundleFiles()) {
  fireEvent.change(screen.getByLabelText("Choose import bundle"), {
    target: { files },
  });
  await screen.findByRole("heading", { name: "Navy cardigan" });
}

beforeEach(() => {
  let sequence = 0;
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:cutout-${sequence += 1}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AlignmentEditor", () => {
  it("uses controlled bounded inputs and updates the canonical mannequin preview locally", () => {
    const onChange = vi.fn();
    const draft = {
      manifestItem: item(),
      cutoutUrl: "blob:cardigan",
      placement: PLACEMENT,
    };

    const view = render(<AlignmentEditor draft={draft} onChange={onChange} />);
    const anchorX = screen.getByLabelText("Anchor X");

    expect(anchorX).toHaveAttribute("min", "0");
    expect(anchorX).toHaveAttribute("max", "1");
    expect(anchorX).toHaveAttribute("step", "0.01");
    fireEvent.change(anchorX, { target: { value: "0.63" } });
    expect(onChange).toHaveBeenCalledWith({ ...PLACEMENT, anchorX: 0.63 });

    view.rerender(<AlignmentEditor
      draft={{ ...draft, placement: { ...PLACEMENT, anchorX: 0.63 } }}
      onChange={onChange}
    />);
    expect(screen.getByAltText("Navy cardigan")).toHaveStyle({ left: "63%" });
  });
});

describe("ImportAdminView", () => {
  it("revokes URLs from a pending parse that resolves after unmount", async () => {
    let resolveManifest;
    const manifest = bundleFile("manifest.json", "pending", "application/json");
    Object.defineProperty(manifest, "text", {
      value: vi.fn(() => new Promise((resolve) => { resolveManifest = resolve; })),
    });
    const view = render(<ImportAdminView repository={repository()} />);
    fireEvent.change(screen.getByLabelText("Choose import bundle"), {
      target: { files: [manifest, bundleFile(item().file, "png", "image/png")] },
    });

    view.unmount();
    await act(async () => {
      resolveManifest(JSON.stringify({ version: 1, items: [item()] }));
    });

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cutout-1"));
  });

  it("creates local review cards without uploading and preserves adjustments between cards", async () => {
    const repo = repository();
    render(<ImportAdminView repository={repo} />);
    await selectBundle(bundleFiles([
      item(),
      item(SECOND_ID, "Cream trousers", { category: "bottom", slot: "bottom" }),
    ]));

    expect(repo.importWardrobeItem).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Anchor X"), { target: { value: "0.63" } });
    await userEvent.click(screen.getByRole("button", { name: /Review Cream trousers/i }));
    await userEvent.click(screen.getByRole("button", { name: /Review Navy cardigan/i }));

    expect(screen.getByLabelText("Anchor X")).toHaveValue("0.63");
    expect(repo.importWardrobeItem).not.toHaveBeenCalled();
  });

  it("approves exactly one reviewed item and labels a stable rerun as already imported", async () => {
    const repo = repository({
      importWardrobeItem: vi.fn().mockResolvedValue({ alreadyImported: true }),
    });
    render(<ImportAdminView repository={repo} />);
    await selectBundle();

    await userEvent.click(screen.getByRole("button", { name: "Approve and upload" }));

    await waitFor(() => expect(repo.importWardrobeItem).toHaveBeenCalledTimes(1));
    expect(repo.importWardrobeItem).toHaveBeenCalledWith(expect.objectContaining({
      manifestItem: expect.objectContaining({ id: FIRST_ID }),
      cutoutFile: expect.any(File),
      detailFiles: [],
      placement: PLACEMENT,
    }));
    expect(await screen.findAllByText("Already imported")).toHaveLength(2);
  });

  it("keeps a failed upload retryable", async () => {
    const repo = repository({
      importWardrobeItem: vi.fn()
        .mockRejectedValueOnce(new Error("Connection interrupted"))
        .mockResolvedValueOnce({ alreadyImported: false }),
    });
    render(<ImportAdminView repository={repo} />);
    await selectBundle();

    await userEvent.click(screen.getByRole("button", { name: "Approve and upload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    await userEvent.click(screen.getByRole("button", { name: "Retry upload" }));

    await waitFor(() => expect(repo.importWardrobeItem).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByText("Imported")).toHaveLength(2);
  });

  it("lists exact reconciliation paths and requires a second explicit cleanup confirmation", async () => {
    const repo = repository({
      reconcileWardrobeAssets: vi.fn()
        .mockResolvedValueOnce({
          orphanedStoragePaths: ["owner-1/items/orphan.png"],
          missingStorageItemIds: ["missing-item"],
        })
        .mockResolvedValueOnce({ orphanedStoragePaths: [], missingStorageItemIds: ["missing-item"] }),
    });
    render(<ImportAdminView repository={repo} />);

    await userEvent.click(screen.getByRole("button", { name: "Check storage" }));
    expect(await screen.findByText("owner-1/items/orphan.png")).toBeInTheDocument();
    expect(screen.getByText("missing-item")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clean up orphaned assets" }));
    expect(repo.removeOrphanedWardrobeAssets).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm delete 1 asset" }));

    expect(repo.removeOrphanedWardrobeAssets)
      .toHaveBeenCalledWith(["owner-1/items/orphan.png"]);
  });

  it("shows parser refusal for raw source formats", async () => {
    render(<ImportAdminView repository={repository()} />);
    fireEvent.change(screen.getByLabelText("Choose import bundle"), {
      target: { files: bundleFiles([item()], [bundleFile("raw/source.heic", "raw", "image/heic")]) },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/raw source files are refused/i);
  });
});

describe("App Admin entry", () => {
  it("exposes Import as a small Admin action outside primary navigation", async () => {
    const repo = repository({
      listItems: vi.fn().mockResolvedValue([]),
      listItemsWithLastWorn: vi.fn().mockResolvedValue([]),
      listOutfits: vi.fn().mockResolvedValue([]),
      listWearHistory: vi.fn().mockResolvedValue([]),
    });
    render(<App repository={repo} />);

    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primary).queryByText("Import")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import wardrobe" }));

    expect(screen.getByRole("heading", { name: "Import reviewed clothes" })).toBeInTheDocument();
  });

  it("releases local preview URLs when Admin closes", async () => {
    const repo = repository({
      listItems: vi.fn().mockResolvedValue([]),
      listItemsWithLastWorn: vi.fn().mockResolvedValue([]),
      listOutfits: vi.fn().mockResolvedValue([]),
      listWearHistory: vi.fn().mockResolvedValue([]),
    });
    render(<App repository={repo} />);
    await userEvent.click(screen.getByRole("button", { name: "Import wardrobe" }));
    await selectBundle();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cutout-1");
    expect(screen.queryByRole("heading", { name: "Import reviewed clothes" })).not.toBeInTheDocument();
  });
});
