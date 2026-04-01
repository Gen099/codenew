# Production Runbook (VM -> VPS Ready)

## 1) Prepare secrets
```bash
cd /opt/faistudio
chmod +x /opt/faistudio/prepare-secrets.sh
/opt/faistudio/prepare-secrets.sh /opt/faistudio/.env.production
```

## 2) Deploy (single command)
```bash
cd /opt/faistudio
chmod +x /opt/faistudio/deploy-vm.sh
/opt/faistudio/deploy-vm.sh
```

## 3) Rotate secrets (recommended before go-live)
```bash
cd /opt/faistudio
chmod +x /opt/faistudio/rotate-secrets.sh
/opt/faistudio/rotate-secrets.sh
```

## 4) Smoke test
```bash
cd /opt/faistudio
chmod +x /opt/faistudio/smoke-test.sh
/opt/faistudio/smoke-test.sh
```

## 5) UAT basic flow
```bash
cd /opt/faistudio
chmod +x /opt/faistudio/uat-production.sh
UAT_USER=admin UAT_PASS='your-admin-password' /opt/faistudio/uat-production.sh
```

## 6) Quick diagnostics
```bash
cd /opt/faistudio
ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production docker compose -f docker-compose.production.yml ps
ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production docker compose -f docker-compose.production.yml logs --tail=200 api
ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production docker compose -f docker-compose.production.yml logs --tail=120 nginx
```

## 7) Rollback (fast)
```bash
cd /opt/faistudio
ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production docker compose -f docker-compose.production.yml down
# checkout previous known-good source/tag then:
/opt/faistudio/deploy-vm.sh
```

## 8) Go-live checklist
- Secrets file is outside repo: `/opt/faistudio/.secrets/.env.production`
- `SECRET_KEY` >= 32 chars and not placeholder
- `DATABASE_URL` matches `POSTGRES_PASSWORD` (encode `%40` if password contains `@`)
- `APP_SEED_USERS=0`, `APP_SEED_PRESETS=0`
- `CORS_ORIGINS` is explicit and minimal
- `smoke-test.sh` passes
