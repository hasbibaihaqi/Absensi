/**
 * routes/siswa.js — CRUD Siswa + Import/Export Excel + QR ZIP
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');
const JSZip = require('jszip');
const dbHandler = require('../services/db_handler');

// ── Validasi file Excel — tipe + ukuran + ekstensi ──────────────────
const EXCEL_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // .xlsx
    'application/vnd.ms-excel',                                             // .xls
    'application/octet-stream'                                              // fallback beberapa browser
];
const EXCEL_EXTENSIONS = /\.(xlsx|xls)$/i;
const MAX_EXCEL_SIZE = 5 * 1024 * 1024; // 5 MB

const uploadExcel = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_EXCEL_SIZE },
    fileFilter: (req, file, cb) => {
        const extOk = EXCEL_EXTENSIONS.test(file.originalname);
        const mimeOk = EXCEL_MIME_TYPES.includes(file.mimetype);
        if (!extOk || !mimeOk) {
            return cb(new Error('Format file tidak didukung. Hanya file Excel (.xlsx/.xls) yang diizinkan.'));
        }
        cb(null, true);
    }
});

// GET /api/siswa
router.get('/', (req, res) => {
    dbHandler.getSiswa((err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST /api/siswa
router.post('/', (req, res) => {
    const data = req.body;
    if (!data.nis || !data.nama_lengkap || !data.kelas) {
        return res.status(400).json({ error: 'NIS, nama lengkap, dan kelas wajib diisi.' });
    }
    dbHandler.tambahSiswa(data, (err) => {
        if (err) return res.status(500).json({ sukses: false, error: err.message });
        res.json({ sukses: true });
    });
});

// PUT /api/siswa/:id
router.put('/:id', (req, res) => {
    const data = { ...req.body, id: req.params.id };
    dbHandler.updateSiswa(data, (err) => {
        if (err) return res.status(500).json({ sukses: false, error: err.message });
        res.json({ sukses: true });
    });
});

// DELETE /api/siswa/:id
router.delete('/:id', (req, res) => {
    dbHandler.hapusSiswa(req.params.id, (err) => {
        if (err) return res.status(500).json({ sukses: false, error: err.message });
        res.json({ sukses: true });
    });
});

// POST /api/siswa/import — Import dari Excel
router.post('/import', uploadExcel.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ sukses: false, error: 'File Excel tidak ditemukan.' });

    try {
        const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
        const wsName = wb.SheetNames[0];
        const dataJson = xlsx.utils.sheet_to_json(wb.Sheets[wsName]);

        if (dataJson.length === 0) return res.status(400).json({ sukses: false, error: 'File Excel kosong atau format tidak sesuai.' });

        dbHandler.importSiswa(dataJson, (err) => {
            if (err) return res.status(500).json({ sukses: false, error: err.message });
            res.json({ sukses: true, pesan: `${dataJson.length} data berhasil diimport.` });
        });
    } catch (e) {
        res.status(400).json({ sukses: false, error: 'Gagal membaca file Excel. Pastikan format sesuai template.' });
    }
});

// GET /api/siswa/export — Export data siswa ke Excel
router.get('/export', (req, res) => {
    dbHandler.getSiswa((err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length === 0) return res.status(404).json({ error: 'Data siswa masih kosong.' });

        const dataExcel = rows.map(r => ({
            NIS: r.nomor_induk,
            Nama: r.nama_lengkap,
            Kelas: r.kelas,
            Status: r.status
        }));

        const ws = xlsx.utils.json_to_sheet(dataExcel);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, 'Data_Siswa');

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename="Data_Siswa.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    });
});

// GET /api/siswa/template — Download template Excel
router.get('/template', (req, res) => {
    const ws = xlsx.utils.json_to_sheet([
        { NIS: '24001', Nama: 'Budi Santoso', Kelas: '7A', Status: 'Aktif' }
    ]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Template');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="Template_Data_Siswa.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});

// POST /api/siswa/qr-zip — Generate ZIP QR kode satu kelas (diproses di server)
router.post('/qr-zip', async (req, res) => {
    const { kelas, siswaList } = req.body;
    // siswaList = [{nomor_induk, nama_lengkap, kelas}] dikirim dari frontend
    // QR Code dibuat di server menggunakan library 'qrcode'

    if (!kelas || !siswaList || !Array.isArray(siswaList) || siswaList.length === 0) {
        return res.status(400).json({ error: 'Data kelas dan daftar siswa diperlukan.' });
    }

    try {
        // Gunakan qrcode library jika tersedia, atau fallback ke base64 yang dikirim frontend
        const QRCode = (() => { try { return require('qrcode'); } catch { return null; } })();

        const zip = new JSZip();

        for (const siswa of siswaList) {
            let pngBuffer;
            if (QRCode) {
                pngBuffer = await QRCode.toBuffer(siswa.nomor_induk, { width: 512, margin: 2 });
            } else if (siswa.base64) {
                // Fallback: frontend mengirim base64 QR yang sudah dibuat
                pngBuffer = Buffer.from(siswa.base64, 'base64');
            } else {
                continue;
            }
            const namaAman = siswa.nama_lengkap.replace(/[^a-z0-9]/gi, '_');
            zip.file(`${siswa.kelas}_${namaAman}_${siswa.nomor_induk}.png`, pngBuffer);
        }

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        res.setHeader('Content-Disposition', `attachment; filename="QR_Kelas_${kelas}.zip"`);
        res.setHeader('Content-Type', 'application/zip');
        res.send(zipBuffer);
    } catch (err) {
        console.error('[QR-ZIP]', err);
        res.status(500).json({ error: 'Gagal membuat file ZIP QR Code.' });
    }
});

// GET /api/siswa/qr-single/:nis — Download single QR PNG
router.get('/qr-single/:nis', async (req, res) => {
    const QRCode = (() => { try { return require('qrcode'); } catch { return null; } })();
    if (!QRCode) return res.status(500).json({ error: 'Library qrcode tidak terinstall di server.' });

    try {
        const buffer = await QRCode.toBuffer(req.params.nis, { width: 512, margin: 2 });
        res.setHeader('Content-Disposition', `attachment; filename="QR_${req.params.nis}.png"`);
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: 'Gagal membuat QR Code.' });
    }
});

module.exports = router;
