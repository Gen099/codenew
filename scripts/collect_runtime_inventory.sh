#!/usr/bin/env bash
set -euo pipefail

echo "[inventory] host"
hostnamectl 2>/dev/null || true
echo

echo "[inventory] cpu"
lscpu 2>/dev/null || true
echo

echo "[inventory] memory"
free -h 2>/dev/null || true
echo

echo "[inventory] disk"
df -h 2>/dev/null || true
echo

echo "[inventory] docker ps"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
echo

echo "[inventory] docker stats snapshot"
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}' 2>/dev/null || true
echo

echo "[inventory] compose status"
docker compose -f /opt/faistudio/docker-compose.production.yml ps 2>/dev/null || true
echo

echo "[inventory] cloudflared"
systemctl status cloudflared --no-pager 2>/dev/null || true
