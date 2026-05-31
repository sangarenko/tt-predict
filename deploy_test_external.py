#!/usr/bin/env python3
"""Step 5f: Test external access to port 81."""
import paramiko
import sys
import urllib.request
import json

HOST = "2.26.122.152"

def run(ssh, cmd, timeout=30):
    print(f"  $ {cmd[:150]}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        for line in out.strip().split('\n')[-10:]:
            print(f"    {line}")

def main():
    # Test from our sandbox directly
    print("=== Test from sandbox to server port 81 ===")
    try:
        url = f"http://{HOST}:81/api/ai-profiles"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read().decode())
        print(f"  ✅ SUCCESS! {len(data)} profiles from port 81")
        for p in data:
            print(f"    {p['emoji']} {p['name']}: {p['currentAmount']}₽")
    except Exception as e:
        print(f"  ❌ Failed: {e}")

    # Also test port 3000
    print("\n=== Test from sandbox to server port 3000 ===")
    try:
        url = f"http://{HOST}:3000/api/ai-profiles"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read().decode())
        print(f"  ✅ SUCCESS! {len(data)} profiles from port 3000")
    except Exception as e:
        print(f"  ❌ Failed: {e}")

    # Stats from 81
    print("\n=== Stats from port 81 ===")
    try:
        url = f"http://{HOST}:81/api/stats"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read().decode())
        print(f"  Stats: {json.dumps(data, indent=2)}")
    except Exception as e:
        print(f"  ❌ Failed: {e}")

    print("\nDone!")

if __name__ == "__main__":
    main()
