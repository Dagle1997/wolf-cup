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
          each hole. Finished rounds also show a <strong>Highlight Reel</strong> with
          the best moments from that round.
        </p>
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

      <Section emoji="⛳" title="Getting Started on Game Day">
        <p>
          Here's the flow when you arrive at the course:
        </p>
        <Step n={1}>
          Go to the <strong>Score</strong> tab. You'll see today's round.
          Enter the <strong>join code</strong> — it's the year (e.g.{' '}
          <strong>2026</strong>).
        </Step>
        <Step n={2}>
          Pick your <strong>group</strong>. This takes you to the{' '}
          <strong>Ball Draw</strong> screen where you set the batting order —
          either use <strong>"Roll for Order"</strong> to let the app randomly
          draw, or throw balls and enter the order manually.
        </Step>
        <Step n={3}>
          After the draw, you'll see the <strong>overview</strong> showing
          everyone's wolf holes for the round.
        </Step>
        <Step n={4}>
          Then you're on the <strong>score screen</strong>. For each hole,
          enter every player's gross score (actual strokes). The app calculates
          net scores and stableford points automatically using your handicaps.
        </Step>
        <Step n={5}>
          On <strong>par 3s</strong>, mark <strong>greenies</strong> and{' '}
          <strong>polies</strong> for any player who earned them (see Money
          section below).
        </Step>
        <Step n={6}>
          Use the <strong>arrow buttons</strong> to move between holes, or tap
          the hole number bar to jump to any hole. Scores save automatically.
        </Step>
      </Section>

      <Section emoji="🐺" title="The Wolf Game">
        <p>
          The batting order determines who is <strong>wolf</strong> on each
          hole. Player 1 is wolf on hole 2, player 2 on hole 4, and so on —
          cycling through the group. Holes <strong>1 &amp; 3</strong> are
          always <strong>skins</strong> (everyone for themselves).
        </p>
        <p>
          On wolf holes, the wolf watches each player tee off. After seeing
          the shots, the wolf either <strong>picks a partner</strong> (2v2) or
          goes <strong>lone wolf</strong> (1v3).
        </p>
        <p>
          Going lone wolf is riskier — if you win, each of the 3 opponents
          pays you (nearly <strong>3× the reward</strong>). If you lose, you
          pay each of them.
        </p>
        <p>
          The app tracks all wolf decisions automatically. The score keeper
          just records the decision and enters scores.
        </p>
      </Section>

      <Section emoji="💰" title="How Money Works">
        <p>
          Every hole has money on the line. The app calculates everything
          automatically — just enter scores.
        </p>
        <p>
          <strong>Skins (Holes 1 &amp; 2):</strong> Every player for
          themselves. Lowest net score wins and collects from each opponent.
        </p>
        <p>
          <strong>Wolf holes (3–18):</strong> Wolf team vs. non-wolf team.
          In a 2v2, the winning team collects from the losing team. Lone wolf
          wins or loses against all 3 opponents individually.
        </p>
        <p>
          <strong>Greenie</strong> (par 3s): Hit the green and make par — each
          other player in the group pays you.
        </p>
        <p>
          <strong>Polie</strong> (any hole): Make a putt longer than the flagstick
          pole — extra bonus skin for your team.
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

      <Section emoji="📸" title="Gallery">
        <p>
          Tap the <strong>camera icon</strong> in the header to open the photo
          gallery. Upload photos from the course — take a new photo or pick from
          your library.
        </p>
        <p>
          Photos uploaded during a live round are automatically tagged to that
          round. You can also add a caption before uploading.
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
