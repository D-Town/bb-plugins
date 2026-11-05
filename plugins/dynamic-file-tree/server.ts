import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract, type ActivityUpdated } from "./src/contracts";
import { createServerData } from "./src/server-data";

export { rpcContract } from "./src/contracts";

export default async function plugin(bb: BbPluginApi) {
  const data = createServerData(bb);

  bb.rpc.register(rpcContract, {
    activity_snapshot: (input) => data.activitySnapshot(input),
    tree_list: (input) => data.listTree(input),
    file_preview: (input) => data.filePreview(input),
    tree_git: (input) => data.treeGit(input),
  });

  bb.events.on("experimental_thread.events", async ({ thread, sequence }) => {
    const snapshot = await data.activitySnapshot({ threadId: thread.id });
    try {
      bb.realtime.publish("activity-updated", {
        threadId: thread.id,
        sequence,
        ...snapshot,
      } satisfies ActivityUpdated);
    } catch (error) {
      bb.log.error(`Activity publish failed for thread ${thread.id}: ${String(error)}`);
      try {
        // Clear previously delivered activity if the publisher can still send.
        bb.realtime.publish("activity-updated", {
          threadId: thread.id,
          sequence,
          available: false,
          activities: [],
        } satisfies ActivityUpdated);
      } catch (fallbackError) {
        bb.log.error(`Activity fallback publish failed for thread ${thread.id}: ${String(fallbackError)}`);
      }
    }
  });

  bb.log.info("loaded");
}
