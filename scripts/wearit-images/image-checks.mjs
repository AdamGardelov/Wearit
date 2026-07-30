import sharp from "sharp";

const GARMENT_COMPONENT_CANVAS_FRACTION = 0.001;
const MINIMUM_GARMENT_COMPONENT_PIXELS = 64;
const GREEN_KEY = [20, 201, 18];
const MAGENTA_KEY = [255, 0, 255];

function alphaMetrics(data, channels) {
  let transparentPixels = 0;
  let visiblePixels = 0;
  let opaquePixels = 0;

  for (let offset = channels - 1; offset < data.length; offset += channels) {
    const alpha = data[offset];
    if (alpha < 255) transparentPixels += 1;
    if (alpha > 0) visiblePixels += 1;
    if (alpha === 255) opaquePixels += 1;
  }

  return {
    hasTransparent: transparentPixels > 0,
    hasVisible: visiblePixels > 0,
    transparentPixels,
    visiblePixels,
    opaquePixels,
  };
}

function spillChannels(key) {
  const keyMaximum = Math.max(...key);
  return key
    .map((value, index) =>
      value >= keyMaximum - 16 && value >= 128 ? index : -1,
    )
    .filter((index) => index !== -1);
}

function channelDistance(rgb, key) {
  return Math.max(...rgb.map((value, index) => Math.abs(value - key[index])));
}

function keyChannelDominance(rgb, key) {
  const keyChannels = spillChannels(key);
  const nonKeyChannels = [0, 1, 2].filter(
    (index) => !keyChannels.includes(index),
  );
  const keyStrength = Math.min(...keyChannels.map((index) => rgb[index]));
  const nonKeyStrength = Math.max(
    ...nonKeyChannels.map((index) => rgb[index]),
    0,
  );
  return keyStrength - nonKeyStrength;
}

function looksKeyColored(rgb, key) {
  const distance = channelDistance(rgb, key);
  return distance <= 32 || keyChannelDominance(rgb, key) >= 16;
}

function countSuspiciousPixels(data, channels) {
  let suspiciousPixels = 0;
  for (let offset = 0; offset < data.length; offset += channels) {
    const alpha = data[offset + channels - 1];
    const rgb = [data[offset], data[offset + 1], data[offset + 2]];
    if (
      alpha > 0
      && (
        looksKeyColored(rgb, GREEN_KEY)
        || looksKeyColored(rgb, MAGENTA_KEY)
      )
    ) {
      suspiciousPixels += 1;
    }
  }
  return suspiciousPixels;
}

function componentMetrics(data, width, height, channels) {
  const pixelCount = width * height;
  const visible = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    visible[index] = data[index * channels + channels - 1] > 0 ? 1 : 0;
  }

  const visited = new Uint8Array(pixelCount);
  const componentSizes = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (!visible[start] || visited[start]) continue;

    let size = 0;
    const stack = [start];
    visited[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop();
      size += 1;
      const x = index % width;

      if (x > 0) visit(index - 1);
      if (x + 1 < width) visit(index + 1);
      if (index >= width) visit(index - width);
      if (index + width < pixelCount) visit(index + width);
    }
    componentSizes.push(size);

    function visit(index) {
      if (visible[index] && !visited[index]) {
        visited[index] = 1;
        stack.push(index);
      }
    }
  }

  componentSizes.sort((left, right) => right - left);
  const garmentSizeThreshold = Math.max(
    MINIMUM_GARMENT_COMPONENT_PIXELS,
    Math.ceil(pixelCount * GARMENT_COMPONENT_CANVAS_FRACTION),
  );
  const detachedSizes = [];
  let garmentComponents = 0;
  for (let index = 0; index < componentSizes.length; index += 1) {
    const size = componentSizes[index];
    if (index === 0 || size >= garmentSizeThreshold) {
      garmentComponents += 1;
    } else {
      detachedSizes.push(size);
    }
  }

  return {
    count: componentSizes.length,
    garmentComponents,
    detachedComponents: detachedSizes.length,
    detachedPixels: detachedSizes.reduce((total, size) => total + size, 0),
    largestComponentPixels: componentSizes[0] ?? 0,
    largestDetachedPixels: detachedSizes[0] ?? 0,
    garmentSizeThreshold,
  };
}

function sourceMetrics(metadata) {
  return {
    format: metadata.format,
    space: metadata.space,
    channels: metadata.channels,
    depth: metadata.depth,
    hasAlpha: metadata.hasAlpha === true,
    isPalette: metadata.isPalette === true,
  };
}

function hasRgbaColorMode(source) {
  return (
    source.space === "srgb"
    && source.channels === 4
    && source.depth === "uchar"
    && source.hasAlpha
    && !source.isPalette
  );
}

function contentMetrics(alpha, components, pixelCount, thresholds) {
  return {
    visiblePixels: alpha.visiblePixels,
    visibleFraction: alpha.visiblePixels / pixelCount,
    largestComponentPixels: components.largestComponentPixels,
    largestComponentFraction: components.largestComponentPixels / pixelCount,
    minimumVisibleFraction: thresholds.minimumVisibleFraction,
    minimumLargestComponentFraction:
      thresholds.minimumLargestComponentFraction,
  };
}

function hasMeaningfulContent(content) {
  return (
    content.visibleFraction >= content.minimumVisibleFraction
    && content.largestComponentFraction
      >= content.minimumLargestComponentFraction
  );
}

async function readImage(file) {
  const image = sharp(file);
  const metadata = await image.metadata();
  const rgba = await image
    .clone()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { ...rgba, metadata };
}

export async function inspectWearLayer(
  file,
  {
    width = 887,
    height = 1774,
    maxDetachedPixels = 16,
    maxChromaPixels = 0,
    minVisibleFraction = 0.05,
    minLargestComponentFraction = 0.04,
  } = {},
) {
  const { data, info, metadata } = await readImage(file);
  const source = sourceMetrics(metadata);
  const dimensions = {
    width: info.width,
    height: info.height,
    expectedWidth: width,
    expectedHeight: height,
    matches: info.width === width && info.height === height,
  };
  const alpha = alphaMetrics(data, info.channels);
  const components = componentMetrics(
    data,
    info.width,
    info.height,
    info.channels,
  );
  const chroma = {
    suspiciousPixels: countSuspiciousPixels(data, info.channels),
    maximumPixels: maxChromaPixels,
  };
  const content = contentMetrics(
    alpha,
    components,
    info.width * info.height,
    {
      minimumVisibleFraction: minVisibleFraction,
      minimumLargestComponentFraction: minLargestComponentFraction,
    },
  );
  const failures = [];
  if (source.format !== "png") failures.push("format");
  if (!hasRgbaColorMode(source)) failures.push("color-mode");
  if (!dimensions.matches) failures.push("dimensions");
  if (!source.hasAlpha || !alpha.hasTransparent || !alpha.hasVisible) {
    failures.push("alpha");
  }
  if (!hasMeaningfulContent(content)) failures.push("content");
  if (
    components.detachedPixels > maxDetachedPixels
    || components.largestDetachedPixels > maxDetachedPixels
  ) {
    failures.push("detached-components");
  }
  if (chroma.suspiciousPixels > maxChromaPixels) {
    failures.push("chroma-residue");
  }

  return {
    pass: failures.length === 0,
    failures,
    source,
    dimensions,
    alpha,
    content,
    components: {
      ...components,
      maximumDetachedPixels: maxDetachedPixels,
    },
    chroma,
  };
}

export async function inspectProductImage(
  file,
  {
    minVisibleFraction = 0.01,
    minLargestComponentFraction = 0.01,
  } = {},
) {
  const { data, info, metadata } = await readImage(file);
  const source = sourceMetrics(metadata);
  const alpha = alphaMetrics(data, info.channels);
  const components = componentMetrics(
    data,
    info.width,
    info.height,
    info.channels,
  );
  const content = contentMetrics(
    alpha,
    components,
    info.width * info.height,
    {
      minimumVisibleFraction: minVisibleFraction,
      minimumLargestComponentFraction: minLargestComponentFraction,
    },
  );
  const failures = [];
  if (!["png", "webp"].includes(source.format)) failures.push("format");
  if (!hasRgbaColorMode(source)) failures.push("color-mode");
  if (!source.hasAlpha || !alpha.hasTransparent || !alpha.hasVisible) {
    failures.push("alpha");
  }
  if (!hasMeaningfulContent(content)) failures.push("content");

  return {
    pass: failures.length === 0,
    failures,
    source,
    dimensions: { width: info.width, height: info.height },
    alpha,
    content,
  };
}
