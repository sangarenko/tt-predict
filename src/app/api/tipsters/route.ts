import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const tipsters = await db.tipster.findMany()
    return NextResponse.json(tipsters)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to fetch tipsters' }, { status: 500 })
  }
}
