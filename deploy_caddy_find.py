#!/usr/bin/env python3
"""Step 5b: Find and configure Caddy."""
import paramiko
import sys

HOST = "2.26.122.152"
PORT_SSH = 22
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
        for line in err.strip().split('\n')[-5:]:
            print(f"    [E] {line}")

def main():
    print(f"Connecting...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT_SSH, USER, PASS, timeout=15)
    print("OK\n")

    # Find caddy
    print("=== Find Caddy ===")
    run(ssh, "which caddy 2>/dev/null; caddy version 2>/dev/null", timeout=10)
    run(ssh, "find / -name 'Caddyfile' -type f 2>/dev/null | head -10", timeout=15)
    run(ssh, "find / -name 'caddy' -type f 2>/dev/null | head -5", timeout=15)
    run(ssh, "ss -tlnp | grep -E '81|443|80' 2>/dev/null", timeout=10)

    # Check if caddy is running
    run(ssh, "ps aux | grep caddy | grep -v grep", timeout=10)
    run(ssh, "systemctl status caddy 2>/dev/null | head -10", timeout=10)

    # What is listening on port 81?
    run(ssh, "ss -tlnp | grep 81", timeout=10)
    run(ssh, "lsof -i :81 2>/dev/null | head -5", timeout=10)

    # Try netstat
    run(ssh, "netstat -tlnp 2>/dev/null | grep -E '81|80|443'", timeout=10)

    ssh.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
