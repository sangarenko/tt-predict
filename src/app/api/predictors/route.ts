import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const predictors = await db.predictor.findMany()
    return NextResponse.json(predictors)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to fetch predictors' }, { status: 500 })
  }
}
