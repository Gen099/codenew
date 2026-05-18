# SOP Van Hanh Production

## 1. Muc tieu
Tai lieu nay chuan hoa thao tac van hanh production cho he thong `app-aistudio.site` tren VPS.

## 2. Thanh phan runtime
- Nginx
- FastAPI API
- Postgres
- Docker Compose production

## 3. Duong dan quan trong
- code runtime: `/opt/faistudio`
- env production: `/opt/faistudio/.secrets/.env.production`
- compose file: `/opt/faistudio/docker-compose.production.yml`

## 4. Health check chuan

### 4.1. App public
```bash
curl -I https://app-aistudio.site/
```

### 4.2. Local reverse proxy
```bash
curl -I http://127.0.0.1:8080/
```

### 4.3. Docker
```bash
sudo docker compose -f /opt/faistudio/docker-compose.production.yml ps
sudo docker compose -f /opt/faistudio/docker-compose.production.yml logs --tail=120 api
sudo docker compose -f /opt/faistudio/docker-compose.production.yml logs --tail=120 nginx
```

## 5. Quy trinh deploy chuan

### 5.1. One-liner
Neu runtime repo nam ngay tai `/opt/faistudio`:
```bash
sudo ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production bash /opt/faistudio/deploy-vm.sh
```

Neu source nam o cho khac tren VPS:
```bash
sudo SOURCE_DIR=/srv/faistudio-src ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production bash /opt/faistudio/deploy-vm.sh
```

### 5.2. Verify sau deploy
```bash
curl -I http://127.0.0.1:8080/
curl -I https://app-aistudio.site/
sudo docker compose -f /opt/faistudio/docker-compose.production.yml ps
```

### 5.3. Alias `appdeploy`
```bash
sudo bash /opt/faistudio/scripts/install_appdeploy_alias.sh
source /root/.bashrc
appdeploy
```

## 6. Quy trinh restart nhanh

### 6.1. Restart app stack
```bash
sudo ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production bash /opt/faistudio/deploy-vm.sh
```

## 7. Quy trinh UAT production
```bash
cd /opt/faistudio
export UAT_BASE_URL='https://app-aistudio.site'
export UAT_ADMIN_USER='admin'
export UAT_ADMIN_PASS='Admin@2026_Strong'
export UAT_QC_USER='Son'
export UAT_QC_PASS='qc123@'
export UAT_STAFF_USER='sonpham'
export UAT_STAFF_PASS='Staff2026@'
npx playwright test tests/e2e/uat-10min.spec.ts --reporter=line
```

## 8. Log dieu tra su co

### 8.1. API
```bash
sudo docker compose -f /opt/faistudio/docker-compose.production.yml logs --tail=300 api
```

### 8.2. Nginx
```bash
sudo docker compose -f /opt/faistudio/docker-compose.production.yml logs --tail=300 nginx
```

## 9. Tinh huong loi thuong gap

### 9.1. App len nhung API 401 hang loat
Kiem tra:
```bash
sudo docker compose -f /opt/faistudio/docker-compose.production.yml logs --tail=200 api
```

### 9.2. Provider tru tien nhung khong co video
Kiem tra:
```bash
sudo docker compose -f /opt/faistudio/docker-compose.production.yml logs --tail=300 api | grep -E "KIE|poll|recover|Video"
```

## 10. Quy tac van hanh
- Khong phu thuoc HGFS.
- Khong sua truc tiep tren VPS neu source chinh dang o noi khac ma chua dong bo vao `/opt/faistudio`.
- Moi deploy phai qua guard va phase status.
- Moi fix production phai quay lai source workspace.
