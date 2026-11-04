// A fresh, recognizable response proves the live app is reachable, not just cached.
export async function checkAppReachability(online: boolean, request = fetch) {
  if (!online) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await request(`/app-status.json?check=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "app" in body && body.app === "mega-maps";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
