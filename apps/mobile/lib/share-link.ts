import * as SecureStore from "expo-secure-store";

function shareLinkKey(botId: string) {
  return `rakazo.share_link.${botId}`;
}

export type StoredShareLink = {
  token: string;
  url: string;
};

export async function saveShareLink(botId: string, link: StoredShareLink) {
  if (!botId.trim() || !link.token.trim() || !link.url.trim()) return;
  try {
    await SecureStore.setItemAsync(shareLinkKey(botId), JSON.stringify(link));
  } catch {
    // SecureStore unavailable in some test / web hosts.
  }
}

export async function loadShareLink(botId: string): Promise<StoredShareLink | null> {
  if (!botId.trim()) return null;
  try {
    const raw = await SecureStore.getItemAsync(shareLinkKey(botId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredShareLink>;
    if (typeof parsed.token === "string" && typeof parsed.url === "string") {
      return { token: parsed.token, url: parsed.url };
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearShareLink(botId: string) {
  if (!botId.trim()) return;
  try {
    await SecureStore.deleteItemAsync(shareLinkKey(botId));
  } catch {
    // SecureStore unavailable in some test / web hosts.
  }
}
