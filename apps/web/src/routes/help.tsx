import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';

export const Route = createFileRoute('/help')({
  component: HelpPage,
});

// ---------------------------------------------------------------------------
// Section component
// ---------------------------------------------------------------------------

function Section({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <span className="text-xl">{emoji}</span>
        {title}
      </h2>
      <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="shrink-0 w-6 h-6 rounded-full bg-green-600 text-white text-xs font-bold flex items-center justify-center">
        {n}
      </span>
      <p>{children}</p>
    </div>
  );
}

function Img({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <img src={src} alt={alt} className="w-full" loading="lazy" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function HelpPage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-8">
      {/* Back link */}
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Board
      </Link>

      {/* Title */}
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-black tracking-tight">
          🐺 How to Play
        </h1>
        <p className="text-sm text-muted-foreground">
          Your guide to the Wolf Cup app
        </p>
      </div>

      {/* ---- Sections ---- */}

      <Section emoji="🏆" title="The Board">
        <p>
          The <strong>Board</strong> is your home screen. It shows every round
          this season — upcoming, in-progress, and finished.
        </p>
        <p>
          Tap a finished round to expand it and see the full group scorecard:
          each player's stableford points, money won/lost, and who was wolf on
          each hole.
        </p>
        {/* <Img src="/help/board.png" alt="Leaderboard showing rounds" /> */}
      </Section>

      <Section emoji="📋" title="Attendance">
        <p>
          The <strong>Attend</strong> tab shows who's playing this week. Your
          admin marks everyone in or out based on the GroupMe chat — you don't
          need to do anything here.
        </p>
        <p>
          Check this page if you want to see who's confirmed for this week's
          round.
        </p>
      </Section>

      <Section emoji="⛳" title="Score Entry">
        <p>
          This is where you'll spend most of your time during a round. Here's
          how it works:
        </p>
        <Step n={1}>
          Go to the <strong>Score</strong> tab. You'll see today's round listed.
          Tap it.
        </Step>
        <Step n={2}>
          Enter your <strong>entry code</strong> — a 2-digit code your admin
          gives you. This connects you to your group.
        </Step>
        <Step n={3}>
          You'll land on <strong>Hole 1</strong>. For each hole, enter every
          player's gross score (actual strokes). The app calculates net scores
          and stableford points automatically using your handicaps.
        </Step>
        <Step n={4}>
          On <strong>par 3s</strong>, you'll see a toggle to mark{' '}
          <strong>greenies</strong> (hit the green in regulation) for any player
          who earned one.
        </Step>
        <Step n={5}>
          If a player <strong>polies</strong> (one-putts after hitting the
          green), mark that too — it's worth bonus money.
        </Step>
        <Step n={6}>
          Use the <strong>arrow buttons</strong> to move between holes, or tap
          the hole number bar at the top to jump to any hole.
        </Step>
        <Step n={7}>
          Scores save automatically. You can close the app and come back — your
          session is remembered.
        </Step>
        {/* <Img src="/help/score-entry.png" alt="Hole-by-hole score entry" /> */}
      </Section>

      <Section emoji="🎰" title="Ball Draw">
        <p>
          The <strong>Ball Draw</strong> sets the batting order — who's wolf
          first, second, etc. Your admin handles this before the round starts.
        </p>
        <p>
          The <strong>"Roll for Order"</strong> button shuffles the order
          randomly if you want to leave it up to chance. This is optional — the
          admin can also set it manually.
        </p>
      </Section>

      <Section emoji="🐺" title="Wolf Decisions">
        <p>
          During score entry, the app tracks who is <strong>wolf</strong> on
          each hole based on the batting order. On wolf holes, the wolf
          picks a partner or goes lone wolf — your admin records this in the
          app.
        </p>
        <p>
          The first 4 holes cycle through each player as wolf. Holes 5+ repeat
          the order. Holes 17 &amp; 18 are always{' '}
          <strong>skins</strong> (everyone for themselves).
        </p>
      </Section>

      <Section emoji="📊" title="Standings">
        <p>
          <strong>Standings</strong> show the season leaderboard. Points come
          from stableford scoring — the better you play relative to your
          handicap, the more points you earn.
        </p>
        <p>
          Only your <strong>best 10 of 20</strong> rounds count toward the
          final standings, so a bad week won't sink your season.
        </p>
        <p>
          The <strong>Harvey Cup</strong> is a separate competition based on
          head-to-head money results within your group each round.
        </p>
      </Section>

      <Section emoji="📈" title="Stats & Awards">
        <p>
          The <strong>Stats</strong> tab shows league-wide statistics and the{' '}
          <strong>awards showcase</strong> — trophies and badges earned across
          all seasons.
        </p>
        <p>
          Tap any player to see their <strong>drill-down</strong>: highlight
          reel (birdies, greenies, polies), partner chemistry, performance by
          batting order position, and more.
        </p>
      </Section>

      <Section emoji="💰" title="How Money Works">
        <p>
          Every hole has money on the line. On <strong>wolf holes</strong>, the
          wolf team plays against the non-wolf team. On <strong>skins
          holes</strong> (17 &amp; 18), it's every player for themselves.
        </p>
        <p>
          <strong>Greenies</strong> (par 3, on the green in reg) and{' '}
          <strong>polies</strong> (one-putt after a greenie) are bonus money
          paid by every other player in the group.
        </p>
        <p>
          All money is calculated automatically — just enter the scores and the
          app handles the rest.
        </p>
      </Section>

      <Section emoji="❓" title="Tips">
        <p>
          <strong>Offline?</strong> No worries — scores are queued and will sync
          automatically when you're back online. A red "Offline" badge appears
          in the header.
        </p>
        <p>
          <strong>Dark mode:</strong> Tap the 🌙/☀️ icon in the top-right to
          switch between light and dark mode.
        </p>
        <p>
          <strong>Wrong score?</strong> You can go back to any hole and
          re-enter. If the round is already finalized, the admin can make
          corrections from the admin panel.
        </p>
      </Section>

      {/* Footer */}
      <div className="text-center pt-4 border-t border-border/60">
        <p className="text-xs text-muted-foreground/50">
          🐺 Wolf Cup — Guyan Golf &amp; Country Club
        </p>
        <p className="text-[10px] text-muted-foreground/30 mt-1">
          ® Appalachian Sports Station TV Networks
        </p>
      </div>
    </div>
  );
}
