#!/usr/bin/env python3
"""
Real Table Tennis Data Collector for TT Predict
Scrapes live and upcoming matches from BetBoom.ru using Playwright.
Stores data in SQLite at /var/www/tt-predict/db/custom.db.
"""

import asyncio
import json
import logging
import os
import re
import sqlite3
import sys
import time
import uuid
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ============================================================
# Configuration
# ============================================================
DB_PATH = "/var/www/tt-predict/db/custom.db"
LOG_PATH = "/var/www/tt-predict/logs/real-collector.log"
SOURCE_NAME = "betboom"

# BetBoom URLs
BB_LIVE_URL = "https://betboom.ru/sport/live/table-tennis"
BB_PREMATCH_URL = "https://betboom.ru/sport/prematch/table-tennis"

# ============================================================
# Logging setup
# ============================================================
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("real_collector")


# ============================================================
# Utility functions
# ============================================================
def generate_external_id(player1: str, player2: str, league: str) -> str:
    """Generate a deterministic external ID for deduplication based on players+league."""
    key = f"{player1}|{player2}|{league}"
    h = hashlib.md5(key.encode("utf-8")).hexdigest()[:12]
    return f"bb_{h}"


def parse_start_time(time_str: str) -> str:
    """Parse Russian start time strings like 'Сегодня в 21:30', 'Завтра в 10:00'."""
    now = datetime.now(timezone.utc)
    time_str = time_str.strip()

    if "\u0417\u0430\u0432\u0442\u0440\u0430" in time_str:  # Завтра
        tomorrow = now + timedelta(days=1)
        match = re.search(r"(\d{1,2}):(\d{2})", time_str)
        if match:
            h, m = int(match.group(1)), int(match.group(2))
            dt = tomorrow.replace(hour=h, minute=m, second=0, microsecond=0)
            return dt.strftime("%Y-%m-%dT%H:%M:%S")
    elif "\u0421\u0435\u0433\u043e\u0434\u043d\u044f" in time_str:  # Сегодня
        match = re.search(r"(\d{1,2}):(\d{2})", time_str)
        if match:
            h, m = int(match.group(1)), int(match.group(2))
            dt = now.replace(hour=h, minute=m, second=0, microsecond=0)
            return dt.strftime("%Y-%m-%dT%H:%M:%S")

    return now.strftime("%Y-%m-%dT%H:%M:%S")


def determine_status(status_str: str) -> str:
    """Map Russian status to our status values."""
    if not status_str:
        return "upcoming"
    set_kw = "\u0441\u0435\u0442"  # сет
    break_kw = "\u041f\u0435\u0440\u0435\u0440\u044b\u0432"  # Перерыв
    not_started1 = "\u041d\u0435 \u043d\u0430\u0447\u0430\u043b\u0441\u044f"  # Не начался
    not_started2 = "\u0441\u043e\u0431\u044b\u0442\u0438\u0435 \u043d\u0435 \u043d\u0430\u0447\u0430\u043b\u043e\u0441\u044c"

    if set_kw in status_str or break_kw in status_str:
        return "live"
    if not_started1 in status_str or not_started2 in status_str:
        return "upcoming"
    return "live"


# ============================================================
# Database functions
# ============================================================
def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def upsert_match(conn: sqlite3.Connection, match_data: dict) -> tuple:
    """Upsert a match and its odds. Returns (match_id, is_new, is_updated)."""
    external_id = match_data["external_id"]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    raw_json = json.dumps(match_data, ensure_ascii=False)

    existing = conn.execute(
        "SELECT id, status, score1, score2 FROM Match WHERE externalId = ? AND source = ?",
        (external_id, SOURCE_NAME),
    ).fetchone()

    if existing:
        match_id = existing["id"]
        old_status = existing["status"]
        old_s1 = existing["score1"]
        old_s2 = existing["score2"]
        new_status = match_data["status"]
        new_s1 = match_data["score1"]
        new_s2 = match_data["score2"]

        is_updated = (old_status != new_status or old_s1 != new_s1 or old_s2 != new_s2)

        winner = None
        if new_status == "finished":
            if new_s1 > new_s2:
                winner = match_data["player1"]
            elif new_s2 > new_s1:
                winner = match_data["player2"]

        if is_updated:
            conn.execute(
                """UPDATE Match SET
                    status = ?, score1 = ?, score2 = ?, winner = ?,
                    league = ?, player1 = ?, player2 = ?, startTime = ?,
                    rawJson = ?, updatedAt = ?
                WHERE id = ?""",
                (
                    new_status, new_s1, new_s2, winner,
                    match_data["league"], match_data["player1"], match_data["player2"],
                    match_data["start_time"], raw_json, now,
                    match_id,
                ),
            )
            # Update odds
            conn.execute(
                """UPDATE BookmakerOdds SET odds1 = ?, odds2 = ?, updatedAt = ?
                WHERE matchId = ? AND source = ?""",
                (match_data["odds1"], match_data["odds2"], now, match_id, SOURCE_NAME),
            )

        return match_id, False, is_updated
    else:
        match_id = str(uuid.uuid4())
        winner = None
        if match_data["status"] == "finished":
            if match_data["score1"] > match_data["score2"]:
                winner = match_data["player1"]
            elif match_data["score2"] > match_data["score1"]:
                winner = match_data["player2"]

        conn.execute(
            """INSERT INTO Match
                (id, externalId, source, sport, league, player1, player2,
                 startTime, status, score1, score2, winner, rawJson, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                match_id, external_id, SOURCE_NAME, "table_tennis",
                match_data["league"], match_data["player1"], match_data["player2"],
                match_data["start_time"], match_data["status"],
                match_data["score1"], match_data["score2"], winner,
                raw_json, now, now,
            ),
        )

        odds_id = str(uuid.uuid4())
        conn.execute(
            """INSERT INTO BookmakerOdds (id, matchId, source, odds1, odds2, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)""",
            (odds_id, match_id, SOURCE_NAME,
             match_data["odds1"], match_data["odds2"], now),
        )

        return match_id, True, False


def mark_stale_upcoming_as_finished(conn: sqlite3.Connection):
    """Mark upcoming matches >24h past startTime as finished (only for our source)."""
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S")
    update_now = now.strftime("%Y-%m-%dT%H:%M:%S")

    cursor = conn.execute(
        """UPDATE Match SET status = 'finished', updatedAt = ?
        WHERE source = ? AND status = 'upcoming'
          AND startTime < ? AND score1 = 0 AND score2 = 0
          AND externalId LIKE 'bb_%'""",
        (update_now, SOURCE_NAME, cutoff),
    )
    return cursor.rowcount


def log_collection(conn, source, status, matches_found, matches_new,
                   matches_updated, duration_ms, error=None):
    log_id = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO CollectionLog
            (id, source, status, matchesFound, matchesNew, matchesUpdated, duration, error, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (log_id, source, status, matches_found, matches_new, matches_updated,
         duration_ms, error, datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")),
    )


# ============================================================
# JavaScript extraction code
# ============================================================
JS_EXTRACT_LIVE = r"""() => {
    const bodyText = document.body.innerText;
    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);
    const playerRe = /^[A-Z\u0410-\u042f][a-z\u0430-\u044f\u00c0-\u017f]+(?:[\s.][A-Z\u0410-\u042f][a-z\u0430-\u044f\u00c0-\u017f]+(?:[\s.][A-ZV])?(?:\s?[A-Z\u0410-\u042f][a-z\u0430-\u044f\u00c0-\u017f]+)?)?$/;
    const scoreRe = /^\d+$/;
    const floatRe = /^\d+\.\d+$/;
    const dashRe = /^[\u2014\u2013-]$/;

    let matches = [];
    let currentLeague = '';
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const isKnownLeague = ['TT Cup', 'TT Elite Series', 'Setka Cup', 'Liga Pro',
                               'Win Cup', 'Premier TT', 'Pro Table Tennis'].some(l => line.includes(l));
        const isCustomLeague = line.includes('.') && line.length > 5 && line.length < 50
            && !scoreRe.test(line) && !floatRe.test(line)
            && !line.startsWith('\u041f') && !line.startsWith('\u0415\u0449\u0451');

        if (isKnownLeague || isCustomLeague) {
            if (i + 1 < lines.length && /^\d+$/.test(lines[i + 1])) {
                currentLeague = line;
                i += 2;
                continue;
            }
        }

        if (playerRe.test(line) && line.length > 2 && line.length < 60) {
            const player1 = line;
            if (i + 1 < lines.length && playerRe.test(lines[i + 1])) {
                const player2 = lines[i + 1];
                let j = i + 2;
                let scores = [];
                let status = '';
                let odds1 = 0;
                let odds2 = 0;

                while (j < lines.length && j < i + 20) {
                    const sl = lines[j];
                    if (playerRe.test(sl)) break;
                    if (dashRe.test(sl)) { j++; continue; }
                    if (scoreRe.test(sl) && sl.length < 3) {
                        scores.push(parseInt(sl));
                    } else if (sl.includes('\u0441\u0435\u0442') ||
                               sl.includes('\u041d\u0435 \u043d\u0430\u0447\u0430\u043b\u0441\u044f') ||
                               sl.includes('\u043d\u0435 \u043d\u0430\u0447\u0430\u043b\u043e\u0441\u044c') ||
                               sl.includes('\u041f\u0435\u0440\u0435\u0440\u044b\u0432')) {
                        status = sl;
                    } else if (sl === '\u041f1' && j + 1 < lines.length && floatRe.test(lines[j + 1])) {
                        odds1 = parseFloat(lines[j + 1]);
                        j++;
                    } else if (sl === '\u041f2' && j + 1 < lines.length && floatRe.test(lines[j + 1])) {
                        odds2 = parseFloat(lines[j + 1]);
                        j++;
                    } else if (sl.startsWith('\u0415\u0449\u0451')) {
                        j++;
                        break;
                    }
                    j++;
                }

                if (odds1 > 0 && odds2 > 0 && player1.length > 2 && player2.length > 2) {
                    let s1 = scores.length >= 2 ? scores[0] : 0;
                    let s2 = scores.length >= 2 ? scores[1] : 0;
                    matches.push({
                        league: currentLeague,
                        player1: player1,
                        player2: player2,
                        score1: s1,
                        score2: s2,
                        allScores: scores,
                        statusText: status,
                        odds1: odds1,
                        odds2: odds2,
                    });
                }
                i = j;
                continue;
            }
        }
        i++;
    }
    return matches;
}"""

JS_EXTRACT_PREMATCH = r"""() => {
    const bodyText = document.body.innerText;
    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);
    const playerRe = /^[A-Z\u0410-\u042f][a-z\u0430-\u044f\u00c0-\u017f]+(?:[\s.][A-Z\u0410-\u042f][a-z\u0430-\u044f\u00c0-\u017f]+(?:[\s.][A-ZV])?(?:\s?[A-Z\u0410-\u042f][a-z\u0430-\u044f\u00c0-\u017f]+)?)?$/;
    const scoreRe = /^\d+$/;
    const floatRe = /^\d+\.\d+$/;
    const todayRe = /\u0421\u0435\u0433\u043e\u0434\u043d\u044f/;
    const tomorrowRe = /\u0417\u0430\u0432\u0442\u0440\u0430/;

    let matches = [];
    let currentLeague = '';
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const isKnownLeague = ['TT Cup', 'TT Elite Series', 'Setka Cup', 'Liga Pro',
                               'Win Cup', 'Premier TT', 'Pro Table Tennis'].some(l => line.includes(l));
        const isCustomLeague = line.includes('.') && line.length > 5 && line.length < 50
            && !scoreRe.test(line) && !floatRe.test(line)
            && !line.startsWith('\u041f') && !line.startsWith('\u0415\u0449\u0451');

        if (isKnownLeague || isCustomLeague) {
            if (i + 1 < lines.length && /^\d+$/.test(lines[i + 1])) {
                currentLeague = line;
                i += 2;
                continue;
            }
        }

        if (playerRe.test(line) && line.length > 2 && line.length < 60) {
            const player1 = line;
            if (i + 1 < lines.length && playerRe.test(lines[i + 1])) {
                const player2 = lines[i + 1];
                let j = i + 2;
                let startText = '';
                let odds1 = 0;
                let odds2 = 0;

                while (j < lines.length && j < i + 15) {
                    const sl = lines[j];
                    if (playerRe.test(sl)) break;
                    if ((todayRe.test(sl) || tomorrowRe.test(sl)) && sl.length > 5) {
                        startText = sl;
                    } else if (sl === '\u041f1' && j + 1 < lines.length && floatRe.test(lines[j + 1])) {
                        odds1 = parseFloat(lines[j + 1]);
                        j++;
                    } else if (sl === '\u041f2' && j + 1 < lines.length && floatRe.test(lines[j + 1])) {
                        odds2 = parseFloat(lines[j + 1]);
                        j++;
                    } else if (sl.startsWith('\u0415\u0449\u0451')) {
                        j++;
                        break;
                    }
                    j++;
                }

                if (odds1 > 0 && odds2 > 0 && startText.length > 0) {
                    matches.push({
                        league: currentLeague,
                        player1: player1,
                        player2: player2,
                        startText: startText,
                        odds1: odds1,
                        odds2: odds2,
                    });
                }
                i = j;
                continue;
            }
        }
        i++;
    }
    return matches;
}"""


# ============================================================
# Playwright scraping
# ============================================================
async def accept_cookies(page):
    """Try to accept cookie consent popups."""
    for text in ["Ok", "Okey", "OK"]:
        try:
            btn = page.locator(f'button:has-text("{text}")').first
            if await btn.is_visible(timeout=2000):
                await btn.click()
                log.info(f"Accepted cookies")
                await page.wait_for_timeout(2000)
                return
        except Exception:
            pass


async def scrape_betboom_live(page) -> list:
    """Scrape live TT matches from BetBoom."""
    log.info("Loading BetBoom live page...")
    await page.goto(BB_LIVE_URL, timeout=30000, wait_until="domcontentloaded")
    await page.wait_for_timeout(3000)
    await accept_cookies(page)
    await page.wait_for_timeout(8000)

    raw_matches = await page.evaluate(JS_EXTRACT_LIVE)
    log.info(f"Extracted {len(raw_matches)} raw live matches")

    processed = []
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    for m in raw_matches:
        status = determine_status(m["statusText"])
        external_id = generate_external_id(m["player1"], m["player2"], m["league"])

        processed.append({
            "external_id": external_id,
            "league": m["league"],
            "player1": m["player1"],
            "player2": m["player2"],
            "score1": m["score1"],
            "score2": m["score2"],
            "status": status,
            "start_time": now_str,
            "odds1": m["odds1"],
            "odds2": m["odds2"],
            "source_type": "live",
        })

    return processed


async def scrape_betboom_prematch(page) -> list:
    """Scrape prematch/upcoming TT matches from BetBoom."""
    log.info("Loading BetBoom prematch page...")
    await page.goto(BB_PREMATCH_URL, timeout=30000, wait_until="domcontentloaded")
    await page.wait_for_timeout(3000)
    await accept_cookies(page)
    await page.wait_for_timeout(6000)

    # The prematch page may need interaction to load TT content
    # Try clicking the TT link in the sidebar
    try:
        tt_link = page.locator('text=Настольный теннис').first
        if await tt_link.is_visible(timeout=5000):
            await tt_link.click()
            log.info("Clicked TT link in sidebar")
            await page.wait_for_timeout(8000)
    except Exception:
        log.info("TT link not found or not clickable, trying scroll...")
        try:
            await page.evaluate("window.scrollTo(0, 800)")
            await page.wait_for_timeout(5000)
        except Exception:
            pass

    raw_matches = await page.evaluate(JS_EXTRACT_PREMATCH)
    log.info(f"Extracted {len(raw_matches)} raw prematch matches")

    processed = []

    for m in raw_matches:
        start_time = parse_start_time(m["startText"])
        external_id = generate_external_id(m["player1"], m["player2"], m["league"])

        processed.append({
            "external_id": external_id,
            "league": m["league"],
            "player1": m["player1"],
            "player2": m["player2"],
            "score1": 0,
            "score2": 0,
            "status": "upcoming",
            "start_time": start_time,
            "odds1": m["odds1"],
            "odds2": m["odds2"],
            "source_type": "prematch",
        })

    return processed


async def run_collector():
    """Main collector entry point."""
    start_time = time.time()
    log.info("=" * 60)
    log.info("Starting real data collection from BetBoom")

    conn = get_db()

    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-extensions",
                ],
            )
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1920, "height": 1080},
                locale="ru-RU",
            )
            page = await context.new_page()

            all_matches = []
            errors = []

            # 1. Scrape live matches
            try:
                live_matches = await scrape_betboom_live(page)
                all_matches.extend(live_matches)
                log.info(f"Live matches collected: {len(live_matches)}")
            except Exception as e:
                err_msg = f"Live scrape error: {e}"
                log.error(err_msg)
                errors.append(err_msg)

            await page.wait_for_timeout(3000)

            # 2. Scrape prematch matches
            try:
                prematch_matches = await scrape_betboom_prematch(page)
                all_matches.extend(prematch_matches)
                log.info(f"Prematch matches collected: {len(prematch_matches)}")
            except Exception as e:
                err_msg = f"Prematch scrape error: {e}"
                log.error(err_msg)
                errors.append(err_msg)

            await browser.close()

        # Process into database
        matches_found = len(all_matches)
        matches_new = 0
        matches_updated = 0

        for match_data in all_matches:
            try:
                match_id, is_new, is_updated = upsert_match(conn, match_data)
                if is_new:
                    matches_new += 1
                    log.info(f"  NEW: {match_data['player1']} vs {match_data['player2']} ({match_data['league']}) [{match_data['status']}]")
                if is_updated:
                    matches_updated += 1
                    log.info(f"  UPD: {match_data['player1']} vs {match_data['player2']} -> {match_data['score1']}:{match_data['score2']} [{match_data['status']}]")
            except Exception as e:
                log.warning(f"Error upserting match: {e}")

        # Mark stale upcoming matches
        stale_count = mark_stale_upcoming_as_finished(conn)

        conn.commit()

        duration_ms = int((time.time() - start_time) * 1000)
        status = "success" if not errors else "partial"
        error_str = "; ".join(errors) if errors else None

        log_collection(
            conn, SOURCE_NAME, status, matches_found,
            matches_new, matches_updated, duration_ms, error_str,
        )
        conn.commit()

        log.info(
            f"Done: found={matches_found}, new={matches_new}, "
            f"updated={matches_updated}, stale={stale_count}, "
            f"duration={duration_ms}ms"
        )

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        log.error(f"Collector failed: {e}", exc_info=True)
        try:
            log_collection(conn, SOURCE_NAME, "error", 0, 0, 0, duration_ms, str(e))
            conn.commit()
        except Exception:
            pass
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    asyncio.run(run_collector())
