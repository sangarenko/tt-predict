// ========================================
// Trend-Hunter Strategy
// Momentum-based analysis. When no history exists,
// falls back to odds-implied form (favorites in TT are favorites for a reason).
// ========================================

import type { StrategyContext, StrategyResult } from './types'

interface PlayerForm {
  totalMatches: number
  wins: number
  losses: number
  recentResults: boolean[]
  currentStreak: number
  recentWinRate: number
}

function getPlayerForm(
  playerName: string,
  allMatches: StrategyContext['allMatches'],
  maxRecent: number = 5
): PlayerForm {
  const playerMatches = allMatches
    .filter((m) => m.player1 === playerName || m.player2 === playerName)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  if (playerMatches.length === 0) {
    return { totalMatches: 0, wins: 0, losses: 0, recentResults: [], currentStreak: 0, recentWinRate: 0 }
  }

  const wins = playerMatches.filter(m => m.winner === playerName).length
  const recentResults = playerMatches.slice(0, maxRecent).map(m => m.winner === playerName)

  let currentStreak = 0
  for (const result of recentResults) {
    if (result) { if (currentStreak >= 0) currentStreak++; else break }
    else { if (currentStreak <= 0) currentStreak--; else break }
  }

  const recentWinRate = recentResults.length > 0
    ? recentResults.filter(Boolean).length / recentResults.length
    : playerMatches.length > 0 ? wins / playerMatches.length : 0

  return { totalMatches: playerMatches.length, wins, losses: playerMatches.length - wins, recentResults, currentStreak, recentWinRate }
}

/** Main Trend strategy function */
export function trendStrategy(ctx: StrategyContext): StrategyResult {
  const { match, allMatches } = ctx

  // No history at all — use odds as form proxy
  if (allMatches.length === 0) {
    const fav = match.odds1 <= match.odds2 ? match.player1 : match.player2
    const favOdds = Math.min(match.odds1, match.odds2)
    const impliedProb = favOdds > 0 ? (1 / favOdds) * 100 : 50
    const confidence = Math.round(Math.min(70, Math.max(35, impliedProb)) * 10) / 10

    const margin = Math.abs(match.odds1 - match.odds2)
    if (margin < 0.3) {
      return {
        predictedWinner: fav,
        confidence: 35,
        valueRating: 0,
        reasoning: `No history, close odds — skip`,
        shouldSkip: true,
      }
    }

    return {
      predictedWinner: fav,
      confidence,
      valueRating: 0.8,
      reasoning: `No history — using odds. ${fav} @${favOdds} (implied ${impliedProb.toFixed(0)}%)`,
      shouldSkip: false,
    }
  }

  const form1 = getPlayerForm(match.player1, allMatches)
  const form2 = getPlayerForm(match.player2, allMatches)

  // Both unknown — odds fallback
  if (form1.totalMatches === 0 && form2.totalMatches === 0) {
    const fav = match.odds1 <= match.odds2 ? match.player1 : match.player2
    const favOdds = Math.min(match.odds1, match.odds2)
    return {
      predictedWinner: fav,
      confidence: 40,
      valueRating: 0.5,
      reasoning: `Both players unknown in finished matches — using odds. ${fav} @${favOdds}`,
      shouldSkip: false,
    }
  }

  // One player unknown — lean toward known player if decent record
  if (form1.totalMatches === 0 || form2.totalMatches === 0) {
    const known = form1.totalMatches > 0 ? form1 : form2
    const knownPlayer = form1.totalMatches > 0 ? match.player1 : match.player2

    if (known.recentWinRate >= 0.4 && known.totalMatches >= 2) {
      return {
        predictedWinner: knownPlayer,
        confidence: Math.round(Math.min(65, 35 + known.totalMatches * 5) * 10) / 10,
        valueRating: 1.0,
        reasoning: `${knownPlayer} has ${known.totalMatches} matches (${Math.round(known.recentWinRate * 100)}% WR) — form edge`,
        shouldSkip: false,
      }
    }
  }

  // Both have history — full form comparison
  const overallWinRate1 = form1.totalMatches > 0 ? form1.wins / form1.totalMatches : 0
  const overallWinRate2 = form2.totalMatches > 0 ? form2.wins / form2.totalMatches : 0

  const score1 = form1.recentWinRate * 40 + Math.min(Math.max(form1.currentStreak, -3), 3) / 6 * 30 + 15 + overallWinRate1 * 30
  const score2 = form2.recentWinRate * 40 + Math.min(Math.max(form2.currentStreak, -3), 3) / 6 * 30 + 15 + overallWinRate2 * 30

  const predictedWinner = score1 >= score2 ? match.player1 : match.player2
  const scoreDiff = Math.abs(score1 - score2)
  const confidence = Math.round(Math.min(90, Math.max(30, 50 + scoreDiff * 2.5)) * 10) / 10

  const isP1 = predictedWinner === match.player1
  const betOdds = isP1 ? match.odds1 : match.odds2
  const impliedProb = betOdds > 0 ? (1 / betOdds) * 100 : 50
  const edge = confidence - impliedProb
  const valueRating = Math.max(0, Math.min(5, edge / 8))

  return {
    predictedWinner,
    confidence,
    valueRating: Math.round(valueRating * 10) / 10,
    reasoning: `${match.player1}: ${Math.round(form1.recentWinRate * 100)}% WR, ${form1.currentStreak > 0 ? '+' : ''}${form1.currentStreak} streak. ${match.player2}: ${Math.round(form2.recentWinRate * 100)}% WR, ${form2.currentStreak > 0 ? '+' : ''}${form2.currentStreak} streak`,
    shouldSkip: valueRating < 0.2,
  }
}
