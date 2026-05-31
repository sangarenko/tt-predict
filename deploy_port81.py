#!/usr/bin/env python3
"""Step 5h: Fix nginx 81 — likely nginx inside a container/slice can't bind properly.
Try adding second listen directive or using nginx stream proxy."""
import paramiko
import sys
import urllib.request
import json

HOST = "2.26.122.152"
USER = "root"
PASS = "Pi#Tx0bh&mQ2!6P6"

def run(ssh, cmd, timeout=30):
    print(f"  $ {cmd[:150]}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        for line in out.strip().split('\n')[-10:]:
            print(f"    {line}")
    if err.strip():
        for line in err.strip().split('\n')[-3:]:
            print(f"    [E] {line}")

def main():
    print("Connecting...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, 22, USER, PASS, timeout=15)
    print("OK\n")

    # Try socat or iptables redirect from 81 to 3000
    print("=== Try iptables redirect 81 -> 3000 ===")
    run(ssh, "iptables -t nat -A PREROUTING -p tcp --dport 81 -j REDIRECT --to-port 3000 2>&1", timeout=10)
    run(ssh, "iptables -t nat -A OUTPUT -p tcp --dport 81 -j REDIRECT --to-port 3000 2>&1", timeout=10)
    run(ssh, "iptables -t nat -L -n | grep 81", timeout=10)

    # Test
    print("\n=== Test from sandbox ===")
    try:
        url = f"http://{HOST}:81/api/ai-profiles"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read().decode())
        print(f"  ✅ Port 81 WORKS! {len(data)} profiles")
    except Exception as e:
        print(f"  ❌ Port 81 still blocked: {e}")

    # Verify 3000 still works
    try:
        url = f"http://{HOST}:3000/api/stats"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read().decode())
        print(f"  ✅ Port 3000: {data}")
    except Exception as e:
        print(f"  ❌ Port 3000: {e}")

    # Save iptables
    print("\n=== Save iptables ===")
    run(ssh, "iptables-save > /etc/iptables.rules 2>/dev/null", timeout=10)

    # Also try disabling nginx on 81 and use Next.js directly
    print("\n=== Disable nginx on 81, let Next.js bind 81 ===")
    run(ssh, "rm -f /etc/nginx/sites-enabled/tt-predict", timeout=10)
    run(ssh, "nginx -s reload 2>/dev/null", timeout=10)

    # Use socat if available
    run(ssh, "which socat 2>/dev/null && socat -d TCP-LISTEN:81,fork,reuseaddr TCP:localhost:3000 &", timeout=10)

    # Test again
    print("\n=== Final test ===")
    try:
        url = f"http://{HOST}:81/api/ai-profiles"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=10)
        print(f"  ✅ Port 81: {len(json.loads(resp.read().decode()))} profiles")
    except Exception as e:
        print(f"  Port 81: {e}")

    ssh.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
