#!/usr/bin/env python3
"""Step 5c: Configure Nginx to proxy port 81 -> 3000."""
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
        for line in out.strip().split('\n')[-10:]:
            print(f"    {line}")
    if err.strip() and 'warn' not in err.lower():
        for line in err.strip().split('\n')[-5:]:
            print(f"    [E] {line}")

def main():
    print("Connecting...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, 22, USER, PASS, timeout=15)
    print("OK\n")

    # Check nginx config
    print("=== Nginx config ===")
    run(ssh, "cat /etc/nginx/nginx.conf 2>/dev/null | head -30", timeout=10)
    run(ssh, "ls /etc/nginx/sites-enabled/ 2>/dev/null", timeout=10)
    run(ssh, "ls /etc/nginx/conf.d/ 2>/dev/null", timeout=10)
    run(ssh, "cat /etc/nginx/sites-enabled/default 2>/dev/null | head -40", timeout=10)
    run(ssh, "cat /etc/nginx/conf.d/*.conf 2>/dev/null | head -40", timeout=10)

    # Create nginx config for port 81
    print("\n=== Creating nginx config for port 81 ===")
    nginx_conf = """server {
    listen 81;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
"""
    run(ssh, "cat > /etc/nginx/sites-enabled/tt-predict << 'NGINXEOF'\n" + nginx_conf + "NGINXEOF", timeout=10)
    run(ssh, "cat /etc/nginx/sites-enabled/tt-predict", timeout=10)

    # Test and reload nginx
    print("\n=== Reload nginx ===")
    run(ssh, "nginx -t 2>&1", timeout=10)
    run(ssh, "nginx -s reload 2>/dev/null || systemctl reload nginx 2>/dev/null", timeout=10)

    # Verify port 81
    print("\n=== Verify port 81 ===")
    run(ssh, "ss -tlnp | grep 81", timeout=10)
    run(ssh, "curl -s -o /dev/null -w '%{http_code}' http://localhost:81/ 2>/dev/null", timeout=15)
    run(ssh, "curl -s http://localhost:81/api/ai-profiles 2>/dev/null | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d),\"profiles\")' 2>/dev/null", timeout=30)

    # Final check
    print("\n=== Final verification ===")
    run(ssh, "curl -s http://localhost:81/api/stats 2>/dev/null", timeout=15)

    ssh.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
