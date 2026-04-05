# Runtime Inventory

Mục tiêu: thu thập phần cứng và runtime thật của VM/VPS, không ghi dữ liệu ảo.

## Chạy lệnh

```bash
cd /opt/faistudio
bash /opt/faistudio/scripts/collect_runtime_inventory.sh
```

## Kết quả cần lưu

- hostname
- hệ điều hành/kernel
- CPU model, số core/vCPU
- RAM tổng
- disk tổng và mount đang dùng
- trạng thái container:
  - postgres
  - api
  - nginx
- snapshot CPU/RAM hiện tại của container
- trạng thái `cloudflared`

## Quy tắc

- chỉ dùng output thật từ máy đang chạy
- không điền tay
- nếu thiếu quyền hoặc thiếu lệnh, ghi rõ mục nào chưa thu được
