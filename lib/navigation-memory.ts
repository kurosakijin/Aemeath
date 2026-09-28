export type NavigationMemory = {
  view: "direct" | "server";
  server?: string;
  channel?: string;
  conversation?: string;
};

const key = (userId: string) => `aemeath:last-location:${userId}`;

export function readNavigationMemory(userId: string): NavigationMemory | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const value = JSON.parse(localStorage.getItem(key(userId)) || "null") as NavigationMemory | null;
    return value && (value.view === "server" || value.view === "direct") ? value : null;
  } catch {
    return null;
  }
}

export function writeNavigationMemory(userId: string, value: NavigationMemory) {
  if (typeof window === "undefined" || !userId) return;
  try {
    const previous = readNavigationMemory(userId);
    localStorage.setItem(key(userId), JSON.stringify({...previous,...value}));
  } catch {}
}
