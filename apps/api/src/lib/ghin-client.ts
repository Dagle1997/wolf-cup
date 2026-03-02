// ---------------------------------------------------------------------------
// Lightweight GHIN API client using the golfer login flow
// (login_with_ghin.json → golfer_user_token → api2.ghin.com)
// ---------------------------------------------------------------------------

const GHIN_BASE = 'https://api2.ghin.com/api/v1';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36';

type GhinGolfer = {
  ghin: string;
  first_name: string;
  last_name: string;
  handicap_index: string | number | null;
  club_name: string | null;
  state: string | null;
  status: string;
};

type GhinSearchResult = {
  ghinNumber: number;
  firstName: string;
  lastName: string;
  handicapIndex: number | null;
  club: string | null;
  state: string | null;
};

class GhinDirectClient {
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {}

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;

    const res = await fetch(`${GHIN_BASE}/login_with_ghin.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ user: { email_or_ghin: this.username, password: this.password } }),
    });
    if (!res.ok) throw new Error('GHIN_AUTH_FAILED');
    const data = (await res.json()) as { golfer_user_token?: string; error?: string };
    if (!data.golfer_user_token) throw new Error('GHIN_AUTH_FAILED');

    this.token = data.golfer_user_token;
    this.tokenExpiry = Date.now() + 20 * 60 * 1000; // 20-minute cache
    return this.token;
  }

  async searchByName(lastName: string, firstName?: string): Promise<GhinSearchResult[]> {
    const token = await this.getToken();
    const params = new URLSearchParams({
      per_page: '20',
      page: '1',
      last_name: lastName,
      state: 'WV',
      source: 'GHINcom',
    });
    if (firstName) params.set('first_name', firstName);

    const res = await fetch(`${GHIN_BASE}/golfers/search.json?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    });
    if (!res.ok) throw new Error('GHIN_UNAVAILABLE');
    const data = (await res.json()) as { golfers?: GhinGolfer[]; error?: string };
    if (data.error) throw new Error('GHIN_UNAVAILABLE');

    return (data.golfers ?? []).map((g) => ({
      ghinNumber: Number(g.ghin),
      firstName: g.first_name,
      lastName: g.last_name,
      handicapIndex: g.handicap_index !== null ? Number(g.handicap_index) : null,
      club: g.club_name ?? null,
      state: g.state ?? null,
    }));
  }

  async getHandicap(ghinNumber: number): Promise<{ handicapIndex: number | null }> {
    const token = await this.getToken();
    const params = new URLSearchParams({
      per_page: '1',
      page: '1',
      golfer_id: String(ghinNumber),
      from_ghin: 'true',
      source: 'GHINcom',
    });

    const res = await fetch(`${GHIN_BASE}/golfers.json?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
    });
    if (!res.ok) throw new Error('GHIN_UNAVAILABLE');
    const data = (await res.json()) as { golfers?: GhinGolfer[]; error?: string };
    if (data.error || !data.golfers?.length) throw new Error('NOT_FOUND');

    const g = data.golfers[0]!;
    return { handicapIndex: g.handicap_index !== null ? Number(g.handicap_index) : null };
  }
}

export const ghinClient =
  process.env['GHIN_USERNAME'] && process.env['GHIN_PASSWORD']
    ? new GhinDirectClient(process.env['GHIN_USERNAME'], process.env['GHIN_PASSWORD'])
    : null;
