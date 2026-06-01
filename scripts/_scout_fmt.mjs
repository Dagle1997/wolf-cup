let s = '';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  let j;
  try { j = JSON.parse(s); } catch { console.log('NON-JSON RESPONSE:', s.slice(0, 300)); return; }
  if (!j.groups) { console.log('UNEXPECTED:', JSON.stringify(j).slice(0, 300)); return; }
  console.log('seasonRounds:', j.seasonRounds, '| groups:', j.groups.length);
  for (const g of j.groups) {
    console.log('\nGroup ' + g.groupNumber);
    if (g.rivalry) console.log('  ⚔️ ' + g.rivalry.leaderName + ' leads — ' + g.rivalry.aName + ' ' + g.rivalry.aWins + '-' + g.rivalry.bWins + ' ' + g.rivalry.bName + ' ($' + g.rivalry.moneyDiff + ', ' + g.rivalry.shared + ' shared)');
    else console.log('  ⚔️ (no rivalry)');
    if (g.luckyCharm) console.log('  🤝 ' + g.luckyCharm.aName + ' + ' + g.luckyCharm.bName + ' ' + g.luckyCharm.wins + '-' + g.luckyCharm.losses + '-' + g.luckyCharm.pushes + ' (rate ' + g.luckyCharm.winRate + ')');
    else console.log('  🤝 (no lucky charm)');
    for (const p of g.players) {
      const trend = p.handicapTrend ? p.handicapTrend.direction + ' ' + p.handicapTrend.delta : '-';
      const birdie = p.topBirdieHole ? p.topBirdieHole.hole + ' (' + p.topBirdieHole.count + '/' + p.topBirdieHole.rounds + ')' : '-';
      const tee = p.bestTee ? p.bestTee.tee + ' ' + p.bestTee.avgStableford : '-';
      console.log('   ' + p.name.padEnd(15) + ' rds=' + p.rounds + ' trend=' + trend + ' best=' + JSON.stringify(p.bestHoles) + ' worst=' + JSON.stringify(p.worstHoles) + ' birdie=' + birdie + ' tee=' + tee + ' win/loss=$' + p.biggestWin + '/$' + p.biggestLoss);
    }
  }
});
