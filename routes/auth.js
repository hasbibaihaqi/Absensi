/**
 * routes/auth.js — Autentikasi Admin
 * POST /api/auth/login   → verifikasi login, issue JWT cookie
 * POST /api/auth/logout  → hapus cookie
 * GET  /api/auth/me      → cek sesi aktif
 * POST /api/auth/change-password → ganti password (wajib jika mustChangePassword)
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const dbHandler = require('../services/db_handler');
const { requireAuth } = require('../middleware/auth');

// ── Rate limiter khusus untuk login ──────────────────────────
// Max 10 percobaan per 15 menit per IP — cegah brute-force
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,   // Hanya hitung request GAGAL
    message: {
        sukses: false,
        pesan: 'Terlalu banyak percobaan login. Silakan coba lagi dalam 15 menit.'
    },
    keyGenerator: (req) => req.ip   // Limit per IP
});

// POST /api/auth/register (Pendaftaran Guru)
router.post('/register', loginLimiter, (req, res) => {
    const { username, password, nama_lengkap, guru_id } = req.body;

    if (!username || !password || !nama_lengkap) {
        return res.status(400).json({ sukses: false, pesan: 'Username, password, dan nama lengkap wajib diisi.' });
    }
    if (typeof username !== 'string' || typeof password !== 'string' || typeof nama_lengkap !== 'string') {
        return res.status(400).json({ sukses: false, pesan: 'Input tidak valid.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ sukses: false, pesan: 'Password minimal 6 karakter.' });
    }

    dbHandler.registerGuruUser({ username, password, nama_lengkap, guru_id: guru_id || null }, (err, result) => {
        if (err) {
            return res.status(400).json({ sukses: false, pesan: err.message || 'Gagal mendaftar.' });
        }
        res.json({
            sukses: true,
            pesan: 'Pendaftaran berhasil! Akun Anda kini menunggu persetujuan dari admin.'
        });
    });
});

// POST /api/auth/login
router.post('/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ sukses: false, pesan: 'Username dan password wajib diisi.' });
    }

    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ sukses: false, pesan: 'Input tidak valid.' });
    }

    dbHandler.cekLogin(username.trim(), password, (err, result) => {
        if (err) {
            console.error('[AUTH] Login error:', err);
            return res.status(500).json({ sukses: false, pesan: 'Terjadi kesalahan server.' });
        }

        if (result.error) {
            return res.status(401).json({ sukses: false, pesan: result.error });
        }

        const user = result.user;
        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                nama_lengkap: user.nama_lengkap,
                role: user.role,
                mustChangePassword: user.mustChangePassword
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 8 * 60 * 60 * 1000
        });

        res.json({
            sukses: true,
            id: user.id,
            username: user.username,
            nama_lengkap: user.nama_lengkap,
            role: user.role,
            mustChangePassword: user.mustChangePassword
        });
    });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
    });
    res.json({ sukses: true });
});

// GET /api/auth/me — cek apakah sesi masih aktif
router.get('/me', (req, res) => {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ loggedIn: false });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.json({
            loggedIn: true,
            id: decoded.id,
            username: decoded.username,
            nama_lengkap: decoded.nama_lengkap,
            role: decoded.role,
            mustChangePassword: decoded.mustChangePassword || false
        });
    } catch {
        res.clearCookie('token');
        res.status(401).json({ loggedIn: false });
    }
});

// POST /api/auth/change-password — ganti password wajib / manual
router.post('/change-password', requireAuth, (req, res) => {
    const { password, konfirmasi } = req.body;

    if (!password || !konfirmasi) {
        return res.status(400).json({ sukses: false, pesan: 'Password baru dan konfirmasi wajib diisi.' });
    }
    if (password !== konfirmasi) {
        return res.status(400).json({ sukses: false, pesan: 'Password dan konfirmasi tidak cocok.' });
    }
    if (password.length < 8) {
        return res.status(400).json({ sukses: false, pesan: 'Password minimal 8 karakter.' });
    }
    if (password === 'admin123') {
        return res.status(400).json({ sukses: false, pesan: 'Gunakan password yang lebih kuat dari password default!' });
    }

    dbHandler.resetUserPassword(req.user.id, password, (err) => {
        if (err) return res.status(500).json({ sukses: false, pesan: 'Gagal menyimpan password baru.' });

        const newToken = jwt.sign(
            {
                id: req.user.id,
                username: req.user.username,
                nama_lengkap: req.user.nama_lengkap,
                role: req.user.role,
                mustChangePassword: false
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
        );
        res.cookie('token', newToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 8 * 60 * 60 * 1000
        });

        res.json({ sukses: true, pesan: 'Password berhasil diubah!' });
    });
});

// ==========================================
// USER MANAGEMENT ENDPOINTS (ADMIN ONLY)
// ==========================================

const { requireRole } = require('../middleware/auth');

// GET /api/auth/pending-users — daftar guru yang belum di-approve
router.get('/pending-users', requireAuth, requireRole('admin'), (req, res) => {
    dbHandler.getPendingUsers((err, rows) => {
        if (err) return res.status(500).json({ sukses: false, pesan: 'Gagal mengambil data user pending.' });
        res.json({ sukses: true, data: rows });
    });
});

// GET /api/auth/users — daftar semua akun user
router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
    dbHandler.getAllUsers((err, rows) => {
        if (err) return res.status(500).json({ sukses: false, pesan: 'Gagal mengambil daftar user.' });
        res.json({ sukses: true, data: rows });
    });
});

// PUT /api/auth/users/:id/status — approve / reject / nonaktifkan user
router.put('/users/:id/status', requireAuth, requireRole('admin'), (req, res) => {
    const userId = req.params.id;
    const { status } = req.body;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ sukses: false, pesan: 'Status tidak valid.' });
    }

    dbHandler.updateUserStatus(userId, status, (err) => {
        if (err) return res.status(500).json({ sukses: false, pesan: 'Gagal mengupdate status user.' });
        res.json({ sukses: true, pesan: `Status akun berhasil diubah menjadi ${status}.` });
    });
});

// POST /api/auth/users/:id/reset-password — admin reset password guru
router.post('/users/:id/reset-password', requireAuth, requireRole('admin'), (req, res) => {
    const userId = req.params.id;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ sukses: false, pesan: 'Password baru minimal 6 karakter.' });
    }

    dbHandler.resetUserPassword(userId, newPassword, (err) => {
        if (err) return res.status(500).json({ sukses: false, pesan: 'Gagal mereset password.' });
        res.json({ sukses: true, pesan: 'Password user berhasil direset.' });
    });
});

// DELETE /api/auth/users/:id — admin hapus akun user
router.delete('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
    const userId = parseInt(req.params.id);

    if (userId === req.user.id) {
        return res.status(400).json({ sukses: false, pesan: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.' });
    }

    dbHandler.deleteUser(userId, (err) => {
        if (err) return res.status(400).json({ sukses: false, pesan: err.message || 'Gagal menghapus user.' });
        res.json({ sukses: true, pesan: 'Akun user berhasil dihapus secara permanen.' });
    });
});

module.exports = router;
