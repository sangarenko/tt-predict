#!/usr/bin/env python3
"""Step 5e: Debug nginx connection issue."""
import paramiko
import sys

HOST = "2.26.122.152"
USER = "root"
PASS = "Pi#Tx0bh&mQ2!6P6"

def run(ssh, cmd, timeout=30):
    print(f"  $ {cmd[:150]}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        for line in out.strip().split('\n')[-12:]:
            print(f"    {line}")
    if err.strip():
        for line in err.strip().split('\n')[-5:]:
            print(f"    [E] {line}")

def main():
    print("Connecting...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, 22, USER, PASS, timeout=15)
    print("OK\n")

    # Full nginx check
    run(ssh, "nginx -T 2>&1 | grep -A5 'listen 81'", timeout=10)
    run(ssh, "nginx -T 2>&1 | grep -E 'server|listen|proxy_pass' | head -20", timeout=10)

    # Restart nginx fully (not just reload)
    print("=== Full nginx restart ===")
    run(ssh, "systemctl restart nginx 2>&1 || service nginx restart 2>&1", timeout=10)
    run(ssh, "sleep 2")
    run(ssh, "ss -tlnp | grep 81", timeout=10)

    # Try again
    print("=== Test again ===")
    run(ssh, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:81/ 2>/dev/null", timeout=15)
    run(ssh, "curl -sv http://127.0.0.1:81/ 2>&1 | tail -15", timeout=15)

    # Maybe iptables/firewall blocking
    print("=== Firewall ===")
    run(ssh, "iptables -L -n 2>/dev/null | grep -E '81|DROP|REJECT' | head -10", timeout=10)
    run(ssh, "ufw status 2>/dev/null", timeout=10)

    # Check if nginx is actually serving on 81
    run(ssh, "netstat -tlnp 2>/dev/null | grep 81", timeout=10)

    ssh.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
