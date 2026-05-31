#!/usr/bin/env python3
"""Step 5: Configure Caddy for port 3000 and run predictions."""
import paramiko
import sys

HOST = "2.26.122.152"
PORT = 22
USER = "root"
PASS = "Pi#Tx0bh&mQ2!6P6"
REMOTE = "/var/www/tt-predict"

def run(ssh, cmd, timeout=120):
    print(f"  $ {cmd[:150]}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    ec = stdout.channel.recv_exit_status()
    if out.strip():
        for line in out.strip().split('\n')[-12:]:
            print(f"    {line}")
    if err.strip() and 'warn' not in err.lower() and 'DeprecationWarning' not in err:
        for line in err.strip().split('\n')[-5:]:
            print(f"    [E] {line}")
    return ec

def main():
    print(f"Connecting to {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASS, timeout=15)
    print("Connected!\n")

    # Update Caddy config to proxy to port 3000
    print("=== Updating Caddy config ===")
    run(ssh, "cat /etc/caddy/Caddyfile 2>/dev/null", timeout=10)

    caddy_config = """:81 {
    reverse_proxy localhost:3000
}
"""
    run(ssh, f"echo '{caddy_config}' > /etc/caddy/Caddyfile", timeout=10)
    run(ssh, "cat /etc/caddy/Caddyfile", timeout=10)

    # Reload Caddy
    print("=== Reloading Caddy ===")
    run(ssh, "systemctl reload caddy 2>/dev/null || caddy reload --config /etc/caddy/Caddyfile 2>/dev/null", timeout=10)

    # Run predictions
    print("=== Running predictions on port 3000 ===")
    run(ssh, "curl -s -X POST http://localhost:3000/api/predict -H 'Content-Type: application/json' -d '{\"action\":\"predict\"}' 2>/dev/null", timeout=60)

    # Verify
    print("=== Verify stats ===")
    run(ssh, "curl -s http://localhost:3000/api/stats 2>/dev/null | head -300", timeout=30)

    # Verify via Caddy (port 81)
    print("=== Verify via Caddy (port 81) ===")
    run(ssh, "curl -s -o /dev/null -w '%{http_code}' http://localhost:81/ 2>/dev/null", timeout=15)
    run(ssh, "curl -s http://localhost:81/api/ai-profiles 2>/dev/null | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d),\"profiles\")' 2>/dev/null", timeout=30)

    print("\nDone!")
    ssh.close()

if __name__ == "__main__":
    main()
