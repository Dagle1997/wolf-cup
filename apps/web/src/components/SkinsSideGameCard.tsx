type SkinHolder = {
  playerName: string;
  skins: number;
};

type Props = {
  // Server-provided label (from sideGames.name). Respecting this means an
  // admin rename of the side game is reflected in the card header.
  name: string;
  format: string;
  // null when the round is missing or no eligible field; empty array when
  // the calc has run but nobody has earned a skin yet.
  skinHolders: SkinHolder[] | null;
};

export function SkinsSideGameCard({ name, format, skinHolders }: Props) {
  const totalSkins = skinHolders?.reduce((acc, h) => acc + h.skins, 0) ?? 0;

  return (
    <div className="rounded-xl border bg-card p-3 mb-3">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
        Side Game
      </p>
      <p className="font-semibold">{name}</p>
      <p className="text-sm text-muted-foreground">{format}</p>
      {skinHolders && skinHolders.length > 0 && (
        <>
          <p className="mt-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            {totalSkins} skin{totalSkins === 1 ? '' : 's'}
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {skinHolders.map((h) => (
              <li key={h.playerName} className="flex justify-between">
                <span className="font-semibold">{h.playerName}</span>
                <span className="tabular-nums text-muted-foreground">{h.skins}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {skinHolders && skinHolders.length === 0 && (
        <p className="mt-2 text-sm italic text-muted-foreground">No skins yet</p>
      )}
    </div>
  );
}
