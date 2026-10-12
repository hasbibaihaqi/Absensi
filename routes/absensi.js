/**
 * routes/absensi.js — Scan Absen, Input Manual, Rekap, Statistik, Laporan, Export
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const multer = require('multer');
const dbHandler = require('../services/db_handler');

require('dotenv').config();

// POST /api/absensi/scan — Scanner QR utama
router.post('/scan', (req, res) => {
    const { qrData, isManual, jenisScan, jenisManual, keterangan } = req.body;

    if (!qrData) return res.status(400).json({ status: 'error', pesan: 'Data QR tidak boleh kosong.' });

    const jenisOverride = jenisScan || jenisManual || null;
    const dicatatOleh = req.user ? req.user.id : null;
    const fotoBukti = isManual ? 'MANUAL' : '-';

    dbHandler.catatAbsen(qrData, fotoBukti, (errDB, result) => {
        if (errDB) {
            console.log(`[SCAN GAGAL] ID: ${qrData} - Alasan: ${errDB.message}`);

            if (errDB.code === 'ALREADY_SCANNED') {
                return res.status(409).json({
                    success: false,
                    code: 'ALREADY_SCANNED',
                    message: 'Anda sudah absen',
                    nama: errDB.nama || 'Siswa/Guru',
                    kelas: errDB.kelas || '-',
                    jenis: errDB.jenis || ''
                });
            }

            return res.status(400).json({ status: 'error', pesan: errDB.message });
        }

        console.log(`[SCAN BERHASIL] Nama: ${result.nama} | Peran: ${result.peran} | ID: ${qrData}${isManual ? ' (MANUAL)' : ''}`);
        res.json({
            success: true,
            status: 'sukses',
            pesan: `Berhasil!\n${result.nama}`,
            jenis: result.jenis,
            nama: result.nama,
            kelas: result.kelas || '-',
            isTerlambat: result.isTerlambat
        });
    }, jenisOverride, keterangan || '', dicatatOleh);
});

// POST /api/absensi/manual-input — Input ketidakhadiran (Sakit/Izin/Alpa) oleh admin/guru
router.post('/manual-input', (req, res) => {
    const { nis, status, keterangan } = req.body;
    if (!nis || !status) return res.status(400).json({ sukses: false, pesan: 'NIS dan status wajib diisi.' });

    const dicatatOleh = req.user ? req.user.id : null;
    dbHandler.inputKetidakhadiran(nis, status, keterangan || '', (err, result) => {
        if (err) {
            console.error('[ABSEN MANUAL ERROR]', err.message);
            return res.status(400).json({ sukses: false, pesan: err.message });
        }
        console.log(`[ABSEN MANUAL] ${result.nama} | Status: ${result.jenis} | Ket: ${result.keterangan}`);
        res.json({ sukses: true, nama: result.nama });
    }, dicatatOleh);
});

// GET /api/absensi/siswa-list — List siswa aktif untuk autocomplete input manual (Guru & Admin)
router.get('/siswa-list', (req, res) => {
    dbHandler.getSiswa((err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const safeRows = (rows || []).filter(s => s.status === 'Aktif').map(s => ({
            nis: s.nomor_induk,
            nama_lengkap: s.nama_lengkap,
            kelas: s.kelas
        }));
        res.json(safeRows);
    });
});

// GET /api/absensi/rekap/:nis — Rekap absensi individu
router.get('/rekap/:nis', (req, res) => {
    dbHandler.getRekapSiswa(req.params.nis, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET /api/absensi/statistik — Statistik dashboard hari ini
router.get('/statistik', (req, res) => {
    dbHandler.getStatistikHariIni((err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(data || { totalSiswa: 0, totalGuru: 0, hadirPagi: 0, terlambat: 0 });
    });
});

// GET /api/absensi/tren-7-hari — Tren kehadiran 7 hari terakhir
router.get('/tren-7-hari', (req, res) => {
    dbHandler.getTrenKehadiran7Hari((err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ sukses: true, tren: rows || [] });
    });
});

// GET /api/absensi/chart-data — Agregat lengkap grafik dashboard (tren 7 hari + distribusi hari ini)
router.get('/chart-data', (req, res) => {
    dbHandler.getTrenKehadiran7Hari((errTren, rowsTren) => {
        if (errTren) return res.status(500).json({ error: errTren.message });

        dbHandler.getStatistikHariIni((errStat, stat) => {
            if (errStat) return res.status(500).json({ error: errStat.message });

            res.json({
                sukses: true,
                tren7Hari: rowsTren || [],
                distribusiHariIni: {
                    hadir: (stat.hadirPagi || 0) - (stat.terlambat || 0),
                    terlambat: stat.terlambat || 0,
                    izin: stat.izin || 0,
                    sakit: stat.sakit || 0,
                    alpa: stat.alpa || 0,
                    belumAbsen: stat.belumAbsen || 0
                }
            });
        });
    });
});

// GET /api/absensi/laporan — Data laporan dengan filter
router.get('/laporan', (req, res) => {
    const { mulai, akhir, peran = 'Semua', kelas = 'Semua' } = req.query;
    if (!mulai || !akhir) return res.status(400).json({ error: 'Parameter tanggal mulai dan akhir diperlukan.' });

    dbHandler.getLaporan(mulai, akhir, peran, kelas, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET /api/absensi/export-excel — Export laporan ke file Excel
router.get('/export-excel', (req, res) => {
    const { mulai, akhir, peran = 'Semua', kelas = 'Semua' } = req.query;
    if (!mulai || !akhir) return res.status(400).json({ error: 'Parameter tanggal diperlukan.' });

    dbHandler.getLaporan(mulai, akhir, peran, kelas, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) return res.status(404).json({ error: 'Data laporan kosong untuk periode tersebut.' });

        const dataExcel = rows.map(r => ({
            Tanggal: r.waktu_scan.split(' ')[0],
            Jam: r.waktu_scan.split(' ')[1] || '-',
            'NIS/NIP': r.nomor_induk,
            Nama: r.nama_lengkap,
            Peran: r.peran,
            'Kelas/Jabatan': r.kelas,
            Status: r.jenis_absen,
            Keterangan: r.keterangan || '-',
            'File Foto': r.foto_bukti || '-'
        }));

        const ws = xlsx.utils.json_to_sheet(dataExcel);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, 'Rekap_Absensi');

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const filename = `Laporan_Absensi_${mulai}_sd_${akhir}.xlsx`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    });
});

const { requireRole } = require('../middleware/auth');

// PUT /api/absensi/:id — Koreksi / Edit absensi (Admin only)
router.put('/:id', requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { jenis_absen, keterangan } = req.body;

    if (!jenis_absen) {
        return res.status(400).json({ sukses: false, error: 'Jenis absen wajib diisi.' });
    }

    dbHandler.updateAbsensi(id, { jenis_absen, keterangan: keterangan || '' }, (err, result) => {
        if (err) return res.status(500).json({ sukses: false, error: err.message });
        res.json({ sukses: true, pesan: 'Catatan absensi berhasil diperbarui.', data: result });
    });
});

// DELETE /api/absensi/:id — Hapus data absensi (Admin only)
router.delete('/:id', requireRole('admin'), (req, res) => {
    const { id } = req.params;

    dbHandler.hapusAbsensi(id, (err) => {
        if (err) return res.status(500).json({ sukses: false, error: err.message });
        res.json({ sukses: true, pesan: 'Catatan absensi berhasil dihapus.' });
    });
});

module.exports = router;
