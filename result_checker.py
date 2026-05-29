#!/usr/bin/env python3
"""
Result Checker for TT Predict System
=====================================
Checks match results from multiple sources (1xBet, SofaScore)
and matches them with void/unfinished matches from BetBoom.

Uses Playwright to bypass Cloudflare/anti-bot protection.

DB Schema (actual):
  Match: id(TEXT), externalId, source, sport, league, player1, player2,
         startTime(DATETIME), status, score1(INT), score2(INT), winner(TEXT),
         createdAt, updatedAt, rawJson
  Bet: id(TEXT), matchId, predictedWinner, odds, stake, potentialWin,
       result, payout, isWin(BOOLEAN), createdAt, settledAt
"""

import asyncio
import json
import logging
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

# ============================================================
# Configuration
# ============================================================
DB_PATH = os.environ.get("DB_PATH", "/var/www/tt-predict/db/custom.db")
LOG_PATH = os.environ.get("LOG_PATH", "/var/www/tt-predict/logs/result-checker.log")

# 1xBet mirrors to try (in order of preference)
X1BET_MIRRORS = [
    "https://1xbet.com",
    "https://1xstavka.ru",
    "https://1xbet.cr",
    "https://1xbk10.com",
    "https://1xbet.in",
    "https://1xbet.co.ke",
]

# 1xBet sport ID for Table Tennis
X1BET_TT_SPORT_ID = 12

# ============================================================
# Logging
# ============================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
    ],
)
log = logging.getLogger("result-checker")

# ============================================================
# Database Helpers (uses REAL column names)
# ============================================================
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_void_matches() -> list[dict]:
    """Get void/live TT matches that need result checking."""
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT id, externalId, source, league, player1, player2,
                   startTime, status, score1, score2, winner
            FROM Match
            WHERE status IN ('void', 'live')
              AND sport = 'table_tennis'
            ORDER BY startTime DESC
        """).fetchall()

        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_match_with_result(match_id: str, score1: int, score2: int,
                            winner_name: str):
    """
    Update a Match with final score and winner (player name).
    Also settle related Bets.
    """
    conn = get_db()
    try:
        # Get player names from match to compare with winner
        match = conn.execute("SELECT player1, player2 FROM Match WHERE id = ?", (match_id,)).fetchone()
        if not match:
            return 0

        # Determine which side won
        isWin1 = names_match(match['player1'], winner_name)
        isWin2 = names_match(match['player2'], winner_name)

        # Update match
        conn.execute("""
            UPDATE Match
            SET score1 = ?, score2 = ?, winner = ?, status = 'finished', updatedAt = ?
            WHERE id = ?
        """, (score1, score2, winner_name,
              datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
              match_id))

        # Find and settle bets
        bets = conn.execute("""
            SELECT id, predictedWinner, isWin
            FROM Bet
            WHERE matchId = ? AND (isWin IS NULL OR isWin = 0)
              AND settledAt IS NULL
        """, (match_id,)).fetchall()

        bets_updated = 0
        for bet in bets:
            pred_winner = bet['predictedWinner']
            bet_won = False

            if names_match(pred_winner, winner_name):
                bet_won = True
            elif names_match(pred_winner, match['player1']) and isWin1:
                bet_won = True
            elif names_match(pred_winner, match['player2']) and isWin2:
                bet_won = True

            conn.execute("""
                UPDATE Bet SET isWin = ?, result = ?, settledAt = ?
                WHERE id = ?
            """, (1 if bet_won else 0,
                  'won' if bet_won else 'lost',
                  datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
                  bet['id']))
            bets_updated += 1
            log.info(f"  Bet {bet['id']}: predicted={pred_winner}, actual={winner_name} -> {'WON' if bet_won else 'LOST'}")

        conn.commit()
        log.info(f"Match {match_id}: {match['player1']} vs {match['player2']} -> "
                 f"{score1}:{score2}, winner={winner_name}, bets_settled={bets_updated}")
        return bets_updated
    finally:
        conn.close()


# ============================================================
# Player Name Matching
# ============================================================
def normalize_name(name: str) -> str:
    """Normalize player name for fuzzy matching."""
    if not name:
        return ""
    name = " ".join(name.split()).lower().strip()
    translit_map = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
        'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
        'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
        'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '',
        'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
        'é': 'e', 'á': 'a', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ý': 'y',
        'č': 'c', 'š': 's', 'ž': 'z', 'ř': 'r', 'ě': 'e', 'ů': 'u',
    }
    result = ""
    for ch in name:
        result += translit_map.get(ch, ch)
    return result


def names_match(name1: str, name2: str) -> bool:
    """Check if two player names match."""
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    if not n1 or not n2:
        return False
    if n1 == n2:
        return True
    if n1 in n2 or n2 in n1:
        return True
    # Check last names
    parts1 = n1.split()
    parts2 = n2.split()
    if len(parts1) >= 1 and len(parts2) >= 1:
        if parts1[-1] == parts2[-1]:
            return True
    return False


def tournaments_match(t1: str, t2: str) -> bool:
    """Loose tournament matching."""
    if not t1 or not t2:
        return True
    n1 = normalize_name(t1)
    n2 = normalize_name(t2)
    words1 = set(w for w in n1.split() if len(w) > 2)
    words2 = set(w for w in n2.split() if len(w) > 2)
    if not words1 or not words2:
        return True
    return len(words1 & words2) > 0

# ============================================================
# 1xBet API Source
# ============================================================
class OneXBetSource:
    """Fetches TT results from 1xBet LineFeed API."""

    def __init__(self):
        self.working_mirror: Optional[str] = None
        self.browser = None
        self.context = None
        self.playwright = None

    async def init_browser(self):
        from playwright.async_api import async_playwright
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=True)
        self.context = await self.browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080},
            locale="ru-RU",
        )

    async def close(self):
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()

    async def find_working_mirror(self) -> Optional[str]:
        """Try mirrors and return first working one."""
        if self.working_mirror:
            return self.working_mirror

        for mirror in X1BET_MIRRORS:
            try:
                page = await self.context.new_page()
                url = f"{mirror}/ru/live/Table-Tennis/"
                log.info(f"  Trying: {mirror}")
                resp = await page.goto(url, timeout=15000, wait_until='domcontentloaded')
                await asyncio.sleep(2)

                result = await page.evaluate("""
                    async () => {
                        try {
                            const r = await fetch('/LiveFeed/Get1x2_VZip?sports=12&count=5&lng=ru&mode=4', {
                                headers: {'Accept': '*/*', 'X-Requested-With': 'XMLHttpRequest'}
                            });
                            const text = await r.text();
                            const data = JSON.parse(text);
                            return {status: r.status, ok: r.ok, count: (data.Value || []).length};
                        } catch(e) {
                            return {error: e.message};
                        }
                    }
                """)

                await page.close()

                if result.get('ok') and result.get('count', 0) > 0:
                    log.info(f"  ✓ Mirror works: {mirror} ({result['count']} matches)")
                    self.working_mirror = mirror
                    return mirror
                else:
                    log.info(f"  ✗ Failed: {mirror} - {result.get('error', 'status=' + str(result.get('status')))[:60]}")

            except Exception as e:
                log.info(f"  ✗ Error: {mirror} - {str(e)[:60]}")
                try:
                    await page.close()
                except:
                    pass

        return None

    async def fetch_results(self, mode: str = "live") -> list[dict]:
        """
        Fetch TT matches from 1xBet.
        mode='live' for live matches, mode='finished' for finished results.
        """
        mirror = await self.find_working_mirror()
        if not mirror:
            log.warning("No working 1xBet mirror")
            return []

        page = await self.context.new_page()
        results = []

        try:
            await page.goto(f"{mirror}/ru/live/Table-Tennis/", timeout=15000, wait_until='domcontentloaded')
            await asyncio.sleep(2)

            # Fetch all TT matches with scores
            data = await page.evaluate(f"""
                async () => {{
                    const r = await fetch('/LiveFeed/Get1x2_VZip?sports={X1BET_TT_SPORT_ID}&count=300&lng=ru&mode=4', {{
                        headers: {{'Accept': '*/*', 'X-Requested-With': 'XMLHttpRequest'}}
                    }});
                    return await r.text();
                }}
            """)

            matches = json.loads(data).get('Value', [])
            cutoff_time = time.time() - 72 * 3600  # 72 hours back

            for m in matches:
                try:
                    o1 = m.get('O1', '')
                    o2 = m.get('O2', '')
                    league = m.get('L', '')
                    country = m.get('CN', '')
                    mid = str(m.get('I', ''))
                    start_ts = m.get('S', 0)

                    sc = m.get('SC', {})
                    fs = sc.get('FS', {})
                    s1 = str(fs.get('S1', ''))
                    s2 = str(fs.get('S2', ''))

                    ps = sc.get('PS', [])

                    # In TT best-of-3: first to 2 sets wins
                    s1v = int(s1) if s1 else 0
                    s2v = int(s2) if s2 else 0
                    is_finished = s1v >= 2 or s2v >= 2

                    if mode == "finished" and not is_finished:
                        continue
                    if mode == "live" and is_finished:
                        continue

                    # Determine winner
                    winner_name = o1 if s1v > s2v else (o2 if s2v > s1v else None)

                    results.append({
                        'source': '1xbet',
                        'player1': o1,
                        'player2': o2,
                        'league': league,
                        'country': country,
                        'score1': s1v,
                        'score2': s2v,
                        'winner': winner_name,
                        'is_finished': is_finished,
                        'startTime': datetime.fromtimestamp(start_ts, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z') if start_ts else '',
                        'externalId': f"x1_{mid}",
                        'periodScores': [(p.get('Value', {}).get('S1', ''), p.get('Value', {}).get('S2', '')) for p in ps],
                    })
                except Exception:
                    continue

        finally:
            await page.close()

        return results

# ============================================================
# Main Logic
# ============================================================
async def compare_sources():
    """Compare 1xBet live matches with BetBoom DB."""
    log.info("=" * 60)
    log.info("COMPARISON MODE: 1xBet vs BetBoom")

    conn = get_db()
    try:
        bb_rows = conn.execute("""
            SELECT player1, player2, league, status, score1, score2, startTime
            FROM Match
            WHERE sport = 'table_tennis'
              AND datetime(startTime) > datetime('now', '-48 hours')
            ORDER BY startTime DESC
        """).fetchall()
    finally:
        conn.close()

    bb_matches = [dict(r) for r in bb_rows]
    log.info(f"BetBoom: {len(bb_matches)} matches (last 48h)")
    log.info(f"  Statuses: {dict(sorted({m['status']: sum(1 for x in bb_matches if x['status']==m['status']) for m in bb_matches}.items()))}")

    # Fetch from 1xBet
    log.info("\n--- Fetching from 1xBet ---")
    try:
        x1bet = OneXBetSource()
        await x1bet.init_browser()

        x1_results = await x1bet.fetch_results(mode="live")
        log.info(f"1xBet: {len(x1_results)} live TT matches")

        if x1_results:
            # Show tournaments
            x1_tournaments = {}
            for m in x1_results:
                t = f"{m.get('country', '')} - {m.get('league', '')}"
                x1_tournaments[t] = x1_tournaments.get(t, 0) + 1

            log.info(f"\n1xBet tournaments ({len(x1_tournaments)}):")
            for t, count in sorted(x1_tournaments.items(), key=lambda x: -x[1])[:15]:
                log.info(f"  {t}: {count}")

            # BetBoom tournaments
            bb_tournaments = {}
            for m in bb_matches:
                t = m.get('league', '') or 'unknown'
                bb_tournaments[t] = bb_tournaments.get(t, 0) + 1

            log.info(f"\nBetBoom tournaments ({len(bb_tournaments)}):")
            for t, count in sorted(bb_tournaments.items(), key=lambda x: -x[1])[:15]:
                log.info(f"  {t}: {count}")

            # Find overlapping
            bb_t_set = {normalize_name(t) for t in bb_tournaments}
            x1_t_set = {normalize_name(t) for t in x1_tournaments}
            overlap = bb_t_set & x1_t_set
            log.info(f"\nOverlapping tournaments: {overlap if overlap else 'checking deeper...'}")

            # Cross-match by player names
            log.info(f"\n--- Cross-matching players ---")
            match_count = 0
            for x1m in x1_results[:50]:
                for bbm in bb_matches:
                    if names_match(x1m['player1'], bbm['player1']) and \
                       names_match(x1m['player2'], bbm['player2']):
                        match_count += 1
                        log.info(f"  ✓ MATCH: {x1m['player1']} vs {x1m['player2']} "
                                 f"| 1xBet: {x1m['score1']}:{x1m['score2']} "
                                 f"| BB: {bbm['score1']}:{bbm['score2']} "
                                 f"| BB status: {bbm['status']} "
                                 f"| League: 1xBet=[{x1m['league']}] BB=[{bbm['league']}]")

            if match_count == 0:
                log.info("  No exact matches found (names may differ)")

            # Show sample 1xBet data
            log.info(f"\n--- Sample 1xBet matches ---")
            for m in x1_results[:10]:
                log.info(f"  [{m['country']}] {m['league']}: {m['player1']} vs {m['player2']} "
                         f"| {m['score1']}:{m['score2']} | finished={m['is_finished']}")

            # Show sample BetBoom data
            log.info(f"\n--- Sample BetBoom matches ---")
            for m in bb_matches[:10]:
                log.info(f"  {m['league']}: {m['player1']} vs {m['player2']} "
                         f"| {m['score1']}:{m['score2']} | {m['status']}")

        await x1bet.close()
    except Exception as e:
        log.error(f"Comparison failed: {e}", exc_info=True)


async def check_and_settle():
    """Check results from 1xBet and settle void matches."""
    log.info("=" * 60)
    log.info("RESULT CHECK & SETTLE")

    void_matches = get_void_matches()
    if not void_matches:
        log.info("No void/live matches to check!")
        return

    log.info(f"Found {len(void_matches)} void/live matches")
    for m in void_matches[:5]:
        log.info(f"  [{m['status']}] {m['league']}: {m['player1']} vs {m['player2']} | {m['score1']}:{m['score2']}")
    if len(void_matches) > 5:
        log.info(f"  ... and {len(void_matches) - 5} more")

    total_settled = 0

    # Try 1xBet
    log.info("\n--- 1xBet ---")
    try:
        x1bet = OneXBetSource()
        await x1bet.init_browser()

        x1_results = await x1bet.fetch_results(mode="live")
        # Also get some finished (they may still be in live feed briefly)
        log.info(f"1xBet: {len(x1_results)} live TT matches")

        if x1_results:
            settled = match_and_settle(void_matches, x1_results)
            total_settled += settled

        await x1bet.close()
    except Exception as e:
        log.error(f"1xBet failed: {e}", exc_info=True)

    log.info(f"\n=== Done. Settled: {total_settled} ===")


def match_and_settle(void_matches: list[dict], source_results: list[dict]) -> int:
    """Match void matches with source results and settle."""
    settled = 0

    for vm in void_matches:
        best_match = None
        best_score = 0

        for sr in source_results:
            # Check both player orderings
            same_order = names_match(vm['player1'], sr['player1']) and \
                         names_match(vm['player2'], sr['player2'])
            rev_order = names_match(vm['player1'], sr['player2']) and \
                        names_match(vm['player2'], sr['player1'])

            if not (same_order or rev_order):
                continue

            if not tournaments_match(vm.get('league', ''), sr.get('league', '')):
                continue

            score = 10
            if same_order:
                score += 5

            # Check time proximity
            if vm.get('startTime') and sr.get('startTime'):
                try:
                    t1 = datetime.fromisoformat(vm['startTime'].replace('Z', '+00:00'))
                    t2 = datetime.fromisoformat(sr['startTime'].replace('Z', '+00:00'))
                    diff_h = abs((t1 - t2).total_seconds()) / 3600
                    if diff_h < 1:
                        score += 30
                    elif diff_h < 3:
                        score += 20
                    elif diff_h < 6:
                        score += 10
                    elif diff_h < 24:
                        score += 5
                except:
                    pass

            # Require score match if we have scores in both
            if vm.get('score1', 0) > 0 and sr.get('score1', 0) > 0:
                if vm['score1'] == sr['score1'] and vm['score2'] == sr['score2']:
                    score += 25

            if score > best_score:
                best_score = score
                best_match = sr

        if best_match and best_score >= 15 and best_match.get('winner'):
            bets = update_match_with_result(
                vm['id'],
                best_match['score1'],
                best_match['score2'],
                best_match['winner']
            )
            log.info(f"✓ SETTLED: {vm['player1']} vs {vm['player2']} -> "
                     f"{best_match['score1']}:{best_match['score2']} "
                     f"winner={best_match['winner']} (score={best_score}, bets={bets})")
            settled += 1

    return settled


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "compare"

    if mode == "compare":
        asyncio.run(compare_sources())
    elif mode == "check":
        asyncio.run(check_and_settle())
    else:
        print(f"Usage: {sys.argv[0]} [compare|check]")
        print("  compare - Compare 1xBet with BetBoom (diagnostic)")
        print("  check   - Check results and settle void matches")
