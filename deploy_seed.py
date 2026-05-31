#!/usr/bin/env python3
"""Step 3c: Upload seed script and run predictions on server."""
import paramiko
import sys

HOST = "2.26.122.152"
PORT = 22
USER = "root"
PASS = "Pi#Tx0bh&mQ2!6P6"
REMOTE = "/var/www/tt-predict"
BUN = "/root/.bun/bin/bun"

def run(ssh, cmd, timeout=120):
    print(f"  $ {cmd[:140]}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    ec = stdout.channel.recv_exit_status()
    if out.strip():
        for line in out.strip().split('\n')[-10:]:
            print(f"    {line}")
    if err.strip() and 'prisma' not in err.lower() and 'warn' not in err.lower():
        for line in err.strip().split('\n')[-5:]:
            print(f"    [E] {line}")
    return ec

def main():
    print(f"Connecting to {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASS, timeout=15)
    sftp = ssh.open_sftp()
    print("Connected!\n")

    # Upload seed script
    print("=== Uploading seed_quick.js ===")
    sftp.put("/home/z/my-project/seed_quick.js", f"{REMOTE}/seed_quick.js")
    print("  Uploaded")
    sftp.close()

    # Seed matches
    print("\n=== Seeding matches ===")
    run(ssh, f"cd {REMOTE} && node seed_quick.js 2>&1")

    # Wait for dev server to be ready
    print("\n=== Waiting for dev server ===")
    run(ssh, "sleep 8", timeout=15)

    # Check dev server
    print("\n=== Checking dev server ===")
    run(ssh, "curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/ 2>/dev/null", timeout=15)

    # Run predictions
    print("\n=== Running predictions ===")
    run(ssh, "curl -s -X POST http://localhost:3001/api/predict -H 'Content-Type: application/json' -d '{\"action\":\"predict\"}' 2>/dev/null", timeout=30)

    # Verify profiles
    print("\n=== Verify profiles ===")
    run(ssh, "curl -s http://localhost:3001/api/ai-profiles 2>/dev/null | head -500", timeout=15)

    # Verify stats
    print("\n=== Verify stats ===")
    run(ssh, "curl -s http://localhost:3001/api/stats 2>/dev/null | head -200", timeout=15)

    # PM2 status
    print("\n=== PM2 ===")
    run(ssh, "pm2 list 2>/dev/null", timeout=10)

    # PM2 logs
    print("\n=== PM2 logs ===")
    run(ssh, "pm2 logs tt-predict --lines 15 --nostream 2>/dev/null", timeout=10)

    print("\nDone!")
    ssh.close()

if __name__ == "__main__":
    main()
