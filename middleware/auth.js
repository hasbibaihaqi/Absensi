/**
 * middleware/auth.js — JWT Authentication Middleware
 * Verifikasi token dari HttpOnly cookie 'token'
 */

const jwt = require('jsonwebtoken');

/**
 * requireAuth — middleware standar, tolak request jika token tidak valid
 */
function requireAuth(req, res, next) {
    const token = req.cookies?.token;

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Silakan login terlebih dahulu.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.status(401).json({ error: 'Sesi tidak valid atau sudah habis. Silakan login ulang.' });
    }
}

/**
 * requirePasswordChanged — middleware yang memblokir akses jika password masih default
 * Gunakan pada semua route admin KECUALI /api/auth/change-password dan /api/auth/logout
 */
function requirePasswordChanged(req, res, next) {
    // Hanya berlaku untuk token yang valid (sudah melewati requireAuth)
    if (req.user && req.user.mustChangePassword === true) {
        return res.status(403).json({
            error: 'Wajib ganti password terlebih dahulu.',
            code: 'MUST_CHANGE_PASSWORD'
        });
    }
    next();
}

/**
 * requireRole — middleware pembatas akses berdasarkan role ('admin', 'guru')
 */
function requireRole(allowedRoles) {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    return function(req, res, next) {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized: Silakan login terlebih dahulu.' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Akses ditolak: Anda tidak memiliki hak akses.' });
        }
        next();
    };
}

module.exports = { requireAuth, requirePasswordChanged, requireRole };
