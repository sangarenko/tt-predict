// ========================================
// Trend-Hunter Strategy
// Momentum-based analysis: examines each player's recent form
// (last 5 results) to identify hot/cold streaks and predict
// the player with better current momentum.
// ========================================

import type { StrategyContext, StrategyResult } from './types'

interface PlayerForm {
  totalMatches: number
  wins: number
  losses: number
  recentResults: boolean[] // true = win, false = loss (most recent first)
  currentStreak: number    // positive = win streak, negative = loss streak
  recentWinRate: number    // win rate over last 5 matches
}

/** Extract a player's recent form from finished matches */
function getPlayerForm(
  playerName: string,
  allMatches: StrategyContext['allMatches'],
  maxRecent: number = 5
): PlayerForm {
  // Find all matches involving this player, sorted by date (most recent first)
  const playerMatches = allMatches
    .filter((m) => m.player1 === playerName || m.player2 === playerName)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  if (playerMatches.length === 0) {
    return {
      totalMatches: 0,
      wins: 0,
      losses: 0,
      recentResults: [],
      currentStreak: 0,
      recentWinRate: 0,
    }
  }

  const wins = playerMatches.filter(
    (m) => m.winner === playerName
  ).length
  const losses = playerMatches.length - wins

  // Recent results (most recent first, up to maxRecent)
  const recentResults = playerMatches.slice(0, maxRecent).map((m) => m.winner === playerName)

  // Calculate current streak (positive = wins, negative = losses)
  let currentStreak = 0
  for (const result of recentResults) {
    if (result) {
      if (currentStreak >= 0) currentStreak++
      else break
    } else {
      if (currentStreak <= 0) currentStreak--
      else break
    }
  }

  // If no recent results yet, use overall record
  const recentWinRate =
    recentResults.length > 0
      ? recentResults.filter(Boolean).length / recentResults.length
      : playerMatches.length > 0
        ? wins / playerMatches.length
        : 0

  return {
    totalMatches: playerMatches.length,
    wins,
    losses,
    recentResults,
    currentStreak,
    recentWinRate,
  }
}

/** Main Trend strategy function */
export function trendStrategy(ctx: StrategyContext): StrategyResult {
  const { match, allMatches } = ctx

  // Need historical matches to analyze trends
  if (allMatches.length === 0) {
    return {
      predictedWinner: match.player1,
      confidence: 30,
      valueRating: 0,
      reasoning: 'No historical match data available — cannot analyze trends',
      shouldSkip: true,
    }
  }

  const form1 = getPlayerForm(match.player1, allMatches)
  const form2 = getPlayerForm(match.player2, allMatches)

  // Both players have no history
  if (form1.totalMatches === 0 && form2.totalMatches === 0) {
    return {
      predictedWinner: match.player1,
      confidence: 30,
      valueRating: 0,
      reasoning: 'Neither player has any recorded match history',
      shouldSkip: true,
    }
  }

  // If only one player has history, prefer the one with history
  // unless they have a terrible record
  if (form1.totalMatches === 0 || form2.totalMatches === 0) {
    const known = form1.totalMatches > 0 ? form1 : form2
    const unknown = form1.totalMatches > 0 ? form2 : form1
    const knownPlayer = form1.totalMatches > 0 ? match.player1 : match.player2
    const unknownPlayer = form1.totalMatches > 0 ? match.player2 : match.player1

    // If the known player has at least a decent record, pick them
    if (known.recentWinRate >= 0.4 && known.totalMatches >= 3) {
      const confidence = Math.min(70, 30 + known.totalMatches * 5 + known.recentWinRate * 30)
      return {
        predictedWinner: knownPlayer,
        confidence: Math.round(confidence * 10) / 10,
        valueRating: 1.5,
        reasoning: `${knownPlayer} has ${known.totalMatches} recorded matches (${Math.round(known.recentWinRate * 100)}% win rate) while ${unknownPlayer} has no history — slight edge to known player`,
        shouldSkip: false,
      }
    }

    return {
      predictedWinner: match.player1,
      confidence: 35,
      valueRating: 0.5,
      reasoning: `Insufficient data — ${unknownPlayer} has no recorded matches and ${knownPlayer}'s record is inconclusive (${Math.round(known.recentWinRate * 100)}% win rate in ${known.totalMatches} matches)`,
      shouldSkip: true,
    }
  }

  // Both players have history — compare form
  // Score: recent win rate (40%) + streak momentum (30%) + overall win rate (30%)
  const overallWinRate1 = form1.totalMatches > 0 ? form1.wins / form1.totalMatches : 0
  const overallWinRate2 = form2.totalMatches > 0 ? form2.wins / form2.totalMatches : 0

  const score1 =
    form1.recentWinRate * 40 +
    Math.min(Math.max(form1.currentStreak, -3), 3) / 6 * 30 + 15 + // streak bonus (-15 to +15)
    overallWinRate1 * 30

  const score2 =
    form2.recentWinRate * 40 +
    Math.min(Math.max(form2.currentStreak, -3), 3) / 6 * 30 + 15 +
    overallWinRate2 * 30

  const predictedWinner = score1 >= score2 ? match.player1 : match.player2
  const scoreDiff = Math.abs(score1 - score2)

  // Confidence based on score difference
  const confidence = Math.min(90, Math.max(30, 50 + scoreDiff * 2.5))
  const roundedConfidence = Math.round(confidence * 10) / 10

  // Value assessment
  const isP1 = predictedWinner === match.player1
  const betOdds = isP1 ? match.odds1 : match.odds2
  const impliedProb = betOdds > 0 ? (1 / betOdds) * 100 : 50
  const edge = roundedConfidence - impliedProb
  const valueRating = Math.max(0, Math.min(5, edge / 8))

  const winnerForm = predictedWinner === match.player1 ? form1 : form2
  const loserForm = predictedWinner === match.player1 ? form2 : form1

  const reasoning = [
    `${match.player1} form: ${Math.round(form1.recentWinRate * 100)}% recent WR, ${form1.currentStreak > 0 ? '+' : ''}${form1.currentStreak} streak, ${form1.totalMatches} total matches`,
    `${match.player2} form: ${Math.round(form2.recentWinRate * 100)}% recent WR, ${form2.currentStreak > 0 ? '+' : ''}${form2.currentStreak} streak, ${form2.totalMatches} total matches`,
    `Momentum score: ${match.player1} = ${score1.toFixed(1)}, ${match.player2} = ${score2.toFixed(1)}`,
    `${predictedWinner} has stronger recent form (${Math.round(winnerForm.recentWinRate * 100)}% vs ${Math.round(loserForm.recentWinRate * 100)}%)`,
    valueRating > 1 ? `Value: ${impliedProb.toFixed(1)}% implied vs ${roundedConfidence.toFixed(1)}% estimated` : 'No clear value edge',
  ].join('. ')

  return {
    predictedWinner,
    confidence: roundedConfidence,
    valueRating: Math.round(valueRating * 10) / 10,
    reasoning,
    shouldSkip: valueRating < 0.3,
  }
}
