// ========================================
// Live Match Collector
// Scrapes real TT match data using z-ai-web-dev-sdk
// (web-search + web-reader for odds and results)
// ========================================

import ZAI from 'z-ai-web-dev-sdk'

interface RawMatch {
  player1: string
  player2: string
  league?: string
  odds1: number
  odds2: number
  score1?: number
  score2?: number
  status?: string
  startTime?: string
  source?: string
  winner?: string
}

interface CollectResult {
  success: boolean
  matches: RawMatch[]
  source: string
  error?: string
  duration: number
}

// TT match regex patterns for parsing scraped pages
const TT_PLAYER_RE = /^[A-Z\u0410-\u042f][a-z\u0430-\u044f\u00c0-\u017f]+(?:\s[A-Z\u0410-\u042f][a-z\u0430-\u044f\u00c0-\u017f]+)*$/
const ODDS_RE = /^\d+\.\d+$/
const SCORE_RE = /^[0-3]:[0-3]$/

// Known TT leagues for filtering
const TT_LEAGUES = [
  'setka cup', 'tt cup', 'tt elite series', 'liga pro',
  'czech liga pro', 'win cup', 'bull cup', 'star cup',
  'premier tt', 'pro table tennis', 'super liga',
  'tt star series', 'winners cup', 'baltic league',
]

function isTTLeague(text: string): boolean {
  const lower = text.toLowerCase()
  return TT_LEAGUES.some(l => lower.includes(l)) ||
    (lower.includes('cup') && lower.includes('tt')) ||
    (lower.includes('liga') && lower.includes('pro')) ||
    (lower.includes('table tennis'))
}

/**
 * Scrape live TT matches from a web page using z-ai page_reader.
 * Tries multiple known TT data sources.
 */
async function scrapeFromUrl(url: string, source: string): Promise<RawMatch[]> {
  const zai = await ZAI.create()
  
  try {
    const result = await zai.functions.invoke('page_reader', { url })
    const html = result.data?.html || ''
    const text = result.data?.html?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || ''
    
    // Parse matches from the text content
    const matches = parseMatchesFromText(text, source)
    
    if (matches.length > 0) {
      console.log(`[collector] Scraped ${matches.length} matches from ${url}`)
    }
    
    return matches
  } catch (error) {
    console.error(`[collector] Failed to scrape ${url}:`, error)
    return []
  }
}

/**
 * Parse match data from extracted text content.
 * Looks for patterns like: PlayerName vs PlayerName @ odds/odds
 */
function parseMatchesFromText(text: string, source: string): RawMatch[] {
  const matches: RawMatch[] = []
  const words = text.split(/\s+/)
  
  // Strategy: find pairs of proper names followed by odds
  let i = 0
  while (i < words.length) {
    // Try to find a player name
    if (isPlayerName(words[i]) && i + 1 < words.length && isPlayerName(words[i + 1])) {
      const p1 = words[i]
      const p2Candidate = words[i + 1]
      
      // Skip if same name
      if (p1 === p2Candidate) { i++; continue }
      
      // Look ahead for odds pattern
      let j = i + 2
      let odds1 = 0, odds2 = 0
      let score1: number | undefined, score2: number | undefined
      let league = ''
      
      while (j < Math.min(i + 15, words.length)) {
        const w = words[j]
        
        // Check for score like 2:1
        if (/^\d+:\d+$/.test(w)) {
          const parts = w.split(':')
          score1 = parseInt(parts[0])
          score2 = parseInt(parts[1])
          j++
          continue
        }
        
        // Check for odds (decimal number > 1)
        if (ODDS_RE.test(w)) {
          const val = parseFloat(w)
          if (val >= 1.01 && val <= 20) {
            if (odds1 === 0) odds1 = val
            else if (odds2 === 0) odds2 = val
          }
          j++
          continue
        }
        
        // Check for "vs" separator
        if (w.toLowerCase() === 'vs' || w === '-' || w === '–') {
          j++
          continue
        }
        
        // Stop if we hit another player name (next match)
        if (isPlayerName(w) && j > i + 2) break
        
        j++
      }
      
      // Only add if we found both odds
      if (odds1 > 0 && odds2 > 0) {
        matches.push({
          player1: p1,
          player2: p2Candidate,
          odds1,
          odds2,
          score1,
          score2,
          status: (score1 !== undefined && score2 !== undefined && (score1 >= 2 || score2 >= 2)) ? 'finished' : 'live',
          source,
        })
      }
      
      i = j
    } else {
      i++
    }
  }
  
  return matches
}

function isPlayerName(word: string): boolean {
  if (!word || word.length < 3 || word.length > 40) return false
  // Must start with uppercase
  if (!/^[A-Z\u0410-\u042f]/.test(word)) return false
  // Must have at least one lowercase letter
  if (!/[a-z\u0430-\u044f]/.test(word.slice(1))) return false
  // Exclude common non-name words
  const exclude = ['table', 'tennis', 'live', 'match', 'odds', 'bet', 'win', 'cup', 
    'liga', 'pro', 'series', 'elite', 'premier', 'the', 'and', 'for', 'with',
    'setka', 'bull', 'star', 'baltic', 'czech', 'super', 'winner']
  if (exclude.includes(word.toLowerCase())) return false
  return true
}

/**
 * Search for live TT matches using web search, then scrape the best results.
 */
async function searchAndScrape(): Promise<RawMatch[]> {
  const zai = await ZAI.create()
  const allMatches: RawMatch[] = []
  
  // Search for today's live TT matches
  const searchQueries = [
    'table tennis live matches today odds',
    'table tennis live score today Setka Cup Liga Pro',
  ]
  
  for (const query of searchQueries) {
    try {
      const results = await zai.functions.invoke('web_search', {
        query,
        num: 5,
        recency_days: 1,
      })
      
      // Try to scrape each result
      for (const item of results.slice(0, 3)) {
        if (item.url) {
          const matches = await scrapeFromUrl(item.url, 'web_search')
          allMatches.push(...matches)
        }
      }
      
      // Also try to parse from snippets
      for (const item of results) {
        if (item.snippet) {
          const matches = parseMatchesFromText(item.snippet, 'snippet')
          allMatches.push(...matches)
        }
      }
    } catch (error) {
      console.error(`[collector] Search failed for "${query}":`, error)
    }
  }
  
  return allMatches
}

/**
 * Scrape specific TT data sources known to have live match data.
 */
async function scrapeKnownSources(): Promise<RawMatch[]> {
  const allMatches: RawMatch[] = []
  
  // Known TT live data pages
  const sources = [
    { url: 'https://www.flashscore.com/table-tennis/', source: 'flashscore' },
    { url: 'https://www.sofascore.com/table-tennis', source: 'sofascore' },
    { url: 'https://www.oddsportal.com/table-tennis/', source: 'oddsportal' },
  ]
  
  // Try each source (some may be blocked)
  for (const { url, source } of sources) {
    const matches = await scrapeFromUrl(url, source)
    allMatches.push(...matches)
  }
  
  return allMatches
}

/**
 * Deduplicate matches by player pair (normalize names).
 */
function deduplicateMatches(matches: RawMatch[]): RawMatch[] {
  const seen = new Set<string>()
  return matches.filter(m => {
    const key = `${m.player1.toLowerCase()}|${m.player2.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Filter matches to only include valid TT matches with reasonable odds.
 */
function filterValidMatches(matches: RawMatch[]): RawMatch[] {
  return matches.filter(m => {
    // Both players must exist
    if (!m.player1 || !m.player2) return false
    if (m.player1 === m.player2) return false
    // Odds must be reasonable (between 1.01 and 15)
    if (m.odds1 < 1.01 || m.odds1 > 15) return false
    if (m.odds2 < 1.01 || m.odds2 > 15) return false
    // Sum of implied probabilities shouldn't be too far from 100%
    const impSum = (1 / m.odds1) + (1 / m.odds2)
    if (impSum < 1.5 || impSum > 3.0) return false
    return true
  })
}

/**
 * Main collector function — tries all sources and returns deduplicated, validated matches.
 */
export async function scrapeLiveMatches(): Promise<CollectResult> {
  const start = Date.now()
  
  try {
    console.log('[collector] Starting live match collection...')
    
    // Collect from all sources in parallel
    const [searchMatches, knownMatches] = await Promise.allSettled([
      searchAndScrape(),
      scrapeKnownSources(),
    ])
    
    let allMatches: RawMatch[] = []
    
    if (searchMatches.status === 'fulfilled') {
      allMatches.push(...searchMatches.value)
    }
    if (knownMatches.status === 'fulfilled') {
      allMatches.push(...knownMatches.value)
    }
    
    console.log(`[collector] Raw matches collected: ${allMatches.length}`)
    
    // Filter and deduplicate
    const valid = filterValidMatches(allMatches)
    const deduped = deduplicateMatches(valid)
    
    console.log(`[collector] Valid matches: ${valid.length}, After dedup: ${deduped.length}`)
    
    // If no real matches found, return empty
    if (deduped.length === 0) {
      console.log('[collector] No real matches found — data will come from Python collectors or API')
      return {
        success: true,
        matches: [],
        source: 'web_collect',
        duration: Date.now() - start,
      }
    }
    
    return {
      success: true,
      matches: deduped,
      source: 'web_collect',
      duration: Date.now() - start,
    }
  } catch (error) {
    console.error('[collector] Collection failed:', error)
    return {
      success: false,
      matches: [],
      source: 'web_collect',
      error: String(error),
      duration: Date.now() - start,
    }
  }
}
