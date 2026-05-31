// ========================================
// Bankroll Management
// Kelly Criterion stake sizing, bankroll protection,
// and strategy-specific stake calculation.
// ========================================

/** Profile fields needed for bankroll checks */
interface BankrollProfile {
  currentAmount: number
  initialAmount: number
  peakAmount: number
  stopLossPct: number
  totalBets: number
  lostBets: number
}

/** Profile fields needed for stake calculation */
interface StakeProfile {
  currentAmount: number
  flatAmount: number
  totalBets: number
  wonBets: number
  lostBets: number
  initialAmount: number
}

// ---- Kelly Criterion ----

/**
 * Calculate optimal stake using the Kelly Criterion (fractional).
 *
 * Kelly formula: f* = (bp - q) / b
 *   where b = decimal odds - 1 (net payout ratio)
 *         p = estimated probability of winning (confidence / 100)
 *         q = 1 - p (probability of losing)
 *
 * We use fractional Kelly (default 25%) to reduce variance.
 * Stake is capped at 10% of bankroll maximum.
 *
 * @param confidence - Strategy's estimated win probability (0-100)
 * @param odds - Decimal odds for the selection
 * @param bankroll - Current available bankroll
 * @param fraction - Kelly fraction (default 0.25 = quarter Kelly)
 * @returns Recommended stake amount (always >= 0)
 */
export function kellyStake(
  confidence: number,
  odds: number,
  bankroll: number,
  fraction: number = 0.25
): number {
  const p = confidence / 100
  const q = 1 - p
  const b = odds - 1

  // Guard: if odds are invalid, return 0
  if (b <= 0 || p <= 0 || q <= 0 || bankroll <= 0) {
    return 0
  }

  const kelly = (b * p - q) / b

  // Fractional Kelly with safety bounds
  const rawStake = bankroll * fraction * Math.max(0, kelly)

  // Never bet more than 10% of bankroll
  return Math.max(0, Math.min(rawStake, bankroll * 0.1))
}

// ---- Bankroll Protection ----

/**
 * Check whether the profile's bankroll is in a safe state for betting.
 *
 * Rules:
 * 1. Stop-loss: If drawdown from peak exceeds stopLossPct, pause betting
 * 2. Bankrupt protection: If bankroll is depleted, prevent further bets
 *
 * @returns Object with canBet flag and optional reason
 */
export function checkBankrollProtection(profile: BankrollProfile): {
  canBet: boolean
  reason?: string
  drawdownPct: number
} {
  const drawdownPct =
    profile.peakAmount > 0
      ? ((profile.peakAmount - profile.currentAmount) / profile.peakAmount) * 100
      : 0

  // Stop-loss: pause if drawdown exceeds threshold
  if (drawdownPct >= profile.stopLossPct) {
    return {
      canBet: false,
      reason: `Stop-loss triggered: ${drawdownPct.toFixed(1)}% drawdown exceeds ${profile.stopLossPct}%`,
      drawdownPct,
    }
  }

  // Bankrupt protection
  if (profile.currentAmount <= 0) {
    return {
      canBet: false,
      reason: 'Bankroll depleted',
      drawdownPct,
    }
  }

  return { canBet: true, drawdownPct }
}

// ---- Strategy-Specific Stake Calculation ----

/**
 * Calculate stake based on the strategy type and profile state.
 *
 * - chase:      Martingale variant — increasing stakes on consecutive losses
 * - arbitrage:  Kelly Criterion with quarter-Kelly fraction
 * - elo:        Confidence-based Kelly with 20% fraction
 * - trend/league: Flat stake (consistent, conservative)
 *
 * All stakes are capped at 10% of current bankroll.
 */
export function calculateStake(
  strategy: string,
  confidence: number,
  odds: number,
  profile: StakeProfile,
  consecutiveLosses: number
): number {
  const { currentAmount, flatAmount } = profile

  // Guard: no bankroll available
  if (currentAmount <= 0) return 0

  switch (strategy) {
    case 'chase': {
      // Increasing stakes on losses: base * 1.5^losses, capped at 3x and 10% of bankroll
      const multiplier = Math.min(1.5 ** consecutiveLosses, 3)
      const stake = flatAmount * multiplier
      return Math.min(Math.round(stake), Math.round(currentAmount * 0.1))
    }

    case 'arbitrage': {
      // Kelly criterion with quarter-Kelly fraction
      return Math.round(kellyStake(confidence, odds, currentAmount, 0.25))
    }

    case 'elo': {
      // Confidence-based Kelly with 20% fraction
      return Math.round(kellyStake(confidence, odds, currentAmount, 0.2))
    }

    default: {
      // Flat stake for trend and league strategies
      return Math.min(flatAmount, Math.round(currentAmount * 0.1))
    }
  }
}
