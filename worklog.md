# Real Data Collector Deployment - Worklog

## Date: 2026-05-27

### Objective
Replace the fake random data generator in the Next.js TT Predict app's collector service with a real data collector that scrapes live table tennis matches and odds from BetBoom.ru.

### Server
- **Host**: 2.26.122.152 (Helsinki, Finland - no geo-restrictions for Russian bookmakers)
- **Project Path**: `/var/www/tt-predict/`

---

### Phase 1: Reconnaissance & Analysis

#### Existing Setup
- **Next.js app** runs on port 3001 via PM2
- **Fake collector** at `/var/www/tt-predict/mini-services/collector/index.ts` generates random TT matches with fake player names and random odds
- **Database**: SQLite at `/var/www/tt-predict/db/custom.db` via Prisma
- **Existing tables**: Match, BookmakerOdds, CollectionLog (already exist with correct schema)
- **Python 3.12.3** with playwright 1.59.0, beautifulsoup4 4.12.0, lxml 6.1.0
- **Chromium**: Playwright's own Chromium at `/root/.cache/ms-playwright/chromium-1217/`
- **Cron**: Already had one entry for `auto-predictor.sh` every 30 minutes

#### Database Schema (existing)
```sql
CREATE TABLE Match (
    id TEXT PRIMARY KEY, externalId TEXT, source TEXT, sport TEXT,
    league TEXT, player1 TEXT, player2 TEXT, startTime DATETIME,
    status TEXT DEFAULT 'upcoming', score1 INT DEFAULT 0, score2 INT DEFAULT 0,
    winner TEXT, createdAt DATETIME, updatedAt DATETIME, rawJson TEXT
);
CREATE TABLE BookmakerOdds (
    id TEXT PRIMARY KEY, matchId TEXT, source TEXT,
    odds1 REAL, odds2 REAL, totalOver REAL, totalUnder REAL,
    handicap1 REAL, handicap2 REAL, updatedAt DATETIME
);
CREATE TABLE CollectionLog (
    id TEXT PRIMARY KEY, source TEXT, status TEXT,
    matchesFound INT, matchesNew INT, matchesUpdated INT,
    error TEXT, duration INT, createdAt DATETIME
);
```

---

### Phase 2: Source Website Analysis (BetBoom.ru)

#### Scraping Approach
BetBoom.ru is a SPA (React/Next.js) that renders content client-side. Key findings:

1. **Live page** (`/sport/live/table-tennis`): Shows currently playing TT matches
   - Loads via JavaScript rendering (requires Playwright)
   - Shows: player names, set scores, current game score, set number, odds (П1/П2)
   - Cookie consent popup needs to be dismissed first
   
2. **Prematch page** (`/sport/prematch/table-tennis`): Shows upcoming matches
   - Content loads lazily - requires clicking the "Настольный теннис" sidebar link
   - Shows: player names, start times ("Сегодня в 21:30"), odds
   - 300+ upcoming TT matches available across leagues

3. **Data extraction method**: Parse `document.body.innerText` with JavaScript since:
   - CSS classes are heavily obfuscated (styled-components)
   - No `data-event-id` or similar semantic attributes
   - Body text has clear structure: League → Count → [Player1, Player2, Scores, Status, Odds]

#### Leagues Found
- TT Cup (27+ matches)
- TT Elite Series (108+ matches)  
- Setka Cup (27+ matches)
- Custom leagues (Россия. Лига Про, etc.)

---

### Phase 3: Collector Script Development

#### File: `/var/www/tt-predict/collector/real_collector.py`

**Architecture**:
```
real_collector.py (standalone Python script)
├── Configuration (DB path, URLs, logging)
├── Utility functions (externalId generation, time parsing, status mapping)
├── Database layer (upsert match, update odds, mark stale matches)
├── JavaScript extractors (live + prematch)
├── Playwright scraping (live page → prematch page)
└── Main entry point (asyncio.run)
```

**Key Design Decisions**:

1. **ExternalId**: Deterministic MD5 hash of `player1|player2|league` → `bb_<12-char-hash>`
   - Same players in same league always get the same ID
   - Enables proper deduplication across runs

2. **Deduplication**: Uses `externalId + source` as unique key
   - INSERT for new matches, UPDATE for existing (score/status changes)
   - Odds updated independently via UPDATE on existing BookmakerOdds row

3. **Status mapping**:
   - Contains "сет" (set) → `live`
   - Contains "Не начался" / "Событие не началось" → `upcoming`
   - Contains "Перерыв" (break) → `live`

4. **Stale match cleanup**: Marks upcoming matches >24h past startTime with 0-0 score as `finished`

5. **Anti-bot measures**:
   - Realistic Chrome User-Agent string
   - Russian locale
   - Delays between requests (3s between live/prematch)
   - Cookie consent auto-dismissal

6. **Lock file**: Prevents overlapping cron runs (300s timeout)

#### Results from Testing
| Run | Live | Prematch | New | Updated | Duration |
|-----|------|----------|-----|---------|----------|
| #1  | 13   | 0        | 13  | 0       | 37s      |
| #2  | 12   | 14       | 26  | 0       | 43s      |
| #3  | 10   | 14       | 0   | 2       | 39s      |

**Deduplication confirmed**: Run #3 correctly detected 0 new matches and 2 updates (live score changes).

---

### Phase 4: Deployment

#### Files Created
```
/var/www/tt-predict/collector/
├── real_collector.py    # Main collector script (398 lines)
└── run_collector.sh     # Cron wrapper with lock file
/var/www/tt-predict/logs/
└── real-collector.log   # Collector log output
```

#### Cron Setup
```
*/5 * * * * /var/www/tt-predict/collector/run_collector.sh
```
- Runs every 5 minutes
- Existing cron entry for `auto-predictor.sh` (every 30 min) preserved

#### Data in Database After Deployment
- 19 live matches (real)
- 20 upcoming matches (real) 
- 2422 finished matches (mix of old fake + real that ended)
- CollectionLog entries tracking all runs

---

### Sample Real Data
```
bb_1990f6af88a6 | TT Cup           | Йирасек Мартин vs Клюсачек Патрик | live   | 1:1 | odds 2.65/1.42
bb_51ae36c804a9 | TT Elite Series  | Барон Мариуш vs Крупа Себастьян   | live   | 1:2 | odds 1.65/2.15
bb_bca9e25c9755 | Setka Cup        | Перетятько Андрей vs Яковенко Антон| live   | 2:2 | odds 1.42/2.56
bb_guzi_karol   | TT Cup           | Гузи Кароль vs Запала Кшиштоф     | upcoming | 0:0 | odds 1.76/1.96
```

---

### Technical Notes
- **No changes made to the Next.js application code** - only the collector was added
- Playwright headless Chrome is used (not system Chromium) for compatibility
- The prematch page requires sidebar click to load content (lazy loading)
- Score parsing: `allScores[0:2]` = set scores, `allScores[2:4]` = current game in set

---

### Phase 5: Fake Data Cleanup (by main agent)

#### Problem
The database contained 4462+ fake matches (2465 betboom + 2000 fonbet) generated by the old random collector. These needed to be removed.

#### Actions Taken
1. **Identified fake data patterns**:
   - Fake betboom externalId: `bb_1779612300021_0_1zyjmk` (timestamp-based, 25+ chars)
   - Real betboom externalId: `bb_203ea2e916df` (MD5 hash, 15 chars)
   - All fonbet data was fake (no real fonbet collector existed)

2. **Deleted ALL fake data**:
   - Removed 1356 fake betboom matches + 1109 old betboom matches
   - Removed all 2000 fonbet matches
   - Deleted related AiBets (5700+ entries), BookmakerOdds, Predictions, ValueBets, Bets
   - Reset all 26 AI Profiles bankrolls to initial values
   - Reset AiBankroll and Bankroll to initial values

3. **Result**: Clean database with only real data
   - 27 real matches (10 live, 17 upcoming)
   - 27 real BookmakerOdds entries from BetBoom
   - 0 fake entries remaining

4. **PM2 restarted** to clear application cache

---
## Date: 2026-05-31 — Phase 6: Backend Rebuild + Currency Change (€→₽)

### Objective
Rebuild the backend from scratch (Prisma schema, API routes, seed data) and change all currency from EUR (€) to Russian Rubles (₽). Each of the 5 AI profiles starts with 1000₽.

### Actions Taken

#### 1. Prisma Schema Rebuild
Created comprehensive Prisma schema with all models:
- **Match** — table tennis matches (source, sport, league, players, scores, status)
- **BookmakerOdds** — odds from bookmakers (odds1, odds2, totals, handicaps)
- **AiProfile** — 5 AI betting profiles with bankroll tracking
- **AiBet** — bets placed by AI profiles (stake, odds, profit, reasoning)
- **Prediction** — raw predictions from predictors
- **CollectionLog** — data collection tracking
- **ValueBet** — value betting calculations
- **Predictor** — external predictor records
- **Tipster** — tipster tracking

#### 2. 9 API Routes Created
| Route | Purpose |
|-------|---------|
| `GET /api/matches` | All matches with odds, filtered 48h |
| `GET /api/ai-bets` | All AI bets with profile names |
| `GET /api/stats` | Aggregate stats (win rate, profit, counts) |
| `GET /api/bankroll` | Overall bankroll state |
| `GET /api/ai-bankroll` | AI bankroll aggregate across profiles |
| `GET /api/predictors` | All predictors |
| `GET /api/collection-logs` | Collection log history |
| `GET /api/ai-profiles` | All AI profiles with derived stats |
| `GET /api/tipsters` | All tipsters |

#### 3. Currency Change €→₽
Changed in `src/app/page.tsx`:
- `fmtMoney()`: `+123₽` format (was `+€123.00`)
- `fmtMoneyPlain()`: `1000₽` format (was `€1000.00`)
- All inline € references → ₽
- Russian labels: "Ставка" (stake), "Выигрыш" (potential win)

#### 4. Seed Data (1000₽ per profile)
5 AI profiles created:
| Profile | Strategy | Emoji | Initial |
|---------|----------|-------|---------|
| Эло-Мастер | elo | 📊 | 1000₽ |
| Тренд-Хантер | trend | 🔥 | 1000₽ |
| Лига-Эксперт | league | 🏆 | 1000₽ |
| Догонщик | chase | ⚡ | 1000₽ |
| Арбитражёр | arbitrage | 💰 | 1000₽ |

- 8 sample matches (2 live, 6 upcoming)
- 10 AI bets (5 profiles × 2 live matches)
- 3 sample predictors

#### 5. DATABASE_URL Fix
Fixed path from `file:./db/custom.db` to `file:/home/z/my-project/db/custom.db` in .env to match dev server resolution.
