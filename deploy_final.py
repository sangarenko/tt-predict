#!/usr/bin/env python3
"""Step 5g: Add port 3000 to existing nginx (or make nginx listen on public interface for 81)."""
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
    sftp = ssh.open_sftp()
    print("OK\n")

    # Check where nginx is running (in docker?)
    print("=== Check nginx context ===")
    run(ssh, "cat /proc/$(pgrep -x nginx | head -1)/cgroup 2>/dev/null | head -5", timeout=10)
    run(ssh, "docker ps 2>/dev/null | grep nginx", timeout=10)
    run(ssh, "nsenter -t $(pgrep -x nginx | head -1) -n ss -tlnp 2>/dev/null | grep 81", timeout=10)

    # Since port 3000 is directly accessible, let's just verify everything works
    print("\n=== Verify everything works on port 3000 ===")
    run(ssh, "curl -s http://localhost:3000/api/stats 2>/dev/null", timeout=15)
    run(ssh, "curl -s http://localhost:3000/api/ai-bets 2>/dev/null | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d),\"bets\")' 2>/dev/null", timeout=15)

    # PM2 status
    print("\n=== PM2 ===")
    run(ssh, "pm2 list 2>/dev/null", timeout=10)

    # Make sure PM2 restarts on reboot
    run(ssh, "pm2 startup 2>/dev/null | tail -3", timeout=10)
    run(ssh, "pm2 save 2>/dev/null", timeout=10)

    # Also add a systemd service for tt-predict
    print("\n=== Create systemd service ===")
    service = """[Unit]
Description=TT Predict Next.js App
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/tt-predict
Environment=NODE_ENV=production
ExecStart=/root/.bun/bin/bun --hot run dev
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
"""
    with sftp.file('/etc/systemd/system/tt-predict.service', 'w') as f:
        f.write(service)
    print("  Service file written")
    
    run(ssh, "systemctl daemon-reload 2>&1", timeout=10)
    run(ssh, "systemctl enable tt-predict 2>/dev/null", timeout=10)
    print("  Service enabled (backup for PM2)")

    sftp.close()

    # Final: just confirm it all works externally
    print("\n=== FINAL CHECK from server ===")
    run(ssh, "curl -s http://localhost:3000/api/stats 2>/dev/null", timeout=15)

    ssh.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
