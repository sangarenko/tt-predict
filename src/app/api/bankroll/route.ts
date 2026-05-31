import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const bets = await db.aiBet.findMany()

    const totalBets = bets.length
    const wonBets = bets.filter((b) => b.status === 'won').length
    const lostBets = bets.filter((b) => b.status === 'lost').length
    const pendingBets = bets.filter((b) => b.status === 'pending').length
    const settledBets = wonBets + lostBets

    const winRate =
      settledBets > 0 ? (wonBets / settledBets) * 100 : 0

    const totalProfit = bets.reduce((sum, b) => sum + b.profit, 0)

    const totalStaked = bets.reduce((sum, b) => sum + b.stake, 0)
    const yieldPct = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0

    // Use profile data to determine initial/current/peak
    const profiles = await db.aiProfile.findMany()
    const initialAmount = profiles.reduce((sum, p) => sum + p.initialAmount, 0)
    const currentAmount = profiles.reduce((sum, p) => sum + p.currentAmount, 0)
    const peakAmount = profiles.reduce((sum, p) => sum + p.peakAmount, 0)

    return NextResponse.json({
      currentAmount: Math.round(currentAmount * 100) / 100,
      initialAmount: Math.round(initialAmount * 100) / 100,
      peakAmount: Math.round(peakAmount * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      totalBets,
      wonBets,
      lostBets,
      pendingBets,
      winRate: Math.round(winRate * 100) / 100,
      yield: Math.round(yieldPct * 100) / 100,
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to fetch bankroll' }, { status: 500 })
  }
}
