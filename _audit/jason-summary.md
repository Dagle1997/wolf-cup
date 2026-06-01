# For Jason — what we checked after the ball-draw fix

Your catch on the batting order was a real bug, and it was fair to wonder what else might be off. So rather than just say "trust it," here's what got checked.

**The randomness.** The batting-order draw was the one spot that wasn't truly random. We went through the whole app looking for anything else that decides an outcome by chance. The only other place is how groups get paired, and that one was already done correctly. The batting draw is now fixed with the proper method, and there's an automatic test that re-runs it 60,000 times and fails if it ever drifts off fair again. So that class of problem can't quietly come back.

**The money — the part that actually matters.** We took the real records from all six finalized rounds this year and recomputed every player's winnings and losses from scratch, completely independently of the app's own math, then compared three numbers for every player in every round:

1. what the app actually paid out,
2. what the app's stats page shows,
3. a fresh independent recalculation.

**All three matched exactly, for every player, in all six rounds — down to the dollar.** And every single round balances to zero: every dollar someone won, someone else lost. No money is ever created or lost by the app. We also hand-checked one full hole start to finish — handicap strokes, low ball, team total, skins, the eagle bonus — and it matched the app to the dollar.

**Bottom line.** The one bug was isolated to the batting draw, it's fixed, and the money math checks out exactly against the real rounds. And honestly — if you'd rather toss real golf balls for the order, go for it. The app just records whatever order you give it; it isn't deciding anything you don't tell it to.

— Josh
