// The app and nginx agree on one convention: ?raw=1 always returns bytes
// instead of the app shell (see maps.conf's $render_page), and ?view=text
// hands a path to the buffered text viewer regardless of its extension.
function withParam(path: string, param: string): string {
  return path + (path.includes("?") ? "&" : "?") + param;
}

export function rawUrl(path: string): string {
  return withParam(path, "raw=1");
}

export function textViewUrl(path: string): string {
  return withParam(path, "view=text");
}

export async function headSize(path: string): Promise<number | null> {
  const res = await fetch(rawUrl(path), { method: "HEAD", cache: "no-store" });
  const len = res.headers.get("Content-Length");
  return len ? Number(len) : null;
}

export async function fetchRaw(path: string): Promise<string> {
  const res = await fetch(rawUrl(path), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.text();
}
