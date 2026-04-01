#!/bin/bash
# =============================================
# F-Aistudio Production Deploy Script
# Target: Ubuntu 24.04 VM - aimedia.fun
# =============================================

set -e

echo "🚀 F-Aistudio Production Deploy"
echo "================================"

# ─── 1. System packages ───
echo "📦 Installing system packages..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx ufw curl git
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER

# ─── 2. Firewall ───
echo "🔒 Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
echo "y" | sudo ufw enable

# ─── 3. Project directory ───
echo "📁 Setting up project directory..."
PROJ_DIR=/opt/faistudio
sudo mkdir -p $PROJ_DIR
sudo chown -R $USER:$USER $PROJ_DIR

# Copy files (assuming script runs from project root)
cp -r . $PROJ_DIR/
cd $PROJ_DIR

# ─── 4. Generate secrets (if not already set) ───
if grep -q "CHANGE_THIS_TO_LONG_RANDOM_SECRET" .env.production; then
    echo "🔑 Generating SECRET_KEY..."
    SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    sed -i "s/CHANGE_THIS_TO_LONG_RANDOM_SECRET/$SECRET/" .env.production
fi

if grep -q "CHANGE_STRONG_DB_PASSWORD" .env.production; then
    echo "🔑 Generating DB password..."
    DB_PASS=$(python3 -c "import secrets; print(secrets.token_hex(16))")
    sed -i "s/CHANGE_STRONG_DB_PASSWORD/$DB_PASS/" .env.production
    DB_PASS_URL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$DB_PASS', safe=''))")
    if grep -q "^DATABASE_URL=" .env.production; then
        sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://videotool:${DB_PASS_URL}@postgres:5432/videotool|" .env.production
    else
        echo "DATABASE_URL=postgresql://videotool:${DB_PASS_URL}@postgres:5432/videotool" >> .env.production
    fi
fi

# ─── 5. Docker Compose ───
echo "🐳 Starting Docker containers..."
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build

echo "⏳ Waiting for API health check..."
sleep 15
docker compose -f docker-compose.production.yml ps

# ─── 6. Host Nginx (reverse proxy) ───
echo "🌐 Configuring host Nginx..."
sudo tee /etc/nginx/sites-available/faistudio > /dev/null <<'NGINX'
server {
    listen 80;
    server_name aimedia.fun www.aimedia.fun;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 200M;
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/faistudio /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# ─── 7. SSL Certificate ───
if [[ "$PUBLIC_URL" == *"aimedia.fun"* ]] && [[ "$PUBLIC_URL" == "https"* ]]; then
    echo "🔐 Setting up SSL..."
    sudo certbot --nginx -d aimedia.fun -d www.aimedia.fun --non-interactive --agree-tos -m admin@aimedia.fun || {
        echo "⚠️  SSL setup failed. Since this is a local VM, Certbot cannot reach it from the internet."
        echo "💡 Using HTTP only. Access via http://aimedia.fun or http://localhost:8080"
    }
else
    echo "ℹ️  Skipping SSL for local/HTTP deployment."
fi

# ─── 8. Verify ───
echo ""
echo "✅ Deploy complete!"
echo "================================"
echo "🌐 Frontend:  http://aimedia.fun (Cần cấu hình file hosts)"
echo "📖 API Docs:  http://aimedia.fun/docs"
echo "🐳 Logs:      docker compose -f docker-compose.production.yml logs -f api"
echo ""
echo "📋 Next steps (CHO LOCAL VM):"
echo "  1. Trên máy Windows, mở Notepad bằng Admin, sửa file C:\Windows\System32\drivers\etc\hosts"
echo "  2. Thêm dòng: <IP_CUA_VM> aimedia.fun"
echo "  3. Mở http://aimedia.fun trên trình duyệt."
echo "  4. Check API: curl http://aimedia.fun/api/credits/balance"
echo "  5. Check Telegram bot: docker compose logs api | grep telegram"
