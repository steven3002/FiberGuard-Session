import { toHex } from "../hex.js";
import type { MockState } from "../state.js";

/** `node_info`: identity plus channel/peer counts as hex strings. */
export function nodeInfo(state: MockState): Record<string, unknown> {
  const openCount = state.channels.filter((channel) => channel.state !== "CLOSED").length;
  return {
    version: "0.1.0-fiberguard-mock",
    commit_hash: "0000000",
    node_name: state.nodeName,
    pubkey: state.pubkey,
    addresses: [`/ip4/127.0.0.1/tcp/8227/p2p/${state.pubkey.slice(2, 14)}`],
    chain_hash: state.chainHash,
    channel_count: toHex(BigInt(openCount)),
    pending_channel_count: "0x0",
    peers_count: toHex(1n),
    udt_cfg_infos: [],
  };
}
