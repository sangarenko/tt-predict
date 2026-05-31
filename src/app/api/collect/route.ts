import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'

// POST /api/collect — receive real matches from external collectors
// Body: { matches: Array<{ player1, player2, league, odds1, odds2, score1?, score2?, status?, startTime?, externalId?, source? }> }
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const matches: Array<{
      player1: string
      player2: string
      league?: string
      odds1: number
      odds2: number
      score1?: number
      score2?: number
      status?: string
      startTime?: string
      externalId?: string
      source?: string
      winner?: string
    }> = body.matches || []

    if (!Array.isArray(matches) || matches.length === 0) {
      return NextResponse.json({ error: 'No matches provided' }, { status: 400 })
    }

    const source = body.source || 'external'
    let created = 0
    let updated = 0
    let skipped = 0

    for (const m of matches) {
      if (!m.player1 || !m.player2 || !m.odds1 || !m.odds2) {
        skipped++
        continue
      }

      // Generate external ID if not provided
      const key = `${m.player1}|${m.player2}|${m.league || ''}|${source}`
      const externalId = m.externalId || `ext_${crypto.createHash('md5').update(key).digest('hex').slice(0, 12)}`

      // Dedup: check if match already exists
      const existing = await db.match.findFirst({
        where: { externalId },
        include: { odds: true },
      })

      if (existing) {
        // Update scores/status if changed
        const needsUpdate =
          (m.score1 !== undefined && m.score1 !== existing.score1) ||
          (m.score2 !== undefined && m.score2 !== existing.score2) ||
          (m.status && m.status !== existing.status)

        if (needsUpdate) {
          const winner = m.winner || (m.score1 !== undefined && m.score2 !== undefined
            ? (m.score1 > m.score2 ? m.player1 : m.score2 > m.score1 ? m.player2 : null)
            : existing.winner)

          await db.match.update({
            where: { id: existing.id },
            data: {
              score1: m.score1 ?? existing.score1,
              score2: m.score2 ?? existing.score2,
              status: m.status || existing.status,
              winner,
            },
          })

          // Update odds
          if (existing.odds[0]) {
            await db.bookmakerOdds.update({
              where: { id: existing.odds[0].id },
              data: { odds1: m.odds1, odds2: m.odds2 },
            })
          }
          updated++
        } else {
          skipped++
        }
        continue
      }

      // Parse start time
      const startTime = m.startTime ? new Date(m.startTime) : new Date()

      // Determine winner from scores if match is finished
      const status = m.status || 'upcoming'
      const score1 = m.score1 ?? 0
      const score2 = m.score2 ?? 0
      const winner = m.winner || (status === 'finished'
        ? (score1 > score2 ? m.player1 : score2 > score1 ? m.player2 : null)
        : null)

      // Create new match
      const match = await db.match.create({
        data: {
          externalId,
          source: source,
          sport: 'table_tennis',
          league: m.league || null,
          player1: m.player1,
          player2: m.player2,
          startTime,
          status,
          score1,
          score2,
          winner,
        },
      })

      await db.bookmakerOdds.create({
        data: {
          matchId: match.id,
          source,
          odds1: m.odds1,
          odds2: m.odds2,
        },
      })

      created++
    }

    // Log the collection
    await db.collectionLog.create({
      data: {
        source,
        status: 'success',
        matchesFound: matches.length,
        matchesCollected: created + updated,
        matchesNew: created,
        matchesUpdated: updated,
        duration: 0,
      },
    })

    return NextResponse.json({
      success: true,
      created,
      updated,
      skipped,
      total: matches.length,
    })
  } catch (error) {
    console.error('Collect API error:', error)

    await db.collectionLog.create({
      data: {
        source: 'api',
        status: 'error',
        matchesFound: 0,
        matchesCollected: 0,
        matchesNew: 0,
        matchesUpdated: 0,
        duration: 0,
        error: String(error),
      },
    }).catch(() => {})

    return NextResponse.json({ error: 'Failed to collect matches' }, { status: 500 })
  }
}

// GET /api/collect — trigger auto-collection (scrape from web)
export async function GET() {
  try {
    const { scrapeLiveMatches } = await import('@/lib/collector')
    const result = await scrapeLiveMatches()
    return NextResponse.json(result)
  } catch (error) {
    console.error('Auto-collect error:', error)
    return NextResponse.json({ error: 'Auto-collection not available' }, { status: 503 })
  }
}
