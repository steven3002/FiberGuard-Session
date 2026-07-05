import type { MockState } from "../state.js";

interface ListChannelsParams {
  include_closed?: unknown;
}

/** `list_channels`: closed channels are withheld unless `include_closed` is true. */
export function listChannels(
  state: MockState,
  params: ListChannelsParams,
): Record<string, unknown> {
  const includeClosed = params.include_closed === true;
  const channels = state.channels.filter(
    (channel) => includeClosed || channel.state !== "CLOSED",
  );
  return {
    channels: channels.map((channel) => ({
      channel_id: channel.channel_id,
      state: channel.state,
      is_public: channel.is_public,
      local_balance: channel.local_balance,
      remote_balance: channel.remote_balance,
      created_at: channel.created_at,
      enabled: channel.enabled,
    })),
  };
}
