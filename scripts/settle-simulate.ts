// ========================================
// Settle & Simulate Script
// Mark some live/upcoming matches as finished, settle bets
// Run: bun run scripts/settle-simulate.ts
// ========================================

import { PrismaClient } from '@prisma/client'
import { runPredictions, settleBets } from '../src/lib/predictor'

const db = new PrismaClient()

async function main() {
  console.log('🏓 TT Predict — Settle & Simulate')
  console.log('====================================')

  // Step 1: Get upcoming/live matches
  const liveMatches = await db.match.findMany({
    where: { status: { in: ['live', 'upcoming'] } },
    include: { odds: true },
  })

  console.log(`\n📊 Found ${liveMatches.length} live/upcoming matches`)

  if (liveMatches.length === 0) {
    console.log('No live matches to settle')
    await db.$disconnect()
    return
  }

  // Step 2: Simulate random results for half of them
  const toFinish = liveMatches.slice(0, Math.ceil(liveMatches.length / 2))
  
  for (const match of toFinish) {
    // Random winner (weighted by odds — favorite wins more often)
    const odds = match.odds[0]
    if (!odds) continue
    
    const favOdds = Math.min(odds.odds1, odds.odds2)
    const favWinProb = 1 / favOdds
    
    const p1Wins = Math.random() < favWinProb * 0.85 // Slightly favor the favorite
    
    const winner = p1Wins ? match.player1 : match.player2
    const score1 = p1Wins ? 3 : Math.floor(Math.random() * 2)
    const score2 = p1Wins ? Math.floor(Math.random() * 2) : 3
    
    // Ensure there's a clear winner
    const finalScore1 = p1Wins ? 3 : (score2 >= 3 ? Math.max(0, score1) : 0)
    const finalScore2 = p1Wins ? (score1 >= 3 ? Math.max(0, score2) : 0) : 3

    await db.match.update({
      where: { id: match.id },
      data: {
        status: 'finished',
        score1: finalScore1,
        score2: finalScore2,
        winner,
      },
    })

    console.log(`  ✅ ${match.player1} vs ${match.player2} → ${winner} wins (${finalScore1}:${finalScore2})`)
  }

  // Step 3: Settle bets
  console.log('\n💰 Settling bets...')
  const settleResult = await settleBets()
  console.log(`Settled: ${settleResult.settled} bets`)

  // Step 4: Run predictions again for remaining matches
  console.log('\n🧠 Running predictions on remaining matches...')
  const predResult = await runPredictions()
  console.log(`New bets placed: ${predResult.betsPlaced}, Skipped: ${predResult.betsSkipped}`)

  // Step 5: Final summary
  const profiles = await db.aiProfile.findMany({ orderBy: { name: 'asc' } })
  const totalBets = await db.aiBet.count()
  const wonBets = await db.aiBet.count({ where: { status: 'won' } })
  const lostBets = await db.aiBet.count({ where: { status: 'lost' } })
  const pendingBets = await db.aiBet.count({ where: { status: 'pending' } })

  console.log('\n📊 Final State:')
  console.log(`  Total bets: ${totalBets} (${wonBets}W / ${lostBets}L / ${pendingBets}P)`)
  console.log('')
  
  let totalBankroll = 0
  for (const p of profiles) {
    const profit = p.currentAmount - p.initialAmount
    const winRate = p.wonBets + p.lostBets > 0 
      ? ((p.wonBets / (p.wonBets + p.lostBets)) * 100).toFixed(1) + '%'
      : 'N/A'
    const yieldPct = p.totalBets > 0
      ? ((profit / p.initialAmount) * 100).toFixed(1) + '%'
      : 'N/A'
    
    console.log(`  ${p.emoji} ${p.name}:`)
    console.log(`     Bankroll: ${p.currentAmount.toFixed(0)}₽ (${profit >= 0 ? '+' : ''}${profit.toFixed(0)}₽)`)
    console.log(`     Win Rate: ${winRate} (${p.wonBets}W/${p.lostBets}L) | Yield: ${yieldPct}`)
    console.log('')
    totalBankroll += p.currentAmount
  }

  console.log(`💰 Total AI Bankroll: ${totalBankroll.toFixed(0)}₽ (of ${5000}₽ initial)`)
  console.log(`📈 Total P&L: ${totalBankroll - 5000 >= 0 ? '+' : ''}${(totalBankroll - 5000).toFixed(0)}₽`)

  console.log('\n✅ Simulation complete!')
  await db.$disconnect()
}

main().catch(async (err) => {
  console.error('Error:', err)
  await db.$disconnect()
  process.exit(1)
})
