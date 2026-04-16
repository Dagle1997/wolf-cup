import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft, Printer } from 'lucide-react';

export const Route = createFileRoute('/cheatsheet')({
  component: CheatsheetPage,
});

// ---------------------------------------------------------------------------
// Visual primitives — match the leaderboard HoleBadge / Wolf row styling
// ---------------------------------------------------------------------------

function Eagle({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white text-[11px] font-black leading-none">
      {n}
    </span>
  );
}
function Birdie({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border-[1.5px] border-red-600 text-red-600 text-[11px] font-bold leading-none">
      {n}
    </span>
  );
}
function Par({ n }: { n: number }) {
  return <span className="inline-flex items-center justify-center w-6 h-6 text-[11px] font-medium leading-none">{n}</span>;
}
function Bogey({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 border-[1.5px] border-amber-500 text-amber-600 text-[11px] font-medium leading-none">
      {n}
    </span>
  );
}
function Double({ n }: { n: number }) {
  return (
    <span className="relative inline-flex items-center justify-center w-7 h-7 border-[2px] border-blue-600 text-blue-600 text-[11px] font-bold leading-none">
      <span className="absolute inset-[2px] border-[1px] border-blue-600" />
      <span className="relative">{n}</span>
    </span>
  );
}

function DotDemo({
  n,
  topDots,
  bottomDot,
}: {
  n: number;
  topDots?: 1 | 2;
  bottomDot?: 'g' | 'p' | 's';
}) {
  const bottomColor = bottomDot === 'g' ? 'bg-emerald-500' : bottomDot === 'p' ? 'bg-amber-400' : bottomDot === 's' ? 'bg-orange-500' : '';
  return (
    <span className="relative inline-flex items-center justify-center w-7 h-7 text-[12px] font-semibold">
      {n}
      {topDots === 1 && <span className="absolute -top-[2px] -right-[3px] w-[5px] h-[5px] rounded-full bg-foreground/60" />}
      {topDots === 2 && (
        <span className="absolute -top-[2px] -right-[3px] flex gap-[1px]">
          <span className="w-[5px] h-[5px] rounded-full bg-foreground/60" />
          <span className="w-[5px] h-[5px] rounded-full bg-foreground/60" />
        </span>
      )}
      {bottomDot && <span className={`absolute -bottom-[3px] left-1/2 -translate-x-1/2 w-[5px] h-[5px] rounded-full ${bottomColor}`} />}
    </span>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-extrabold uppercase tracking-[0.12em] text-green-700 dark:text-green-400 border-b border-border/60 pb-1">
        {n} · {title}
      </h2>
      <div className="text-sm">{children}</div>
    </section>
  );
}

function KeyRow({ k, children }: { k: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
      <div className="flex justify-center w-9 shrink-0">{k}</div>
      <div className="text-xs leading-snug">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function CheatsheetPage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/help"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Help
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Printer className="h-3.5 w-3.5" />
          Print
        </button>
      </div>

      <div className="text-center space-y-1">
        <div className="text-3xl">🗒️</div>
        <h1 className="text-2xl font-black tracking-tight">Leaderboard Cheat Sheet</h1>
        <p className="text-xs text-muted-foreground">How to read the board at a glance</p>
      </div>

      {/* ── 1. Anatomy of a row ─────────────────────────── */}
      <Section n={1} title="Anatomy of a Leaderboard Row">
        <div className="rounded-xl border overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-muted-foreground text-[11px]">
                <th className="text-center py-2 pl-2 pr-1 w-10">#</th>
                <th className="text-left py-2 pr-2">Player</th>
                <th className="text-right py-2 pr-2 w-14">To Par</th>
                <th className="text-right py-2 pr-2 w-12">Stb</th>
                <th className="text-right py-2 pr-3 w-14">$</th>
                <th className="text-right py-2 pr-3 w-14">Hvy</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-l-2 border-l-amber-400 bg-amber-50/60 dark:bg-amber-950/20">
                <td className="py-2 pl-2 pr-1 text-center">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400 text-amber-900 text-xs font-black">1</span>
                </td>
                <td className="py-2 pr-2">
                  <div className="font-semibold text-sm leading-tight">Noah M.</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">HCP +5 · Thru 12 <span className="ml-1 text-blue-600 font-medium">Putts: 22</span></div>
                </td>
                <td className="py-2 pr-2 text-right text-base text-green-600 font-bold">-4</td>
                <td className="py-2 pr-2 text-right font-medium">26</td>
                <td className="py-2 pr-3 text-right font-medium text-green-600">+$18</td>
                <td className="py-2 pr-3 text-right font-bold">18</td>
              </tr>
              <tr className="border-b border-l-2 border-l-slate-400">
                <td className="py-2 pl-2 pr-1 text-center">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-300 text-slate-700 text-xs font-black dark:bg-slate-600 dark:text-slate-100">2</span>
                </td>
                <td className="py-2 pr-2">
                  <div className="font-semibold text-sm leading-tight">Josh S.</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">HCP 8.4 · Thru 12</div>
                </td>
                <td className="py-2 pr-2 text-right text-base text-destructive font-medium">+2</td>
                <td className="py-2 pr-2 text-right font-medium">20</td>
                <td className="py-2 pr-3 text-right font-medium text-green-600">+$6</td>
                <td className="py-2 pr-3 text-right font-bold">12</td>
              </tr>
              <tr className="border-l-2 border-l-orange-500">
                <td className="py-2 pl-2 pr-1 text-center">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-400 text-orange-900 text-xs font-black">3</span>
                </td>
                <td className="py-2 pr-2">
                  <div className="font-semibold text-sm leading-tight">Bobby M.</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">HCP 15.1 · F</div>
                </td>
                <td className="py-2 pr-2 text-right text-base font-medium">E</td>
                <td className="py-2 pr-2 text-right font-medium">18</td>
                <td className="py-2 pr-3 text-right font-medium text-destructive">-$3</td>
                <td className="py-2 pr-3 text-right font-bold">8</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground leading-snug">
          <p><b className="text-foreground">Rank pill</b> — gold/silver/bronze for 1st/2nd/3rd. Ties share a rank.</p>
          <p><b className="text-foreground">Sub-line</b> — handicap index · <b>Thru N</b> hole or <b>F</b> when finished. Blue <b>Putts</b> shows on Least Putts side-game weeks.</p>
          <p><b className="text-foreground">To Par</b> — <span className="text-green-600 font-bold">green bold</span> under par · <span className="text-destructive">red</span> over · <b>E</b> even.</p>
          <p><b className="text-foreground">$</b> — <span className="text-green-600">+$X</span> winning · <span className="text-destructive">-$X</span> losing.</p>
          <p><b className="text-foreground">Hvy Pts</b> — total Harvey points for this round (stableford rank + money rank + group-size bonus). Live during play, locked at finalize.</p>
          <p><b className="text-foreground">Tap any row</b> to expand the full scorecard for that player (see §2).</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">When you've joined a group, a pill toggle appears:</span>
          <span className="inline-flex rounded-full border bg-muted/40 p-0.5 text-[11px] font-semibold">
            <span className="px-3 py-0.5 rounded-full bg-background shadow-sm">All</span>
            <span className="px-3 py-0.5 rounded-full text-muted-foreground">Group 2</span>
          </span>
          <span className="text-muted-foreground">→ filter to your 4 (ranks stay field-wide).</span>
        </div>
      </Section>

      {/* ── 2. Scorecard expansion ─────────────────────── */}
      <Section n={2} title="Scorecard (Expanded Row)">
        <p className="text-xs text-muted-foreground mb-3">
          When you tap a row, this horizontal scorecard slides open. It's the same view used everywhere — front 9 first, back 9 once any back-9 hole is played.
        </p>
        <ul className="text-xs space-y-1.5 leading-snug">
          <li>• <b>Boxed hole #</b> in the green header = wolf hole.</li>
          <li>• <b>Par row</b> only fills in for holes you've played.</li>
          <li>• <b>Score row</b> uses the color notation in §3 + bonus dots from §4.</li>
          <li>• <b>Wolf row</b> shows your role on each wolf hole (see §6).</li>
          <li>• <b>Net</b> = score after handicap strokes applied.</li>
          <li>• <b>Stb</b> = stableford; <span className="text-green-600 font-semibold">green bold</span> = 3+ pts.</li>
          <li>• <b>$</b> = net money for that hole (skins, wolf, greenies, polies, sandies combined).</li>
        </ul>
      </Section>

      {/* ── 3. Score notation ─────────────────────── */}
      <Section n={3} title="Score Notation">
        <div className="grid grid-cols-3 gap-y-3 gap-x-2">
          <KeyRow k={<Eagle n={2} />}><b>Eagle+</b><br /><span className="text-muted-foreground">Filled red</span></KeyRow>
          <KeyRow k={<Birdie n={3} />}><b>Birdie</b><br /><span className="text-muted-foreground">Red outline</span></KeyRow>
          <KeyRow k={<Par n={4} />}><b>Par</b><br /><span className="text-muted-foreground">Plain number</span></KeyRow>
          <KeyRow k={<Bogey n={5} />}><b>Bogey</b><br /><span className="text-muted-foreground">Orange square</span></KeyRow>
          <KeyRow k={<Double n={6} />}><b>Double+</b><br /><span className="text-muted-foreground">Blue double</span></KeyRow>
          <KeyRow k={<span className="text-muted-foreground/60 text-base">—</span>}><b>No score</b><br /><span className="text-muted-foreground">Dash, unplayed</span></KeyRow>
        </div>
      </Section>

      {/* ── 4. Bonus dots ─────────────────────── */}
      <Section n={4} title="Bonus Dots (below score)">
        <div className="grid grid-cols-3 gap-3">
          <KeyRow k={<DotDemo n={4} bottomDot="g" />}><b className="text-emerald-600">G</b> Greenie<br /><span className="text-muted-foreground">par-3 green &amp; par</span></KeyRow>
          <KeyRow k={<DotDemo n={4} bottomDot="p" />}><b className="text-amber-500">P</b> Polie<br /><span className="text-muted-foreground">putt &gt; flagstick</span></KeyRow>
          <KeyRow k={<DotDemo n={4} bottomDot="s" />}><b className="text-orange-500">S</b> Sandie<br /><span className="text-muted-foreground">up &amp; down from sand</span></KeyRow>
        </div>
        <p className="text-[11px] text-muted-foreground italic mt-2">Multiple dots stack left-to-right (e.g., Greenie + Polie on a par 3).</p>
      </Section>

      {/* ── 5. Handicap dots ─────────────────────── */}
      <Section n={5} title="Handicap Stroke Dots (top-right)">
        <div className="grid grid-cols-2 gap-y-2 gap-x-4">
          <KeyRow k={<DotDemo n={5} topDots={1} />}><b>1 stroke</b> on this hole</KeyRow>
          <KeyRow k={<DotDemo n={5} topDots={2} />}><b>2 strokes</b> on this hole</KeyRow>
        </div>
        <p className="text-[11px] text-muted-foreground italic mt-2">Also shown on unplayed cells (next to the —) so you can see strokes in advance.</p>
      </Section>

      {/* ── 6. Wolf row ─────────────────────── */}
      <Section n={6} title="Wolf Row — What Each Letter Means">
        <div className="space-y-2">
          <KeyRow k={<span className="text-base font-extrabold">W</span>}>
            <b>Lone Wolf</b> — went 1v3 after seeing tee shots. Triple reward / triple loss.
          </KeyRow>
          <KeyRow k={<span className="text-base font-extrabold text-red-500">B</span>}>
            <b>Blind Wolf</b> — went 1v3 <em>before</em> tee shots. +1 point per opponent on a win; no penalty on loss.
          </KeyRow>
          <KeyRow k={<span className="text-base font-extrabold text-green-600">JS</span>}>
            <span className="text-green-600 font-semibold">Green initials</span> = your <b>teammate</b> on this 2v2.
          </KeyRow>
          <KeyRow k={<span className="text-base font-extrabold text-red-500">KB</span>}>
            <span className="text-red-500 font-semibold">Red initials</span> = opponent teammate (paired against you).
          </KeyRow>
          <KeyRow k={<span className="text-xs font-extrabold text-red-500">3v1</span>}>
            <b>3v1</b> — the wolf went alone and you're one of the 3 opponents.
          </KeyRow>
          <KeyRow k={<span className="text-base text-amber-500">🐺</span>}>
            <b>Pending</b> — wolf decision not recorded yet.
          </KeyRow>
        </div>
      </Section>

      {/* ── 7. Quick rules ─────────────────────── */}
      <Section n={7} title="Side Game &amp; Quick Rules">
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-2.5 text-xs text-amber-900 dark:text-amber-200 font-semibold mb-3">
          🏆 &nbsp;Side Game Winner: <b>Josh Stoll</b> (Most Skins — 4)
        </div>
        <ul className="text-xs space-y-1.5 leading-snug">
          <li>• <b>Holes 1 &amp; 3</b> are skins. No wolf, no polie/sandie payout (still tracked for stats).</li>
          <li>• <b>Every other hole</b> rotates wolf by batting order.</li>
          <li>• <b>Greenies</b> pay only on par 3s (wolfer hits green &amp; makes par).</li>
          <li>• <b>Polie</b> = made putt longer than the flagstick. <b>Sandie</b> = 1 shot out of bunker + 1 putt.</li>
        </ul>
      </Section>

      <div className="text-center pt-4 border-t border-border/60">
        <p className="text-xs text-muted-foreground/60">🐺 Wolf Cup — Guyan Golf &amp; Country Club</p>
        <p className="text-[10px] text-muted-foreground/40 mt-1">® AssTV — Appalachian Sports Station TV Networks</p>
      </div>
    </div>
  );
}
