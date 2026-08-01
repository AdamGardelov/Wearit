#!/usr/bin/env node
/**
 * Apply the deterministic open-footwear mask to a saved wear layer.
 *
 *   node scripts/wearit-images/apply-foot-mask.mjs \
 *     --template <dual-chroma.png> --input <wear-layer.png> --out <masked.png>
 *     [--max-strap-run <px>] [--max-strap-run-fraction <0..1>]
 *     [--foot-top-fraction <0..1>]
 *
 * ONLY valid for open footwear. A closed shoe is nothing but long vertical runs
 * inside the footprint, so this would erase its upper. Callers must gate on the
 * item contract declaring open-toe topology; this script does not guess.
 *
 * Refuses to overwrite an existing output, matching the immutable-attempt rule
 * the rest of the pipeline follows.
 */
import { access, constants } from "node:fs/promises";
import process from "node:process";
import sharp from "sharp";
import {
  footprintFromTemplate,
  maskOpenFootwear,
  resolveMaxStrapRun,
} from "./foot-mask.mjs";

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Option --${name} requires a value`);
    }
    options[name] = value;
    i += 1;
  }
  for (const required of ["template", "input", "out"]) {
    if (!options[required]) throw new Error(`Missing required option: --${required}`);
  }
  return options;
}

async function readRgba(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let exists = true;
  try {
    await access(options.out, constants.F_OK);
  } catch {
    exists = false;
  }
  if (exists) throw new Error(`Refusing to overwrite existing output: ${options.out}`);

  const template = await readRgba(options.template);
  const layer = await readRgba(options.input);
  if (template.width !== layer.width || template.height !== layer.height) {
    throw new Error(
      `Template ${template.width}x${template.height} does not match layer ${layer.width}x${layer.height}`,
    );
  }

  const footTopFraction = options["foot-top-fraction"]
    ? Number(options["foot-top-fraction"]) : undefined;
  const footprint = footprintFromTemplate(
    template.data, template.width, template.height,
    footTopFraction === undefined ? {} : { footTopFraction },
  );
  const maxStrapRun = resolveMaxStrapRun(footprint.footRows, {
    maxStrapRun: options["max-strap-run"] ? Number(options["max-strap-run"]) : undefined,
    maxStrapRunFraction: options["max-strap-run-fraction"]
      ? Number(options["max-strap-run-fraction"]) : undefined,
  });

  const result = maskOpenFootwear(
    layer.data, layer.width, layer.height, footprint.mask, { maxStrapRun },
  );
  await sharp(result.data, {
    raw: { width: layer.width, height: layer.height, channels: 4 },
  }).png().toFile(options.out);

  process.stdout.write(`${JSON.stringify({
    command: "apply-foot-mask",
    input: options.input,
    output: options.out,
    footTop: footprint.footTop,
    footBottom: footprint.footBottom,
    footRows: footprint.footRows,
    maxStrapRun,
    removedPixels: result.removedPixels,
    keptStrapPixels: result.keptStrapPixels,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`apply-foot-mask: ${error.message}\n`);
  process.exitCode = 1;
});
