const UPSTREAM_RELEASES_URL = "https://github.com/cjpais/Handy/releases";

export function upstreamReleaseUrl(version: string): string {
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `${UPSTREAM_RELEASES_URL}/tag/${encodeURIComponent(tag)}`;
}
