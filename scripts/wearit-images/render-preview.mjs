#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  link,
  lstat,
  mkdir,
  realpath,
  rm,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --flag value, received: ${argv.slice(index).join(" ")}`);
    }
    values[flag.slice(2)] = value;
  }
  return values;
}

function required(values, key) {
  if (!values[key]) throw new Error(`Missing required --${key}`);
  return path.resolve(values[key]);
}

function numberInRange(values, key, min, max) {
  const value = Number(values[key]);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${key} must be between ${min} and ${max}`);
  }
  return value;
}

async function prepareImmutableOutput(output, inputs) {
  const resolvedOutput = path.resolve(output);
  const outputDirectory = path.dirname(resolvedOutput);
  await mkdir(outputDirectory, { recursive: true });
  const canonicalInputs = await Promise.all(
    inputs.map((input) => realpath(path.resolve(input))),
  );

  let outputExists = false;
  try {
    await lstat(resolvedOutput);
    outputExists = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (outputExists) {
    let canonicalOutput = resolvedOutput;
    try {
      canonicalOutput = await realpath(resolvedOutput);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (canonicalInputs.includes(canonicalOutput)) {
      throw new Error("Preview output aliases an input path");
    }
    throw new Error(`Preview output already exists: ${resolvedOutput}`);
  }

  const canonicalDirectory = await realpath(outputDirectory);
  const canonicalOutput = path.join(
    canonicalDirectory,
    path.basename(resolvedOutput),
  );
  if (canonicalInputs.includes(canonicalOutput)) {
    throw new Error("Preview output aliases an input path");
  }

  return {
    output: resolvedOutput,
    inputs: canonicalInputs,
    temporary: path.join(
      outputDirectory,
      `.${path.basename(resolvedOutput)}.${process.pid}.${randomUUID()}.tmp`,
    ),
  };
}

export async function renderMannequinPreview(options) {
  const paths = await prepareImmutableOutput(options.output, [
    options.mannequin,
    options.wearLayer,
  ]);
  const require = createRequire(path.join(options.repo, "package.json"));
  const sharp = require("sharp");
  const base = sharp(paths.inputs[0]);
  const { width, height } = await base.metadata();
  if (!width || !height) throw new Error("Could not read mannequin dimensions");

  const renderedWidth = Math.max(1, Math.round(width * options.scale));
  const { data: garment, info } = await sharp(paths.inputs[1])
    .resize({ width: renderedWidth })
    .rotate(options.rotationDegrees, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round(options.anchorX * width - info.width / 2) || 0;
  const top = Math.round(options.anchorY * height - info.height / 2) || 0;
  const compositeLeft = Math.max(0, left);
  const compositeTop = Math.max(0, top);
  const compositeRight = Math.min(width, left + info.width);
  const compositeBottom = Math.min(height, top + info.height);
  const intersectionWidth = compositeRight - compositeLeft;
  const intersectionHeight = compositeBottom - compositeTop;
  if (intersectionWidth <= 0 || intersectionHeight <= 0) {
    throw new Error(`Rendered wear layer does not intersect mannequin canvas: ${info.width}x${info.height}+${left}+${top}`);
  }
  const crop = {
    left: compositeLeft - left,
    top: compositeTop - top,
    width: intersectionWidth,
    height: intersectionHeight,
  };
  const clipped = (
    crop.left !== 0
    || crop.top !== 0
    || crop.width !== info.width
    || crop.height !== info.height
  );
  const visibleGarment = clipped
    ? await sharp(garment).extract(crop).png().toBuffer()
    : garment;

  try {
    await base
      .composite([{
        input: visibleGarment,
        left: compositeLeft,
        top: compositeTop,
      }])
      .png()
      .toFile(paths.temporary);
    await link(paths.temporary, paths.output);
    return {
      width,
      height,
      garmentWidth: info.width,
      garmentHeight: info.height,
      left,
      top,
      clipped,
      crop,
      composite: {
        left: compositeLeft,
        top: compositeTop,
        width: intersectionWidth,
        height: intersectionHeight,
      },
    };
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Preview output already exists: ${paths.output}`);
    }
    throw error;
  } finally {
    await rm(paths.temporary, { force: true });
  }
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  const result = await renderMannequinPreview({
    repo: required(values, "repo"),
    mannequin: required(values, "mannequin"),
    wearLayer: required(values, "wear-layer"),
    output: required(values, "output"),
    anchorX: numberInRange(values, "anchor-x", 0, 1),
    anchorY: numberInRange(values, "anchor-y", 0, 1),
    scale: numberInRange(values, "scale", 0.05, 2),
    rotationDegrees: numberInRange(values, "rotation-degrees", -180, 180),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
