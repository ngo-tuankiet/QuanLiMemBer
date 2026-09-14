#!/usr/bin/env bash
set -e

echo "=== [1/7] KIỂM TRA & THIẾT LẬP MÚI GIỜ GMT+7 (Asia/Ho_Chi_Minh) ==="
timedatectl set-timezone Asia/Ho_Chi_Minh || true
echo "VPS Timezone: $(date)"

cd /var/www/dashboard-ckvn

# Cập nhật TZ trong .env nếu chưa có hoặc sai
if grep -q "TZ=" .env; then
  sed -i '/TZ=/d' .env
fi
echo 'TZ="Asia/Ho_Chi_Minh"' >> .env
echo "Đã cấu hình TZ trong .env:"
tail -n 2 .env

echo "=== [2/7] SAO LƯU DỮ LIỆU DATABASE HIỆN TẠI ==="
BACKUP_NAME="prisma/dev.db.backup-$(date +%Y%m%d_%H%M%S)"
if [ -f "prisma/dev.db" ]; then
  cp "prisma/dev.db" "$BACKUP_NAME"
  echo "Đã backup database an toàn: $BACKUP_NAME"
  ls -lh prisma/dev.db "$BACKUP_NAME"
fi

echo "=== [3/7] PULL CODE MỚI TỪ GITHUB ==="
git fetch origin main
git status
git merge origin/main --no-edit

echo "=== [4/7] CẬP NHẬT DEPENDENCIES & PRISMA CLIENT ==="
npm install --prefer-offline --no-audit

echo "=== [5/7] CHẠY PRISMA MIGRATION (GIỮ NGUYÊN DỮ LIỆU) ==="
npx prisma migrate deploy
npx prisma generate

echo "=== [6/7] BUILD PRODUCTION NEXT.JS ==="
npm run build

echo "=== [7/7] RESTART PM2 SERVICE ==="
pm2 restart dashboard-ckvn
pm2 save

echo "=== HOÀN TẤT TRIỂN KHAI ==="
pm2 status
curl -I http://127.0.0.1:3000 || true
