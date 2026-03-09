export type WolfSession = {
  roundId: number;
  entryCode: string | null;
  groupId: number | null;
};

const KEY = 'wolf-cup:session';

export function getSession(): WolfSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WolfSession) : null;
  } catch {
    return null;
  }
}

export function setSession(session: WolfSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
