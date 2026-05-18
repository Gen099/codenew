# README Van Hanh

## 1. Muc dich
Tai lieu nay la diem vao nhanh cho van hanh production.

## 2. Runtime hien tai
- Domain: `https://app-aistudio.site`
- Reverse proxy: Nginx
- Backend: FastAPI
- Database: Postgres
- Deploy path: `/opt/faistudio`

## 3. Health check nhanh
```bash
curl -I http://127.0.0.1:8080/
curl -I https://app-aistudio.site/
sudo docker compose -f /opt/faistudio/docker-compose.production.yml ps
```

## 4. Deploy chuan
Neu runtime repo nam ngay tai `/opt/faistudio`:
```bash
sudo ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production bash /opt/faistudio/deploy-vm.sh
```

Neu source nam o cho khac tren VPS:
```bash
sudo SOURCE_DIR=/srv/faistudio-src ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production bash /opt/faistudio/deploy-vm.sh
```

## 4.1. Cai alias `appdeploy`
```bash
sudo bash /opt/faistudio/scripts/install_appdeploy_alias.sh
source /root/.bashrc
```

Sau khi cai:
```bash
appdeploy
```

## 5. UAT production
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

## 6. Su co thuong gap
- `401` hang loat: token/session/env secret
- video tru tien khong vao library: provider poll/result mapping
- staff view sai dashboard: scope/viewContext

## 7. Tai lieu chi tiet
- `docs/index.md`
- `docs/ops_sop.md`
- `docs/backup_restore.md`
- `docs/vps_migration.md`
- `docs/incident_response.md`
