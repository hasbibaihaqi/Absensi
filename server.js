/**
 * server.js — Express.js Server Utama
 *
 * Cara jalankan:
 *   Development : node server.js
 *   Production  : NODE_ENV=production TZ=Asia/Jakarta node server.js (atau via PM2)
 */

require('dotenv').config();

// Paksa timezone WIB secara programatik (backup jika TZ env belum diset di OS)
if (!process.env.TZ) {
    process.env.TZ = 'Asia/Jakarta';
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const dbHandler = require('./services/db_handler');
const { requireAuth, requirePasswordChanged, requireRole } = require('./middleware/auth');
const cron = require('node-cron');
const jalankanBackup = require('./scripts/backup');


// Import routes
const authRoutes = require('./routes/auth');
const siswaRoutes = require('./routes/siswa');
const guruRoutes = require('./routes/guru');
const absensiRoutes = require('./routes/absensi');
const pengaturanRoutes = require('./routes/pengaturan');
const publicRoutes = require('./routes/public');

const app = express();
const PORT = process.env.PORT || 3000;

// Diperlukan jika aplikasi di-deploy di balik reverse proxy (Render, Railway, Nginx)
// agar rateLimiter dan req.ip membaca IP asli pengunjung dengan benar
app.set('trust proxy', 1);

// ==========================================
// LOGS SETUP — Simpan ke file logs/
// ==========================================
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const accessLogStream = fs.createWriteStream(path.join(logsDir, 'access.log'), { flags: 'a' });
// Log semua request ke file
app.use(morgan('combined', { stream: accessLogStream }));
// Log hanya error di console (development: log semua)
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

// ==========================================
// SECURITY HEADERS — Helmet.js
// ==========================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",           // Diperlukan karena ada inline script di HTML (FOUC prevention)
                "https://cdnjs.cloudflare.com",  // Masih dipakai untuk qrcodejs & jszip di admin.html
            ],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",           // Diperlukan karena ada inline <style> di beberapa halaman
            ],
            // font-src: semua font sudah self-hosted di /vendor/fontawesome/ dan /vendor/inter/
            fontSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https://ui-avatars.com"],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false   // Dibutuhkan agar kamera bisa jalan di iframe konteks tertentu
}));

// ==========================================
// CORS — Izinkan origin yang dikonfigurasi dan domain host
// ==========================================
const configuredOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];

app.use(cors({
    origin: (origin, callback) => {
        // Izinkan request tanpa header origin (same-origin, curl, mobile browser internal)
        if (!origin) return callback(null, true);

        // Jika terdaftar di ALLOWED_ORIGINS
        if (configuredOrigins.includes(origin)) return callback(null, true);

        // Jika running di localhost atau domain onrender.com
        if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || origin.endsWith('.onrender.com')) {
            return callback(null, true);
        }

        console.warn(`[CORS] Blokir request dari origin: ${origin}`);
        callback(new Error('Akses tidak diizinkan oleh kebijakan CORS.'));
    },
    credentials: true,          // Diperlukan agar cookie terkirim
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// ==========================================
// MIDDLEWARE GLOBAL
// ==========================================
app.use(express.json({ limit: '10mb' }));       // Body JSON (termasuk gambar base64)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Rate limiter global untuk semua endpoint API admin
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 menit
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/api/public/')   // Publik punya limiter sendiri
});
app.use('/api/', adminLimiter);

// ==========================================
// STATIC FILES (Frontend)
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ==========================================
// ROUTES — PUBLIK (tanpa autentikasi)
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);

// Alias publik untuk logo (backward-compatibility untuk endpoint lama tanpa auth)
app.get('/api/pengaturan/logo', (req, res) => {
    res.redirect(301, '/api/public/logo');
});

// ==========================================
// ROUTES — PROTECTED (butuh JWT & RBAC)
// ==========================================
app.use('/api/siswa',       requireAuth, requirePasswordChanged, requireRole('admin'), siswaRoutes);
app.use('/api/guru',        requireAuth, requirePasswordChanged, requireRole('admin'), guruRoutes);
app.use('/api/pengaturan',  requireAuth, requirePasswordChanged, requireRole('admin'), pengaturanRoutes);
app.use('/api/absensi',     requireAuth, requirePasswordChanged, absensiRoutes);

// ==========================================
// SPA ROUTING
// ==========================================
app.get('/login',             (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/guru-dashboard',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'guru-dashboard.html')));
app.get('/guru-input-manual', (req, res) => res.sendFile(path.join(__dirname, 'public', 'guru-input-manual.html')));
app.get('/scanner',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'scanner.html')));
app.get('/admin',             (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/',                  (req, res) => res.sendFile(path.join(__dirname, 'public', 'public.html')));

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
});

// Error handler global
app.use((err, req, res, next) => {
    if (err.message?.includes('CORS')) {
        return res.status(403).json({ error: err.message });
    }
    console.error('[SERVER ERROR]', err.message || err);
    res.status(500).json({ error: 'Terjadi kesalahan internal server.' });
});

// ==========================================
// STARTUP
// ==========================================

// Inisialisasi database
dbHandler.initDB();

// ==========================================
// SCHEDULER OTOMATIS (node-cron)
// ==========================================

// Backup database otomatis setiap hari jam 02:00 WIB
cron.schedule('0 2 * * *', () => {
    console.log('[CRON] Menjalankan backup database otomatis...');
    jalankanBackup().catch(err => console.error('[CRON BACKUP ERROR]', err.message));
}, { timezone: 'Asia/Jakarta' });

// Jalankan server
app.listen(PORT, () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log('\n=========================================');
    console.log(`  AbsenSekolah Web Server`);
    console.log(`  Berjalan di: http://localhost:${PORT}`);
    console.log(`  Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  Timezone: ${tz}`);
    console.log('=========================================\n');
    console.log(`  > Landing Page : http://localhost:${PORT}/`);
    console.log(`  > Login Admin  : http://localhost:${PORT}/login`);
    console.log(`  > Scanner      : http://localhost:${PORT}/scanner`);
    console.log(`  > Dashboard    : http://localhost:${PORT}/admin`);
    console.log('\n');

    if (tz !== 'Asia/Jakarta' && tz !== 'Asia/Makassar') {
        console.warn('[PERINGATAN] Timezone server bukan WIB! Set TZ=Asia/Jakarta di .env atau OS VPS Anda.');
        console.warn('             Deteksi keterlambatan mungkin tidak akurat.\n');
    }
});

module.exports = app;
