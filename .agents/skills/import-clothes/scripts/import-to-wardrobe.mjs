#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { prepareImportBundle } from "../../../../scripts/prepare-import-bundle.mjs";

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error("Usage: import-to-wardrobe.mjs --items <directory> --manifest <file> --output <directory> [--dry-run]");
  process.exit(message ? 1 : 0);
}

function parseArgs(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") usage();
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!["--items", "--manifest", "--output"].includes(argument)) usage(`Unknown option: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) usage(`${argument} requires a value`);
    options[argument.slice(2)] = path.resolve(value);
    index += 1;
  }
  if (!options.items) usage("--items is required");
  if (!options.manifest) usage("--manifest is required");
  if (!options.output) usage("--output is required");
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await prepareImportBundle({
    itemsDir: options.items,
    manifestFile: options.manifest,
    outputDir: options.output,
    dryRun: options.dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`Import bundle failed: ${error.message}`);
  process.exitCode = 1;
}
