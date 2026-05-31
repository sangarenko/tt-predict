#!/usr/bin/env python3
"""Step 1: Upload all project files to server."""
import paramiko
import os
import sys

HOST = "2.26.122.152"
PORT = 22
USER = "root"
PASS = "Pi#Tx0bh&mQ2!6P6"
REMOTE_PATH = "/var/www/tt-predict"
LOCAL_PATH = "/home/z/my-project"

EXCLUDE = {'.next', 'node_modules', '.git', 'bun.lock', 'dev.log', '__pycache__',
           'download', 'examples', '*.png', '*.jpg', 'ss_*.png', 'screenshot_*.png',
           'extract_test.py', 'result_checker.py', 'test_prematch.py', 'deploy.py',
           'AI_WORKLOG.md', 'real_collector.py'}

def should_upload(name):
    if name in EXCLUDE:
        return False
    if name.startswith('ss_') or name.startswith('screenshot_'):
        return False
    return True

def upload_dir(sftp, local_dir, remote_dir, indent=""):
    try:
        items = os.listdir(local_dir)
    except (PermissionError, FileNotFoundError):
        return
    for item in sorted(items):
        if not should_upload(item):
            continue
        lp = os.path.join(local_dir, item)
        rp = f"{remote_dir}/{item}"
        if os.path.isfile(lp):
            try:
                sftp.put(lp, rp)
                print(f"{indent}↑ {item}")
            except Exception as e:
                print(f"{indent}⚠ {item}: {e}")
        elif os.path.isdir(lp):
            try:
                sftp.stat(rp)
            except FileNotFoundError:
                try:
                    sftp.mkdir(rp)
                except:
                    continue
            upload_dir(sftp, lp, rp, indent)

def main():
    print(f"Connecting to {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASS, timeout=15)
    print("Connected!")
    sftp = ssh.open_sftp()

    # Create dirs
    print("Creating directories...")
    dirs = [
        'prisma', 'src/app/api/matches', 'src/app/api/ai-bets', 'src/app/api/stats',
        'src/app/api/bankroll', 'src/app/api/ai-bankroll', 'src/app/api/predictors',
        'src/app/api/collection-logs', 'src/app/api/ai-profiles', 'src/app/api/tipsters',
        'src/app/api/predict', 'src/app/api/collect', 'src/app/api/collect/trigger',
        'src/lib/strategies', 'src/components/ui', 'src/hooks', 'db', 'public',
        'scripts', 'logs', 'collector',
    ]
    for d in dirs:
        try:
            sftp.stat(f"{REMOTE_PATH}/{d}")
        except FileNotFoundError:
            try:
                sftp.mkdir(f"{REMOTE_PATH}/{d}")
            except:
                pass

    # Stop old processes
    print("Stopping old processes...")
    for cmd in ["pm2 delete all 2>/dev/null", "pkill -f 'next dev' 2>/dev/null"]:
        ssh.exec_command(cmd, timeout=10)

    # Upload config
    print("Uploading config...")
    for f in ['package.json', '.env', 'next.config.ts', 'tailwind.config.ts', 'tsconfig.json',
              'postcss.config.mjs', 'eslint.config.mjs', 'components.json', 'Caddyfile']:
        lp = f"{LOCAL_PATH}/{f}"
        if os.path.isfile(lp):
            print(f"  ↑ {f}")
            sftp.put(lp, f"{REMOTE_PATH}/{f}")

    # prisma/
    print("Uploading prisma/...")
    for f in sorted(os.listdir(f"{LOCAL_PATH}/prisma")):
        if should_upload(f):
            lp = f"{LOCAL_PATH}/prisma/{f}"
            if os.path.isfile(lp):
                print(f"  ↑ prisma/{f}")
                sftp.put(lp, f"{REMOTE_PATH}/prisma/{f}")

    # src/
    print("Uploading src/...")
    upload_dir(sftp, f"{LOCAL_PATH}/src", f"{REMOTE_PATH}/src", "  ")

    # scripts/
    print("Uploading scripts/...")
    for f in sorted(os.listdir(f"{LOCAL_PATH}/scripts")):
        if should_upload(f):
            lp = f"{LOCAL_PATH}/scripts/{f}"
            if os.path.isfile(lp):
                print(f"  ↑ scripts/{f}")
                sftp.put(lp, f"{REMOTE_PATH}/scripts/{f}")

    # public/
    print("Uploading public/...")
    upload_dir(sftp, f"{LOCAL_PATH}/public", f"{REMOTE_PATH}/public", "  ")

    # collector/
    print("Uploading collector/...")
    coll_dir = os.path.join(LOCAL_PATH, "collector")
    if os.path.isdir(coll_dir):
        for f in sorted(os.listdir(coll_dir)):
            if '__pycache__' in f:
                continue
            lp = os.path.join(coll_dir, f)
            rp = os.path.join(REMOTE_PATH, "collector", f)
            if os.path.isfile(lp):
                print(f"  ↑ collector/{f}")
                sftp.put(lp, rp)

    sftp.close()
    ssh.close()
    print("\n✅ All files uploaded!")

if __name__ == "__main__":
    main()
