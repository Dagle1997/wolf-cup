/**
 * HoleBadge — compact golf notation for a horizontal scorecard.
 *
 * Hand-ported (FD-1/FD-2 boundary) from the Wolf Cup reference
 * `HoleBadge` (apps/web/src/routes/index.tsx L145-208). The Wolf source is a
 * READ-ONLY *pattern* reference — this is NOT an import/re-export; Tournament
 * never depends on apps/web/** at runtime.
 *
 * Notation is keyed on `d = gross - par`:
 *   d <= -2  eagle+  filled red circle (bg-red-600, white text)
 *   d === -1 birdie  red circle outline
 *   d === 0  par     plain number
 *   d === 1  bogey   amber square outline
 *   d >= 2   double+ blue nested double-square
 *
 * Bonus dots (bottom-center): greenie = emerald, polie = amber, sandie = orange.
 * Stroke dots (top-right): relativeStrokes >= 2 → two, === 1 → one, else none.
 *
 * Styling note: the Wolf source uses `bg-foreground/50` for the stroke dots,
 * which is a shadcn semantic alias tournament-web does NOT define (it renders
 * as a no-op under Tailwind v4). It is replaced here with the tournament token
 * `var(--color-text-muted)` via inline style. The real palette utilities
 * (bg-red-600, border-amber-500, bg-emerald-500, bg-orange-500, text-blue-600,
 * etc.) are kept as-is — they resolve under Tailwind v4.
 *
 * Test hooks: a stable `data-testid="hole-badge"` plus `data-variant`
 * (eagle|birdie|par|bogey|double) and `data-greenie`/`data-polie`/`data-sandie`/
 * `data-strokes` attributes make notation/dot presence deterministically
 * queryable without brittle className assertions. They are inert in production.
 */

const STROKE_DOT_STYLE = { background: 'var(--color-text-muted)' } as const;

type HoleBadgeVariant = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double';

export function HoleBadge({
  gross,
  par,
  hasGreenie,
  hasPolie,
  hasSandie,
  relativeStrokes,
}: {
  gross: number;
  par: number;
  hasGreenie?: boolean | undefined;
  hasPolie?: boolean | undefined;
  hasSandie?: boolean | undefined;
  relativeStrokes?: number | undefined;
}) {
  const d = gross - par; // gross-based styling

  const variant: HoleBadgeVariant =
    d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'double' : 'par';

  // Stable, inert test hooks (see component doc). data-* attrs only emit when set.
  const testAttrs: Record<string, string> = {
    'data-testid': 'hole-badge',
    'data-variant': variant,
    'data-strokes': String(relativeStrokes ?? 0),
  };
  if (hasGreenie) testAttrs['data-greenie'] = 'true';
  if (hasPolie) testAttrs['data-polie'] = 'true';
  if (hasSandie) testAttrs['data-sandie'] = 'true';

  const bonusDots =
    hasGreenie || hasPolie || hasSandie ? (
      <span className="absolute -bottom-[2px] left-1/2 -translate-x-1/2 flex gap-[1px]">
        {hasGreenie && (
          <span data-testid="bonus-dot-greenie" className="w-[4px] h-[4px] rounded-full bg-emerald-500" />
        )}
        {hasPolie && (
          <span data-testid="bonus-dot-polie" className="w-[4px] h-[4px] rounded-full bg-amber-400" />
        )}
        {hasSandie && (
          <span data-testid="bonus-dot-sandie" className="w-[4px] h-[4px] rounded-full bg-orange-500" />
        )}
      </span>
    ) : null;

  const strokeDot = relativeStrokes ? (
    relativeStrokes >= 2 ? (
      <span className="absolute -top-[2px] -right-[3px] flex gap-[1px]">
        <span data-testid="stroke-dot" className="w-[4px] h-[4px] rounded-full" style={STROKE_DOT_STYLE} />
        <span data-testid="stroke-dot" className="w-[4px] h-[4px] rounded-full" style={STROKE_DOT_STYLE} />
      </span>
    ) : (
      <span
        data-testid="stroke-dot"
        className="absolute -top-[2px] -right-[2px] w-[4px] h-[4px] rounded-full"
        style={STROKE_DOT_STYLE}
      />
    )
  ) : null;

  if (d <= -2) {
    // Eagle or better: filled red circle
    return (
      <span
        {...testAttrs}
        className="relative inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-red-600 text-white text-[9px] font-black leading-none"
      >
        {gross}
        {bonusDots}
        {strokeDot}
      </span>
    );
  }
  if (d === -1) {
    // Birdie: red circle outline
    return (
      <span
        {...testAttrs}
        className="relative inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border-[1.5px] border-red-600 text-red-600 text-[9px] font-bold leading-none"
      >
        {gross}
        {bonusDots}
        {strokeDot}
      </span>
    );
  }
  if (d === 1) {
    // Bogey: amber square outline
    return (
      <span
        {...testAttrs}
        className="relative inline-flex items-center justify-center w-[18px] h-[18px] border-[1.5px] border-amber-500 text-amber-600 text-[9px] font-medium leading-none"
      >
        {gross}
        {bonusDots}
        {strokeDot}
      </span>
    );
  }
  if (d >= 2) {
    // Double bogey+: blue text, double square (nested border)
    return (
      <span
        {...testAttrs}
        className="relative inline-flex items-center justify-center w-[20px] h-[20px] border-[2px] border-blue-600 text-blue-600 text-[9px] font-bold leading-none"
      >
        <span className="absolute inset-[2px] border-[1px] border-blue-600" />
        <span className="relative">{gross}</span>
        {bonusDots}
        {strokeDot}
      </span>
    );
  }
  // Par
  return (
    <span {...testAttrs} className="relative inline-block text-[10px] font-medium">
      {gross}
      {bonusDots}
      {strokeDot}
    </span>
  );
}
