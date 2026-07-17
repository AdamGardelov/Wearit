import { afterEach, describe, expect, it, vi } from "vitest";
import { renderOutfitThumbnail } from "./renderOutfitThumbnail.js";

const originalCreateElement = document.createElement.bind(document);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("renderOutfitThumbnail", () => {
  it("renders a deterministic 600 by 1200 WebP using mannequin placement rules", async () => {
    const calls = [];
    const context = {
      drawImage: vi.fn((image, ...args) => calls.push([image.src, ...args])),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      clearRect: vi.fn(),
    };
    const blob = new Blob(["thumbnail"], { type: "image/webp" });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback, type, quality) => callback(blob)),
    };
    vi.spyOn(document, "createElement").mockImplementation((tagName) => (
      tagName === "canvas" ? canvas : originalCreateElement(tagName)
    ));

    class LoadedImage {
      naturalWidth = 100;
      naturalHeight = 200;
      set src(value) {
        this._src = value;
        queueMicrotask(() => this.onload());
      }
      get src() { return this._src; }
    }
    vi.stubGlobal("Image", LoadedImage);

    const result = await renderOutfitThumbnail([
      {
        id: "front",
        cutoutUrl: "https://assets.test/front.png",
        anchor_x: 0.4,
        anchor_y: 0.6,
        scale: 0.5,
        rotation_degrees: 10,
        layer_order: 40,
      },
      {
        id: "back",
        cutoutUrl: "https://assets.test/back.png",
        anchor_x: 0.5,
        anchor_y: 0.5,
        scale: 0.25,
        rotation_degrees: 0,
        layer_order: 10,
      },
    ], "/mannequin.svg");

    expect(canvas).toMatchObject({ width: 600, height: 1200 });
    expect(calls[0]).toEqual(["/mannequin.svg", 0, 0, 600, 1200]);
    expect(calls.map(([src]) => src)).toEqual([
      "/mannequin.svg",
      "https://assets.test/back.png",
      "https://assets.test/front.png",
    ]);
    expect(context.translate).toHaveBeenNthCalledWith(2, 240, 720);
    expect(context.rotate).toHaveBeenNthCalledWith(2, 10 * Math.PI / 180);
    expect(calls[2]).toEqual([
      "https://assets.test/front.png",
      -150,
      -300,
      300,
      600,
    ]);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.86);
    expect(result).toBe(blob);
  });

  it("sets anonymous CORS before assigning every image URL", async () => {
    const assignments = [];
    const canvas = {
      getContext: () => ({
        drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), clearRect: vi.fn(),
      }),
      toBlob: (callback) => callback(new Blob()),
    };
    vi.spyOn(document, "createElement").mockImplementation((tagName) => (
      tagName === "canvas" ? canvas : originalCreateElement(tagName)
    ));
    class LoadedImage {
      naturalWidth = 100;
      naturalHeight = 100;
      set crossOrigin(value) { assignments.push(["crossOrigin", value]); }
      set src(value) { assignments.push(["src", value]); queueMicrotask(() => this.onload()); }
    }
    vi.stubGlobal("Image", LoadedImage);

    await renderOutfitThumbnail([], "/mannequin.svg");

    expect(assignments).toEqual([
      ["crossOrigin", "anonymous"],
      ["src", "/mannequin.svg"],
    ]);
  });

  it("rejects when the canvas cannot create a thumbnail", async () => {
    const canvas = {
      getContext: () => ({ drawImage: vi.fn(), clearRect: vi.fn() }),
      toBlob: (callback) => callback(null),
    };
    vi.spyOn(document, "createElement").mockImplementation((tagName) => (
      tagName === "canvas" ? canvas : originalCreateElement(tagName)
    ));
    class LoadedImage {
      set crossOrigin(_) {}
      set src(_) { queueMicrotask(() => this.onload()); }
    }
    vi.stubGlobal("Image", LoadedImage);

    await expect(renderOutfitThumbnail([], "/mannequin.svg"))
      .rejects.toThrow("Could not create outfit thumbnail.");
  });
});
