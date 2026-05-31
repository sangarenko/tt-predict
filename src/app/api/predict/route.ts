// ========================================
// Prediction API Route
// POST /api/predict
// 
// Actions:
//   - predict: Run all strategies and place bets (default)
//   - settle:  Settle finished match bets
//   - all:     Settle first, then predict
// ========================================

import { NextResponse } from 'next/server'
import { runPredictions, settleBets } from '@/lib/predictor'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const action = body.action || 'predict'

    if (action === 'settle') {
      const result = await settleBets()
      return NextResponse.json({ action: 'settle', ...result })
    }

    if (action === 'all') {
      // Settle finished matches first, then run predictions
      const settleResult = await settleBets()
      const predictResult = await runPredictions()
      return NextResponse.json({ action: 'all', settle: settleResult, predict: predictResult })
    }

    // Default: just run predictions
    const result = await runPredictions()
    return NextResponse.json({ action: 'predict', ...result })
  } catch (error) {
    console.error('Predict API error:', error)
    return NextResponse.json({ error: 'Prediction failed' }, { status: 500 })
  }
}
