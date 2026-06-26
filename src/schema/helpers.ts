export function inferWebsite(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export function buildInterceptUrl(fullUrl: string): string {
  try {
    const url = new URL(fullUrl);
    let path = url.pathname;
    if (path.startsWith("/")) path = path.slice(1);
    return path;
  } catch {
    return fullUrl;
  }
}
