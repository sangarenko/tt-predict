// ========================================
// Chase Strategy (Smart Martingale)
// Controlled recovery-based approach. Only bets on clear favorites
// to avoid burning bankroll on coin flips. Increases stakes after losses.
// ========================================

import type { StrategyContext, StrategyResult } from './types'

/** Main Chase strategy function */
export function chaseStrategy(ctx: StrategyContext): StrategyResult {
  const { match, historicalBets, profile } = ctx

  // Only bet on clear favorites (odds < 1.8) — avoid coin flips
  const favorite = match.odds1 <= match.odds2 ? match.player1 : match.player2
  const favOdds = Math.min(match.odds1, match.odds2)
  const dogOdds = Math.max(match.odds1, match.odds2)

  // Skip if no clear favorite (close odds = coin flip)
  if (favOdds >= 1.8) {
    return {
      predictedWinner: favorite,
      confidence: 30,
      valueRating: 0,
      reasoning: `No clear favorite (${match.odds1.toFixed(2)} vs ${match.odds2.toFixed(2)}) — skipping coin flip`,
      shouldSkip: true,
    }
  }

  // Calculate consecutive losses from recent bets
  const recentBets = historicalBets.slice(0, 10)
  let consecutiveLosses = 0
  for (const bet of recentBets) {
    if (!bet.won) {
      consecutiveLosses++
    } else {
      break
    }
  }

  // Confidence = implied probability from odds, clamped to 50-85
  const impliedProb = favOdds > 0 ? (1 / favOdds) * 100 : 50
  const confidence = Math.round(Math.min(85, Math.max(50, impliedProb)) * 10) / 10

  const baseStake = profile.flatAmount
  const chaseMultiplier = Math.min(1.5 ** consecutiveLosses, 3)

  let valueRating: number
  let reasoning: string

  if (consecutiveLosses >= 3) {
    valueRating = Math.min(5, 2 + consecutiveLosses * 0.5)
    reasoning = [
      `CHASE MODE: ${consecutiveLosses} consecutive losses`,
      `Stake x${chaseMultiplier.toFixed(1)} (${baseStake}→${Math.round(baseStake * chaseMultiplier)})`,
      `${favorite} @${favOdds} (implied ${impliedProb.toFixed(0)}%)`,
    ].join('. ')
  } else if (consecutiveLosses >= 1) {
    valueRating = 1.5
    reasoning = [
      `Mild chase: ${consecutiveLosses} loss(es)`,
      `${favorite} @${favOdds} (implied ${impliedProb.toFixed(0)}%)`,
    ].join('. ')
  } else {
    valueRating = 1.0
    reasoning = [
      `Flat mode: ${favorite} @${favOdds} (clear favorite, implied ${impliedProb.toFixed(0)}%)`,
    ].join('. ')
  }

  // Don't bet if bankroll < 3x flat stake (keep reserve for chase)
  if (profile.currentAmount < baseStake * 3) {
    return {
      predictedWinner: favorite,
      confidence,
      valueRating: 0,
      reasoning: `Bankroll too low (${profile.currentAmount}₽) — preserving for chase reserve`,
      shouldSkip: true,
    }
  }

  return {
    predictedWinner: favorite,
    confidence,
    valueRating: Math.round(valueRating * 10) / 10,
    reasoning,
    shouldSkip: false,
  }
}
