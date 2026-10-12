/**
 * routes/pengaturan.js — Pengaturan Aplikasi: Config, Akun Admin, Logo
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const appConfig = require('../services/app_config');
const dbHandler = require('../services/db_handler');

const dbDir = path.resolve(__dirname, '../database');

// Multer untuk upload logo
const uploadLogo = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, dbDir),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            cb(null, `logo${ext}`);
        }
    }),
    fileFilter: (req, file, cb) => {
        const allowed = /\.(png|jpg|jpeg|gif|svg|webp)$/i;
        if (allowed.test(file.originalname)) cb(null, true);
        else cb(new Error('Format file tidak didukung. Gunakan PNG, JPG, GIF, atau SVG.'));
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// GET /api/pengaturan/config
router.get('/config', (req, res) => {
    res.json(appConfig.getConfig());
});

// POST /api/pengaturan/config
router.post('/config', (req, res) => {
    const newConfig = req.body;
    const success = appConfig.saveConfig(newConfig);
    if (success) res.json({ sukses: true });
    else res.status(500).json({ sukses: false, error: 'Gagal menyimpan konfigurasi.' });
});

// GET /api/pengaturan/admin-akun
router.get('/admin-akun', (req, res) => {
    dbHandler.getAdminAccount((err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || {});
    });
});

// POST /api/pengaturan/admin-akun
router.post('/admin-akun', (req, res) => {
    const { username, password } = req.body;
    if (!username) return res.status(400).json({ sukses: false, error: 'Username tidak boleh kosong.' });

    dbHandler.updateAdminAccount(username, password || '*KEEP*', (err) => {
        if (err) return res.status(500).json({ sukses: false, error: err.message });
        res.json({ sukses: true });
    });
});

// POST /api/pengaturan/logo — Upload logo
router.post('/logo', (req, res) => {
    uploadLogo.single('logo')(req, res, (err) => {
        if (err) return res.status(400).json({ sukses: false, error: err.message });
        if (!req.file) return res.status(400).json({ sukses: false, error: 'File logo tidak ditemukan.' });

        const destPath = path.join(dbDir, req.file.filename);
        appConfig.saveConfig({ logoPath: destPath });
        res.json({ sukses: true, logoUrl: `/api/pengaturan/logo` });
    });
});

// GET /api/pengaturan/logo — Serve logo sekolah
router.get('/logo', (req, res) => {
    const cfg = appConfig.getConfig();
    const logoExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];

    // Cari file logo di folder database
    for (const ext of logoExtensions) {
        const logoPath = path.join(dbDir, `logo${ext}`);
        if (fs.existsSync(logoPath)) {
            return res.sendFile(logoPath);
        }
    }

    // Cek logoPath dari config (path absolut lama)
    if (cfg.logoPath && fs.existsSync(cfg.logoPath)) {
        return res.sendFile(cfg.logoPath);
    }

    res.status(404).json({ error: 'Logo tidak ditemukan.' });
});

// DELETE /api/pengaturan/logo — Hapus logo
router.delete('/logo', (req, res) => {
    const logoExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
    for (const ext of logoExtensions) {
        const logoPath = path.join(dbDir, `logo${ext}`);
        if (fs.existsSync(logoPath)) {
            try { fs.unlinkSync(logoPath); } catch (_) {}
        }
    }
    appConfig.saveConfig({ logoPath: '' });
    res.json({ sukses: true });
});

// ==========================================
// BACKUP & RESTORE DATABASE
// ==========================================

const sqliteDbPath = path.resolve(dbDir, 'absensi.sqlite');
const backupDir = path.resolve(dbDir, 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

// Multer untuk upload restore database
const uploadRestore = multer({
    dest: path.resolve(__dirname, '../logs'),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// GET /api/pengaturan/backup/download — Download file database saat ini langsung
router.get('/backup/download', (req, res) => {
    if (!fs.existsSync(sqliteDbPath)) {
        return res.status(404).json({ error: 'File database tidak ditemukan.' });
    }
    const tgl = new Date().toISOString().slice(0, 10);
    res.download(sqliteDbPath, `backup_absensi_${tgl}.sqlite`);
});

// POST /api/pengaturan/backup/create — Buat snapshot backup di server
router.post('/backup/create', (req, res) => {
    try {
        if (!fs.existsSync(sqliteDbPath)) {
            return res.status(404).json({ sukses: false, error: 'Database tidak ditemukan.' });
        }
        const pad = n => String(n).padStart(2, '0');
        const d = new Date();
        const fname = `absensi_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.sqlite`;
        const dest = path.join(backupDir, fname);

        fs.copyFileSync(sqliteDbPath, dest);
        const stat = fs.statSync(dest);
        res.json({
            sukses: true,
            file: fname,
            ukuranKB: Math.round(stat.size / 1024),
            waktu: d.toLocaleString('id-ID')
        });
    } catch (e) {
        res.status(500).json({ sukses: false, error: e.message });
    }
});

// GET /api/pengaturan/backup/list — Ambil riwayat file backup lokal
router.get('/backup/list', (req, res) => {
    try {
        if (!fs.existsSync(backupDir)) return res.json({ list: [] });
        const files = fs.readdirSync(backupDir)
            .filter(f => f.endsWith('.sqlite'))
            .map(f => {
                const fullPath = path.join(backupDir, f);
                const stat = fs.statSync(fullPath);
                return {
                    nama: f,
                    ukuranKB: Math.round(stat.size / 1024),
                    waktu: stat.mtime
                };
            })
            .sort((a, b) => new Date(b.waktu) - new Date(a.waktu));
        res.json({ list: files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/pengaturan/backup/restore — Upload file SQLite untuk restore
router.post('/backup/restore', uploadRestore.single('dbFile'), (req, res) => {
    if (!req.file) return res.status(400).json({ sukses: false, error: 'File database tidak ditemukan.' });

    try {
        const tempPath = req.file.path;
        // Buat backup safety dari database saat ini sebelum ditimpa
        const safetyBackup = path.join(backupDir, `safety_pre_restore_${Date.now()}.sqlite`);
        if (fs.existsSync(sqliteDbPath)) {
            fs.copyFileSync(sqliteDbPath, safetyBackup);
        }

        // Timpa database aktif
        fs.copyFileSync(tempPath, sqliteDbPath);
        fs.unlinkSync(tempPath);

        res.json({ sukses: true, pesan: 'Database berhasil dipulihkan. Silakan muat ulang halaman.' });
    } catch (e) {
        res.status(500).json({ sukses: false, error: e.message });
    }
});

// ==========================================
// PEMBERSIHAN LOG & FILE SISA LAMA
// ==========================================
router.post('/cleanup', (req, res) => {
    const hasil = {
        waSessionRemoved: false,
        logsTruncated: 0,
        tempFilesDeleted: 0
    };

    try {
        // 1. Bersihkan sisa folder wa_session jika ada
        const waSessionDir = path.resolve(dbDir, 'wa_session');
        if (fs.existsSync(waSessionDir)) {
            fs.rmSync(waSessionDir, { recursive: true, force: true });
            hasil.waSessionRemoved = true;
        }

        // 2. Bersihkan/rotate file access log yang membengkak
        const logDir = path.resolve(__dirname, '../logs');
        if (fs.existsSync(logDir)) {
            const logFiles = fs.readdirSync(logDir);
            for (const lf of logFiles) {
                const p = path.join(logDir, lf);
                if (lf.endsWith('.log')) {
                    fs.writeFileSync(p, '', 'utf8'); // Reset isi log
                    hasil.logsTruncated++;
                } else if (!lf.endsWith('.gitkeep')) {
                    // File sementara upload
                    try { fs.unlinkSync(p); hasil.tempFilesDeleted++; } catch (_) {}
                }
            }
        }

        res.json({ sukses: true, detail: hasil, pesan: 'Pembersihan log dan sisa file selesai.' });
    } catch (e) {
        res.status(500).json({ sukses: false, error: e.message });
    }
});

module.exports = router;
