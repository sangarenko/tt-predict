import { create } from 'zustand'

// ============ TYPES ============

export interface Prediction {
  predictorId?: string
  predictedWinner?: string
  confidence?: number
}

export interface Match {
  id: string
  player1: string
  player2: string
  tournament?: string
  startTime: string
  status: string
  odds1?: number
  odds2?: number
  source?: string
  sport?: string
  league?: string
  score1?: number
  score2?: number
  winner?: string
  predictions?: Prediction[]
}

export interface AiBet {
  id: string
  matchId: string
  player1: string
  player2: string
  predictedWinner: string
  confidence: number
  valueRating: number
  odds: number
  stake: number
  potentialWin: number
  profit: number
  status: string
  reasoning: string
  profileId: string
  profileName: string
  createdAt: string
  settledAt?: string | null
}

export interface Stats {
  totalMatches: number
  correctPredictions: number
  avgConfidence: number
  winRate: number
  totalBets: number
  totalProfit: number
  liveMatches: number
  upcomingMatches: number
  finishedMatches: number
}

export interface BankrollState {
  currentAmount: number
  initialAmount: number
  peakAmount: number
  totalProfit: number
  totalBets: number
  wonBets: number
  lostBets: number
  pendingBets: number
  winRate: number
  yield: number
}

export interface AiBankrollState {
  id?: string
  currentAmount: number
  initialAmount: number
  peakAmount: number
  totalProfit: number
  winRate: number
  yield: number
  turnover: number
  totalBets: number
  wonBets: number
  lostBets: number
  pendingBets: number
  drawdownPct: number
  stopLossActive: boolean
  flatAmount: number
}

export interface Predictor {
  id: string
  name: string
  platform?: string
  tier: string
  accuracy: number
  totalPredictions: number
  verified: boolean
  bio?: string
  avatarEmoji?: string
  followers?: number
  currentStreak?: number
}

export interface CollectionLog {
  id: string
  source: string
  matchesCollected: number
  status: string
  createdAt: string
}

export interface AiProfile {
  id: string
  name: string
  emoji: string
  description: string
  color: string
  strategy: string
  isActive: boolean
  initialAmount: number
  currentAmount: number
  peakAmount: number
  totalBets: number
  wonBets: number
  lostBets: number
  pendingBets: number
  skippedBets: number
  totalProfit?: number
  turnover?: number
  yieldPct?: number
  winRate?: number
  settled?: number
  drawdownPct?: number
  stopLossActive?: boolean
  recentBets?: any[]
}

export interface Tipster {
  id: string
  username: string
  displayName: string
  platform: string
  avatarUrl: string
  bio: string
  totalPredictions: number
  wins: number
  losses: number
  voids: number
  deletedBets: number
  editsAfterPost: number
  realWinRate: number
  claimedWinRate: number
  scamScore: number
  trustLevel: number
  profitIfFollowed: number
  tips: any[]
}

// ============ STORE STATE ============

interface TTStore {
  matches: Match[]
  aiBets: AiBet[]
  stats: Stats | null
  bankroll: BankrollState | null
  aiBankroll: AiBankrollState | null
  predictors: Predictor[]
  collectionLogs: CollectionLog[]
  aiProfiles: AiProfile[]
  tipsters: Tipster[]

  loading: boolean
  activeTab: string
  lastFetch: number | null

  setActiveTab: (tab: string) => void
  fetchMatches: () => Promise<void>
  fetchAiBets: () => Promise<void>
  fetchStats: () => Promise<void>
  fetchBankroll: () => Promise<void>
  fetchAiBankroll: () => Promise<void>
  fetchPredictors: () => Promise<void>
  fetchCollectionLogs: () => Promise<void>
  fetchAiProfiles: () => Promise<void>
  fetchTipsters: () => Promise<void>
  fetchAll: () => Promise<void>
}

// ============ STORE ============

export const useTTStore = create<TTStore>((set, get) => ({
  matches: [],
  aiBets: [],
  stats: null,
  bankroll: null,
  aiBankroll: null,
  predictors: [],
  collectionLogs: [],
  aiProfiles: [],
  tipsters: [],
  loading: false,
  activeTab: 'overview',
  lastFetch: null,

  setActiveTab: (tab: string) => set({ activeTab: tab }),

  fetchMatches: async () => {
    try {
      const res = await fetch('/api/matches')
      if (res.ok) set({ matches: await res.json() })
    } catch (e) {
      console.error('fetchMatches error:', e)
    }
  },

  fetchAiBets: async () => {
    try {
      const res = await fetch('/api/ai-bets')
      if (res.ok) set({ aiBets: await res.json() })
    } catch (e) {
      console.error('fetchAiBets error:', e)
    }
  },

  fetchStats: async () => {
    try {
      const res = await fetch('/api/stats')
      if (res.ok) set({ stats: await res.json() })
    } catch (e) {
      console.error('fetchStats error:', e)
    }
  },

  fetchBankroll: async () => {
    try {
      const res = await fetch('/api/bankroll')
      if (res.ok) set({ bankroll: await res.json() })
    } catch (e) {
      console.error('fetchBankroll error:', e)
    }
  },

  fetchAiBankroll: async () => {
    try {
      const res = await fetch('/api/ai-bankroll')
      if (res.ok) set({ aiBankroll: await res.json() })
    } catch (e) {
      console.error('fetchAiBankroll error:', e)
    }
  },

  fetchPredictors: async () => {
    try {
      const res = await fetch('/api/predictors')
      if (res.ok) set({ predictors: await res.json() })
    } catch (e) {
      console.error('fetchPredictors error:', e)
    }
  },

  fetchCollectionLogs: async () => {
    try {
      const res = await fetch('/api/collection-logs')
      if (res.ok) set({ collectionLogs: await res.json() })
    } catch (e) {
      console.error('fetchCollectionLogs error:', e)
    }
  },

  fetchAiProfiles: async () => {
    try {
      const res = await fetch('/api/ai-profiles')
      if (res.ok) set({ aiProfiles: await res.json() })
    } catch (e) {
      console.error('fetchAiProfiles error:', e)
    }
  },

  fetchTipsters: async () => {
    try {
      const res = await fetch('/api/tipsters')
      if (res.ok) set({ tipsters: await res.json() })
    } catch (e) {
      console.error('fetchTipsters error:', e)
    }
  },

  fetchAll: async () => {
    set({ loading: true })
    try {
      await Promise.all([
        get().fetchMatches(),
        get().fetchAiBets(),
        get().fetchStats(),
        get().fetchBankroll(),
        get().fetchAiBankroll(),
        get().fetchPredictors(),
        get().fetchCollectionLogs(),
        get().fetchAiProfiles(),
        get().fetchTipsters(),
      ])
      set({ lastFetch: Date.now() })
    } catch (e) {
      console.error('fetchAll error:', e)
    } finally {
      set({ loading: false })
    }
  },
}))
