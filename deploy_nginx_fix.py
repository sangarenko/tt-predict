#!/usr/bin/env python3
"""Step 5d: Fix nginx config via sftp."""
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

    # Write config via sftp
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
    print("=== Writing nginx config via sftp ===")
    with sftp.file('/etc/nginx/sites-enabled/tt-predict', 'w') as f:
        f.write(nginx_conf)
    print("  Written!")

    # Verify config
    print("\n=== Verify config ===")
    with sftp.file('/etc/nginx/sites-enabled/tt-predict', 'r') as f:
        print(f.read())
    sftp.close()

    # Test and reload
    print("=== Test nginx ===")
    run(ssh, "nginx -t 2>&1", timeout=10)

    print("=== Reload nginx ===")
    run(ssh, "nginx -s reload 2>&1", timeout=10)

    # Check ports
    print("=== Check ports ===")
    run(ssh, "ss -tlnp | grep -E '81|3000'", timeout=10)

    # Test
    print("=== Test ===")
    run(ssh, "curl -sv http://localhost:81/api/ai-profiles 2>&1 | tail -20", timeout=30)
    run(ssh, "curl -s http://localhost:3000/api/ai-profiles 2>/dev/null | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d),\"profiles on 3000\")' 2>/dev/null", timeout=15)

    ssh.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
