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

process.send({ type: "started" });
await updateItem(stateFile, itemId, async (item) => {
  process.send({ type: "entered" });
  await waitForContinue();
  return { ...item, status };
});
process.send({ type: "done" });
process.disconnect();
