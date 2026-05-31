#!/usr/bin/env python3
"""Deploy TT Predict to production server via SSH. Full mode: rsync all files, install, seed, start."""
import paramiko
import os
import sys

HOST = "2.26.122.152"
PORT = 22
USER = "root"
PASS = "Pi#Tx0bh&mQ2!6P6"
REMOTE_PATH = "/var/www/tt-predict"
LOCAL_PATH = "/home/z/my-project"
BUN_PATH = "/root/.bun/bin/bun"

EXCLUDE_DIRS = {'.next', 'node_modules', '.git', 'bun.lock', 'dev.log', '*.pyc', '__pycache__',
               'download', 'collector', 'examples', 'screenshots', '*.png', '*.jpg'}
EXCLUDE_FILES = {'dev.log', '*.png', '*.jpg', 'real_collector.py', 'test_*.py', 'extract_test.py',
                 'result_checker.py', 'deploy.py', 'screenshot_*.png', 'ss_*.png'}

def run_cmd(ssh, cmd, check=True):
    print(f"  $ {cmd[:120]}...")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=300)
    out = stdout.read().decode()
    err = stderr.read().decode()
    exit_code = stdout.channel.recv_exit_status()
    if out.strip():
        for line in out.strip().split('\n')[-8:]:
            print(f"    {line}")
    if err.strip():
        for line in err.strip().split('\n')[-5:]:
            print(f"    [stderr] {line}")
    if check and exit_code != 0:
        print(f"    ⚠ Exit code: {exit_code}")
    return out, err, exit_code

def should_upload(name):
    """Check if file/dir should be uploaded."""
    if name in EXCLUDE_DIRS or name in EXCLUDE_FILES:
        return False
    if name.startswith('ss_') or name.startswith('screenshot_'):
        return False
    return True

def upload_dir(sftp, local_dir, remote_dir):
    """Recursively upload directory."""
    try:
        items = os.listdir(local_dir)
    except PermissionError:
        return

    for item in sorted(items):
        if not should_upload(item):
            continue
        local_path = os.path.join(local_dir, item)
        remote_path = f"{remote_dir}/{item}"

        if os.path.isfile(local_path):
            try:
                sftp.put(local_path, remote_path)
                print(f"  ↑ {item}")
            except Exception as e:
                print(f"  ⚠ Failed to upload {item}: {e}")
        elif os.path.isdir(local_path):
            try:
                sftp.stat(remote_path)
            except FileNotFoundError:
                try:
                    sftp.mkdir(remote_path)
                except Exception as e:
                    print(f"  ⚠ Failed to mkdir {item}: {e}")
                    continue
            upload_dir(sftp, local_path, remote_path)

def main():
    print(f"🔗 Connecting to {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASS, timeout=15)
    print("  ✅ Connected")

    sftp = ssh.open_sftp()

    # Step 1: Kill existing PM2 processes and old dev servers
    print("\n🛑 Stopping existing processes...")
    run_cmd(ssh, "pm2 delete all 2>/dev/null; pkill -f 'next dev' 2>/dev/null; pkill -f 'bun.*start' 2>/dev/null", check=False)
    run_cmd(ssh, "sleep 1", check=False)

    # Step 2: Create remote directories
    print("\n📁 Creating directories...")
    all_dirs = [
        'prisma', 'src/app/api/matches', 'src/app/api/ai-bets', 'src/app/api/stats',
        'src/app/api/bankroll', 'src/app/api/ai-bankroll', 'src/app/api/predictors',
        'src/app/api/collection-logs', 'src/app/api/ai-profiles', 'src/app/api/tipsters',
        'src/app/api/predict', 'src/app/api/collect',
        'src/app/api/collect/trigger',
        'src/lib/strategies', 'src/components/ui', 'src/hooks',
        'db', 'public', 'scripts', 'logs', 'mini-services',
    ]
    for d in all_dirs:
        remote_d = f"{REMOTE_PATH}/{d}"
        try:
            sftp.stat(remote_d)
        except FileNotFoundError:
            print(f"  mkdir {d}")
            try:
                sftp.mkdir(remote_d)
            except Exception as e:
                print(f"  ⚠ mkdir {d}: {e}")

    # Step 3: Upload ALL files
    print("\n📦 Uploading project files...")

    # Config files first
    for f in ['package.json', '.env', 'next.config.ts', 'tailwind.config.ts', 'tsconfig.json',
              'postcss.config.mjs', 'eslint.config.mjs', 'components.json', 'Caddyfile']:
        local_f = f"{LOCAL_PATH}/{f}"
        if os.path.isfile(local_f):
            print(f"  ↑ {f}")
            try:
                sftp.put(local_f, f"{REMOTE_PATH}/{f}")
            except Exception as e:
                print(f"  ⚠ {f}: {e}")

    # prisma/
    for f in os.listdir(f"{LOCAL_PATH}/prisma"):
        if should_upload(f):
            local_f = f"{LOCAL_PATH}/prisma/{f}"
            if os.path.isfile(local_f):
                print(f"  ↑ prisma/{f}")
                sftp.put(local_f, f"{REMOTE_PATH}/prisma/{f}")

    # src/ (full recursive)
    print("\n📦 Uploading src/...")
    upload_dir(sftp, f"{LOCAL_PATH}/src", f"{REMOTE_PATH}/src")

    # scripts/
    print("\n📦 Uploading scripts/...")
    for f in os.listdir(f"{LOCAL_PATH}/scripts"):
        local_f = f"{LOCAL_PATH}/scripts/{f}"
        if os.path.isfile(local_f) and should_upload(f):
            print(f"  ↑ scripts/{f}")
            sftp.put(local_f, f"{REMOTE_PATH}/scripts/{f}")

    # public/
    print("\n📦 Uploading public/...")
    upload_dir(sftp, f"{LOCAL_PATH}/public", f"{REMOTE_PATH}/public")

    # collector (python scripts)
    print("\n📦 Uploading collector/...")
    for f in os.listdir(f"{LOCAL_PATH}/collector"):
        if '__pycache__' in f:
            continue
        local_f = f"{LOCAL_PATH}/collector/{f}"
        remote_f = f"{REMOTE_PATH}/collector/{f}"
        if os.path.isfile(local_f):
            try:
                sftp.stat(f"{REMOTE_PATH}/collector")
            except FileNotFoundError:
                sftp.mkdir(f"{REMOTE_PATH}/collector")
            print(f"  ↑ collector/{f}")
            sftp.put(local_f, remote_f)

    sftp.close()

    # Step 4: Install dependencies
    print("\n🔧 Installing dependencies...")
    run_cmd(ssh, f"cd {REMOTE_PATH} && {BUN_PATH} install 2>&1 | tail -5", check=False)

    # Step 5: Prisma generate + push
    print("\n🔧 Generating Prisma client...")
    run_cmd(ssh, f"cd {REMOTE_PATH} && {BUN_PATH}x prisma generate 2>&1 | tail -3", check=False)

    print("\n🔧 Pushing DB schema (force reset)...")
    run_cmd(ssh, f"cd {REMOTE_PATH} && {BUN_PATH}x prisma db push --force-reset 2>&1 | tail -5", check=False)

    print("\n🌱 Seeding database (5 AI profiles)...")
    run_cmd(ssh, f"cd {REMOTE_PATH} && {BUN_PATH}x prisma db seed 2>&1 | tail -10", check=False)

    # Step 6: Seed matches + run predictions
    print("\n🏓 Seeding matches and running predictions...")
    run_cmd(ssh, f"cd {REMOTE_PATH} && {BUN_PATH} run scripts/seed-matches.ts 2>&1 | grep -v 'prisma:query'", check=False)

    # Step 7: Start dev server via PM2 (dev mode for simplicity — no build needed)
    print("\n🚀 Starting Next.js dev server via PM2...")
    run_cmd(ssh, f"cd {REMOTE_PATH} && PORT=3001 pm2 start {BUN_PATH} --name tt-predict -- --hot run dev 2>&1 | tail -5", check=False)
    run_cmd(ssh, "sleep 2", check=False)
    run_cmd(ssh, "pm2 save 2>/dev/null", check=False)

    # Step 8: Verify
    print("\n✅ Verifying deployment...")
    verify_cmd = (
        'sleep 3 && curl -s http://localhost:3001/api/ai-profiles 2>/dev/null | '
        "python3 -c 'import json,sys; profiles=json.load(sys.stdin); "
        '[print(f\"  {p.get(chr(101)+chr(109)+chr(111)+chr(106)+chr(105),\"?\")} '
        '{p[\"name\"]}: {p[\"currentAmount\"]}\u20bd\") for p in profiles[:5]]\' '
        "2>/dev/null || echo 'API not responding yet'"
    )
    run_cmd(ssh, verify_cmd, check=False)

    # Show match/bet counts
    stats_cmd = (
        'curl -s http://localhost:3001/api/stats 2>/dev/null | '
        "python3 -c 'import json,sys; d=json.load(sys.stdin); "
        'print(f\"  Matches: {d.get(\"totalMatches\",0)} | Bets: {d.get(\"totalBets\",0)}\")\' '
        "2>/dev/null"
    )
    run_cmd(ssh, stats_cmd, check=False)

    # Caddy check
    run_cmd(ssh, "systemctl status caddy 2>/dev/null | head -5", check=False)

    print(f"\n🎉 Deploy complete!")
    print(f"   PM2:     http://{HOST}:3001")
    print(f"   Caddy:   http://{HOST} (port 81)")
    print(f"   Run 'pm2 logs tt-predict' on server for logs")

    ssh.close()

if __name__ == "__main__":
    main()
