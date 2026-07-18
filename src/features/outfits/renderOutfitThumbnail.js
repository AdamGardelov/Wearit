const WIDTH = 600;
const HEIGHT = 1200;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load thumbnail asset: ${url}`));
    image.src = url;
  });
}

function compareItems(left, right) {
  const layerDifference = (Number.isFinite(left.layer_order) ? left.layer_order : 101)
    - (Number.isFinite(right.layer_order) ? right.layer_order : 101);
  return layerDifference || String(left.id).localeCompare(String(right.id));
}

export async function renderOutfitThumbnail(items, mannequinUrl) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create outfit thumbnail.");

  context.clearRect(0, 0, WIDTH, HEIGHT);
  const mannequin = await loadImage(mannequinUrl);
  context.drawImage(mannequin, 0, 0, WIDTH, HEIGHT);

  const drawableItems = [...items]
    .filter((item) => item.cutoutUrl)
    .sort(compareItems);
  for (const item of drawableItems) {
    const image = await loadImage(item.cutoutUrl);
    const width = item.scale * WIDTH;
    const height = width * (image.naturalHeight / image.naturalWidth);
    context.save();
    context.translate(item.anchor_x * WIDTH, item.anchor_y * HEIGHT);
    context.rotate(item.rotation_degrees * Math.PI / 180);
    // A soft baked shadow gives each garment edge definition against the pale mannequin, so
    // white and light pieces stay legible. Scoped by save/restore to the garment layers only.
    context.shadowColor = "rgba(40, 36, 30, 0.28)";
    context.shadowBlur = 22;
    context.shadowOffsetY = 10;
    context.drawImage(image, -width / 2, -height / 2, width, height);
    context.restore();
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Could not create outfit thumbnail.")),
      "image/webp",
      0.86,
    );
  });
}
