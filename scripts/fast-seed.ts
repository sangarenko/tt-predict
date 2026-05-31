// Fast seed: generate realistic TT matches + run predictions
// No web scraping — uses known TT circuit data directly
import { PrismaClient } from '@prisma/client'
import { runPredictions } from '../src/lib/predictor'
import crypto from 'crypto'

const db = new PrismaClient()

const leagues = [
  'Liga Pro', 'Setka Cup', 'TT Cup Series', 'Win Cup',
  'Bull Cup', 'Czech Liga Pro',
]

const players: Record<string, string[]> = {
  'Liga Pro': ['Mikhail Zhukov', 'Pavel Favorskiy', 'Dmitry Bakanov', 'Alexey Smirnov', 'Ivan Bragin', 'Sergey Petrov', 'Andrey Korneev', 'Nikolai Loginov', 'Vladislav Makarov', 'Denis Kulikov', 'Roman Litvinov', 'Evgeny Fadeev'],
  'Setka Cup': ['Boris Grozdev', 'Viktor Lebedev', 'Alexei Vasiliev', 'Oleg Sokolov', 'Dmitry Shklovsky', 'Konstantin Belov', 'Pavel Mironov', 'Ilya Sorokin', 'Artur Dementyev', 'Egor Ivanov', 'Maxim Petrov', 'Kirill Nosov'],
  'TT Cup Series': ['Ruslan Chervyakov', 'Dmitry Bobrov', 'Pavel Dyachenko', 'Alexei Yumashev', 'Timur Radionov', 'Sergey Tkach', 'Anton Gutorov', 'Mikhail Orlov'],
  'Win Cup': ['Pavel Platonov', 'Mikhail Korolev', 'Denis Usynin', 'Alexei Sadovnikov', 'Igor Morozov', 'Grigory Vlasov', 'Vitaly Nesterenko', 'Daniil Moskvin'],
  'Bull Cup': ['Aleksandr Kudryavtsev', 'Pavel Kostrov', 'Fedor Kuznetsov', 'Nikita Ryumin', 'Eduard Grachev', 'Maxim Zhuravlev', 'Andrey Smirnov', 'Vasily Yakovlev'],
  'Czech Liga Pro': ['Josef Obdrzalek', 'Lukas Pecha', 'Jan Mikula', 'Tomas Konecny', 'Martin Sevcik', 'David Reznicek', 'Pavel Jansa', 'Roman Skypala'],
}

async function main() {
  console.log('🏓 Fast Seed — Realistic TT Matches')

  const profileCount = await db.aiProfile.count()
  if (profileCount === 0) {
    console.log('Run prisma db seed first!')
    process.exit(1)
  }

  const existing = await db.match.count()
  if (existing > 0) {
    console.log(`DB already has ${existing} matches, skipping seed`)
    await db.$disconnect()
    return
  }

  // Generate upcoming/live matches
  const now = new Date()
  const allMatches: any[] = []

  // 8 upcoming/live
  for (let i = 0; i < 8; i++) {
    const league = leagues[i % leagues.length]
    const pool = players[league]
    const i1 = Math.floor(Math.random() * pool.length)
    let i2 = Math.floor(Math.random() * (pool.length - 1))
    if (i2 >= i1) i2++
    const p1 = pool[i1], p2 = pool[i2]
    const base = 1.15 + Math.random() * 0.85
    const spread = 0.3 + Math.random() * 0.7
    const o1 = Math.round(base * 100) / 100
    const o2 = Math.round((base + spread) * 100) / 100

    allMatches.push({
      player1: p1, player2: p2, league,
      odds1: Math.min(o1, o2), odds2: Math.max(o1, o2),
      status: i < 3 ? 'live' : 'upcoming',
      startTime: new Date(now.getTime() + (i * 30 + Math.random() * 20) * 60000).toISOString(),
      source: 'tt_circuit_2025',
    })
  }

  // 12 finished matches
  const finishedPool = [
    ...players['Liga Pro'].slice(0, 6),
    ...players['Setka Cup'].slice(0, 6),
    ...players['TT Cup Series'].slice(0, 4),
  ]
  for (let i = 0; i < 12; i++) {
    const league = leagues[i % leagues.length]
    const p1 = finishedPool[i]
    const p2 = finishedPool[(i + 3) % finishedPool.length]
    if (p1 === p2) continue
    const s1 = Math.random() > 0.5 ? (Math.random() > 0.3 ? 3 : 2) : 1
    const s2 = s1 >= 3 ? Math.floor(Math.random() * 2) : (Math.random() > 0.5 ? 3 : 2)
    const winner = s1 > s2 ? p1 : p2
    const base = 1.15 + Math.random() * 0.85
    const spread = 0.3 + Math.random() * 0.7
    const o1 = Math.round(base * 100) / 100
    const o2 = Math.round((base + spread) * 100) / 100
    const hoursAgo = 1 + i * 2 + Math.random() * 3

    allMatches.push({
      player1: p1, player2: p2, league,
      odds1: Math.min(o1, o2), odds2: Math.max(o1, o2),
      score1: s1, score2: s2,
      status: 'finished', winner,
      startTime: new Date(now.getTime() - hoursAgo * 3600000).toISOString(),
      source: 'tt_circuit_2025',
    })
  }

  // Save all
  let created = 0
  for (const m of allMatches) {
    const key = `${m.player1}|${m.player2}|${m.league}|${m.source}`
    const extId = `ext_${crypto.createHash('md5').update(key).digest('hex').slice(0, 12)}`
    const start = new Date(m.startTime)
    const s1 = m.score1 ?? 0, s2 = m.score2 ?? 0

    const match = await db.match.create({
      data: {
        externalId: extId, source: m.source, sport: 'table_tennis',
        league: m.league, player1: m.player1, player2: m.player2,
        startTime: start, status: m.status || 'upcoming',
        score1: s1, score2: s2, winner: m.winner || null,
      },
    })
    await db.bookmakerOdds.create({
      data: { matchId: match.id, source: m.source, odds1: m.odds1, odds2: m.odds2 },
    })
    created++
  }

  console.log(`✅ Created ${created} matches`)

  // Run predictions
  console.log('\n🧠 Running AI predictions...')
  try {
    const predResult = await runPredictions()
    console.log(`Bets placed: ${predResult.betsPlaced}, Skipped: ${predResult.betsSkipped}`)
  } catch (e: any) {
    console.log(`Prediction note: ${e.message}`)
  }

  // Summary
  const profiles = await db.aiProfile.findMany({ orderBy: { name: 'asc' } })
  const totalBets = await db.aiBet.count()
  console.log(`\n📊 ${await db.match.count()} matches, ${totalBets} bets`)
  for (const p of profiles) {
    const profit = p.currentAmount - p.initialAmount
    console.log(`  ${p.emoji} ${p.name}: ${p.currentAmount.toFixed(0)}₽ (${profit >= 0 ? '+' : ''}${profit.toFixed(0)}₽)`)
  }

  console.log('\n✅ Fast seed complete!')
  await db.$disconnect()
}

main().catch(async (err) => {
  console.error('Error:', err)
  await db.$disconnect()
  process.exit(1)
})
