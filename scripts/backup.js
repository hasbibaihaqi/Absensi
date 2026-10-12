/**
 * scripts/backup.js — Backup SQLite database harian
 *
 * Cara jalankan manual:
 *   node scripts/backup.js
 *
 * Cara jadwalkan via PM2 (tambahkan di ecosystem.config.js):
 *   cron_restart: "0 2 * * *"   (setiap hari jam 02:00)
 *
 * Cara jadwalkan via Linux crontab:
 *   0 2 * * * cd /var/www/absensi && node scripts/backup.js >> logs/backup.log 2>&1
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : path.join(__dirname, '../database/absensi.sqlite');

// Folder tujuan backup (buat jika belum ada)
const backupDir = path.join(__dirname, '../database/backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

function formatTanggal(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const h = String(date.getHours()).padStart(2, '0');
    const mn = String(date.getMinutes()).padStart(2, '0');
    return `${y}${m}${d}_${h}${mn}`;
}

function hapusBackupLama(dir, maxKeep = 30) {
    // Hapus backup lebih dari 30 hari (30 file)
    const files = fs.readdirSync(dir)
        .filter(f => f.startsWith('absensi_') && f.endsWith('.sqlite'))
        .sort();     // Urutkan dari terlama

    if (files.length > maxKeep) {
        const hapus = files.slice(0, files.length - maxKeep);
        hapus.forEach(f => {
            fs.unlinkSync(path.join(dir, f));
            console.log(`[BACKUP] Backup lama dihapus: ${f}`);
        });
    }
}

async function jalankanBackup() {
    if (!fs.existsSync(dbPath)) {
        console.error('[BACKUP] File database tidak ditemukan:', dbPath);
        process.exit(1);
    }

    const timestamp = formatTanggal(new Date());
    const destPath = path.join(backupDir, `absensi_${timestamp}.sqlite`);

    try {
        fs.copyFileSync(dbPath, destPath);
        const stat = fs.statSync(destPath);
        const ukuranKB = Math.round(stat.size / 1024);

        console.log(`[BACKUP] ✅ Backup berhasil: ${path.basename(destPath)} (${ukuranKB} KB)`);

        // Hapus backup lama (simpan max 30 file = 30 hari)
        hapusBackupLama(backupDir, 30);

        // Catat ke log
        const logLine = `${new Date().toISOString()} | OK | ${path.basename(destPath)} | ${ukuranKB} KB\n`;
        fs.appendFileSync(path.join(__dirname, '../logs/backup.log'), logLine);

        console.log(`[BACKUP] Backup tersimpan di: ${backupDir}`);
        console.log(`[BACKUP] Total backup: ${fs.readdirSync(backupDir).filter(f => f.endsWith('.sqlite')).length} file`);

    } catch (err) {
        const logLine = `${new Date().toISOString()} | ERROR | ${err.message}\n`;
        fs.appendFileSync(path.join(__dirname, '../logs/backup.log'), logLine);
        console.error('[BACKUP] ❌ Backup GAGAL:', err.message);
        process.exit(1);
    }
}

// Jalankan otomatis hanya saat dijalankan langsung (node scripts/backup.js)
// Saat di-require sebagai module oleh cron/server.js, hanya ekspor fungsi
if (require.main === module) {
    jalankanBackup();
}

module.exports = jalankanBackup;
