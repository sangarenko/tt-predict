import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database (clean — no fake matches)...')

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
        description: 'Chase/Martingale variant with smart loss recovery. Uses controlled bankroll management after losses. Only bets on clear favorites (<1.8 odds).',
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
        description: 'Value betting and arbitrage scanner. Finds mispriced odds and value opportunities across markets. Uses Kelly criterion for sizing.',
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

  // Seed predictors (template data for tipster tracking)
  await db.predictor.createMany({
    data: [
      { name: 'TipMaster Pro', platform: 'telegram', tier: 'premium', accuracy: 0, totalPredictions: 0, verified: true, bio: 'Professional TT tipster — accuracy will be tracked from real predictions', avatarEmoji: '🎯' },
      { name: 'TT Analytics', platform: 'website', tier: 'expert', accuracy: 0, totalPredictions: 0, verified: true, bio: 'Data-driven table tennis predictions — awaiting real data', avatarEmoji: '📈' },
      { name: 'PongPredictor', platform: 'telegram', tier: 'basic', accuracy: 0, totalPredictions: 0, verified: false, bio: 'AI-powered predictions for table tennis — unverified', avatarEmoji: '🏓' },
    ],
  })
  console.log('✅ Created predictor templates')

  console.log('\n🎉 Seeding complete!')
  console.log('📊 5 AI profiles created (1000₽ each)')
  console.log('⚠️  NO fake matches — run /api/collect to get real data')
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
