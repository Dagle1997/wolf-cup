import { describe, it, expect } from "vitest";
import { settleBet, type StrokeTotals, type BetRow } from "./bets.js";

// Minimal bet-row factory (only the fields settleBet reads matter).
function bet(overrides: Partial<BetRow>): BetRow {
  return {
    id: 1,
    roundId: 1,
    betType: "h2h",
    basis: "net",
    amountDollars: 50,
    subjectAPlayerId: 1,
    subjectBPlayerId: 2,
    line: null,
    sideAPlayerId: 10,
    sideBPlayerId: 11,
    note: null,
    createdByAdminId: null,
    createdAt: 0,
    contextId: "league:guyan-wolf-cup-friday",
    tenantId: "guyan",
    ...overrides,
  } as BetRow;
}

const full = (gross: number, net: number, netReliable = true): StrokeTotals => ({
  gross18: gross,
  net18: net,
  holesPlayed: 18,
  perHoleGross: new Map(),
  perHoleNet: new Map(),
  netReliable,
});
const partial = (gross: number, net: number): StrokeTotals => ({
  gross18: gross,
  net18: net,
  holesPlayed: 9,
  perHoleGross: new Map(),
  perHoleNet: new Map(),
  netReliable: true,
});

/** Per-hole totals from an array of 18 net values (gross mirrored for simplicity). */
const holes = (nets: number[]): StrokeTotals => {
  const perHoleNet = new Map<number, number>();
  const perHoleGross = new Map<number, number>();
  let net18 = 0;
  let gross18 = 0;
  nets.forEach((n, i) => {
    perHoleNet.set(i + 1, n);
    perHoleGross.set(i + 1, n);
    net18 += n;
    gross18 += n;
  });
  return { gross18, net18, holesPlayed: nets.length, perHoleGross, perHoleNet, netReliable: true };
};

describe("settleBet — head-to-head", () => {
  it("lower NET wins side A (subject A)", () => {
    const totals = new Map([
      [1, full(95, 72)],
      [2, full(90, 75)], // B lower gross but higher net
    ]);
    const o = settleBet(bet({ basis: "net" }), totals);
    expect(o.status).toBe("settled");
    expect(o.winningSide).toBe("A"); // A net 72 < B net 75
  });

  it("GROSS basis flips it — B's lower gross wins side B", () => {
    const totals = new Map([
      [1, full(95, 72)],
      [2, full(90, 75)],
    ]);
    const o = settleBet(bet({ basis: "gross" }), totals);
    expect(o.status).toBe("settled");
    expect(o.winningSide).toBe("B"); // B gross 90 < A gross 95
  });

  it("equal score is a push", () => {
    const totals = new Map([
      [1, full(90, 74)],
      [2, full(88, 74)],
    ]);
    const o = settleBet(bet({ basis: "net" }), totals);
    expect(o.status).toBe("push");
    expect(o.winningSide).toBeNull();
  });

  it("incomplete round → live (no winner declared)", () => {
    const totals = new Map([
      [1, partial(45, 36)],
      [2, full(88, 74)],
    ]);
    const o = settleBet(bet({ basis: "net" }), totals);
    expect(o.status).toBe("live");
  });

  it("NET bet fails closed (live) when a subject's net is unreliable (missing HI/tee)", () => {
    const totals = new Map([
      [1, full(90, 90, /* netReliable */ false)], // e.g. missing round HI
      [2, full(88, 74)],
    ]);
    expect(settleBet(bet({ basis: "net" }), totals).status).toBe("live");
    // …but a GROSS bet still settles (no handicap needed).
    expect(settleBet(bet({ basis: "gross" }), totals).status).toBe("settled");
  });
});

describe("settleBet — over/under", () => {
  const ou = (overrides: Partial<BetRow> = {}) =>
    bet({ betType: "over_under", subjectBPlayerId: null, line: 90, basis: "gross", ...overrides });

  it("under the line wins side A (the under)", () => {
    const o = settleBet(ou(), new Map([[1, full(87, 70)]]));
    expect(o.status).toBe("settled");
    expect(o.winningSide).toBe("A"); // 87 gross < 90
    expect(o.subjectAScore).toBe(87);
  });

  it("over the line wins side B (the over)", () => {
    const o = settleBet(ou(), new Map([[1, full(93, 76)]]));
    expect(o.status).toBe("settled");
    expect(o.winningSide).toBe("B"); // 93 > 90
  });

  it("exactly the line is a push (90 = tie)", () => {
    const o = settleBet(ou(), new Map([[1, full(90, 73)]]));
    expect(o.status).toBe("push");
    expect(o.winningSide).toBeNull();
  });

  it("honors NET basis against the line", () => {
    const o = settleBet(ou({ basis: "net" }), new Map([[1, full(93, 88)]]));
    expect(o.winningSide).toBe("A"); // net 88 < 90, even though gross 93 > 90
  });

  it("incomplete round → live", () => {
    const o = settleBet(ou(), new Map([[1, partial(45, 36)]]));
    expect(o.status).toBe("live");
  });
});

describe("settleBet — per-hole match play ($/hole)", () => {
  const ph = (overrides: Partial<BetRow> = {}) =>
    bet({ betType: "per_hole", basis: "net", amountDollars: 5, ...overrides });

  it("net holes-up wins side A; payout = |netHoles| × stake", () => {
    // A lower on holes 1-10 (wins 10), B lower on 11-12 (wins 2), tie 13-18.
    const aNets = Array.from({ length: 18 }, (_, i) => (i < 10 ? 3 : i < 12 ? 5 : 4));
    const bNets = Array.from({ length: 18 }, (_, i) => (i < 10 ? 4 : i < 12 ? 4 : 4));
    const o = settleBet(ph(), new Map([[1, holes(aNets)], [2, holes(bNets)]]));
    expect(o.status).toBe("settled");
    expect(o.winningSide).toBe("A");
    expect(o.holesWon).toEqual({ a: 10, b: 2 });
    expect(o.payout).toBe((10 - 2) * 5); // $40
  });

  it("more holes lost wins side B", () => {
    const aNets = Array.from({ length: 18 }, () => 5);
    const bNets = Array.from({ length: 18 }, () => 4); // B wins all 18
    const o = settleBet(ph(), new Map([[1, holes(aNets)], [2, holes(bNets)]]));
    expect(o.winningSide).toBe("B");
    expect(o.payout).toBe(18 * 5);
  });

  it("even holes = push (all square)", () => {
    const aNets = Array.from({ length: 18 }, (_, i) => (i % 2 === 0 ? 3 : 5));
    const bNets = Array.from({ length: 18 }, (_, i) => (i % 2 === 0 ? 5 : 3)); // each wins 9
    const o = settleBet(ph(), new Map([[1, holes(aNets)], [2, holes(bNets)]]));
    expect(o.status).toBe("push");
    expect(o.holesWon).toEqual({ a: 9, b: 9 });
    expect(o.payout).toBe(0);
  });

  it("incomplete round → live", () => {
    const o = settleBet(ph(), new Map([[1, partial(45, 36)], [2, full(88, 74)]]));
    expect(o.status).toBe("live");
  });
});
