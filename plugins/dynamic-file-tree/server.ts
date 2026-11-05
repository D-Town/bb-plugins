import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract, type ActivityUpdated } from "./src/contracts";
import { createServerData } from "./src/server-data";
import { createLiveActivityCollector } from "./src/live-activity";

export { rpcContract } from "./src/contracts";

export default async function plugin(bb: BbPluginApi) {
  const data = createServerData(bb);
  const liveActivity = createLiveActivityCollector(bb);

  bb.rpc.register(rpcContract, {
    activity_snapshot: (input) => data.activitySnapshot(input),
    tree_list: (input) => data.listTree(input),
    file_preview: (input) => data.filePreview(input),
    tree_git: (input) => data.treeGit(input),
    workspace: (input) => data.workspace(input),
    tree: (input) => data.tree(input),
    activity: (input) => {
      const snapshot = liveActivity.snapshot(input.threadId);
      if (snapshot.files.length || snapshot.status.length) return { files: snapshot.files, status: snapshot.status };
      return liveActivity.syncById(input.threadId).then((live) =>
        live.files.length || live.status.length ? { files: live.files, status: live.status } : data.activity(input));
    },
    prefs_get: () => data.prefsGet(),
    prefs_set: (input) => data.prefsSet(input),
    stats: (input) => data.stats(input),
    log: (input) => data.log(input.message),
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
    try {
      const live = await liveActivity.sync(thread);
      bb.realtime.publish("filetree-activity", live);
    } catch (error) {
      bb.log.debug(`Live activity unavailable for thread ${thread.id}: ${String(error)}`);
    }
  });

  bb.log.info("loaded");
}
