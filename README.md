# VideoTool

He thong web phuc vu quy trinh tao anh/video, QC, dashboard van hanh, quan ly credits, key, bao cao ca lam viec.

Production hien tai chay tai:
- `https://app-aistudio.site`

## 1. Thanh phan he thong
- Frontend SPA
- Backend FastAPI
- Database Postgres
- Reverse proxy Nginx

## 2. Deploy production

Neu runtime repo nam ngay tai `/opt/faistudio`:
```bash
sudo ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production bash /opt/faistudio/deploy-vm.sh
```

Neu source nam o cho khac tren VPS:
```bash
sudo SOURCE_DIR=/srv/faistudio-src ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production bash /opt/faistudio/deploy-vm.sh
```

## 3. Health check

```bash
curl -I http://127.0.0.1:8080/
curl -I https://app-aistudio.site/
sudo docker compose -f /opt/faistudio/docker-compose.production.yml ps
```

## 4. UAT production

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
