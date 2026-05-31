import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const profiles = await db.aiProfile.findMany()

    const initialAmount = profiles.reduce((sum, p) => sum + p.initialAmount, 0)
    const currentAmount = profiles.reduce((sum, p) => sum + p.currentAmount, 0)
    const peakAmount = profiles.reduce((sum, p) => sum + p.peakAmount, 0)
    const flatAmount = profiles.reduce((sum, p) => sum + p.flatAmount, 0)

    const totalBets = profiles.reduce((sum, p) => sum + p.totalBets, 0)
    const wonBets = profiles.reduce((sum, p) => sum + p.wonBets, 0)
    const lostBets = profiles.reduce((sum, p) => sum + p.lostBets, 0)
    const pendingBets = profiles.reduce((sum, p) => sum + p.pendingBets, 0)
    const settledBets = wonBets + lostBets

    const totalProfit = currentAmount - initialAmount
    const winRate = settledBets > 0 ? (wonBets / settledBets) * 100 : 0

    // Turnover = sum of all stakes
    const allBets = await db.aiBet.findMany()
    const turnover = allBets.reduce((sum, b) => sum + b.stake, 0)

    const yieldPct = turnover > 0 ? (totalProfit / turnover) * 100 : 0
    const drawdownPct =
      peakAmount > 0 ? ((peakAmount - currentAmount) / peakAmount) * 100 : 0

    // Stop loss active if any profile has drawdown >= its stopLossPct
    let stopLossActive = false
    for (const p of profiles) {
      const pDrawdown =
        p.peakAmount > 0
          ? ((p.peakAmount - p.currentAmount) / p.peakAmount) * 100
          : 0
      if (pDrawdown >= p.stopLossPct) {
        stopLossActive = true
        break
      }
    }

    return NextResponse.json({
      currentAmount: Math.round(currentAmount * 100) / 100,
      initialAmount: Math.round(initialAmount * 100) / 100,
      peakAmount: Math.round(peakAmount * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      winRate: Math.round(winRate * 100) / 100,
      yield: Math.round(yieldPct * 100) / 100,
      turnover: Math.round(turnover * 100) / 100,
      totalBets,
      wonBets,
      lostBets,
      pendingBets,
      drawdownPct: Math.round(drawdownPct * 100) / 100,
      stopLossActive,
      flatAmount: Math.round(flatAmount * 100) / 100,
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to fetch AI bankroll' }, { status: 500 })
  }
}
