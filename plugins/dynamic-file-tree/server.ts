import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./src/contracts";
import { createServerData } from "./src/server-data";

export { rpcContract } from "./src/contracts";

export default async function plugin(bb: BbPluginApi) {
  const data = createServerData(bb);

  bb.rpc.register(rpcContract, {
    // Activity normalization is added in a later task.
    activity_snapshot: () => ({ available: false, activities: [] }),
    tree_list: (input) => data.listTree(input),
  });

  bb.log.info("loaded");
}
