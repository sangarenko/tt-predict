// ========================================
// Chase Strategy (Smart Martingale)
// Aggressive recovery-based approach that increases stakes
// after consecutive losses. Never skips — always bets.
// Uses simple odds comparison (lower odds = more likely winner).
// ========================================

import type { StrategyContext, StrategyResult } from './types'

/** Main Chase strategy function */
export function chaseStrategy(ctx: StrategyContext): StrategyResult {
  const { match, historicalBets, profile } = ctx

  // Calculate consecutive losses from recent bets
  const recentBets = historicalBets.slice(0, 10) // Look at last 10 bets
  let consecutiveLosses = 0
  for (const bet of recentBets) {
    if (!bet.won) {
      consecutiveLosses++
    } else {
      break
    }
  }

  // Simple prediction: lower odds = more likely winner
  // This is the most basic approach — the chase strategy is about
  // money management, not sophisticated analysis
  const predictedWinner = match.odds1 <= match.odds2 ? match.player1 : match.player2
  const betOdds = match.odds1 <= match.odds2 ? match.odds1 : match.odds2

  // Confidence = implied probability from odds, clamped to 30-75
  const impliedProb = betOdds > 0 ? (1 / betOdds) * 100 : 50
  const confidence = Math.round(Math.min(75, Math.max(30, impliedProb)) * 10) / 10

  // Calculate the chase multiplier for display in reasoning
  const baseStake = profile.flatAmount
  const chaseMultiplier = Math.min(1.5 ** consecutiveLosses, 3)
  const proposedStake = Math.min(
    Math.round(baseStake * chaseMultiplier),
    Math.round(profile.currentAmount * 0.1)
  )

  // Value rating: chase strategy focuses on recovery
  // Higher value when on a loss streak (recovery is more important)
  let valueRating: number
  let reasoning: string

  if (consecutiveLosses >= 3) {
    // Active chase mode — recovery needed
    const recoveryTarget = consecutiveLosses * baseStake
    valueRating = Math.min(5, 2 + consecutiveLosses * 0.5)
    reasoning = [
      `CHASE MODE ACTIVE: ${consecutiveLosses} consecutive losses detected`,
      `Recovery target: ~${recoveryTarget} units from losing streak`,
      `Stake multiplied by ${chaseMultiplier.toFixed(2)}x (${baseStake} → ${proposedStake} units)`,
      `Predicting ${predictedWinner} at ${betOdds} odds (implied ${impliedProb.toFixed(1)}% probability)`,
      `Current bankroll: ${profile.currentAmount.toFixed(0)} (${(proposedStake / profile.currentAmount * 100).toFixed(1)}% of bankroll at risk)`,
      'Strategy: Aggressive recovery — increased stake to recover losses faster',
    ].join('. ')
  } else if (consecutiveLosses >= 1) {
    // Mild chase — small increase
    valueRating = 1.5
    reasoning = [
      `Mild chase: ${consecutiveLosses} loss(es) in a row`,
      `Stake: ${proposedStake} units (${chaseMultiplier.toFixed(2)}x base)`,
      `Predicting ${predictedWinner} at ${betOdds} odds (implied ${impliedProb.toFixed(1)}%)`,
      `Monitoring for potential escalation to full chase mode`,
    ].join('. ')
  } else {
    // Normal mode — flat bet
    valueRating = 0.5
    reasoning = [
      `Normal mode: no active losing streak`,
      `Flat stake: ${baseStake} units`,
      `Predicting ${predictedWinner} at ${betOdds} odds (implied ${impliedProb.toFixed(1)}%)`,
      `Betting on the odds-on favorite — simple probability play`,
    ].join('. ')
  }

  // Chase strategy NEVER skips — it always bets
  // (unless bankroll protection stops it, handled upstream)
  return {
    predictedWinner,
    confidence,
    valueRating: Math.round(valueRating * 10) / 10,
    reasoning,
    shouldSkip: false,
  }
}
