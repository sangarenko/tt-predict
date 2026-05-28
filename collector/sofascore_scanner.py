#!/usr/bin/env python3
"""
SofaScore Table Tennis Results Scanner

Uses Playwright to bypass Cloudflare and fetch finished TT match results
from SofaScore API. Matches results with void bets in the database
and updates them with actual outcomes.

SofaScore API:
  Base URL: https://api.sofascore.com/api/v1
  Finished TT events: GET /sport/table-tennis/events/finished/{page}
  
  Response key fields:
    - winnerCode: 1 = home team won, 2 = away team won
    - homeTeam.name / awayTeam.name: player names
    - homeScore.current / awayScore.current: final score
    - tournament.uniqueTournament.name: league name
    - startTimestamp: unix timestamp of match start
    - status.code: 100 = finished

Usage:
  python3 sofascore_scanner.py              # scan last 3 pages of finished events
  python3 sofascore_scanner.py --pages 5    # scan last 5 pages
  python3 sofascore_scanner.py --dry-run    # show matches without updating DB
  python3 sofascore_scanner.py --demo       # demo mode - just fetch and print events
"""

import sys
import os
import json
import time
import re
import sqlite3
import argparse
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Playwright
from playwright.sync_api import sync_playwright

# ──────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────
SOFASCORE_API_BASE = "https://api.sofascore.com/api/v1"
TT_FINISHED_URL = f"{SOFASCORE_API_BASE}/sport/table-tennis/events/finished"

# BetBoom leagues we care about (SofaScore names may differ slightly)
TARGET_LEAGUES = [
    "setka cup", "liga pro", "win cup", "tt cup",
    "tt elite series", "lions bet cup", "kings cup",
    "star cup", "bull cup", "european league",
    "champions league", "super league", "premier league",
]

# Name similarity threshold (0-1, higher = stricter)
NAME_SIMILARITY_THRESHOLD = 0.65

# Time tolerance for match matching (seconds) - TT matches may start 1-2 min off
TIME_TOLERANCE_SECONDS = 300  # 5 minutes

# Database path (relative to script or absolute)
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'db', 'custom.db')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('/var/www/tt-predict/logs/sofascore_scanner.log', mode='a')
    ]
)
log = logging.getLogger('sofascore_scanner')


# ──────────────────────────────────────────────
# Playwright-based API fetcher (bypasses Cloudflare)
# ──────────────────────────────────────────────
class SofaScoreAPI:
    """Fetches SofaScore API using Playwright to handle Cloudflare."""
    
    def __init__(self):
        self.browser = None
        self.context = None
        self.page = None
    
    def start(self):
        """Launch browser with stealth settings."""
        self.browser = None  # Will use chromium
        pw = sync_playwright().start()
        # Use chromium - most compatible
        self.browser = pw.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--window-position=0,0',
                '--ignore-certificate-errors',
            ]
        )
        self.context = self.browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080},
            locale='en-US',
        )
        # Remove webdriver flag
        self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        """)
        self.page = self.context.new_page()
        # Navigate to sofascore.com first to get cookies/session
        log.info("Initializing SofaScore session...")
        try:
            self.page.goto('https://www.sofascore.com/table-tennis', 
                          wait_until='domcontentloaded', timeout=30000)
            self.page.wait_for_timeout(3000)
            log.info("SofaScore session initialized")
        except Exception as e:
            log.warning(f"Initial navigation warning (may be ok): {e}")
        self._pw = pw  # Keep reference for cleanup
    
    def fetch_json(self, url: str, max_retries: int = 3) -> dict | None:
        """Fetch JSON from SofaScore API URL using the browser."""
        for attempt in range(max_retries):
            try:
                log.debug(f"Fetching: {url} (attempt {attempt + 1})")
                response = self.page.goto(url, wait_until='domcontentloaded', timeout=20000)
                
                if response.status != 200:
                    log.warning(f"HTTP {response.status} for {url}")
                    if response.status == 403:
                        # Cloudflare challenge - wait and retry
                        self.page.wait_for_timeout(5000)
                        continue
                    return None
                
                # Check if we got Cloudflare challenge page instead of JSON
                content = self.page.content()
                if 'challenge-platform' in content or 'Just a moment' in content:
                    log.warning("Cloudflare challenge detected, waiting...")
                    self.page.wait_for_timeout(8000)
                    continue
                
                # Extract JSON from the page
                # The API returns JSON directly
                json_text = self.page.inner_text('body')
                if not json_text or json_text.startswith('<'):
                    # Not JSON - might be HTML error page
                    log.warning("Response is not JSON, retrying...")
                    self.page.wait_for_timeout(3000)
                    continue
                
                return json.loads(json_text)
                
            except json.JSONDecodeError as e:
                log.error(f"JSON parse error: {e}")
                return None
            except Exception as e:
                log.warning(f"Fetch error (attempt {attempt + 1}): {e}")
                if attempt < max_retries - 1:
                    self.page.wait_for_timeout(3000)
        
        return None
    
    def get_finished_tt_events(self, page: int = 0) -> list[dict]:
        """Get finished table tennis events for a given page."""
        url = f"{TT_FINISHED_URL}/{page}"
        data = self.fetch_json(url)
        if data and 'events' in data:
            return data['events']
        return []
    
    def close(self):
        """Close browser."""
        try:
            if self.browser:
                self.browser.close()
        except:
            pass
        try:
            if hasattr(self, '_pw') and self._pw:
                self._pw.stop()
        except:
            pass


# ──────────────────────────────────────────────
# Name matching utilities
# ──────────────────────────────────────────────
def normalize_name(name: str) -> str:
    """Normalize player name for comparison."""
    if not name:
        return ""
    name = name.lower().strip()
    # Remove common suffixes/prefixes
    name = re.sub(r'\s+(jr\.?|sr\.?|iii?|iv)\b', '', name)
    # Remove extra spaces
    name = re.sub(r'\s+', ' ', name).strip()
    return name


def name_similarity(name1: str, name2: str) -> float:
    """
    Calculate similarity between two player names.
    Uses a combination of exact match, contains, and token-based matching.
    Returns a value between 0 and 1.
    """
    if not name1 or not name2:
        return 0.0
    
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    
    # Exact match
    if n1 == n2:
        return 1.0
    
    # One contains the other
    if n1 in n2 or n2 in n1:
        return 0.85
    
    # Check if last names match (most important for TT)
    parts1 = n1.split()
    parts2 = n2.split()
    
    if not parts1 or not parts2:
        return 0.0
    
    # Last name match
    if parts1[-1] == parts2[-1]:
        # Check first name/initial match
        first1 = parts1[0]
        first2 = parts2[0]
        if first1 == first2:
            return 0.95
        if first1[0] == first2[0]:
            return 0.80
        return 0.70
    
    # First name + last name swap check
    if len(parts1) >= 2 and len(parts2) >= 2:
        if parts1[0] == parts2[-1] and parts1[-1] == parts2[0]:
            return 0.90
    
    # Token overlap ratio
    common = set(parts1) & set(parts2)
    if common:
        overlap = len(common) / max(len(parts1), len(parts2))
        return max(overlap, 0.3)
    
    # Levenshtein-like simple check
    min_len = min(len(n1), len(n2))
    max_len = max(len(n1), len(n2))
    if min_len == 0:
        return 0.0
    return min_len / max_len * 0.5


def is_target_league(tournament_name: str) -> bool:
    """Check if tournament is one we care about (our betting leagues)."""
    if not tournament_name:
        return True  # If unknown, include it
    tn = tournament_name.lower()
    for league in TARGET_LEAGUES:
        if league in tn:
            return True
    return False


# ──────────────────────────────────────────────
# Database operations
# ──────────────────────────────────────────────
def get_void_matches(db_path: str) -> list[dict]:
    """Get all void/unfinished matches from database that need result checking."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get void matches where we have player names but no final result
    cursor.execute("""
        SELECT id, homePlayer, awayPlayer, homeScore, awayScore, 
               status, result, startTime, prediction
        FROM matches 
        WHERE status = 'void' 
           OR (status = 'live' AND startTime IS NOT NULL AND datetime(startTime) < datetime('now', '-30 minutes'))
        ORDER BY startTime DESC
    """)
    
    matches = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return matches


def get_all_finished_matches(db_path: str) -> list[dict]:
    """Get all finished matches from database for reference."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, homePlayer, awayPlayer, homeScore, awayScore,
               status, result, startTime
        FROM matches 
        WHERE status = 'finished'
        ORDER BY startTime DESC
    """)
    matches = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return matches


def update_match_result(db_path: str, match_id: int, home_score: int, away_score: int, 
                        winner: str, sofascore_id: int = None):
    """Update a match with SofaScore result."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("""
        UPDATE matches 
        SET homeScore = ?,
            awayScore = ?,
            status = 'finished',
            result = ?,
            updatedAt = datetime('now')
        WHERE id = ?
    """, (home_score, away_score, winner, match_id))
    
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    return rows_affected > 0


def update_bet_result_from_match(db_path: str, match_id: int):
    """
    After updating a match result, update corresponding bets.
    Determines if bet won/lost based on prediction vs actual result.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get the match and its bets
    cursor.execute("""
        SELECT m.homePlayer, m.awayPlayer, m.homeScore, m.awayScore, m.result,
               b.id as bet_id, b.prediction, b.selectedPlayer
        FROM matches m
        LEFT JOIN bets b ON b.matchId = m.id
        WHERE m.id = ? AND b.status = 'void'
    """, (match_id,))
    
    rows = cursor.fetchall()
    updates = []
    
    for row in rows:
        match = dict(row)
        bet_id = match['bet_id']
        prediction = match['prediction']
        selected_player = match['selected_player']
        home_score = match['homeScore']
        away_score = match['awayScore']
        
        if not bet_id or not prediction:
            continue
        
        # Determine winner
        if home_score > away_score:
            actual_winner = 'home'
        elif away_score > home_score:
            actual_winner = 'away'
        else:
            actual_winner = 'draw'
        
        # Check if bet won
        bet_won = False
        if prediction and selected_player:
            if actual_winner == 'draw':
                bet_won = False
            elif prediction.lower() in ['win', 'победа', '1', '2']:
                if prediction.lower() == '1' and actual_winner == 'home':
                    bet_won = True
                elif prediction.lower() == '2' and actual_winner == 'away':
                    bet_won = True
                elif prediction.lower() in ['win', 'победа']:
                    # Check if selected player matches winner
                    sel_norm = normalize_name(selected_player)
                    home_norm = normalize_name(match['homePlayer'])
                    away_norm = normalize_name(match['awayPlayer'])
                    if actual_winner == 'home' and name_similarity(selected_player, match['homePlayer']) > 0.6:
                        bet_won = True
                    elif actual_winner == 'away' and name_similarity(selected_player, match['awayPlayer']) > 0.6:
                        bet_won = True
            elif prediction.lower() in ['home', 'away']:
                if prediction.lower() == actual_winner:
                    bet_won = True
        
        # Update bet
        new_status = 'won' if bet_won else 'lost'
        cursor.execute("""
            UPDATE bets SET status = ?, updatedAt = datetime('now') WHERE id = ?
        """, (new_status, bet_id))
        updates.append({
            'bet_id': bet_id,
            'old_status': 'void',
            'new_status': new_status,
            'prediction': prediction,
            'actual_winner': actual_winner
        })
    
    conn.commit()
    conn.close()
    return updates


# ──────────────────────────────────────────────
# Core matching logic
# ──────────────────────────────────────────────
def match_sofascore_to_db(sofa_event: dict, db_matches: list[dict]) -> dict | None:
    """
    Try to match a SofaScore event to a database match.
    Returns the best matching DB match or None.
    """
    sofa_home = sofa_event.get('homeTeam', {}).get('name', '')
    sofa_away = sofa_event.get('awayTeam', {}).get('name', '')
    sofa_timestamp = sofa_event.get('startTimestamp', 0)
    sofa_tournament = sofa_event.get('tournament', {}).get('name', '')
    sofa_unique_tournament = sofa_event.get('tournament', {}).get('uniqueTournament', {}).get('name', '')
    
    if not sofa_home or not sofa_away:
        return None
    
    sofa_time = datetime.fromtimestamp(sofa_timestamp, tz=timezone.utc)
    
    best_match = None
    best_score = 0
    
    for db_match in db_matches:
        db_home = db_match.get('homePlayer', '')
        db_away = db_match.get('awayPlayer', '')
        db_start = db_match.get('startTime', '')
        
        if not db_home or not db_away or not db_start:
            continue
        
        # Parse DB time (ISO format or various formats)
        try:
            if 'T' in db_start:
                db_time = datetime.fromisoformat(db_start.replace('Z', '+00:00'))
            else:
                db_time = datetime.strptime(db_start, '%Y-%m-%d %H:%M:%S')
                db_time = db_time.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
        
        # Time difference check (within tolerance)
        time_diff = abs((sofa_time - db_time).total_seconds())
        if time_diff > TIME_TOLERANCE_SECONDS:
            continue
        
        # Name matching
        home_sim = name_similarity(sofa_home, db_home)
        away_sim = name_similarity(sofa_away, db_away)
        
        # Also check swapped (in case BetBoom vs SofaScore have home/away reversed)
        home_sim_swap = name_similarity(sofa_home, db_away)
        away_sim_swap = name_similarity(sofa_away, db_home)
        
        # Best score from normal and swapped
        normal_score = (home_sim + away_sim) / 2
        swapped_score = (home_sim_swap + away_sim_swap) / 2
        match_score = max(normal_score, swapped_score)
        
        # Boost score for good time match (closer time = higher boost)
        time_boost = max(0, 1 - time_diff / TIME_TOLERANCE_SECONDS) * 0.15
        
        final_score = match_score + time_boost
        
        if final_score > best_score:
            best_score = final_score
            is_swapped = swapped_score > normal_score
            best_match = {
                'db_match': db_match,
                'score': final_score,
                'is_swapped': is_swapped,
                'home_sim': max(home_sim, home_sim_swap),
                'away_sim': max(away_sim, away_sim_swap),
                'time_diff': time_diff
            }
    
    if best_match and best_match['score'] >= NAME_SIMILARITY_THRESHOLD:
        return best_match
    return None


def extract_score(sofa_event: dict) -> tuple[int, int]:
    """Extract home and away scores from SofaScore event."""
    home_score = sofa_event.get('homeScore', {}).get('current', 0) or 0
    away_score = sofa_event.get('awayScore', {}).get('current', 0) or 0
    return home_score, away_score


# ──────────────────────────────────────────────
# Main scanner
# ──────────────────────────────────────────────
def run_scanner(pages: int = 3, dry_run: bool = False, demo: bool = False):
    """Main scanner function."""
    log.info("=" * 60)
    log.info("SofaScore Table Tennis Results Scanner")
    log.info(f"Pages to scan: {pages}, Dry run: {dry_run}, Demo: {demo}")
    log.info("=" * 60)
    
    api = SofaScoreAPI()
    all_events = []
    
    try:
        api.start()
        
        # Fetch finished events from multiple pages
        for page_num in range(pages):
            log.info(f"Fetching page {page_num}...")
            events = api.get_finished_tt_events(page_num)
            if not events:
                log.info(f"No more events on page {page_num}")
                break
            log.info(f"Got {len(events)} events from page {page_num}")
            all_events.extend(events)
            time.sleep(1)  # Be polite
        
        log.info(f"Total events fetched: {len(all_events)}")
        
        if not all_events:
            log.warning("No events found! Cloudflare may be blocking.")
            return
        
        # Demo mode: just print events
        if demo:
            log.info("\n--- DEMO MODE: Showing events ---")
            for i, event in enumerate(all_events[:20]):
                home = event.get('homeTeam', {}).get('name', '?')
                away = event.get('awayTeam', {}).get('name', '?')
                hs, as_ = extract_score(event)
                winner = event.get('winnerCode', 0)
                winner_str = home if winner == 1 else away if winner == 2 else '?'
                tournament = event.get('tournament', {}).get('uniqueTournament', {}).get('name', '?')
                ts = event.get('startTimestamp', 0)
                dt = datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d %H:%M')
                log.info(f"  {i+1}. [{dt}] {home} {hs}:{as_} {away} | WIN: {winner_str} | {tournament}")
            return
        
        # Load database matches
        db_path = os.path.abspath(DB_PATH)
        if not os.path.exists(db_path):
            log.error(f"Database not found: {db_path}")
            return
        
        void_matches = get_void_matches(db_path)
        if not void_matches:
            log.info("No void matches to check in database.")
            return
        
        log.info(f"Found {len(void_matches)} void/live-stale matches in database")
        
        # Match events to DB
        matched = 0
        updated = 0
        bet_updates = []
        
        for event in all_events:
            match = match_sofascore_to_db(event, void_matches)
            if match:
                db_match = match['db_match']
                home_score, away_score = extract_score(event)
                winner_code = event.get('winnerCode', 0)
                sofa_home = event.get('homeTeam', {}).get('name', '')
                sofa_away = event.get('awayTeam', {}).get('name', '')
                
                if match['is_swapped']:
                    # SofaScore has teams in opposite order
                    winner_str = 'away' if winner_code == 1 else 'home' if winner_code == 2 else 'draw'
                    actual_home_score, actual_away_score = away_score, home_score
                else:
                    winner_str = 'home' if winner_code == 1 else 'away' if winner_code == 2 else 'draw'
                    actual_home_score, actual_away_score = home_score, away_score
                
                matched += 1
                log.info(f"\n✓ MATCH FOUND (score: {match['score']:.2f}):")
                log.info(f"  DB:      {db_match['homePlayer']} vs {db_match['awayPlayer']} (id={db_match['id']}, time={db_match['startTime']})")
                log.info(f"  Sofa:    {sofa_home} vs {sofa_away} (ts={event.get('startTimestamp')})")
                log.info(f"  Score:   {actual_home_score}:{actual_away_score} (winner: {winner_str})")
                log.info(f"  Similarity: home={match['home_sim']:.2f}, away={match['away_sim']:.2f}, time_diff={match['time_diff']:.0f}s")
                
                if not dry_run:
                    # Update match in database
                    success = update_match_result(
                        db_path, db_match['id'],
                        actual_home_score, actual_away_score,
                        winner_str,
                        sofascore_id=event.get('id')
                    )
                    
                    if success:
                        updated += 1
                        log.info(f"  → Match updated: id={db_match['id']}, result={winner_str}, score={actual_home_score}:{actual_away_score}")
                        
                        # Update bets
                        bet_results = update_bet_result_from_match(db_path, db_match['id'])
                        for br in bet_results:
                            log.info(f"  → Bet updated: id={br['bet_id']}, {br['old_status']}→{br['new_status']}")
                            bet_updates.append(br)
        
        # Summary
        log.info("\n" + "=" * 60)
        log.info("SCAN SUMMARY")
        log.info(f"  Events scanned:     {len(all_events)}")
        log.info(f"  Void matches in DB:  {len(void_matches)}")
        log.info(f"  Matches found:      {matched}")
        log.info(f"  Matches updated:    {updated}")
        log.info(f"  Bets updated:       {len(bet_updates)}")
        if bet_updates:
            won = sum(1 for b in bet_updates if b['new_status'] == 'won')
            lost = sum(1 for b in bet_updates if b['new_status'] == 'lost')
            log.info(f"  Bets won:           {won}")
            log.info(f"  Bets lost:          {lost}")
        log.info("=" * 60)
        
    except Exception as e:
        log.error(f"Scanner error: {e}", exc_info=True)
    finally:
        api.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='SofaScore Table Tennis Results Scanner')
    parser.add_argument('--pages', type=int, default=3, help='Number of pages to scan (default: 3)')
    parser.add_argument('--dry-run', action='store_true', help='Show matches without updating DB')
    parser.add_argument('--demo', action='store_true', help='Demo mode: just show SofaScore events')
    parser.add_argument('--db', type=str, default=None, help='Custom database path')
    args = parser.parse_args()
    
    if args.db:
        DB_PATH = args.db
    
    # Ensure log directory exists
    os.makedirs('/var/www/tt-predict/logs', exist_ok=True)
    
    run_scanner(pages=args.pages, dry_run=args.dry_run, demo=args.demo)
