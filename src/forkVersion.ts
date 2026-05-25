import insidersVersion from "../insiders-version.json";

export const forkVersion = insidersVersion;

const channelLabel = (channel: string) =>
  channel.length > 0 ? `${channel[0].toUpperCase()}${channel.slice(1)}` : channel;

export const getForkVersionLabel = () =>
  `${channelLabel(insidersVersion.channel)} v${insidersVersion.fork_version}`;
