export type WolfSession = {
  roundId: number;
  entryCode: string | null;
  groupId: number | null;
};

const KEY = 'wolf-cup:session';

export function getSession(): WolfSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WolfSession) : null;
  } catch {
    return null;
  }
}

export function setSession(session: WolfSession): void {
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  sessionStorage.removeItem(KEY);
}
