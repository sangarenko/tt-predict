// ========================================
// League-Expert Strategy
// Analyzes league-level patterns and predictability.
// Some leagues may be more consistent (easier to predict),
// and certain players may dominate specific leagues.
// ========================================

import type { StrategyContext, StrategyResult } from './types'

interface LeagueStats {
  league: string
  totalMatches: number
  // Track how often the "favorite" (lower odds) wins
  favoriteWins: number
  // Player dominance in this league
  playerWins: Map<string, number>
  playerMatches: Map<string, number>
}

/** Build league-level statistics from historical matches */
function buildLeagueStats(
  allMatches: StrategyContext['allMatches']
): Map<string, LeagueStats> {
  const stats = new Map<string, LeagueStats>()

  for (const match of allMatches) {
    const league = match.league || 'unknown'
    if (league === 'unknown' || !match.winner) continue

    if (!stats.has(league)) {
      stats.set(league, {
        league,
        totalMatches: 0,
        favoriteWins: 0,
        playerWins: new Map(),
        playerMatches: new Map(),
      })
    }

    const leagueData = stats.get(league)!
    leagueData.totalMatches++

    // Count matches per player in this league
    for (const player of [match.player1, match.player2]) {
      leagueData.playerMatches.set(player, (leagueData.playerMatches.get(player) || 0) + 1)
    }

    // Track winner
    leagueData.playerWins.set(match.winner, (leagueData.playerWins.get(match.winner) || 0) + 1)

    // Track if favorite (lower odds) won
    if (match.odds1 && match.odds2) {
      const favorite = match.odds1 < match.odds2 ? match.player1 : match.player2
      if (match.winner === favorite) {
        leagueData.favoriteWins++
      }
    }
  }

  return stats
}

/** Main League strategy function */
export function leagueStrategy(ctx: StrategyContext): StrategyResult {
  const { match, allMatches } = ctx

  // Need league info and historical data
  if (!match.league) {
    return {
      predictedWinner: match.player1,
      confidence: 30,
      valueRating: 0,
      reasoning: 'No league information available for this match',
      shouldSkip: true,
    }
  }

  if (allMatches.length === 0) {
    return {
      predictedWinner: match.player1,
      confidence: 30,
      valueRating: 0,
      reasoning: 'No historical match data available — cannot analyze league patterns',
      shouldSkip: true,
    }
  }

  const leagueStats = buildLeagueStats(allMatches)
  const leagueData = leagueStats.get(match.league)

  // No data for this specific league
  if (!leagueData || leagueData.totalMatches === 0) {
    // Check if there are any similar leagues (partial match)
    const similarLeagues = [...leagueStats.entries()]
      .filter(([name]) => name.toLowerCase().includes(match.league.toLowerCase()) ||
        match.league.toLowerCase().includes(name.toLowerCase()))
      .map(([name, data]) => ({ name, matches: data.totalMatches }))

    if (similarLeagues.length > 0) {
      return {
        predictedWinner: match.player1,
        confidence: 35,
        valueRating: 0.5,
        reasoning: `No exact league "${match.league}" data, but similar leagues found: ${similarLeagues.map(l => `${l.name} (${l.matches} matches)`).join(', ')}. Not enough for confident prediction.`,
        shouldSkip: true,
      }
    }

    return {
      predictedWinner: match.player1,
      confidence: 30,
      valueRating: 0,
      reasoning: `No historical data for league "${match.league}" — cannot analyze league-specific patterns`,
      shouldSkip: true,
    }
  }

  // League predictability: how often does the favorite win?
  const favoriteWinRate = leagueData.favoriteWins / leagueData.totalMatches
  // High predictability = favorite usually wins (>65%)
  const leaguePredictability = favoriteWinRate > 0.65 ? 'high' :
    favoriteWinRate > 0.5 ? 'moderate' : 'low'

  // Check player dominance in this league
  const p1WinsInLeague = leagueData.playerWins.get(match.player1) || 0
  const p1MatchesInLeague = leagueData.playerMatches.get(match.player1) || 0
  const p2WinsInLeague = leagueData.playerWins.get(match.player2) || 0
  const p2MatchesInLeague = leagueData.playerMatches.get(match.player2) || 0

  const p1WinRate = p1MatchesInLeague > 0 ? p1WinsInLeague / p1MatchesInLeague : 0
  const p2WinRate = p2MatchesInLeague > 0 ? p2WinsInLeague / p2MatchesInLeague : 0

  // At least one player must have league history
  if (p1MatchesInLeague === 0 && p2MatchesInLeague === 0) {
    // Use league predictability as a general guide
    if (leaguePredictability === 'high') {
      const predictedWinner = match.odds1 < match.odds2 ? match.player1 : match.player2
      const betOdds = predictedWinner === match.player1 ? match.odds1 : match.odds2
      const confidence = 55 + (favoriteWinRate - 0.5) * 40
      return {
        predictedWinner,
        confidence: Math.round(Math.min(75, confidence) * 10) / 10,
        valueRating: 1.0,
        reasoning: `League "${match.league}" has high predictability (${Math.round(favoriteWinRate * 100)}% favorite win rate in ${leagueData.totalMatches} matches). Neither player has specific league history, so favoring the odds-on player.`,
        shouldSkip: false,
      }
    }

    return {
      predictedWinner: match.player1,
      confidence: 35,
      valueRating: 0,
      reasoning: `League "${match.league}" has low predictability (${Math.round(favoriteWinRate * 100)}% favorite win rate) and neither player has league history`,
      shouldSkip: true,
    }
  }

  // Predict based on league-specific win rates
  // If one player has no league history but the other does, give a small bonus to known player
  let score1 = p1WinRate * 60 + (p1MatchesInLeague > 0 ? 10 : 0)
  let score2 = p2WinRate * 60 + (p2MatchesInLeague > 0 ? 10 : 0)

  // Adjust by league predictability
  if (leaguePredictability === 'high') {
    // In predictable leagues, give bonus to the favorite (lower odds)
    if (match.odds1 < match.odds2) {
      score1 += 10
    } else {
      score2 += 10
    }
  }

  const predictedWinner = score1 >= score2 ? match.player1 : match.player2
  const scoreDiff = Math.abs(score1 - score2)

  // Confidence calculation
  const baseConfidence = Math.min(85, 40 + scoreDiff * 5)
  const leagueBonus = leaguePredictability === 'high' ? 5 :
    leaguePredictability === 'moderate' ? 0 : -5
  const confidence = Math.round(Math.min(90, Math.max(30, baseConfidence + leagueBonus)) * 10) / 10

  // Value assessment
  const isP1 = predictedWinner === match.player1
  const betOdds = isP1 ? match.odds1 : match.odds2
  const impliedProb = betOdds > 0 ? (1 / betOdds) * 100 : 50
  const edge = confidence - impliedProb
  const valueRating = Math.max(0, Math.min(5, edge / 8))

  const winnerMatches = predictedWinner === match.player1 ? p1MatchesInLeague : p2MatchesInLeague
  const winnerWins = predictedWinner === match.player1 ? p1WinsInLeague : p2WinsInLeague
  const winnerWR = predictedWinner === match.player1 ? p1WinRate : p2WinRate

  const reasoning = [
    `League "${match.league}": ${leagueData.totalMatches} total matches, ${Math.round(favoriteWinRate * 100)}% favorite win rate (${leaguePredictability} predictability)`,
    `${match.player1} in this league: ${p1MatchesInLeague} matches, ${p1WinsInLeague} wins (${Math.round(p1WinRate * 100)}% WR)`,
    `${match.player2} in this league: ${p2MatchesInLeague} matches, ${p2WinsInLeague} wins (${Math.round(p2WinRate * 100)}% WR)`,
    `Predicting ${predictedWinner}: ${winnerWR > 0 ? Math.round(winnerWR * 100) + '% league win rate' : 'no league data'} in ${winnerMatches} league matches`,
    valueRating > 1 ? `Value edge: +${edge.toFixed(1)}%` : 'Insufficient edge for value bet',
  ].join('. ')

  return {
    predictedWinner,
    confidence,
    valueRating: Math.round(valueRating * 10) / 10,
    reasoning,
    shouldSkip: valueRating < 0.3 && winnerMatches < 3,
  }
}
