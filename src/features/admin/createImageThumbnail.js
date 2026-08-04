function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bilden kunde inte avkodas."));
    };
    image.src = url;
  });
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Thumbnail kunde inte skapas."))),
      "image/webp",
      0.76,
    );
  });
}

export async function createImageThumbnail(url, { maxWidth, maxHeight }) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Bilden kunde inte hämtas (${response.status}).`);
  const sourceBlob = await response.blob();
  const source = typeof createImageBitmap === "function"
    ? await createImageBitmap(sourceBlob)
    : await loadImage(sourceBlob);
  try {
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error("Bilden saknar giltiga dimensioner.");
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Webbläsaren kunde inte skapa en bildyta.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return await canvasBlob(canvas);
  } finally {
    source.close?.();
  }
}
