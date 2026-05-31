import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const profiles = await db.aiProfile.findMany({
      include: {
        aiBets: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    })

    const result = profiles.map((p) => {
      const settled = p.wonBets + p.lostBets
      const winRate = settled > 0 ? (p.wonBets / settled) * 100 : 0
      const totalProfit = p.currentAmount - p.initialAmount

      // Calculate turnover from all bets for yield
      const totalStake = p.aiBets.reduce((sum, b) => sum + b.stake, 0)
      const yieldPct = totalStake > 0 ? (totalProfit / totalStake) * 100 : 0

      const drawdownPct =
        p.peakAmount > 0
          ? ((p.peakAmount - p.currentAmount) / p.peakAmount) * 100
          : 0

      const stopLossActive = drawdownPct >= p.stopLossPct

      return {
        ...p,
        recentBets: p.aiBets,
        aiBets: undefined,
        winRate: Math.round(winRate * 100) / 100,
        yieldPct: Math.round(yieldPct * 100) / 100,
        totalProfit: Math.round(totalProfit * 100) / 100,
        drawdownPct: Math.round(drawdownPct * 100) / 100,
        stopLossActive,
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to fetch AI profiles' }, { status: 500 })
  }
}
