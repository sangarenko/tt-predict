// ========================================
// Elo-Master Strategy
// Elo-based rating system for player strength estimation
// Uses historical match results to calculate Elo ratings,
// then predicts the higher-rated player as winner.
// ========================================

import type { StrategyContext, StrategyResult } from './types'

const INITIAL_ELO = 1500
const K_FACTOR = 32

/** Calculate expected score (0-1) based on Elo difference */
function expectedScore(eloA: number, eloB: number): number {
  const diff = eloB - eloA
  // Clamp difference to avoid overflow in exp()
  const clampedDiff = Math.max(-400, Math.min(400, diff))
  return 1 / (1 + Math.pow(10, clampedDiff / 400))
}

/** Calculate Elo ratings for all players from historical match results */
function calculateEloRatings(
  allMatches: StrategyContext['allMatches']
): Map<string, number> {
  const ratings = new Map<string, number>()

  for (const match of allMatches) {
    // Ensure both players have ratings
    if (!ratings.has(match.player1)) ratings.set(match.player1, INITIAL_ELO)
    if (!ratings.has(match.player2)) ratings.set(match.player2, INITIAL_ELO)

    if (!match.winner) continue

    const elo1 = ratings.get(match.player1)!
    const elo2 = ratings.get(match.player2)!

    const p1Won = match.winner === match.player1

    // Update Elo for both players
    const exp1 = expectedScore(elo1, elo2)
    const exp2 = expectedScore(elo2, elo1)

    if (p1Won) {
      ratings.set(match.player1, elo1 + K_FACTOR * (1 - exp1))
      ratings.set(match.player2, elo2 + K_FACTOR * (0 - exp2))
    } else {
      ratings.set(match.player1, elo1 + K_FACTOR * (0 - exp1))
      ratings.set(match.player2, elo2 + K_FACTOR * (1 - exp2))
    }
  }

  return ratings
}

/** Calculate number of matches a player appears in */
function playerMatchCount(player: string, allMatches: StrategyContext['allMatches']): number {
  return allMatches.filter(
    (m) => m.player1 === player || m.player2 === player
  ).length
}

/** Main Elo strategy function */
export function eloStrategy(ctx: StrategyContext): StrategyResult {
  const { match, allMatches } = ctx

  // Need historical matches to calculate Elo
  if (allMatches.length === 0) {
    return {
      predictedWinner: match.player1,
      confidence: 30,
      valueRating: 0,
      reasoning: 'No historical match data available — cannot calculate Elo ratings',
      shouldSkip: true,
    }
  }

  // Calculate Elo ratings
  const ratings = calculateEloRatings(allMatches)
  const elo1 = ratings.get(match.player1) ?? INITIAL_ELO
  const elo2 = ratings.get(match.player2) ?? INITIAL_ELO

  // Both players have no history at all
  const count1 = playerMatchCount(match.player1, allMatches)
  const count2 = playerMatchCount(match.player2, allMatches)

  if (count1 === 0 && count2 === 0) {
    return {
      predictedWinner: match.player1,
      confidence: 30,
      valueRating: 0,
      reasoning: 'Both players have no match history — cannot reliably predict',
      shouldSkip: true,
    }
  }

  // Predict: higher Elo wins
  const eloDiff = elo1 - elo2
  const predictedWinner = eloDiff > 0 ? match.player1 : match.player2
  const absDiff = Math.abs(eloDiff)

  // Confidence: map Elo gap to 30-95 range
  // 0 gap = 30, ~300+ gap = 90+
  const confidence = Math.min(95, Math.max(30, 50 + (absDiff / 400) * 50))
  const roundedConfidence = Math.round(confidence * 10) / 10

  // Value assessment: compare our confidence to implied probability
  const isP1 = predictedWinner === match.player1
  const betOdds = isP1 ? match.odds1 : match.odds2
  const impliedProb = betOdds > 0 ? (1 / betOdds) * 100 : 50

  // Value exists when our confidence significantly exceeds implied probability
  const edge = roundedConfidence - impliedProb
  const valueRating = Math.max(0, Math.min(5, edge / 10))

  const reasoning = [
    `Elo rating: ${match.player1} = ${Math.round(elo1)}, ${match.player2} = ${Math.round(elo2)}`,
    `Elo gap: ${Math.round(absDiff)} points → ${eloDiff > 0 ? match.player1 : match.player2} favored`,
    `Matches played: ${match.player1} (${count1}), ${match.player2} (${count2})`,
    `Implied probability: ${impliedProb.toFixed(1)}% vs our estimate: ${roundedConfidence.toFixed(1)}%`,
    valueRating > 1 ? `Edge detected: +${edge.toFixed(1)}% — potential value` : 'No significant edge found',
  ].join('. ')

  return {
    predictedWinner,
    confidence: roundedConfidence,
    valueRating: Math.round(valueRating * 10) / 10,
    reasoning,
    shouldSkip: valueRating < 0.3, // Skip if no meaningful edge
  }
}
