import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const [allBets, allMatches, liveMatches, upcomingMatches, finishedMatches] =
      await Promise.all([
        db.aiBet.findMany(),
        db.match.findMany(),
        db.match.count({ where: { status: 'live' } }),
        db.match.count({ where: { status: 'upcoming' } }),
        db.match.count({ where: { status: 'finished' } }),
      ])

    const totalBets = allBets.length
    const totalMatches = allMatches.length

    const settledBets = allBets.filter(
      (b) => b.status === 'won' || b.status === 'lost' || b.status === 'void'
    )
    const wonBets = allBets.filter((b) => b.status === 'won')
    const correctPredictions = wonBets.length

    const winRate =
      settledBets.length > 0 ? (wonBets.length / settledBets.length) * 100 : 0

    const totalProfit = allBets.reduce((sum, b) => sum + b.profit, 0)

    const avgConfidence =
      totalBets > 0
        ? allBets.reduce((sum, b) => sum + b.confidence, 0) / totalBets
        : 0

    return NextResponse.json({
      totalMatches,
      totalBets,
      winRate: Math.round(winRate * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      liveMatches,
      upcomingMatches,
      finishedMatches,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      correctPredictions,
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
