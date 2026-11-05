import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract, type ActivityUpdated } from "./src/contracts";
import { createServerData } from "./src/server-data";

export { rpcContract } from "./src/contracts";

export default async function plugin(bb: BbPluginApi) {
  const data = createServerData(bb);

  bb.rpc.register(rpcContract, {
    activity_snapshot: (input) => data.activitySnapshot(input),
    tree_list: (input) => data.listTree(input),
  });

  bb.events.on("experimental_thread.events", async ({ thread, sequence }) => {
    const snapshot = await data.activitySnapshot({ threadId: thread.id });
    bb.realtime.publish("activity-updated", {
      threadId: thread.id,
      sequence,
      ...snapshot,
    } satisfies ActivityUpdated);
  });

  bb.log.info("loaded");
}
