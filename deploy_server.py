#!/usr/bin/env python3
"""Step 2: Install, seed, start on server."""
import paramiko
import sys

HOST = "2.26.122.152"
PORT = 22
USER = "root"
PASS = "Pi#Tx0bh&mQ2!6P6"
REMOTE = "/var/www/tt-predict"
BUN = "/root/.bun/bin/bun"

def run(ssh, cmd):
    print(f"  $ {cmd[:100]}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=180)
    out = stdout.read().decode()
    err = stderr.read().decode()
    ec = stdout.channel.recv_exit_status()
    if out.strip():
        for line in out.strip().split('\n')[-6:]:
            print(f"    {line}")
    if err.strip() and 'warn' not in err.lower() and 'experimental' not in err.lower():
        for line in err.strip().split('\n')[-3:]:
            print(f"    [E] {line}")
    return ec

def main():
    print(f"Connecting to {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASS, timeout=15)
    print("Connected!\n")

    # Install deps
    print("=== Installing dependencies ===")
    run(ssh, f"cd {REMOTE} && {BUN} install 2>&1 | tail -5")

    # Prisma
    print("\n=== Prisma generate ===")
    run(ssh, f"cd {REMOTE} && {BUN}x prisma generate 2>&1 | tail -3")

    print("\n=== DB schema push ===")
    run(ssh, f"cd {REMOTE} && {BUN}x prisma db push --force-reset 2>&1 | tail -5")

    print("\n=== Seeding profiles ===")
    run(ssh, f"cd {REMOTE} && {BUN}x prisma db seed 2>&1 | tail -8")

    print("\n=== Seeding matches + predictions ===")
    run(ssh, f"cd {REMOTE} && {BUN} run scripts/seed-matches.ts 2>&1 | grep -v 'prisma:query'")

    # Start server
    print("\n=== Starting Next.js on port 3001 ===")
    run(ssh, f"cd {REMOTE} && PORT=3001 pm2 start {BUN} --name tt-predict -- --hot run dev 2>&1")
    run(ssh, "pm2 save 2>/dev/null")
    run(ssh, "sleep 3")

    # Verify
    print("\n=== Verification ===")
    run(ssh, f"curl -s http://localhost:3001/api/ai-profiles 2>/dev/null | head -200")
    print()
    run(ssh, f"curl -s http://localhost:3001/api/stats 2>/dev/null | head -200")
    print()
    run(ssh, "pm2 list 2>/dev/null")

    print(f"\n🎉 Done! Server: http://{HOST}")

    ssh.close()

if __name__ == "__main__":
    main()
