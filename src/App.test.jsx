import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CATEGORIES } from "./domain/slots.js";
vi.mock("./lib/supabase.js", () => ({ supabase: {} }));
import { App } from "./App.jsx";

let wardrobeProps;

vi.mock("./features/wardrobe/WardrobeView.jsx", () => ({
  WardrobeView: (props) => {
    wardrobeProps = props;
    return null;
  },
}));


afterEach(() => {
  cleanup();
  wardrobeProps = undefined;
});

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function repository(overrides = {}) {
  return {
    listItems: vi.fn().mockResolvedValue([]),
    listLabels: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("App category integration", () => {
  it("loads built-in and custom categories for the active repository", async () => {
    const kavajer = { id: "category-kavajer", label: "Kavajer", slot: "outerwear", builtIn: false };
    const listCategories = vi.fn().mockResolvedValue([...CATEGORIES, kavajer]);

    render(<App repository={repository({ listCategories })} />);

    await waitFor(() => expect(wardrobeProps.categories).toEqual([...CATEGORIES, kavajer]));
    expect(listCategories).toHaveBeenCalledTimes(1);
    expect(wardrobeProps.categoriesLoading).toBe(false);
    expect(wardrobeProps.categoriesError).toBe("");
  });

  it("appends a category created through WardrobeView", async () => {
    const created = { id: "category-kavajer", label: "Kavajer", slot: "outerwear", builtIn: false };
    const createCategory = vi.fn().mockResolvedValue(created);
    const repo = repository({
      listCategories: vi.fn().mockResolvedValue([...CATEGORIES]),
      createCategory,
    });
    render(<App repository={repo} />);
    await waitFor(() => expect(wardrobeProps.categoriesLoading).toBe(false));

    await act(async () => {
      await wardrobeProps.onCreateCategory({ name: "Kavajer", slot: "outerwear" });
    });

    expect(createCategory).toHaveBeenCalledWith({ name: "Kavajer", slot: "outerwear" });
    await waitFor(() => expect(wardrobeProps.categories).toContainEqual(created));
  });

  it("ignores a late category response from a replaced repository", async () => {
    const categoriesA = deferred();
    const categoryA = { id: "category-a", label: "A", slot: "top", builtIn: false };
    const categoryB = { id: "category-b", label: "B", slot: "bottom", builtIn: false };
    const repositoryA = repository({ listCategories: vi.fn(() => categoriesA.promise) });
    const repositoryB = repository({ listCategories: vi.fn().mockResolvedValue([...CATEGORIES, categoryB]) });
    const view = render(<App repository={repositoryA} />);

    view.rerender(<App repository={repositoryB} />);
    await waitFor(() => expect(wardrobeProps.categories).toEqual([...CATEGORIES, categoryB]));

    await act(async () => categoriesA.resolve([...CATEGORIES, categoryA]));
    expect(wardrobeProps.categories).toEqual([...CATEGORIES, categoryB]);
  });

  it("falls back to built-in categories when category APIs are unavailable", async () => {
    render(<App repository={repository()} />);

    await waitFor(() => expect(wardrobeProps.categories).toEqual(CATEGORIES));
    expect(wardrobeProps.categoriesLoading).toBe(false);
    expect(wardrobeProps.categoriesError).toBe("");
  });

  it("keeps built-in categories usable when loading custom categories fails", async () => {
    const listCategories = vi.fn().mockRejectedValue(new Error("category service unavailable"));

    render(<App repository={repository({ listCategories })} />);

    await waitFor(() => expect(wardrobeProps.categoriesLoading).toBe(false));
    expect(wardrobeProps.categories).toEqual(CATEGORIES);
    expect(wardrobeProps.categoriesError).toBe("category service unavailable");
  });

  it("preserves a category created while the category list is loading", async () => {
    const categories = deferred();
    const created = { id: "category-kavajer", label: "Kavajer", slot: "outerwear", builtIn: false };
    const listCategories = vi.fn(() => categories.promise);
    const createCategory = vi.fn().mockResolvedValue(created);
    const repo = repository({ listCategories, createCategory });

    render(<App repository={repo} />);
    await waitFor(() => expect(listCategories).toHaveBeenCalledTimes(1));

    await act(async () => {
      await wardrobeProps.onCreateCategory({ name: "Kavajer", slot: "outerwear" });
    });
    expect(wardrobeProps.categories).toContainEqual(created);

    await act(async () => categories.resolve([...CATEGORIES]));
    await waitFor(() => expect(wardrobeProps.categories).toEqual([...CATEGORIES, created]));
  });
  it("preserves a category created while a failed category list is pending", async () => {
    const categories = deferred();
    const created = { id: "category-kavajer", label: "Kavajer", slot: "outerwear", builtIn: false };
    const listCategories = vi.fn(() => categories.promise);
    const createCategory = vi.fn().mockResolvedValue(created);
    const repo = repository({ listCategories, createCategory });

    render(<App repository={repo} />);
    await waitFor(() => expect(listCategories).toHaveBeenCalledTimes(1));
    await act(async () => {
      await wardrobeProps.onCreateCategory({ name: "Kavajer", slot: "outerwear" });
    });

    await act(async () => categories.resolve(Promise.reject(new Error("category service unavailable"))));
    await waitFor(() => expect(wardrobeProps.categoriesLoading).toBe(false));
    expect(wardrobeProps.categories).toEqual([...CATEGORIES, created]);
    expect(wardrobeProps.categoriesError).toBe("category service unavailable");
  });

});
