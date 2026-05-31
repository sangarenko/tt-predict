import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Clean existing data
  await db.aiBet.deleteMany()
  await db.prediction.deleteMany()
  await db.bookmakerOdds.deleteMany()
  await db.valueBet.deleteMany()
  await db.match.deleteMany()
  await db.collectionLog.deleteMany()
  await db.tipster.deleteMany()
  await db.predictor.deleteMany()
  await db.aiProfile.deleteMany()

  // 5 AI Profiles — each starts with 1000₽
  const profiles = await db.aiProfile.createMany({
    data: [
      {
        name: 'Эло-Мастер',
        emoji: '📊',
        description: 'Elo-rating based predictions. Calculates player strength from historical match results, adjusts for form and recency.',
        color: '#10b981',
        strategy: 'elo',
        initialAmount: 1000,
        currentAmount: 1000,
        peakAmount: 1000,
        flatAmount: 20,
        stopLossPct: 30,
        isActive: true,
      },
      {
        name: 'Тренд-Хантер',
        emoji: '🔥',
        description: 'Momentum and trend detection. Identifies hot/cold streaks, recent form patterns, and momentum shifts.',
        color: '#f59e0b',
        strategy: 'trend',
        initialAmount: 1000,
        currentAmount: 1000,
        peakAmount: 1000,
        flatAmount: 20,
        stopLossPct: 30,
        isActive: true,
      },
      {
        name: 'Лига-Эксперт',
        emoji: '🏆',
        description: 'League/tournament specific analysis. Specializes in league-level statistics, home/away advantages, and tournament structures.',
        color: '#8b5cf6',
        strategy: 'league',
        initialAmount: 1000,
        currentAmount: 1000,
        peakAmount: 1000,
        flatAmount: 20,
        stopLossPct: 30,
        isActive: true,
      },
      {
        name: 'Догонщик',
        emoji: '⚡',
        description: 'Chase/Martingale variant with smart loss recovery. Uses controlled bankroll management after losses.',
        color: '#ef4444',
        strategy: 'chase',
        initialAmount: 1000,
        currentAmount: 1000,
        peakAmount: 1000,
        flatAmount: 20,
        stopLossPct: 30,
        isActive: true,
      },
      {
        name: 'Арбитражёр',
        emoji: '💰',
        description: 'Value betting and arbitrage scanner. Finds mispriced odds and value opportunities across markets.',
        color: '#06b6d4',
        strategy: 'arbitrage',
        initialAmount: 1000,
        currentAmount: 1000,
        peakAmount: 1000,
        flatAmount: 20,
        stopLossPct: 30,
        isActive: true,
      },
    ],
  })
  console.log(`✅ Created ${profiles.count} AI profiles (1000₽ each)`)

  // Seed some sample matches
  const now = new Date()
  const leagues = ['TT Cup', 'TT Elite Series', 'Setka Cup', 'Лига Про']
  const playerPairs = [
    ['Гузи Кароль', 'Запала Кшиштоф'],
    ['Барон Мариуш', 'Крупа Себастьян'],
    ['Перетятько Андрей', 'Яковенко Антон'],
    ['Йирасек Мартин', 'Клюсачек Патрик'],
    ['Молдан Томаш', 'Шиманский Пшемыслав'],
    ['Бобровицкий Мирослав', 'Влодарчик Михал'],
    ['Колесников Дмитрий', 'Громов Алексей'],
    ['Литвинов Сергей', 'Федоров Андрей'],
  ]

  for (let i = 0; i < playerPairs.length; i++) {
    const [p1, p2] = playerPairs[i]
    const startTime = new Date(now.getTime() + (i * 15 + Math.random() * 30) * 60000)
    const league = leagues[i % leagues.length]
    const status = i < 2 ? 'live' : 'upcoming'
    const odds1 = parseFloat((1.3 + Math.random() * 1.2).toFixed(2))
    const odds2 = parseFloat((1.3 + Math.random() * 1.2).toFixed(2))

    const match = await db.match.create({
      data: {
        source: 'betboom',
        sport: 'table_tennis',
        league,
        player1: p1,
        player2: p2,
        startTime,
        status,
        score1: status === 'live' ? Math.floor(Math.random() * 3) : 0,
        score2: status === 'live' ? Math.floor(Math.random() * 3) : 0,
      },
    })

    await db.bookmakerOdds.create({
      data: {
        matchId: match.id,
        source: 'betboom',
        odds1,
        odds2,
        totalOver: parseFloat((5.5 + Math.random()).toFixed(1)),
        totalUnder: parseFloat((5.5 + Math.random()).toFixed(1)),
      },
    })
  }

  console.log(`✅ Created ${playerPairs.length} sample matches`)

  // Seed a collection log
  await db.collectionLog.create({
    data: {
      source: 'betboom',
      status: 'success',
      matchesFound: playerPairs.length,
      matchesCollected: playerPairs.length,
      matchesNew: playerPairs.length,
      duration: 42,
    },
  })

  // Seed some predictors
  await db.predictor.createMany({
    data: [
      { name: 'TipMaster Pro', platform: 'telegram', tier: 'premium', accuracy: 62.5, totalPredictions: 148, verified: true, bio: 'Professional TT tipster with 5 years experience', avatarEmoji: '🎯' },
      { name: 'TT Analytics', platform: 'website', tier: 'expert', accuracy: 58.3, totalPredictions: 89, verified: true, bio: 'Data-driven table tennis predictions', avatarEmoji: '📈' },
      { name: 'PongPredictor', platform: 'telegram', tier: 'basic', accuracy: 54.1, totalPredictions: 234, verified: false, bio: 'AI-powered predictions for table tennis', avatarEmoji: '🏓' },
    ],
  })

  console.log('✅ Created sample predictors')

  // Create some AI bets on the live matches
  const liveMatches = await db.match.findMany({ where: { status: 'live' } })
  const allProfiles = await db.aiProfile.findMany()

  for (const match of liveMatches) {
    for (const profile of allProfiles) {
      const betOnP1 = Math.random() > 0.5
      const predictedWinner = betOnP1 ? match.player1 : match.player2
      const odds = betOnP1
        ? (await db.bookmakerOdds.findFirst({ where: { matchId: match.id } }))?.odds1 ?? 1.8
        : (await db.bookmakerOdds.findFirst({ where: { matchId: match.id } }))?.odds2 ?? 1.8
      const confidence = 50 + Math.random() * 35
      const stake = 20
      const potentialWin = stake * odds

      await db.aiBet.create({
        data: {
          matchId: match.id,
          profileId: profile.id,
          player1: match.player1,
          player2: match.player2,
          predictedWinner,
          confidence,
          valueRating: confidence > 70 ? 1.5 + Math.random() : 0.5 + Math.random(),
          odds,
          stake,
          potentialWin,
          profit: 0,
          status: 'pending',
          reasoning: `${profile.strategy} strategy suggests ${predictedWinner} at ${odds.toFixed(2)} with ${confidence.toFixed(0)}% confidence`,
          strategy: profile.strategy,
        },
      })
    }
  }

  console.log(`✅ Created AI bets for ${liveMatches.length} live matches across ${allProfiles.length} profiles`)

  console.log('\n🎉 Seeding complete!')
  console.log('📊 5 AI profiles created (1000₽ each)')
  console.log('🏓 Sample matches and odds added')
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
