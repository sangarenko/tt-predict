// ========================================
// Arbitrage Strategy (Value Betting)
// Identifies market inefficiencies by analyzing implied probabilities.
// When the sum of implied probabilities deviates significantly from 100%,
// there may be value on one side.
// ========================================

import type { StrategyContext, StrategyResult } from './types'

/** Clamp a number between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Main Arbitrage strategy function */
export function arbitrageStrategy(ctx: StrategyContext): StrategyResult {
  const { match } = ctx

  // Calculate implied probabilities from odds
  const impProb1 = match.odds1 > 0 ? 1 / match.odds1 : 0.5
  const impProb2 = match.odds2 > 0 ? 1 / match.odds2 : 0.5
  const totalImplied = impProb1 + impProb2

  // The margin / vig: how much the bookmaker takes
  const margin = totalImplied - 1

  // Normalize probabilities (remove the vig)
  const normProb1 = impProb1 / totalImplied
  const normProb2 = impProb2 / totalImplied

  // Market analysis
  let reasoning: string
  let predictedWinner: string
  let confidence: number
  let valueRating: number
  let shouldSkip: boolean

  if (margin > 0.15) {
    // Very high margin — market is very inefficient or bookmaker is pricing aggressively
    // This means both sides might be overpriced (bad for bettor) OR
    // one side could have significant value

    // The "true" probability should be 50/50 in an efficient market
    // The deviation from 50% suggests where the value might be
    const deviation1 = Math.abs(normProb1 - 0.5)
    const deviation2 = Math.abs(normProb2 - 0.5)

    // Bet on the side where the market has priced LESS probability than average
    // (i.e., the side with shorter odds, which might be underpriced)
    if (normProb1 > normProb2) {
      predictedWinner = match.player1
      // Confidence = normalized probability, but capped
      confidence = Math.round(clamp(normProb1 * 100 - margin * 20, 30, 85) * 10) / 10
    } else {
      predictedWinner = match.player2
      confidence = Math.round(clamp(normProb2 * 100 - margin * 20, 30, 85) * 10) / 10
    }

    // High margin means potentially bad value unless one side is clearly mispriced
    const edge = Math.abs(normProb1 - normProb2) * 100
    valueRating = clamp(edge / 10, 0, 5)

    reasoning = [
      `High market margin detected: ${(margin * 100).toFixed(1)}% (total implied: ${(totalImplied * 100).toFixed(1)}%)`,
      `This suggests an inefficient or heavily juiced market`,
      `Normalized probabilities: ${match.player1} = ${(normProb1 * 100).toFixed(1)}%, ${match.player2} = ${(normProb2 * 100).toFixed(1)}%`,
      `Favoring ${predictedWinner} (higher normalized probability)`,
      `Edge from probability gap: ${edge.toFixed(1)}%`,
      valueRating > 2 ? 'Strong mispricing detected — potential value opportunity' : 'Market is inefficient but edge is marginal',
    ].join('. ')

    shouldSkip = valueRating < 1.5 // Skip unless clear value in high-margin markets
  } else if (margin > 0.05) {
    // Moderate margin — normal bookmaker pricing
    // Look for value: is one side significantly underpriced compared to 50/50?
    const probDeviation = Math.abs(normProb1 - normProb2)
    const closenessTo5050 = 1 - probDeviation // 1 = perfectly balanced, 0 = very skewed

    if (closenessTo5050 < 0.15) {
      // Very lopsided odds — one side strongly favored
      // The underdog might have value if the favorite is overhyped
      const favorite = normProb1 > normProb2 ? match.player1 : match.player2
      const underdog = normProb1 > normProb2 ? match.player2 : match.player1
      const favOdds = favorite === match.player1 ? match.odds1 : match.odds2
      const dogOdds = favorite === match.player1 ? match.odds2 : match.odds1

      // If the favorite is very short (< 1.3), the underdog might be value
      if (favOdds < 1.3 && dogOdds > 3.0) {
        predictedWinner = underdog
        confidence = Math.round(clamp(normProb2 > normProb1 ? normProb2 * 100 : normProb1 * 100, 30, 70) * 10) / 10
        valueRating = clamp((dogOdds - 3) / 2, 0, 5)

        reasoning = [
          `Market margin: ${(margin * 100).toFixed(1)}% — moderate bookmaker pricing`,
          `Very lopsided market: favorite ${favorite} at ${favOdds} vs underdog ${underdog} at ${dogOdds}`,
          `Heavy favorite (odds < 1.3) may be overbet — underdog offers value at ${dogOdds}`,
          `Predicting upset: ${underdog} with ${dogOdds} odds`,
          `Value rating based on underdog odds premium`,
        ].join('. ')

        shouldSkip = valueRating < 2 // Only bet underdogs with clear value
      } else {
        // Standard lopsided — follow the favorite
        predictedWinner = favorite
        const favNormProb = normProb1 > normProb2 ? normProb1 : normProb2
        confidence = Math.round(clamp(favNormProb * 100, 30, 80) * 10) / 10
        valueRating = clamp(margin * 15, 0, 5)

        reasoning = [
          `Market margin: ${(margin * 100).toFixed(1)}% — standard pricing`,
          `Clear favorite: ${favorite} at ${favOdds}`,
          `Following the market consensus on ${predictedWinner}`,
          `No significant mispricing detected — moderate value at best`,
        ].join('. ')

        shouldSkip = valueRating < 1
      }
    } else {
      // Close to 50/50 — pick the slightly favored side
      predictedWinner = normProb1 >= normProb2 ? match.player1 : match.player2
      const selectedNormProb = normProb1 >= normProb2 ? normProb1 : normProb2
      confidence = Math.round(clamp(selectedNormProb * 100 + 5, 30, 65) * 10) / 10
      valueRating = clamp(margin * 10, 0, 3)

      reasoning = [
        `Market margin: ${(margin * 100).toFixed(1)}% — balanced market`,
        `Near 50/50 matchup: ${match.player1} ${(normProb1 * 100).toFixed(1)}% vs ${match.player2} ${(normProb2 * 100).toFixed(1)}%`,
        `Slight edge to ${predictedWinner} based on normalized probabilities`,
        `Low value opportunity in balanced markets`,
      ].join('. ')

      shouldSkip = valueRating < 0.5
    }
  } else {
    // Low margin (< 5%) — tight market, possibly efficient
    // This is actually good for finding value because the bookmaker
    // is pricing close to true probability

    // In tight markets, look for where implied probability disagrees with odds movement patterns
    predictedWinner = normProb1 >= normProb2 ? match.player1 : match.player2
    const selectedNormProb = normProb1 >= normProb2 ? normProb1 : normProb2

    confidence = Math.round(clamp(selectedNormProb * 100, 30, 70) * 10) / 10

    // Value in tight markets: if margin < 3%, the market is very efficient
    // so value is hard to find
    valueRating = clamp((0.05 - margin) * 20, 0, 3)

    reasoning = [
      `Tight market: ${(margin * 100).toFixed(1)}% margin — highly efficient pricing`,
      `Implied probabilities: ${match.player1} ${(impProb1 * 100).toFixed(1)}%, ${match.player2} ${(impProb2 * 100).toFixed(1)}%`,
      `Normalized: ${match.player1} ${(normProb1 * 100).toFixed(1)}%, ${match.player2} ${(normProb2 * 100).toFixed(1)}%`,
      `Predicting ${predictedWinner} (slight normalized probability edge)`,
      'Efficient market — limited value opportunity',
    ].join('. ')

    shouldSkip = valueRating < 1
  }

  return {
    predictedWinner,
    confidence,
    valueRating: Math.round(valueRating * 10) / 10,
    reasoning,
    shouldSkip,
  }
}
