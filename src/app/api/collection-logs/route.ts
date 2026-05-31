import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const logs = await db.collectionLog.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json(logs)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to fetch collection logs' }, { status: 500 })
  }
}
