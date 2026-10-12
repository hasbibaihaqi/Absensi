/**
 * routes/guru.js — CRUD Guru
 */

const express = require('express');
const router = express.Router();
const dbHandler = require('../services/db_handler');

// GET /api/guru
router.get('/', (req, res) => {
    dbHandler.getGuru((err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST /api/guru
router.post('/', (req, res) => {
    const data = req.body;
    if (!data.nip || !data.nama_lengkap || !data.jabatan) {
        return res.status(400).json({ error: 'NIP, nama lengkap, dan jabatan wajib diisi.' });
    }
    dbHandler.tambahGuru(data, (err) => {
        if (err) return res.status(500).json({ sukses: false, error: err.message });
        res.json({ sukses: true });
    });
});

// PUT /api/guru/:id
router.put('/:id', (req, res) => {
    const data = { ...req.body, id: req.params.id };
    dbHandler.updateGuru(data, (err) => {
        if (err) return res.status(500).json({ sukses: false, error: err.message });
        res.json({ sukses: true });
    });
});

// DELETE /api/guru/:id
router.delete('/:id', (req, res) => {
    dbHandler.hapusGuru(req.params.id, (err) => {
        if (err) return res.status(500).json({ sukses: false, error: err.message });
        res.json({ sukses: true });
    });
});

// GET /api/guru/export — Export data guru ke Excel
const xlsx = require('xlsx');
router.get('/export', (req, res) => {
    dbHandler.getGuru((err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length === 0) return res.status(404).json({ error: 'Data guru masih kosong.' });

        const dataExcel = rows.map(r => ({
            NIP: r.nomor_induk,
            Nama: r.nama_lengkap,
            Jabatan: r.kelas,
            Status: r.status
        }));

        const ws = xlsx.utils.json_to_sheet(dataExcel);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, 'Data_Guru');

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename="Data_Guru.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    });
});

module.exports = router;
