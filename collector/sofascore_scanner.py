#!/usr/bin/env python3
"""
SofaScore Table Tennis Results Scanner v2

Uses Playwright to bypass Cloudflare, fetches finished TT matches from:
  GET /sport/table-tennis/scheduled-events/{YYYY-MM-DD}

Matches results with void/stale matches in the DB by player name + time.

DB Schema (Prisma):
  Table "Match": id(TEXT UUID), player1, player2, score1, score2,
                  winner(TEXT), status, league, startTime(DATETIME ISO)

SofaScore response:
  winnerCode: 1=home, 2=away
  homeTeam.name, awayTeam.name (Latin)
  homeScore.current, awayScore.current
  tournament.uniqueTournament.name
  startTimestamp (unix)
  status.type: 'finished'|'inprogress'|'notstarted'|'canceled'

Usage:
  python3 sofascore_scanner.py --demo --pages 2
  python3 sofascore_scanner.py --dry-run --days 3
  python3 sofascore_scanner.py --days 3
"""

import sys, os, json, time, re, sqlite3, argparse, logging
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
from playwright.sync_api import sync_playwright

# ──────────────────────────────────────────────
SOFASCORE_API_BASE = "https://api.sofascore.com/api/v1"
DATE_URL = f"{SOFASCORE_API_BASE}/sport/table-tennis/scheduled-events"

TARGET_LEAGUES = [
    "setka cup", "tt cup", "tt elite series", "liga pro",
    "czech liga pro", "win cup", "bull cup", "star cup",
]

NAME_SIMILARITY_THRESHOLD = 0.70
TIME_TOLERANCE_SECONDS = 300  # 5 min

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'db', 'custom.db')
LOG_DIR = '/var/www/tt-predict/logs'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(os.path.join(LOG_DIR, 'sofascore_scanner.log'), mode='a')
    ]
)
log = logging.getLogger('sofascore_scanner')


# ──────────────────────────────────────────────
# Cyrillic ↔ Latin transliteration for name matching
# ──────────────────────────────────────────────
CYR_TO_LAT = {
    'а':'a','б':'b','в':'v','г':'h','г':'g','д':'d','е':'e','є':'ie',
    'ж':'zh','з':'z','и':'y','і':'i','ї':'i','й':'y','к':'k',
    'л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s',
    'т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh',
    'щ':'shch','ь':'','ю':'iu','я':'ia','ё':'yo','ъ':'',
    'э':'e','ы':'y',
    'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o',
    'ś':'s','ź':'z','ż':'z',
    'ä':'a','ö':'o','ü':'u','ß':'ss',
}

def transliterate_to_latin(text):
    if not text: return ""
    r = []
    for ch in text.lower():
        if ch in CYR_TO_LAT: r.append(CYR_TO_LAT[ch])
        elif ch.isascii() and ch.isalpha(): r.append(ch)
        elif ch == ' ': r.append(' ')
    return re.sub(r'\s+', ' ', ''.join(r)).strip()

def normalize_name(name):
    if not name: return ""
    n = name.lower().strip()
    n = re.sub(r'\s+(мл\.?|ст\.?|мл|ст|jr\.?|sr\.?)\s*$', '', n)
    n = re.sub(r'\s+', ' ', n).strip()
    return n

def latinize(name):
    return transliterate_to_latin(normalize_name(name))

def name_similarity(name1, name2):
    if not name1 or not name2: return 0.0
    n1, n2 = normalize_name(name1), normalize_name(name2)
    if n1 == n2: return 1.0
    l1, l2 = latinize(name1), latinize(name2)
    if l1 and l2 and l1 == l2: return 0.95
    if l1 and l2 and (l1 in l2 or l2 in l1): return 0.82

    def token_sim(p1, p2):
        if not p1 or not p2: return 0.0
        ln1, ln2 = p1[-1], p2[-1]
        fn1, fn2 = p1[0], p2[0]
        if ln1 == ln2:
            s = 0.6
            if fn1 == fn2: s += 0.35
            elif fn1 and fn2 and fn1[0] == fn2[0]: s += 0.15
            return s
        if ln1 in ln2 or ln2 in ln1:
            s = 0.5
            if fn1 and fn2 and fn1[0] == fn2[0]: s += 0.15
            return s
        common = set(p1) & set(p2)
        if common: return len(common) / max(len(p1), len(p2)) * 0.5
        return 0.0

    p1o, p2o = n1.split(), n2.split()
    p1l, p2l = l1.split() if l1 else [], l2.split() if l2 else []
    scores = [token_sim(p1o, p2o)]
    if p1l and p2l: scores.append(token_sim(p1l, p2l))
    if p2l: scores.append(token_sim(p1o, p2l))
    if p1l: scores.append(token_sim(p1l, p2o))
    result = max(scores)
    # Minimum: last names must be somewhat similar
    if result < 0.5: return result
    ln1 = (l1.split()[-1] if l1 else '') or (p1o[-1] if p1o else '')
    ln2 = (l2.split()[-1] if l2 else '') or (p2o[-1] if p2o else '')
    if not ln1 or not ln2: return result * 0.5
    # Check last name similarity directly
    if ln1 == ln2: return max(result, 0.65)
    if ln1 in ln2 or ln2 in ln1: return max(result, 0.60)
    # No last name overlap at all - very likely wrong
    common_ln = set(ln1) & set(ln2)
    if len(common_ln) < max(len(ln1), len(ln2)) * 0.4: return result * 0.3
    return result


# ──────────────────────────────────────────────
# Playwright API fetcher
# ──────────────────────────────────────────────
class SofaScoreAPI:
    def __init__(self):
        self.browser = self.context = self.page = self._pw = None

    def start(self):
        self._pw = sync_playwright().start()
        self.browser = self._pw.chromium.launch(
            headless=True,
            args=['--no-sandbox','--disable-setuid-sandbox',
                  '--disable-blink-features=AutomationControlled','--ignore-certificate-errors']
        )
        self.context = self.browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            viewport={'width':1920,'height':1080}, locale='en-US',
        )
        self.context.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined});")
        self.page = self.context.new_page()
        log.info("Initializing SofaScore session...")
        try:
            self.page.goto('https://www.sofascore.com/table-tennis', wait_until='domcontentloaded', timeout=30000)
            self.page.wait_for_timeout(3000)
            log.info("Session OK")
        except Exception as e:
            log.warning(f"Session init: {e}")

    def fetch_date(self, date_str, max_retries=3):
        url = f"{DATE_URL}/{date_str}"
        for attempt in range(max_retries):
            try:
                resp = self.page.goto(url, wait_until='domcontentloaded', timeout=20000)
                if resp.status != 200:
                    if resp.status == 403: self.page.wait_for_timeout(5000); continue
                    return None
                content = self.page.content()
                if 'challenge-platform' in content or 'Just a moment' in content:
                    log.warning("Cloudflare challenge, waiting..."); self.page.wait_for_timeout(8000); continue
                text = self.page.inner_text('body')
                if not text or text.strip().startswith('<'): self.page.wait_for_timeout(3000); continue
                return json.loads(text)
            except json.JSONDecodeError as e:
                log.error(f"JSON error: {e}"); return None
            except Exception as e:
                log.warning(f"Fetch err (attempt {attempt+1}): {e}")
                if attempt < max_retries-1: self.page.wait_for_timeout(3000)
        return None

    def get_finished_events(self, date_str):
        data = self.fetch_date(date_str)
        if data and 'events' in data:
            return [ev for ev in data['events']
                    if ev.get('status',{}).get('type') == 'finished' and ev.get('winnerCode')]
        return []

    def close(self):
        for x in [self.browser, self._pw]:
            try:
                x.close() if hasattr(x, 'close') else x.stop() if hasattr(x, 'stop') else None
            except: pass


# ──────────────────────────────────────────────
# Database
# ──────────────────────────────────────────────
def get_void_matches(db_path):
    conn = sqlite3.connect(db_path); conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT id,player1,player2,score1,score2,status,winner,league,startTime FROM Match WHERE status='void' ORDER BY startTime DESC")
    rows = [dict(r) for r in cur.fetchall()]; conn.close(); return rows

def get_stale_live_matches(db_path):
    conn = sqlite3.connect(db_path); conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT id,player1,player2,score1,score2,status,winner,league,startTime FROM Match WHERE status='live' AND datetime(startTime)<datetime('now','-30 minutes') ORDER BY startTime DESC")
    rows = [dict(r) for r in cur.fetchall()]; conn.close(); return rows

def update_match_result(db_path, match_id, score1, score2, winner):
    conn = sqlite3.connect(db_path); cur = conn.cursor()
    cur.execute("UPDATE Match SET score1=?,score2=?,winner=?,status='finished',updatedAt=datetime('now') WHERE id=?", (score1,score2,winner,match_id))
    conn.commit(); ok = cur.rowcount > 0; conn.close(); return ok


# ──────────────────────────────────────────────
# Matching
# ──────────────────────────────────────────────
def league_match(sofa_league, db_league):
    """Check if SofaScore league matches DB league."""
    if not sofa_league or not db_league: return 0.5  # unknown
    sl, dl = sofa_league.lower(), db_league.lower()
    # Direct match
    if sl in dl or dl in sl: return 1.0
    # Partial match
    sl_words = set(re.split(r'[-,.\\s]+', sl))
    dl_words = set(re.split(r'[-,.\\s]+', dl))
    common = sl_words & dl_words
    if common and len(common) >= min(len(sl_words), len(dl_words)): return 0.8
    return 0.0

def match_event_to_db(ev, db_matches):
    sh = ev.get('homeTeam',{}).get('name','')
    sa = ev.get('awayTeam',{}).get('name','')
    ts = ev.get('startTimestamp',0)
    sofa_league = ev.get('tournament',{}).get('uniqueTournament',{}).get('name','')
    if not sh or not sa or not ts: return None
    sofa_time = datetime.fromtimestamp(ts, tz=timezone.utc)

    best, best_score = None, 0
    for dbm in db_matches:
        p1, p2, st = dbm.get('player1',''), dbm.get('player2',''), dbm.get('startTime','')
        db_league = dbm.get('league','')
        if not p1 or not p2 or not st: continue
        try:
            if 'T' in st: dbt = datetime.fromisoformat(st.replace('Z','+00:00'))
            else: dbt = datetime.strptime(st,'%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
        except: continue
        td = abs((sofa_time - dbt).total_seconds())
        if td > TIME_TOLERANCE_SECONDS: continue

        sim_n = (name_similarity(sh,p1)+name_similarity(sa,p2))/2
        sim_s = (name_similarity(sh,p2)+name_similarity(sa,p1))/2
        swapped = sim_s > sim_n
        ms = max(sim_n, sim_s)
        if ms < 0.5: continue  # Skip very low name matches early

        tb = max(0, 1 - td/TIME_TOLERANCE_SECONDS)*0.10
        lg = league_match(sofa_league, db_league) * 0.10
        fs = ms + tb + lg

        if fs > best_score:
            best_score = fs
            best = {'dbm':dbm,'score':fs,'swapped':swapped,
                    'h_sim':max(name_similarity(sh,p1),name_similarity(sh,p2)),
                    'a_sim':max(name_similarity(sa,p1),name_similarity(sa,p2)),
                    'td':td,'lg':lg}
    return best if best and best['score'] >= NAME_SIMILARITY_THRESHOLD else None


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
def run_scanner(days=3, dry_run=False, demo=False):
    log.info("="*60)
    log.info(f"SofaScore TT Scanner v2 | days={days} dry_run={dry_run} demo={demo}")
    log.info("="*60)

    api = SofaScoreAPI()
    all_finished = []
    try:
        api.start()

        today = date.today()
        for i in range(days):
            d = today - timedelta(days=i)
            dstr = d.isoformat()
            log.info(f"Fetching {dstr}...")
            events = api.get_finished_events(dstr)
            log.info(f"  {dstr}: {len(events)} finished events")
            all_finished.extend(events)
            time.sleep(1.5)

        log.info(f"Total finished events: {len(all_finished)}")
        if not all_finished: log.warning("No events!"); return

        if demo:
            log.info("\n--- DEMO: Sample events ---")
            for i, ev in enumerate(all_finished[:30]):
                h = ev.get('homeTeam',{}).get('name','?')
                a = ev.get('awayTeam',{}).get('name','?')
                hs = ev.get('homeScore',{}).get('current',0) or 0
                as_ = ev.get('awayScore',{}).get('current',0) or 0
                wc = ev.get('winnerCode',0)
                w = h if wc==1 else a if wc==2 else '?'
                tn = ev.get('tournament',{}).get('uniqueTournament',{}).get('name','?')
                ts = ev.get('startTimestamp',0)
                dt = datetime.fromtimestamp(ts,tz=timezone.utc).strftime('%m-%d %H:%M')
                log.info(f"  {i+1}. [{dt}] {h} {hs}:{as_} {a} | W:{w} | {tn}")
            return

        db_path = os.path.abspath(DB_PATH)
        if not os.path.exists(db_path): log.error(f"DB not found: {db_path}"); return

        void_m = get_void_matches(db_path)
        stale_m = get_stale_live_matches(db_path)
        all_db = void_m + stale_m
        log.info(f"DB: {len(void_m)} void + {len(stale_m)} stale = {len(all_db)}")
        if not all_db: log.info("No matches to check"); return

        matched, updated, used = 0, 0, set()
        for ev in all_finished:
            m = match_event_to_db(ev, all_db)
            if not m or m['dbm']['id'] in used: continue
            dbm = m['dbm']
            used.add(dbm['id'])

            hs = ev.get('homeScore',{}).get('current',0) or 0
            as_ = ev.get('awayScore',{}).get('current',0) or 0
            wc = ev.get('winnerCode',0)
            sh = ev.get('homeTeam',{}).get('name','')
            sa = ev.get('awayTeam',{}).get('name','')

            if m['swapped']:
                winner_sofa = sa if wc==1 else sh if wc==2 else None
                db_s1, db_s2 = as_, hs
            else:
                winner_sofa = sh if wc==1 else sa if wc==2 else None
                db_s1, db_s2 = hs, as_

            # Map to DB player name
            if winner_sofa:
                s1 = name_similarity(winner_sofa, dbm['player1'])
                s2 = name_similarity(winner_sofa, dbm['player2'])
                winner_name = dbm['player1'] if s1 > s2 else dbm['player2']
            else:
                winner_name = None

            matched += 1
            log.info(f"\n✓ MATCH (score={m['score']:.2f} td={m['td']:.0f}s swap={m['swapped']}):")
            log.info(f"  DB:   {dbm['player1']} vs {dbm['player2']} | {dbm['league']} | {dbm['startTime']}")
            log.info(f"  Sofa: {sh} vs {sa} | {hs}:{as_} | winner={winner_sofa}")
            log.info(f"  → {db_s1}:{db_s2} winner={winner_name}")

            if not dry_run:
                ok = update_match_result(db_path, dbm['id'], db_s1, db_s2, winner_name)
                if ok:
                    updated += 1; log.info(f"  ✅ UPDATED {dbm['id'][:8]}...")
                else:
                    log.info(f"  ❌ FAILED {dbm['id'][:8]}...")

        log.info("\n" + "="*60)
        log.info(f"SUMMARY: events={len(all_finished)} | void={len(void_m)} | stale={len(stale_m)}")
        log(f"  matched={matched} | updated={updated} | remaining={len(all_db)-matched}")
        log.info("="*60)

    except Exception as e:
        log.error(f"Error: {e}", exc_info=True)
    finally:
        api.close()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='SofaScore TT Scanner v2')
    p.add_argument('--days', type=int, default=3, help='Days to scan back (default 3)')
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--demo', action='store_true')
    p.add_argument('--db', type=str, default=None)
    a = p.parse_args()
    if a.db: DB_PATH = a.db
    os.makedirs(LOG_DIR, exist_ok=True)
    run_scanner(days=a.days, dry_run=a.dry_run, demo=a.demo)
