# Migration Tu Nguon Bat Ky Len VPS

## 1. Muc tieu
Chuan hoa cach dua source len VPS ma khong phu thuoc VM local.

## 2. Thanh phan can co tren VPS
- `/opt/faistudio`
- `/opt/faistudio/.secrets/.env.production`
- Docker Engine
- Docker Compose

## 3. Chien luoc
1. Dua source vao VPS bang `git pull` hoac `rsync`.
2. Dong bo source vao runtime `/opt/faistudio` neu repo clone nam cho khac.
3. Chay deploy runtime tren VPS.
4. Verify health.

## 4. Cach 1: repo runtime nam ngay tai `/opt/faistudio`
```bash
sudo ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production bash /opt/faistudio/deploy-vm.sh
```

## 5. Cach 2: repo source nam cho khac tren VPS
```bash
sudo SOURCE_DIR=/srv/faistudio-src ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production bash /opt/faistudio/deploy-vm.sh
```

## 6. Verify
```bash
curl -I http://127.0.0.1:8080/
sudo docker compose -f /opt/faistudio/docker-compose.production.yml ps
sudo docker compose -f /opt/faistudio/docker-compose.production.yml logs --tail=120 api
```

## 7. Rollback
Neu deploy loi:
```bash
sudo docker compose -f /opt/faistudio/docker-compose.production.yml logs --tail=200 api
sudo docker compose -f /opt/faistudio/docker-compose.production.yml logs --tail=200 nginx
```

Khuyen nghi giu mot ban backup source va SQL dump truoc moi deploy lon.
