import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const bets = await db.aiBet.findMany({
      include: {
        profile: {
          select: { name: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    const result = bets.map((bet) => ({
      ...bet,
      profileName: bet.profile.name,
    }))

    return NextResponse.json(result)
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Failed to fetch AI bets' }, { status: 500 })
  }
}
