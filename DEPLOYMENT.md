# Panduan Deployment — AbsenSekolah Web App

## Persyaratan Server
- OS: Ubuntu 22.04 LTS (direkomendasikan)
- RAM: Minimal 1 GB
- Storage: 10 GB (untuk database + foto bukti absen)
- Node.js: v18+ ([panduan install](https://github.com/nodesource/distributions))
- PM2: Process manager untuk Node.js
- Nginx: Reverse proxy + SSL termination
- Certbot: SSL gratis dari Let's Encrypt

---

## 1. Persiapan Server

```bash
# Update sistem
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verifikasi
node --version   # harusnya v20.x.x
npm --version

# Install PM2 secara global
sudo npm install -g pm2

# Install Nginx
sudo apt install -y nginx

# Install Certbot
sudo apt install -y certbot python3-certbot-nginx
```

---

## 2. Upload & Setup Aplikasi

```bash
# Buat folder aplikasi
sudo mkdir -p /var/www/absensi
sudo chown $USER:$USER /var/www/absensi

# Upload file (dari komputer lokal, gunakan rsync atau SCP)
rsync -avz --exclude='node_modules' --exclude='.env' --exclude='database/fotos' \
  ./absensi-sekolah/ user@IP_SERVER:/var/www/absensi/

# Masuk ke server, lalu ke folder
cd /var/www/absensi

# Install dependencies
npm install

# Salin file database dari lokal (PENTING! Jangan sampai lupa)
scp ./database/absensi.sqlite user@IP_SERVER:/var/www/absensi/database/
```

---

## 3. Konfigurasi Environment

```bash
# Buat file .env di server
nano /var/www/absensi/.env
```

Isi file `.env` di server:

```env
PORT=3000
NODE_ENV=production
TZ=Asia/Jakarta

# GANTI dengan string random panjang minimal 64 karakter!
JWT_SECRET=GANTI_INI_DENGAN_STRING_RANDOM_SANGAT_PANJANG_DAN_AMAN

JWT_EXPIRES_IN=8h
DB_PATH=./database/absensi.sqlite
FOTO_DIR=./database/fotos

# Ganti dengan domain Anda yang sebenarnya
ALLOWED_ORIGINS=https://absensi.namadomainanda.sch.id
```

> ⚠️ **PENTING**: Ganti `JWT_SECRET` dengan string baru yang aman!
> Generate dengan: `node -e "require('crypto').randomBytes(64, (e,b) => console.log(b.toString('hex')))"`

---

## 4. Konfigurasi PM2 (Process Manager)

Buat file `ecosystem.config.js` di folder aplikasi:

```javascript
module.exports = {
  apps: [{
    name: 'absensi-sekolah',
    script: 'server.js',
    instances: 1,          // SQLite tidak support multi-instance write
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Jakarta'
    },
    // Restart otomatis jika memory > 500MB
    max_memory_restart: '500M',
    // Log
    out_file: './logs/pm2-out.log',
    error_file: './logs/pm2-err.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

```bash
# Jalankan dengan PM2
pm2 start ecosystem.config.js

# Simpan konfigurasi PM2 agar auto-start saat reboot
pm2 save
pm2 startup   # ikuti instruksi yang muncul

# Cek status
pm2 status
pm2 logs absensi-sekolah
```

---

## 5. Konfigurasi Nginx (Reverse Proxy)

```bash
sudo nano /etc/nginx/sites-available/absensi
```

```nginx
server {
    listen 80;
    server_name namadomainanda.sch.id www.namadomainanda.sch.id;

    # Redirect semua HTTP ke HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name namadomainanda.sch.id www.namadomainanda.sch.id;

    # SSL — akan diisi otomatis oleh Certbot
    ssl_certificate     /etc/letsencrypt/live/namadomainanda.sch.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/namadomainanda.sch.id/privkey.pem;

    # Pengaturan SSL yang aman
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;

    # Maksimal ukuran upload (foto bukti absen = base64, bisa besar)
    client_max_body_size 15m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Serve foto bukti langsung via Nginx (lebih efisien)
    location /api/absensi/foto/ {
        alias /var/www/absensi/database/fotos/;
        add_header Cache-Control "private, max-age=86400";
    }

    # Cache asset statis
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 1d;
        expires 1d;
        add_header Cache-Control "public, max-age=86400";
    }
}
```

```bash
# Aktifkan konfigurasi
sudo ln -s /etc/nginx/sites-available/absensi /etc/nginx/sites-enabled/
sudo nginx -t       # Test konfigurasi — harus "ok"
sudo systemctl reload nginx
```

---

## 6. Setup HTTPS dengan Let's Encrypt

> ⚠️ **WAJIB sebelum go-live**: Scanner QR membutuhkan akses kamera browser. Browser hanya mengizinkan akses kamera di HTTPS (atau localhost). Tanpa HTTPS, scanner tidak akan berfungsi!

```bash
# Request sertifikat SSL gratis
sudo certbot --nginx -d namadomainanda.sch.id -d www.namadomainanda.sch.id

# Ikuti instruksi, masukkan email, setujui ToS
# Certbot akan otomatis modifikasi konfigurasi Nginx

# Verifikasi auto-renewal
sudo certbot renew --dry-run

# Certbot auto-renewal sudah dikonfigurasi via systemd timer
# Cek: sudo systemctl status certbot.timer
```

---

## 7. Jadwalkan Backup SQLite Otomatis

```bash
# Edit crontab
crontab -e

# Tambahkan baris berikut (backup setiap hari jam 02:00 WIB)
0 2 * * * cd /var/www/absensi && node scripts/backup.js >> logs/backup.log 2>&1
```

Backup tersimpan di `/var/www/absensi/database/backups/` (max 30 file = 30 hari terakhir).

**Rekomendasi tambahan**: Sync folder `backups/` ke storage eksternal (Google Drive, Dropbox, object storage) menggunakan `rclone`:

```bash
# Install rclone dan configure (rclone config)
# Lalu tambahkan ke crontab setelah backup:
30 2 * * * rclone copy /var/www/absensi/database/backups remote:backup-absensi/
```

---

## 8. Pengaturan Timezone Server

```bash
# Set timezone server ke WIB
sudo timedatectl set-timezone Asia/Jakarta

# Verifikasi
timedatectl
date   # harus menampilkan WIB (UTC+7)
```

---

## 9. Firewall

```bash
# Izinkan hanya port yang dibutuhkan
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (redirect ke HTTPS)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Port 3000 (Node.js) TIDAK perlu dibuka — Nginx yang proxy ke sana
```

---

## 10. Checklist Go-Live

```
[ ] Domain sudah pointing ke IP server (A record)
[ ] HTTPS sudah aktif dan sertifikat valid
[ ] .env sudah dikonfigurasi dengan JWT_SECRET baru
[ ] ALLOWED_ORIGINS diisi domain produksi
[ ] NODE_ENV=production
[ ] TZ=Asia/Jakarta (di server dan di .env)
[ ] PM2 sudah running dan auto-start dikonfigurasi
[ ] Crontab backup sudah aktif
[ ] Login pertama dengan admin/admin123 → WAJIB ganti password
[ ] Test scanner kamera di https:// (bukan http://)
[ ] Test import Excel
[ ] Test scan QR 2x di hari yang sama → harus ditolak
```

---

## Troubleshooting

### Scanner tidak bisa akses kamera
→ Pastikan diakses via **HTTPS**. Browser memblokir akses kamera di HTTP (kecuali localhost).

### Error "CORS"
→ Tambahkan domain production di `.env`: `ALLOWED_ORIGINS=https://domain.sch.id`

### Waktu absen salah (terlambat padahal tepat waktu)
→ Cek timezone server: `date`. Harus WIB (UTC+7).
→ Set `TZ=Asia/Jakarta` di `.env` dan `sudo timedatectl set-timezone Asia/Jakarta`

### Database locked (concurrent write)
→ Normal untuk 1-2 titik scanner bersamaan. Jika lebih dari 5 scanner bersamaan, pertimbangkan upgrade ke PostgreSQL.

### PM2 tidak auto-restart setelah reboot
→ Jalankan `pm2 startup` lagi dan ikuti instruksi yang muncul.
