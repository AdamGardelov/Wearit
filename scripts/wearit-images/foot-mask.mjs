/**
 * Deterministic open-footwear mask.
 *
 * A wear layer is a single flat image composited IN FRONT OF the mannequin, so
 * it has no depth. On open footwear that breaks: the footbed sits UNDER the
 * foot, and any footbed pixel drawn over the foot's footprint hides the toes
 * that belong on top of it. The generator reliably paints that footbed, because
 * it is genuinely visible in the source photograph - it just cannot be placed
 * behind anything. The result reads as a closed clog.
 *
 * This module removes exactly those pixels, deterministically, after generation.
 *
 * Discriminating a footbed fill from a strap that legitimately crosses the foot:
 * inside the footprint a strap produces a SHORT contiguous vertical run of
 * garment pixels in each column it covers, while a footbed fill produces a LONG
 * one. Runs longer than `maxStrapRun` are footbed and are erased; shorter runs
 * are straps and are kept.
 *
 * This is opt-in per item and only valid for open footwear. A closed shoe is
 * nothing but long vertical runs, so running it on a sneaker erases the upper.
 * Callers must gate on the item contract declaring open-toe topology.
 */

const DEFAULT_BODY_KEY = [255, 0, 255];
const DEFAULT_TOLERANCE = 32;

function assertDimensions(data, width, height, channels = 4) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("foot-mask: width and height must be positive integers");
  }
  if (data.length !== width * height * channels) {
    throw new Error(
      `foot-mask: buffer length ${data.length} does not match ${width}x${height}x${channels}`,
    );
  }
}

/** Mark pixels within `tolerance` of the body key colour. */
export function extractBodyMask(data, width, height, options = {}) {
  const { key = DEFAULT_BODY_KEY, tolerance = DEFAULT_TOLERANCE } = options;
  assertDimensions(data, width, height);
  const mask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const i = pixel * 4;
    const distance = Math.max(
      Math.abs(data[i] - key[0]),
      Math.abs(data[i + 1] - key[1]),
      Math.abs(data[i + 2] - key[2]),
    );
    mask[pixel] = distance <= tolerance ? 1 : 0;
  }
  return mask;
}

/**
 * Keep only the bottom slice of the body silhouette - the feet. The ankle strap
 * of a sandal wraps the ankle and is correctly in front of it, so restricting to
 * the feet keeps this mask away from anything above the foot.
 */
export function restrictToFeet(bodyMask, width, height, options = {}) {
  const { footTopFraction = 0.1 } = options;
  if (bodyMask.length !== width * height) {
    throw new Error("foot-mask: body mask does not match the given dimensions");
  }
  if (!(footTopFraction > 0 && footTopFraction <= 1)) {
    throw new Error("foot-mask: footTopFraction must be between 0 and 1");
  }

  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (bodyMask[y * width + x]) {
        if (top === -1) top = y;
        bottom = y;
        break;
      }
    }
  }
  if (top === -1) {
    throw new Error("foot-mask: template has no body pixels, refusing to guess a foot region");
  }

  const bodyRows = bottom - top + 1;
  const footRows = Math.max(1, Math.round(bodyRows * footTopFraction));
  const footTop = bottom - footRows + 1;

  const mask = new Uint8Array(width * height);
  for (let y = footTop; y <= bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      mask[index] = bodyMask[index];
    }
  }
  return { mask, footTop, footBottom: bottom, bodyTop: top, footRows };
}

/**
 * Erase footbed pixels inside the foot footprint, keeping strap crossings.
 * Returns a new buffer; the input is not mutated.
 */
export function maskOpenFootwear(data, width, height, footMask, options = {}) {
  assertDimensions(data, width, height);
  if (footMask.length !== width * height) {
    throw new Error("foot-mask: foot mask does not match the given dimensions");
  }
  const { maxStrapRun } = options;
  if (!Number.isInteger(maxStrapRun) || maxStrapRun <= 0) {
    throw new Error("foot-mask: maxStrapRun must be a positive integer");
  }

  const out = Buffer.from(data);
  let removedPixels = 0;
  let keptStrapPixels = 0;

  const visible = (x, y) => data[(y * width + x) * 4 + 3] > 0;
  const inFoot = (x, y) => footMask[y * width + x] === 1;

  for (let x = 0; x < width; x += 1) {
    let y = 0;
    while (y < height) {
      if (!(inFoot(x, y) && visible(x, y))) {
        y += 1;
        continue;
      }
      const start = y;
      while (y < height && inFoot(x, y) && visible(x, y)) y += 1;
      const length = y - start;
      if (length > maxStrapRun) {
        for (let row = start; row < y; row += 1) {
          const i = (row * width + x) * 4;
          out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0;
          removedPixels += 1;
        }
      } else {
        keptStrapPixels += length;
      }
    }
  }

  return { data: out, removedPixels, keptStrapPixels };
}

/** Convenience: derive the foot footprint straight from a dual-chroma template. */
export function footprintFromTemplate(templateData, width, height, options = {}) {
  const body = extractBodyMask(templateData, width, height, options);
  return restrictToFeet(body, width, height, options);
}

/**
 * Default separator between a strap crossing and a footbed fill, as a fraction
 * of the foot's height rather than a pixel count, so it survives a canvas change.
 *
 * Calibrated visually against two real sandal layers on the 887x1774 canvas,
 * where the foot is 158 rows: 0.25 gives 40px. Measured vertical runs on those
 * layers had a median of 26-44 and a 75th percentile of 52-65, so the separator
 * sits between the strap population and the fill population. Lower values (0.19)
 * fragment buckle straps; higher ones (0.32) merge adjacent straps into a band.
 */
export const DEFAULT_MAX_STRAP_RUN_FRACTION = 0.25;

export function resolveMaxStrapRun(footRows, options = {}) {
  const { maxStrapRun, maxStrapRunFraction = DEFAULT_MAX_STRAP_RUN_FRACTION } = options;
  if (maxStrapRun !== undefined) return maxStrapRun;
  if (!(maxStrapRunFraction > 0 && maxStrapRunFraction < 1)) {
    throw new Error("foot-mask: maxStrapRunFraction must be between 0 and 1");
  }
  return Math.max(1, Math.round(footRows * maxStrapRunFraction));
}
