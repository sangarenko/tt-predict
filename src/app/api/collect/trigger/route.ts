import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scrapeLiveMatches } from '@/lib/collector'

// POST /api/collect/trigger — scrape real TT matches and save to DB
export async function POST() {
  try {
    console.log('[trigger] Starting collection trigger...')

    // 1. Scrape live matches
    const result = await scrapeLiveMatches()

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error,
        duration: result.duration,
      }, { status: 500 })
    }

    if (result.matches.length === 0) {
      // Log the collection attempt even if no matches found
      await db.collectionLog.create({
        data: {
          source: result.source,
          status: 'success',
          matchesFound: 0,
          matchesCollected: 0,
          matchesNew: 0,
          matchesUpdated: 0,
          duration: result.duration,
          error: 'No matches found — try Python collectors for more data',
        },
      })

      return NextResponse.json({
        success: true,
        created: 0,
        updated: 0,
        message: 'No live matches found. The Python collectors (real_collector.py) provide more comprehensive data from BetBoom.',
        duration: result.duration,
      })
    }

    // 2. Save matches to DB via collect API logic
    let created = 0
    let updated = 0

    for (const m of result.matches) {
      // Check for existing match with same players
      const existing = await db.match.findFirst({
        where: {
          AND: [
            { player1: { contains: m.player1.split(' ')[0] } },
            { player2: { contains: m.player2.split(' ')[0] } },
          ],
        },
        include: { odds: true },
      })

      if (existing) {
        // Update if scores changed
        if (m.score1 !== undefined && (m.score1 !== existing.score1 || m.score2 !== existing.score2)) {
          const winner = m.status === 'finished'
            ? (m.score1! > m.score2! ? existing.player1 : m.score2! > m.score1! ? existing.player2 : null)
            : existing.winner

          await db.match.update({
            where: { id: existing.id },
            data: {
              score1: m.score1,
              score2: m.score2 ?? existing.score2,
              status: m.status || existing.status,
              winner,
            },
          })
          updated++
        }
        continue
      }

      // Create new match
      const startTime = m.startTime ? new Date(m.startTime) : new Date()

      const match = await db.match.create({
        data: {
          source: m.source || result.source,
          sport: 'table_tennis',
          league: m.league || null,
          player1: m.player1,
          player2: m.player2,
          startTime,
          status: m.status || 'live',
          score1: m.score1 ?? 0,
          score2: m.score2 ?? 0,
          winner: m.winner || null,
        },
      })

      await db.bookmakerOdds.create({
        data: {
          matchId: match.id,
          source: m.source || result.source,
          odds1: m.odds1,
          odds2: m.odds2,
        },
      })

      created++
    }

    // 3. Log the collection
    await db.collectionLog.create({
      data: {
        source: result.source,
        status: 'success',
        matchesFound: result.matches.length,
        matchesCollected: created + updated,
        matchesNew: created,
        matchesUpdated: updated,
        duration: result.duration,
      },
    })

    // 4. Run predictions on new matches
    let predictionResult = null
    try {
      const { runPredictions } = await import('@/lib/predictor')
      predictionResult = await runPredictions()
    } catch (predError) {
      console.error('[trigger] Prediction failed:', predError)
    }

    return NextResponse.json({
      success: true,
      scraped: result.matches.length,
      created,
      updated,
      predictions: predictionResult ? {
        betsPlaced: predictionResult.betsPlaced,
        betsSkipped: predictionResult.betsSkipped,
      } : null,
      duration: result.duration,
    })
  } catch (error) {
    console.error('[trigger] Error:', error)
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
