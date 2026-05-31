// ========================================
// Elo-Master Strategy
// Elo-based rating system. When no history exists,
// falls back to odds-based prediction (implied probability).
// ========================================

import type { StrategyContext, StrategyResult } from './types'

const INITIAL_ELO = 1500
const K_FACTOR = 32

function expectedScore(eloA: number, eloB: number): number {
  const diff = Math.max(-400, Math.min(400, eloB - eloA))
  return 1 / (1 + Math.pow(10, diff / 400))
}

function calculateEloRatings(allMatches: StrategyContext['allMatches']): Map<string, number> {
  const ratings = new Map<string, number>()
  for (const match of allMatches) {
    if (!ratings.has(match.player1)) ratings.set(match.player1, INITIAL_ELO)
    if (!ratings.has(match.player2)) ratings.set(match.player2, INITIAL_ELO)
    if (!match.winner) continue

    const elo1 = ratings.get(match.player1)!
    const elo2 = ratings.get(match.player2)!
    const p1Won = match.winner === match.player1

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

function playerMatchCount(player: string, allMatches: StrategyContext['allMatches']): number {
  return allMatches.filter(m => m.player1 === player || m.player2 === player).length
}

/** Main Elo strategy function */
export function eloStrategy(ctx: StrategyContext): StrategyResult {
  const { match, allMatches } = ctx

  const count1 = playerMatchCount(match.player1, allMatches)
  const count2 = playerMatchCount(match.player2, allMatches)

  // No history for either player — use odds as fallback
  if (allMatches.length === 0 || (count1 === 0 && count2 === 0)) {
    const fav = match.odds1 <= match.odds2 ? match.player1 : match.player2
    const favOdds = Math.min(match.odds1, match.odds2)
    const impliedProb = favOdds > 0 ? (1 / favOdds) * 100 : 50
    const confidence = Math.round(Math.min(70, Math.max(35, impliedProb)) * 10) / 10

    // Skip very close matches (no edge)
    const margin = Math.abs(match.odds1 - match.odds2)
    if (margin < 0.3) {
      return {
        predictedWinner: fav,
        confidence: 35,
        valueRating: 0,
        reasoning: `No player history, very close odds (${match.odds1.toFixed(2)} vs ${match.odds2.toFixed(2)}) — skip`,
        shouldSkip: true,
      }
    }

    return {
      predictedWinner: fav,
      confidence,
      valueRating: 0.8,
      reasoning: `No player history — using odds as proxy. ${fav} @${favOdds} (implied ${impliedProb.toFixed(0)}%)`,
      shouldSkip: false,
    }
  }

  // Calculate Elo ratings
  const ratings = calculateEloRatings(allMatches)
  const elo1 = ratings.get(match.player1) ?? INITIAL_ELO
  const elo2 = ratings.get(match.player2) ?? INITIAL_ELO

  // If only one player has history, mix Elo with odds
  const hasOnlyOdds = count1 === 0 || count2 === 0

  const eloDiff = elo1 - elo2
  const predictedWinner = eloDiff > 0 ? match.player1 : match.player2
  const absDiff = Math.abs(eloDiff)

  // Confidence: map Elo gap to 35-90 range
  const eloConf = Math.min(90, Math.max(35, 50 + (absDiff / 400) * 50))
  const confidence = Math.round(eloConf * 10) / 10

  // Value assessment
  const isP1 = predictedWinner === match.player1
  const betOdds = isP1 ? match.odds1 : match.odds2
  const impliedProb = betOdds > 0 ? (1 / betOdds) * 100 : 50
  const edge = confidence - impliedProb
  const valueRating = Math.max(0, Math.min(5, edge / 8))

  const historyNote = hasOnlyOdds ? ' (partial history — one player new)' : ''

  const reasoning = [
    `Elo: ${match.player1}=${Math.round(elo1)}, ${match.player2}=${Math.round(elo2)}${historyNote}`,
    `Gap: ${Math.round(absDiff)}pts → ${predictedWinner} favored`,
    `Implied: ${impliedProb.toFixed(1)}% vs our: ${confidence.toFixed(1)}% (edge: ${edge > 0 ? '+' : ''}${edge.toFixed(1)}%)`,
  ].join('. ')

  return {
    predictedWinner,
    confidence,
    valueRating: Math.round(valueRating * 10) / 10,
    reasoning,
    shouldSkip: valueRating < 0.2,
  }
}
