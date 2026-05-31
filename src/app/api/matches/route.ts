import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)

    const matches = await db.match.findMany({
      where: {
        OR: [
          { status: { not: 'finished' } },
          {
            status: 'finished',
            startTime: { gte: fortyEightHoursAgo },
          },
        ],
      },
      include: {
        odds: true,
      },
      orderBy: {
        startTime: 'desc',
      },
    })

    return NextResponse.json(matches)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 })
  }
}
