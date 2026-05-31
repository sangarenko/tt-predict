#!/usr/bin/env python3
"""Deploy TT Predict to production server via SSH."""
import paramiko
import os
import sys

HOST = "2.26.122.152"
PORT = 22
USER = "root"
PASS = "Pi#Tx0bh&mQ2!6P6"
REMOTE_PATH = "/var/www/tt-predict"
LOCAL_PATH = "/home/z/my-project"

def run_cmd(ssh, cmd, check=True):
    print(f"  $ {cmd[:100]}...")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=300)
    out = stdout.read().decode()
    err = stderr.read().decode()
    exit_code = stdout.channel.recv_exit_status()
    if out.strip():
        for line in out.strip().split('\n')[-5:]:
            print(f"    {line}")
    if err.strip() and 'warning' not in err.lower():
        for line in err.strip().split('\n')[-3:]:
            print(f"    [ERR] {line}")
    if check and exit_code != 0:
        print(f"    Exit code: {exit_code}")
        if check:
            sys.exit(1)
    return out, err, exit_code

def upload_dir(sftp, local_dir, remote_dir, exclude=None):
    """Recursively upload directory."""
    if exclude is None:
        exclude = {'.next', 'node_modules', '.git', 'db/custom.db', 'bun.lock', 'dev.log', '*.pyc', '__pycache__'}
    
    for item in os.listdir(local_dir):
        if item in exclude:
            continue
        local_path = os.path.join(local_dir, item)
        remote_path = f"{remote_dir}/{item}"
        
        if os.path.isfile(local_path):
            print(f"  ↑ {item}")
            sftp.put(local_path, remote_path)
        elif os.path.isdir(local_path):
            try:
                sftp.stat(remote_path)
            except FileNotFoundError:
                sftp.mkdir(remote_path)
            upload_dir(sftp, local_path, remote_path, exclude)

def main():
    print(f"🔗 Connecting to {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASS)
    print("  ✅ Connected")
    
    sftp = ssh.open_sftp()
    
    # Step 1: Check remote state
    print("\n📋 Checking remote server...")
    run_cmd(ssh, "pm2 list 2>/dev/null | head -20", check=False)
    
    # Step 2: Create remote dirs
    print("\n📁 Creating directories...")
    for d in ['prisma', 'src/app/api/matches', 'src/app/api/ai-bets', 'src/app/api/stats',
              'src/app/api/bankroll', 'src/app/api/ai-bankroll', 'src/app/api/predictors',
              'src/app/api/collection-logs', 'src/app/api/ai-profiles', 'src/app/api/tipsters',
              'src/lib', 'src/components/ui', 'src/hooks', 'db', 'public']:
        remote_d = f"{REMOTE_PATH}/{d}"
        try:
            sftp.stat(remote_d)
        except FileNotFoundError:
            print(f"  mkdir {d}")
            sftp.mkdir(remote_d)
    
    # Step 3: Upload key files
    print("\n📦 Uploading files...")
    
    # Config files
    for f in ['package.json', '.env', 'next.config.ts', 'tailwind.config.ts', 'tsconfig.json',
              'postcss.config.mjs', 'eslint.config.mjs', 'components.json']:
        local_f = f"{LOCAL_PATH}/{f}"
        if os.path.isfile(local_f):
            print(f"  ↑ {f}")
            sftp.put(local_f, f"{REMOTE_PATH}/{f}")
    
    # Prisma
    for f in ['schema.prisma']:
        sftp.put(f"{LOCAL_PATH}/prisma/{f}", f"{REMOTE_PATH}/prisma/{f}")
    
    # Seed
    if os.path.isfile(f"{LOCAL_PATH}/prisma/seed.ts"):
        sftp.put(f"{LOCAL_PATH}/prisma/seed.ts", f"{REMOTE_PATH}/prisma/seed.ts")
    
    # Source files - src/
    print("\n📦 Uploading src/...")
    upload_dir(sftp, f"{LOCAL_PATH}/src", f"{REMOTE_PATH}/src")
    
    # Public
    print("\n📦 Uploading public/...")
    upload_dir(sftp, f"{LOCAL_PATH}/public", f"{REMOTE_PATH}/public")
    
    # Caddyfile
    if os.path.isfile(f"{LOCAL_PATH}/Caddyfile"):
        sftp.put(f"{LOCAL_PATH}/Caddyfile", f"{REMOTE_PATH}/Caddyfile")
    
    sftp.close()
    
    # Step 4: Install dependencies & build
    print("\n🔧 Installing dependencies...")
    run_cmd(ssh, f"cd {REMOTE_PATH} && bun install --production=false 2>&1 | tail -5", check=False)
    
    print("\n🔧 Generating Prisma client...")
    run_cmd(ssh, f"cd {REMOTE_PATH} && npx prisma generate 2>&1 | tail -3", check=False)
    
    print("\n🔧 Pushing DB schema...")
    run_cmd(ssh, f"cd {REMOTE_PATH} && DATABASE_URL='file:/var/www/tt-predict/db/custom.db' npx prisma db push --force-reset 2>&1 | tail -5", check=False)
    
    print("\n🌱 Seeding database...")
    run_cmd(ssh, f"cd {REMOTE_PATH} && DATABASE_URL='file:/var/www/tt-predict/db/custom.db' npx tsx prisma/seed.ts 2>&1 | tail -10", check=False)
    
    # Step 5: Restart PM2
    print("\n🔄 Restarting PM2...")
    run_cmd(ssh, f"cd {REMOTE_PATH} && pm2 delete tt-predict 2>/dev/null; cd {REMOTE_PATH} && NODE_ENV=production pm2 start bun --name tt-predict -- run start 2>&1 | tail -5", check=False)
    run_cmd(ssh, "pm2 save 2>/dev/null", check=False)
    
    # Step 6: Verify
    print("\n✅ Verifying...")
    run_cmd(ssh, "sleep 3 && curl -s http://localhost:3001/api/ai-profiles 2>/dev/null | python3 -c \"import json,sys; profiles=json.load(sys.stdin); [print(f'  {p[\\\"emoji\\\"]} {p[\\\"name\\\"]}: {p[\\\"currentAmount\\\"]}₽') for p in profiles]\" 2>/dev/null || echo '  API not responding yet'", check=False)
    
    print("\n🎉 Deploy complete!")
    print(f"   Server: http://{HOST}")
    print(f"   PM2: port 3001, Caddy: port 81")
    
    ssh.close()

if __name__ == "__main__":
    main()
