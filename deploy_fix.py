#!/usr/bin/env python3
"""Step 4b: Fix port — start with PORT env or next.config."""
import paramiko
import sys

HOST = "2.26.122.152"
PORT = 22
USER = "root"
PASS = "Pi#Tx0bh&mQ2!6P6"
REMOTE = "/var/www/tt-predict"
BUN = "/root/.bun/bin/bun"

def run(ssh, cmd, timeout=120):
    print(f"  $ {cmd[:150]}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    ec = stdout.channel.recv_exit_status()
    if out.strip():
        for line in out.strip().split('\n')[-12:]:
            print(f"    {line}")
    if err.strip() and 'prisma' not in err.lower() and 'warn' not in err.lower() and 'experimental' not in err.lower() and 'DeprecationWarning' not in err:
        for line in err.strip().split('\n')[-5:]:
            print(f"    [E] {line}")
    return ec

def main():
    print(f"Connecting to {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASS, timeout=15)
    print("Connected!\n")

    # Kill everything
    print("=== Stopping all ===")
    run(ssh, "pm2 delete all 2>/dev/null; pkill -f 'next' 2>/dev/null; sleep 2")

    # Set PORT=3001 in .env file
    print("=== Setting PORT=3001 in .env ===")
    run(ssh, f"cd {REMOTE} && grep -q '^PORT=' .env && sed -i 's/^PORT=.*/PORT=3001/' .env || echo 'PORT=3001' >> .env")
    run(ssh, f"cd {REMOTE} && cat .env | grep PORT")

    # Start: pm2 start with env PORT=3001 using npx next dev -p 3001
    print("=== Starting on port 3001 ===")
    run(ssh, f"cd {REMOTE} && PORT=3001 pm2 start {BUN} --name tt-predict -- run dev 2>&1")
    run(ssh, "pm2 save 2>/dev/null")

    # Wait
    print("=== Waiting ===")
    run(ssh, "sleep 12", timeout=15)

    # Check logs
    print("=== PM2 logs ===")
    run(ssh, "pm2 logs tt-predict --lines 20 --nostream 2>/dev/null", timeout=10)

    # Test port 3001
    print("=== Test 3001 ===")
    run(ssh, "curl -s http://localhost:3001/api/ai-profiles 2>/dev/null | head -500", timeout=30)

    # Test port 3000
    print("=== Test 3000 ===")
    run(ssh, "curl -s http://localhost:3000/api/ai-profiles 2>/dev/null | head -500", timeout=30)

    # Predictions
    print("=== Predictions on 3001 ===")
    run(ssh, 'curl -s -X POST http://localhost:3001/api/predict -H "Content-Type: application/json" -d \'{"action":"predict"}\' 2>/dev/null', timeout=30)

    # Stats
    print("=== Stats ===")
    run(ssh, "curl -s http://localhost:3001/api/stats 2>/dev/null | head -300", timeout=15)

    # PM2
    run(ssh, "pm2 list 2>/dev/null", timeout=10)

    print("\nDone!")
    ssh.close()

if __name__ == "__main__":
    main()
