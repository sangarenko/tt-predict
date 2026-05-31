// ========================================
// Prediction Orchestrator
// Main engine that runs all strategies across all profiles
// and upcoming matches, places bets, and settles results.
// ========================================

import { db } from '@/lib/db'
import { eloStrategy } from './strategies/elo'
import { trendStrategy } from './strategies/trend'
import { leagueStrategy } from './strategies/league'
import { chaseStrategy } from './strategies/chase'
import { arbitrageStrategy } from './strategies/arbitrage'
import { checkBankrollProtection, calculateStake } from './bankroll'
import type { StrategyContext, BetRecommendation } from './strategies/types'

// Map strategy names to their implementation functions
const strategies: Record<string, (ctx: StrategyContext) => import('./strategies/types').StrategyResult> = {
  elo: eloStrategy,
  trend: trendStrategy,
  league: leagueStrategy,
  chase: chaseStrategy,
  arbitrage: arbitrageStrategy,
}

/**
 * Run predictions for all active profiles on all upcoming matches.
 * 
 * Flow:
 * 1. Fetch active profiles and upcoming/live matches
 * 2. Gather historical data for strategy context
 * 3. For each (profile, match) pair, run the profile's strategy
 * 4. Calculate stakes and save qualifying bets to DB
 * 5. Update profile bankrolls
 */
export async function runPredictions() {
  // 1. Get all active profiles
  const profiles = await db.aiProfile.findMany({ where: { isActive: true } })

  // 2. Get upcoming matches without pending bets
  const allUpcoming = await db.match.findMany({
    where: { status: { in: ['upcoming', 'live'] } },
    include: { odds: true, aiBets: true },
  })

  // 3. Get historical data for strategy context
  const settledBets = await db.aiBet.findMany({
    where: { status: { in: ['won', 'lost'] } },
    orderBy: { createdAt: 'desc' },
  })
  const finishedMatches = await db.match.findMany({
    where: { status: 'finished', winner: { not: null } },
    include: { odds: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const results: BetRecommendation[] = []
  let totalPlaced = 0
  let totalSkipped = 0

  // 4. For each profile and each match, run strategy
  for (const profile of profiles) {
    // Bankroll protection check
    const protection = checkBankrollProtection(profile)
    if (!protection.canBet) continue

    for (const match of allUpcoming) {
      // Skip if this profile already has a pending bet on this match
      const existingBet = match.aiBets.find(
        (b) => b.profileId === profile.id && b.status === 'pending'
      )
      if (existingBet) continue

      const odds = match.odds[0]
      if (!odds || !odds.odds1 || !odds.odds2) continue

      // Build strategy context
      const profileHistoricalBets = settledBets
        .filter((b) => b.profileId === profile.id)
        .map((b) => ({
          player1: b.player1,
          player2: b.player2,
          predictedWinner: b.predictedWinner,
          won: b.status === 'won',
          confidence: b.confidence,
          createdAt: b.createdAt,
        }))

      const ctx: StrategyContext = {
        match: {
          id: match.id,
          player1: match.player1,
          player2: match.player2,
          league: match.league || '',
          odds1: odds.odds1,
          odds2: odds.odds2,
          score1: match.score1,
          score2: match.score2,
          status: match.status,
          startTime: match.startTime,
        },
        historicalBets: profileHistoricalBets,
        allMatches: finishedMatches.map((m) => ({
          player1: m.player1,
          player2: m.player2,
          winner: m.winner || undefined,
          score1: m.score1,
          score2: m.score2,
          league: m.league || '',
          odds1: m.odds[0]?.odds1 ?? undefined,
          odds2: m.odds[0]?.odds2 ?? undefined,
          createdAt: m.createdAt,
        })),
        profile: {
          id: profile.id,
          name: profile.name,
          currentAmount: profile.currentAmount,
          initialAmount: profile.initialAmount,
          peakAmount: profile.peakAmount,
          flatAmount: profile.flatAmount,
          stopLossPct: profile.stopLossPct,
          totalBets: profile.totalBets,
          wonBets: profile.wonBets,
          lostBets: profile.lostBets,
        },
      }

      // Run the profile's assigned strategy
      const strategyFn = strategies[profile.strategy]
      if (!strategyFn) continue

      const result = strategyFn(ctx)

      // Strategy says skip this match
      if (result.shouldSkip) {
        totalSkipped++
        continue
      }

      // Calculate consecutive losses for chase strategy
      const consecutiveLosses = profileHistoricalBets
        .slice(0, 5)
        .filter((b) => !b.won).length

      // Determine which odds to use based on prediction
      const isP1 = result.predictedWinner === match.player1
      const betOdds = isP1 ? odds.odds1 : odds.odds2
      const stake = calculateStake(
        profile.strategy,
        result.confidence,
        betOdds,
        profile,
        consecutiveLosses
      )

      // Safety: don't bet if stake is invalid or exceeds bankroll
      if (stake <= 0 || stake > profile.currentAmount) continue

      const potentialWin = Math.round(stake * betOdds)

      results.push({
        matchId: match.id,
        profileId: profile.id,
        player1: match.player1,
        player2: match.player2,
        predictedWinner: result.predictedWinner,
        confidence: result.confidence,
        valueRating: result.valueRating,
        odds: betOdds,
        stake,
        potentialWin,
        strategy: profile.strategy,
        reasoning: result.reasoning,
      })
    }
  }

  // 5. Save bets to DB and update profiles
  for (const rec of results) {
    // Create the bet record
    await db.aiBet.create({
      data: {
        matchId: rec.matchId,
        profileId: rec.profileId,
        player1: rec.player1,
        player2: rec.player2,
        predictedWinner: rec.predictedWinner,
        confidence: rec.confidence,
        valueRating: rec.valueRating,
        odds: rec.odds,
        stake: rec.stake,
        potentialWin: rec.potentialWin,
        strategy: rec.strategy,
        reasoning: rec.reasoning,
      },
    })

    // Deduct stake from profile bankroll
    const profile = await db.aiProfile.findUnique({ where: { id: rec.profileId } })
    if (profile && rec.stake <= profile.currentAmount) {
      const newAmount = Math.round((profile.currentAmount - rec.stake) * 100) / 100
      await db.aiProfile.update({
        where: { id: rec.profileId },
        data: {
          currentAmount: newAmount,
          totalBets: { increment: 1 },
          pendingBets: { increment: 1 },
        },
      })
      totalPlaced++
    }
  }

  return { betsPlaced: totalPlaced, betsSkipped: totalSkipped, recommendations: results }
}

/**
 * Settle all pending bets for finished matches.
 * Updates bet status (won/lost), calculates profit/loss,
 * and adjusts profile bankrolls accordingly.
 */
export async function settleBets() {
  const pendingBets = await db.aiBet.findMany({
    where: { status: 'pending' },
    include: { match: true, profile: true },
  })

  let settled = 0

  for (const bet of pendingBets) {
    // Only settle if the match is finished with a declared winner
    if (bet.match.status !== 'finished' || !bet.match.winner) continue

    const won = bet.predictedWinner === bet.match.winner
    const profit = won ? Math.round(bet.potentialWin - bet.stake) : -bet.stake
    const newStatus = won ? 'won' : 'lost'

    // Update bet record
    await db.aiBet.update({
      where: { id: bet.id },
      data: {
        status: newStatus,
        profit,
        settledAt: new Date(),
      },
    })

    // Update profile: add profit back, adjust counters
    const profile = await db.aiProfile.findUnique({ where: { id: bet.profileId } })
    if (profile) {
      const newAmount = Math.round((profile.currentAmount + profit) * 100) / 100
      const newPeak = Math.max(profile.peakAmount, newAmount)

      await db.aiProfile.update({
        where: { id: bet.profileId },
        data: {
          currentAmount: newAmount,
          peakAmount: newPeak,
          pendingBets: { decrement: 1 },
          ...(won ? { wonBets: { increment: 1 } } : { lostBets: { increment: 1 } }),
        },
      })
    }

    settled++
  }

  return { settled }
}
