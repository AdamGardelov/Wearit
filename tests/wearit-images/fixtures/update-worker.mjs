import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { updateItem } from "../../../scripts/wearit-images/state.mjs";

const [stateFile, itemId, status] = process.argv.slice(2);

function waitForContinue() {
  return new Promise((resolve) => {
    const onMessage = (message) => {
      if (message?.type === "continue") {
        process.off("message", onMessage);
        resolve();
      }
    };
    process.on("message", onMessage);
  });
}

if (stateFile === "--hold-reaper") {
  const reaperPath = itemId;
  await mkdir(reaperPath);
  await writeFile(path.join(reaperPath, "owner.json"), JSON.stringify({
    pid: process.pid,
    token: "child-reaper",
    createdAtMs: Date.now(),
  }));
  await mkdir(`${reaperPath}.guard`);
  process.send({ type: "started" });
  process.send({ type: "entered" });
  await waitForContinue();
  process.disconnect();
  process.exit(0);
}

process.send({ type: "started" });
await updateItem(stateFile, itemId, async (item) => {
  process.send({ type: "entered" });
  await waitForContinue();
  return { ...item, status };
});
process.send({ type: "done" });
process.disconnect();
