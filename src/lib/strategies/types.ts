// ========================================
// Strategy Type Definitions
// Shared interfaces for all AI betting strategies
// ========================================

/** Full context passed to each strategy for analysis */
export interface StrategyContext {
  match: {
    id: string
    player1: string
    player2: string
    league: string
    odds1: number
    odds2: number
    score1: number
    score2: number
    status: string
    startTime: Date
  }
  /** Historical bets placed by this specific profile */
  historicalBets: Array<{
    player1: string
    player2: string
    predictedWinner: string
    won: boolean
    confidence: number
    createdAt: Date
  }>
  /** All finished matches with results (for general analysis) */
  allMatches: Array<{
    player1: string
    player2: string
    winner?: string
    score1: number
    score2: number
    league: string
    odds1?: number
    odds2?: number
    createdAt: Date
  }>
  /** The AI profile executing this strategy */
  profile: {
    id: string
    name: string
    currentAmount: number
    initialAmount: number
    peakAmount: number
    flatAmount: number
    stopLossPct: number
    totalBets: number
    wonBets: number
    lostBets: number
  }
}

/** Result returned by every strategy function */
export interface StrategyResult {
  predictedWinner: string  // player1 or player2 name
  confidence: number      // 0-100
  valueRating: number      // how much value (0-5)
  reasoning: string
  shouldSkip: boolean      // if true, don't bet
}

/** Final bet recommendation ready to be placed */
export interface BetRecommendation {
  matchId: string
  profileId: string
  player1: string
  player2: string
  predictedWinner: string
  confidence: number
  valueRating: number
  odds: number
  stake: number
  potentialWin: number
  strategy: string
  reasoning: string
}
