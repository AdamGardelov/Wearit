import sharp from "sharp";

const GARMENT_COMPONENT_CANVAS_FRACTION = 0.001;
const MINIMUM_GARMENT_COMPONENT_PIXELS = 64;

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

function isVividKeyColor(red, green, blue) {
  const maximum = Math.max(red, green, blue) / 255;
  const minimum = Math.min(red, green, blue) / 255;
  const delta = maximum - minimum;
  const saturation = maximum === 0 ? 0 : delta / maximum;
  if (saturation < 0.18 || maximum < 0.12 || delta === 0) return false;

  let hue;
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  if (maximum === normalizedRed) {
    hue = 60 * (((normalizedGreen - normalizedBlue) / delta) % 6);
  } else if (maximum === normalizedGreen) {
    hue = 60 * ((normalizedBlue - normalizedRed) / delta + 2);
  } else {
    hue = 60 * ((normalizedRed - normalizedGreen) / delta + 4);
  }
  if (hue < 0) hue += 360;

  return (hue >= 65 && hue <= 175) || (hue >= 280 && hue <= 350);
}

function countSuspiciousPixels(data, channels) {
  let suspiciousPixels = 0;
  for (let offset = 0; offset < data.length; offset += channels) {
    const alpha = data[offset + channels - 1];
    if (
      alpha > 0
      && isVividKeyColor(data[offset], data[offset + 1], data[offset + 2])
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

async function readRgba(file) {
  return sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

export async function inspectWearLayer(
  file,
  {
    width = 887,
    height = 1774,
    maxDetachedPixels = 16,
    maxChromaPixels = 0,
  } = {},
) {
  const { data, info } = await readRgba(file);
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
  const failures = [];
  if (!dimensions.matches) failures.push("dimensions");
  if (!alpha.hasTransparent || !alpha.hasVisible) failures.push("alpha");
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
    dimensions,
    alpha,
    components: {
      ...components,
      maximumDetachedPixels: maxDetachedPixels,
    },
    chroma,
  };
}

export async function inspectProductImage(file) {
  const { data, info } = await readRgba(file);
  const alpha = alphaMetrics(data, info.channels);
  const failures = [];
  if (!alpha.hasTransparent || !alpha.hasVisible) failures.push("alpha");

  return {
    pass: failures.length === 0,
    failures,
    dimensions: { width: info.width, height: info.height },
    alpha,
  };
}
