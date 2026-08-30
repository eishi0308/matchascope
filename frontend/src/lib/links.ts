/**
 * Outbound links, made absolute.
 *
 * Cafe records store hosts bare — the crawler strips the scheme before saving
 * (see CafeService.buildCafe), and evidence sources inherit whatever the source
 * listing had, which for OpenStreetMap tags is often "www.example.com" with no
 * scheme at all. A bare host in an href is not a URL to a browser, it is a
 * *relative path*: href="www.frenchsfair.com" resolves against our own origin
 * and lands the reader on our 404 page instead of the cafe's site. That is the
 * worst possible failure for this project — the whole promise is "here is the
 * proof, go read it yourself", and the proof link quietly went nowhere.
 *
 * Returns null when there is nothing linkable, so callers render plain text
 * rather than an anchor that leads somewhere useless.
 */
export function externalUrl(raw?: string | null): string | null {
  const value = raw?.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`; // protocol-relative

  // Must look like a host — "example.com", "example.com/menu", "sub.example.co.uk".
  // Anything else (a label like "Official Website", a stray note) is not a link,
  // and https://-prefixing it would only produce a different kind of dead end.
  const host = value.replace(/^\/+/, "").split(/[/?#]/, 1)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/i.test(host)) return null;

  return `https://${value.replace(/^\/+/, "")}`;
}
