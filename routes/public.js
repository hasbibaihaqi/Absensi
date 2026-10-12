/**
 * routes/public.js — Endpoint Publik (READ-ONLY, tanpa autentikasi)
 * GET /api/public/absensi-hari-ini
 * GET /api/public/daftar-kelas
 *
 * Rate limited: 60 request/menit per IP
 * TIDAK ADA endpoint POST/PUT/DELETE di sini
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const dbHandler = require('../services/db_handler');
const appConfig = require('../services/app_config');

// Rate limiter khusus endpoint publik
const publicLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 menit
    max: 60,             // max 60 request per menit per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Terlalu banyak permintaan. Silakan coba lagi dalam 1 menit.',
        retryAfter: 60
    }
});

router.use(publicLimiter);

// GET /api/public/absensi-hari-ini
// Query params: kelas (optional), cari (optional - nama/NIS)
router.get('/absensi-hari-ini', (req, res) => {
    const { kelas, cari } = req.query;
    const cfg = appConfig.getConfig();
    const jamBatasMasuk = cfg.jamBatasMasuk || '07:15';

    dbHandler.getAbsensiHariIni(kelas || null, cari || null, (err, rows) => {
        if (err) {
            console.error('[PUBLIC API]', err);
            return res.status(500).json({ error: 'Terjadi kesalahan server.' });
        }

        // Hanya kembalikan data yang aman — tidak ada data sensitif
        const safeData = rows.map(r => {
            let isTerlambat = false;
            if (r.jenis_absen === 'Masuk' && r.jam_absen) {
                const jamAbsenShort = r.jam_absen.substring(0, 5); // HH:mm
                isTerlambat = jamAbsenShort > jamBatasMasuk;
            }

            let finalJenis = r.jenis_absen;
            if (r.jenis_absen === 'Masuk' && isTerlambat) {
                finalJenis = 'Terlambat';
            }

            let ketText = r.keterangan && r.keterangan !== 'MANUAL' ? r.keterangan : '';
            if (isTerlambat || r.jenis_absen === 'Terlambat') {
                if (!ketText) {
                    ketText = 'Terlambat';
                } else if (!ketText.toLowerCase().includes('terlambat')) {
                    ketText = `Terlambat (${ketText})`;
                }
            } else if (!ketText) {
                ketText = '-';
            }

            return {
                nama_lengkap: r.nama_lengkap,
                kelas: r.kelas,
                jenis_absen: finalJenis,
                is_terlambat: isTerlambat,
                keterangan: ketText,
                jam_absen: r.jam_absen
            };
        });

        res.json({
            tanggal: new Date().toLocaleDateString('id-ID', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            }),
            total: safeData.length,
            data: safeData
        });
    });
});

// GET /api/public/daftar-kelas — Untuk dropdown filter di landing page
router.get('/daftar-kelas', (req, res) => {
    dbHandler.getDaftarKelas((err, kelas) => {
        if (err) return res.status(500).json({ error: 'Terjadi kesalahan server.' });
        res.json(kelas);
    });
});

// GET /api/public/statistik — Ringkasan statistik untuk landing page
router.get('/statistik', (req, res) => {
    dbHandler.getStatistikHariIni((err, data) => {
        if (err) return res.status(500).json({ error: 'Terjadi kesalahan server.' });
        res.json(data || { totalSiswa: 0, totalGuru: 0, hadirPagi: 0, terlambat: 0 });
    });
});

// GET /api/public/server-time — Acuan waktu real-time server (Asia/Jakarta / WIB)
router.get('/server-time', (req, res) => {
    const now = new Date();

    const optionsDate = { timeZone: 'Asia/Jakarta', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const optionsTime = { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' };

    const formattedDate = now.toLocaleDateString('id-ID', optionsDate);
    const formattedTime = now.toLocaleTimeString('id-ID', optionsTime).replace(/\./g, ':');

    res.json({
        timestamp: now.getTime(),
        formattedDate,
        formattedTime,
        timezone: 'WIB'
    });
});

// GET /api/public/daftar-guru — Untuk dropdown pilihan guru di halaman registrasi
router.get('/daftar-guru', (req, res) => {
    dbHandler.getGuru((err, rows) => {
        if (err) return res.status(500).json({ error: 'Terjadi kesalahan server.' });
        const dataGuru = (rows || []).map(g => ({
            id: g.id,
            nip: g.nomor_induk,
            nama_lengkap: g.nama_lengkap
        }));
        res.json({ sukses: true, data: dataGuru });
    });
});

// GET /api/public/aturan-jam — Expose aturan jam absensi untuk landing page (READ-ONLY)
router.get('/aturan-jam', (req, res) => {
    const cfg = appConfig.getConfig();
    res.json({
        sukses: true,
        jamBatasMasuk: cfg.jamBatasMasuk || '07:15',
        jamPulangMulai: cfg.jamPulangMulai || '12:00'
    });
});

// GET /api/public/info-sekolah — Nama sekolah untuk semua halaman publik (tanpa auth)
router.get('/info-sekolah', (req, res) => {
    const cfg = appConfig.getConfig();
    res.json({
        sukses: true,
        namaSekolah: cfg.namaSekolah || 'SMP TERPADU BANDUNG'
    });
});

// GET /api/public/logo — Serve logo sekolah (tanpa auth, alias aman dari /api/pengaturan/logo)
// Dilindungi rate limit publicLimiter yang sudah terpasang di atas
router.get('/logo', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const dbDir = path.resolve(__dirname, '../database');
    const ekstensiYangDiizinkan = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
    const mimeMap = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp'
    };

    // Cari file logo di folder database — tidak ada path dari request → aman dari path traversal
    for (const ext of ekstensiYangDiizinkan) {
        const logoPath = path.join(dbDir, `logo${ext}`);
        if (fs.existsSync(logoPath)) {
            const mime = mimeMap[ext] || 'image/png';
            // Cache 1 jam di browser, revalidasi via ETag
            res.setHeader('Content-Type', mime);
            res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
            return res.sendFile(logoPath);
        }
    }

    // Cek logoPath dari config (path absolut lama) — validasi tidak keluar dari dbDir
    const cfg = appConfig.getConfig();
    if (cfg.logoPath) {
        const resolvedPath = path.resolve(cfg.logoPath);
        // Pastikan path tetap di dalam direktori yang aman (tidak ada path traversal)
        if (resolvedPath.startsWith(dbDir) && fs.existsSync(resolvedPath)) {
            const ext = path.extname(resolvedPath).toLowerCase();
            const mime = mimeMap[ext] || 'image/png';
            res.setHeader('Content-Type', mime);
            res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
            return res.sendFile(resolvedPath);
        }
    }

    res.status(404).json({ sukses: false, error: 'Logo belum diupload.' });
});

// ──────────────────────────────────────────────────────────────
// ENDPOINT REKAP PUBLIK — Pengganti fitur notifikasi WA
// ──────────────────────────────────────────────────────────────

// Rate limiter lebih ketat untuk pencarian siswa (cegah enumerasi data)
const cariLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Terlalu banyak permintaan pencarian. Coba lagi 1 menit.' }
});

// GET /api/public/rekap?periode=hari|minggu|bulan — Rekap per kelas
router.get('/rekap', (req, res) => {
    const { periode = 'hari' } = req.query;
    const periodeValid = ['hari', 'minggu', 'bulan'];
    if (!periodeValid.includes(periode)) {
        return res.status(400).json({ error: 'Parameter periode tidak valid. Gunakan: hari, minggu, atau bulan.' });
    }

    dbHandler.getRekapPerKelas(periode, (err, data) => {
        if (err) {
            console.error('[PUBLIC REKAP]', err.message);
            return res.status(500).json({ error: 'Terjadi kesalahan server.' });
        }
        res.json({ sukses: true, periode, data: data || [] });
    });
});

// GET /api/public/siswa/cari?q=... — Cari siswa (min 3 karakter, max 10 hasil)
// Keputusan privasi: tidak masking nama karena halaman ini sudah publik (seperti papan absensi sekolah).
// Yang TIDAK dikembalikan: nomor HP/WA orang tua, alamat, data sensitif lainnya.
router.get('/siswa/cari', cariLimiter, (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 3) {
        return res.status(400).json({ error: 'Pencarian minimal 3 karakter.' });
    }

    dbHandler.cariSiswaPublik(q, (err, rows) => {
        if (err) {
            console.error('[PUBLIC CARI]', err.message);
            return res.status(500).json({ error: 'Terjadi kesalahan server.' });
        }
        // Batasi 10 hasil, hanya field yang aman
        const safeResult = (rows || []).slice(0, 10).map(r => ({
            id: r.id,          // ID internal untuk /rekap/:id berikutnya
            nama_lengkap: r.nama_lengkap,
            kelas: r.kelas
        }));
        res.json({ sukses: true, total: safeResult.length, data: safeResult });
    });
});

// GET /api/public/siswa/:id/rekap — Rekap absensi siswa (30 hari terakhir) via ID
router.get('/siswa/:id/rekap', cariLimiter, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id) || id <= 0) {
        return res.status(400).json({ error: 'ID siswa tidak valid.' });
    }

    // Set no-store cache control demi privasi data siswa
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    dbHandler.getRekapSiswaPublik(id, (err, data) => {
        if (err) {
            console.error('[PUBLIC REKAP SISWA]', err.message);
            return res.status(500).json({ error: 'Terjadi kesalahan server.' });
        }
        if (!data) {
            return res.status(404).json({ error: 'Siswa tidak ditemukan.' });
        }
        res.json({ sukses: true, data });
    });
});

// GET /api/public/siswa/rekap-30-hari?nis=... — Portal Rekap Siswa Khusus Orang Tua / Siswa
// Menggunakan query berparameter, rate limit ketat (20 req/menit), sanitasi format NIS
router.get('/siswa/rekap-30-hari', cariLimiter, (req, res) => {
    const rawNis = (req.query.nis || '').trim();

    // Validasi format NIS: minimal 3 karakter, alfanumerik & tanda hubung, maks 20 karakter
    if (!rawNis || rawNis.length < 3 || rawNis.length > 20 || !/^[a-zA-Z0-9\-_]+$/.test(rawNis)) {
        return res.status(400).json({
            sukses: false,
            error: 'Format NIS tidak valid. Masukkan minimal 3 karakter alfanumerik.'
        });
    }

    // Header Cache-Control: no-store untuk privasi data siswa
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    dbHandler.getRekapSiswaByNis(rawNis, (err, data) => {
        if (err) {
            console.error('[PUBLIC REKAP NIS]', err.message);
            return res.status(500).json({ sukses: false, error: 'Terjadi kesalahan server.' });
        }

        // Respon seragam jika tidak ditemukan untuk mencegah enumerasi
        if (!data) {
            return res.status(404).json({
                sukses: false,
                error: 'Data kehadiran siswa dengan NIS tersebut tidak ditemukan atau siswa tidak aktif.'
            });
        }

        res.json({ sukses: true, data });
    });
});

module.exports = router;
