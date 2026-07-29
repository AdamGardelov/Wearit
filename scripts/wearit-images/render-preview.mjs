#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
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

export async function renderMannequinPreview(options) {
  const require = createRequire(path.join(options.repo, "package.json"));
  const sharp = require("sharp");
  const base = sharp(options.mannequin);
  const { width, height } = await base.metadata();
  if (!width || !height) throw new Error("Could not read mannequin dimensions");

  const renderedWidth = Math.max(1, Math.round(width * options.scale));
  const { data: garment, info } = await sharp(options.wearLayer)
    .resize({ width: renderedWidth })
    .rotate(options.rotationDegrees, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round(options.anchorX * width - info.width / 2);
  const top = Math.round(options.anchorY * height - info.height / 2);
  if (left < 0 || top < 0 || left + info.width > width || top + info.height > height) {
    throw new Error(`Rendered wear layer falls outside mannequin canvas: ${info.width}x${info.height}+${left}+${top}`);
  }

  await mkdir(path.dirname(options.output), { recursive: true });
  await base
    .composite([{ input: garment, left, top }])
    .png()
    .toFile(options.output);
  return { width, height, garmentWidth: info.width, garmentHeight: info.height, left, top };
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
