import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../App.jsx";

afterEach(cleanup);

const repositoryAItem = {
  id: "shared-id",
  name: "Repository A top",
  category: "top",
  slot: "top",
  brand: "",
  size: "",
  notes: "",
  colors: [],
  tags: [],
  cutoutUrl: "/repository-a.png",
  anchor_x: 0.5,
  anchor_y: 0.35,
  scale: 0.5,
  rotation_degrees: 0,
  layer_order: 20,
};
const repositoryBItem = {
  ...repositoryAItem,
  name: "Repository B top",
  cutoutUrl: "/repository-b.png",
};

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function repository(items, updateItem) {
  return {
    listItems: vi.fn().mockResolvedValue(items),
    updateItem,
    archiveItem: vi.fn(),
    restoreItem: vi.fn(),
    createSignedAssetUrls: vi.fn(),
  };
}

it("ignores an old repository mutation after the active repository changes", async () => {
  const user = userEvent.setup();
  const staleSave = deferred();
  const repositoryA = repository([repositoryAItem], vi.fn(() => staleSave.promise));
  const repositoryB = repository([repositoryBItem], vi.fn(async (item) => item));
  const view = render(<App repository={repositoryA} />);
  await user.click(await screen.findByRole("button", { name: "Visa Repository A top" }));
  await user.click(screen.getByRole("button", { name: "Spara" }));

  view.rerender(<App repository={repositoryB} />);
  await screen.findByRole("button", { name: "Visa Repository B top", hidden: true });
  await act(async () => staleSave.resolve({
    ...repositoryAItem,
    name: "Stale repository A top",
  }));

  expect(await screen.findByRole("button", { name: "Visa Repository B top" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Visa Stale repository A top" }))
    .not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Dress" }));
  expect(screen.getByRole("button", { name: "Välj Repository B top" })).toBeInTheDocument();
});
