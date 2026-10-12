/**
 * db_handler.js — Database handler menggunakan sqlite3 (async callback style)
 * Semua nama fungsi dan parameter dipertahankan sama seperti versi Electron.
 * Versi web: semua fungsi masih callback-based agar kompatibel dengan routes.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const appConfig = require('./app_config');

require('dotenv').config();

const dbPath = process.env.DB_PATH
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : path.resolve(__dirname, '../database/absensi.sqlite');

const db = new sqlite3.Database(dbPath);

// Aktifkan WAL mode untuk performa lebih baik
db.run('PRAGMA journal_mode = WAL');

function initDB() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS pengguna (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nomor_induk TEXT UNIQUE,
            nama_lengkap TEXT,
            peran TEXT,
            kelas TEXT,
            nomor_wa_ortu TEXT,
            status TEXT DEFAULT 'Aktif'
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS absensi (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nomor_induk TEXT,
            waktu_scan DATETIME DEFAULT CURRENT_TIMESTAMP,
            jenis_absen TEXT,
            foto_bukti TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS admin (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            must_change_password INTEGER DEFAULT 0
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nama_lengkap TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'guru',
            status TEXT NOT NULL DEFAULT 'pending',
            guru_id INTEGER,
            must_change_password INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Migrasi: tambahkan kolom jika belum ada
        db.run(`ALTER TABLE absensi ADD COLUMN foto_bukti TEXT`, () => {});
        db.run(`ALTER TABLE absensi ADD COLUMN keterangan TEXT`, () => {});
        db.run(`ALTER TABLE absensi ADD COLUMN dicatat_oleh INTEGER`, () => {});
        db.run(`ALTER TABLE absensi ADD COLUMN tanggal_wib TEXT`, () => {
            // Isi tanggal_wib untuk data yang belum terisi
            db.run(`UPDATE absensi SET tanggal_wib = date(waktu_scan, '+7 hours') WHERE tanggal_wib IS NULL`, () => {});
        });
        db.run(`ALTER TABLE admin ADD COLUMN must_change_password INTEGER DEFAULT 0`, () => {});

        // Indeks database untuk percepatan performa query scan, laporan, dan statistik
        db.run(`CREATE INDEX IF NOT EXISTS idx_absensi_waktu ON absensi(waktu_scan)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_absensi_nomor ON absensi(nomor_induk)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_absensi_jenis ON absensi(jenis_absen)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_absensi_tgl_wib ON absensi(tanggal_wib)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_pengguna_nomor ON pengguna(nomor_induk)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_pengguna_peran_status ON pengguna(peran, status)`);

        // Unique index pengaman race condition untuk data baru (ID >= 65)
        // Data lama yang sudah duplikat tidak diblokir/dihapus otomatis
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_prevent_double ON absensi(nomor_induk, tanggal_wib, jenis_absen) WHERE id >= 65`);

        // Buat akun admin default jika kosong & migrasikan admin lama ke users
        db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => {
            if (!err && row.count === 0) {
                // Cek jika ada data admin lama
                db.get(`SELECT * FROM admin LIMIT 1`, (errAdmin, adminRow) => {
                    if (!errAdmin && adminRow) {
                        db.run(`INSERT INTO users (username, password, nama_lengkap, role, status, must_change_password) VALUES (?, ?, 'Administrator', 'admin', 'approved', ?)`,
                            [adminRow.username, adminRow.password, adminRow.must_change_password || 0]);
                        console.log('Migrasi akun admin ke tabel users berhasil.');
                    } else {
                        const hashed = bcrypt.hashSync('admin123', 10);
                        db.run(`INSERT INTO users (username, password, nama_lengkap, role, status, must_change_password) VALUES ('admin', ?, 'Administrator', 'admin', 'approved', 1)`, [hashed]);
                        console.log('Akun admin default dibuat di tabel users: admin / admin123 — wajib ganti password!');
                    }
                });
            }
        });

        console.log('Database SQLite siap! Path:', dbPath);
    });
}

// ==========================================
// AUTENTIKASI & USER MANAGEMENT
// ==========================================

/**
 * cekLogin — verifikasi username + password dari tabel users (bcrypt aware)
 */
function cekLogin(username, password, callback) {
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) return callback(err, null);
        if (!row) return callback(null, { error: 'Username atau password salah' });

        if (row.status === 'pending') {
            return callback(null, { error: 'Akun Anda masih menunggu persetujuan admin.' });
        }
        if (row.status === 'rejected') {
            return callback(null, { error: 'Pendaftaran akun Anda telah ditolak oleh admin.' });
        }
        if (row.status !== 'approved') {
            return callback(null, { error: 'Akun Anda tidak aktif.' });
        }

        const handleMatch = (match) => {
            if (!match) return callback(null, { error: 'Username atau password salah' });
            callback(null, {
                user: {
                    id: row.id,
                    username: row.username,
                    nama_lengkap: row.nama_lengkap,
                    role: row.role,
                    status: row.status,
                    guru_id: row.guru_id,
                    mustChangePassword: row.must_change_password === 1
                }
            });
        };

        if (row.password && row.password.startsWith('$2')) {
            // Sudah bcrypt
            bcrypt.compare(password, row.password, (bErr, match) => {
                if (bErr) return callback(bErr, null);
                handleMatch(match);
            });
        } else {
            // Plain-text lama — bandingkan, lalu auto-upgrade ke bcrypt
            const match = row.password === password;
            if (match) {
                const hashed = bcrypt.hashSync(password, 10);
                db.run(`UPDATE users SET password = ? WHERE id = ?`, [hashed, row.id]);
            }
            handleMatch(match);
        }
    });
}

function registerGuruUser(data, callback) {
    const { username, password, nama_lengkap, guru_id } = data;
    if (!username || !password || !nama_lengkap) {
        return callback(new Error('Semua bidang wajib diisi.'));
    }

    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) return callback(err);
        if (row) return callback(new Error('Username sudah digunakan, silakan pilih username lain.'));

        const hashed = bcrypt.hashSync(password, 10);
        db.run(
            `INSERT INTO users (username, password, nama_lengkap, role, status, guru_id) VALUES (?, ?, ?, 'guru', 'pending', ?)`,
            [username.trim(), hashed, nama_lengkap.trim(), guru_id || null],
            function(err2) {
                if (err2) return callback(err2);
                callback(null, { id: this.lastID });
            }
        );
    });
}

function getPendingUsers(callback) {
    db.all(`SELECT id, username, nama_lengkap, role, status, guru_id, created_at FROM users WHERE status = 'pending' ORDER BY created_at DESC`, [], (err, rows) => {
        callback(err, rows || []);
    });
}

function getAllUsers(callback) {
    const query = `
        SELECT u.id, u.username, u.nama_lengkap, u.role, u.status, u.guru_id, u.created_at, p.nama_lengkap as nama_guru
        FROM users u
        LEFT JOIN pengguna p ON u.guru_id = p.id
        ORDER BY u.created_at DESC
    `;
    db.all(query, [], (err, rows) => {
        callback(err, rows || []);
    });
}

function updateUserStatus(userId, status, callback) {
    db.run(`UPDATE users SET status = ? WHERE id = ?`, [status, userId], (err) => {
        callback(err);
    });
}

function resetUserPassword(userId, newPassword, callback) {
    const hashed = bcrypt.hashSync(newPassword, 10);
    db.run(`UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?`, [hashed, userId], (err) => {
        callback(err);
    });
}

function deleteUser(userId, callback) {
    db.run(`DELETE FROM users WHERE id = ? AND role != 'admin'`, [userId], function(err) {
        if (err) return callback(err);
        if (this.changes === 0) return callback(new Error('User tidak ditemukan atau akun admin tidak dapat dihapus.'));
        callback(null);
    });
}

function getAdminAccount(callback) {
    db.get(`SELECT id, username, must_change_password FROM users WHERE role = 'admin' LIMIT 1`, [], (err, row) => {
        callback(err, row || null);
    });
}

/**
 * updateAdminAccount — update admin di tabel users
 */
function updateAdminAccount(username, password, callback) {
    if (password === '*KEEP*') {
        db.run(`UPDATE users SET username = ? WHERE role = 'admin'`, [username], (err) => callback(err));
    } else {
        const hashed = bcrypt.hashSync(password, 10);
        db.run(`UPDATE users SET username = ?, password = ?, must_change_password = 0 WHERE role = 'admin'`, [username, hashed], (err) => callback(err));
    }
}

// ==========================================
// ABSENSI
// ==========================================

function catatAbsen(nomorInduk, fotoPath, callback, jenisOverride = null, keterangan = '', dicatatOleh = null) {
    db.get(`SELECT nama_lengkap, status, peran FROM pengguna WHERE nomor_induk = ?`, [nomorInduk], (err, row) => {
        if (err || !row) return callback(new Error('QR Tidak Terdaftar di Sistem!'), null);
        if (row.status !== 'Aktif') return callback(new Error(`Status ${row.nama_lengkap} tidak aktif!`), null);

        const cfg = appConfig.getConfig();

        // Hitung waktu dan tanggal WIB (Asia/Jakarta, UTC+7)
        const wibOffsetMs = 7 * 60 * 60 * 1000;
        const nowWib = new Date(Date.now() + wibOffsetMs);
        const pad2 = n => String(n).padStart(2, '0');
        const tanggalWib = `${nowWib.getUTCFullYear()}-${pad2(nowWib.getUTCMonth() + 1)}-${pad2(nowWib.getUTCDate())}`;
        const totalMenitSekarang = nowWib.getUTCHours() * 60 + nowWib.getUTCMinutes();

        // ── Validasi Hari Libur & Hari Operasional ───────────────────────
        const dayOfWeek = nowWib.getUTCDay(); // 0: Minggu, 1: Senin, ..., 6: Sabtu
        const hariOp = Array.isArray(cfg.hariOperasional) ? cfg.hariOperasional : [1, 2, 3, 4, 5, 6];

        // Cek hari libur khusus
        const liburKhusus = (cfg.hariLiburKhusus || []).find(h => h.tanggal === tanggalWib);
        if (liburKhusus && !jenisOverride) {
            return callback(new Error(`Hari ini libur: ${liburKhusus.keterangan || 'Libur Nasional / Sekolah'}`), null);
        }

        // Cek hari operasional (misal Minggu/hari yang dinonaktifkan)
        if (!hariOp.includes(dayOfWeek) && !jenisOverride) {
            const namaHari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][dayOfWeek];
            return callback(new Error(`Hari ${namaHari} bukan hari kegiatan operasional/sekolah.`), null);
        }

        let jenisAbsen;
        if (jenisOverride && (jenisOverride === 'Masuk' || jenisOverride === 'Pulang')) {
            jenisAbsen = jenisOverride;
        } else {
            const [jamBatasH, jamBatasM] = (cfg.jamPulangMulai || '12:00').split(':').map(Number);
            jenisAbsen = (totalMenitSekarang < (jamBatasH * 60 + jamBatasM)) ? 'Masuk' : 'Pulang';
        }

        // ── Validasi: Tidak boleh 'Pulang' jika belum 'Masuk' hari ini ──────────
        const prosesCekDouble = () => {
            const cekDoubleQuery = `
                SELECT COUNT(*) as cnt
                FROM absensi
                WHERE nomor_induk = ?
                  AND jenis_absen = ?
                  AND COALESCE(tanggal_wib, date(waktu_scan, '+7 hours')) = ?`;

            db.get(cekDoubleQuery, [nomorInduk, jenisAbsen, tanggalWib], (errCek, cek) => {
                if (errCek) return callback(errCek, null);

                if (cek && cek.cnt > 0) {
                    // Tolak scan ganda: status yang sama tidak bisa tercatat dua kali di hari yang sama
                    const errAlready = new Error(`Anda sudah absen ${jenisAbsen}`);
                    errAlready.code = 'ALREADY_SCANNED';
                    errAlready.nama = row.nama_lengkap;
                    errAlready.kelas = row.kelas || '-';
                    errAlready.jenis = jenisAbsen;
                    return callback(errAlready, null);
                }

                let isTerlambat = false;
                if (jenisAbsen === 'Masuk') {
                    const [batasH, batasM] = (cfg.jamBatasMasuk || '07:15').split(':').map(Number);
                    isTerlambat = totalMenitSekarang > (batasH * 60 + batasM);
                }

                db.run(
                    `INSERT INTO absensi (nomor_induk, jenis_absen, foto_bukti, keterangan, dicatat_oleh, tanggal_wib) VALUES (?, ?, ?, ?, ?, ?)`,
                    [nomorInduk, jenisAbsen, fotoPath, keterangan, dicatatOleh || null, tanggalWib],
                    function(err2) {
                        if (err2) {
                            // Penanganan race condition jika unique constraint terpicu
                            if (err2.message && err2.message.includes('UNIQUE constraint failed')) {
                                const errRace = new Error(`Anda sudah absen ${jenisAbsen}`);
                                errRace.code = 'ALREADY_SCANNED';
                                errRace.nama = row.nama_lengkap;
                                errRace.kelas = row.kelas || '-';
                                errRace.jenis = jenisAbsen;
                                return callback(errRace, null);
                            }
                            return callback(err2, null);
                        }

                        callback(null, {
                            nama: row.nama_lengkap,
                            kelas: row.kelas || '-',
                            jenis: jenisAbsen,
                            peran: row.peran,
                            isTerlambat,
                            keterangan
                        });
                    }
                );
            });
        };

        if (jenisAbsen === 'Pulang') {
            const cekMasukQuery = `
                SELECT COUNT(*) as cnt
                FROM absensi
                WHERE nomor_induk = ?
                  AND jenis_absen = 'Masuk'
                  AND COALESCE(tanggal_wib, date(waktu_scan, '+7 hours')) = ?`;

            db.get(cekMasukQuery, [nomorInduk, tanggalWib], (errMasuk, resMasuk) => {
                if (!errMasuk && (!resMasuk || resMasuk.cnt === 0)) {
                    return callback(new Error(
                        `${row.nama_lengkap} belum tercatat Masuk hari ini, tidak bisa absen Pulang!`
                    ), null);
                }
                prosesCekDouble();
            });
        } else {
            prosesCekDouble();
        }
    });
}

function inputKetidakhadiran(nomorInduk, status, keterangan, callback, dicatatOleh = null) {
    db.get(`SELECT nama_lengkap, peran FROM pengguna WHERE nomor_induk = ?`, [nomorInduk], (err, row) => {
        if (err || !row) return callback(new Error('Siswa/Guru tidak ditemukan!'));

        db.run(`INSERT INTO absensi (nomor_induk, jenis_absen, keterangan, foto_bukti, dicatat_oleh) VALUES (?, ?, ?, ?, ?)`,
            [nomorInduk, status, keterangan, 'MANUAL', dicatatOleh || null],
            function(err2) {
                callback(err2, {
                    nama: row.nama_lengkap,
                    jenis: status,
                    keterangan,
                    peran: row.peran
                });
            }
        );
    });
}

function getRekapSiswa(nis, callback) {
    db.all(`SELECT jenis_absen, COUNT(*) as total FROM absensi WHERE nomor_induk = ? GROUP BY jenis_absen`, [nis], (err, rows) => {
        callback(err, rows || []);
    });
}

function getStatistikHariIni(callback) {
    const cfg = appConfig.getConfig();
    const batasJam = (cfg.jamBatasMasuk || '07:15') + ':00';
    let result = { totalSiswa: 0, totalGuru: 0, hadirPagi: 0, terlambat: 0, izin: 0, sakit: 0, alpa: 0, totalSudahAbsen: 0, belumAbsen: 0 };
    let completed = 0;
    const totalChecks = 8;
    const checkComplete = () => {
        completed++;
        if (completed === totalChecks) {
            result.belumAbsen = Math.max(0, result.totalSiswa - result.totalSudahAbsen);
            callback(null, result);
        }
    };

    db.get(`SELECT COUNT(*) as count FROM pengguna WHERE peran = 'Siswa' AND status = 'Aktif'`, [], (err, row) => { result.totalSiswa = row?.count || 0; checkComplete(); });
    db.get(`SELECT COUNT(*) as count FROM pengguna WHERE peran = 'Guru' AND status = 'Aktif'`, [], (err, row) => { result.totalGuru = row?.count || 0; checkComplete(); });
    db.get(`SELECT COUNT(*) as count FROM absensi WHERE date(waktu_scan, '+7 hours') = date('now', '+7 hours') AND jenis_absen = 'Masuk'`, [], (err, row) => { result.hadirPagi = row?.count || 0; checkComplete(); });
    db.get(`SELECT COUNT(*) as count FROM absensi WHERE date(waktu_scan, '+7 hours') = date('now', '+7 hours') AND jenis_absen = 'Masuk' AND time(waktu_scan, '+7 hours') > ?`, [batasJam], (err, row) => { result.terlambat = row?.count || 0; checkComplete(); });
    db.get(`SELECT COUNT(*) as count FROM absensi WHERE date(waktu_scan, '+7 hours') = date('now', '+7 hours') AND jenis_absen = 'Izin'`, [], (err, row) => { result.izin = row?.count || 0; checkComplete(); });
    db.get(`SELECT COUNT(*) as count FROM absensi WHERE date(waktu_scan, '+7 hours') = date('now', '+7 hours') AND jenis_absen = 'Sakit'`, [], (err, row) => { result.sakit = row?.count || 0; checkComplete(); });
    db.get(`SELECT COUNT(*) as count FROM absensi WHERE date(waktu_scan, '+7 hours') = date('now', '+7 hours') AND jenis_absen = 'Alpa'`, [], (err, row) => { result.alpa = row?.count || 0; checkComplete(); });
    db.get(`SELECT COUNT(DISTINCT a.nomor_induk) as count FROM absensi a JOIN pengguna p ON a.nomor_induk = p.nomor_induk WHERE p.peran = 'Siswa' AND p.status = 'Aktif' AND date(a.waktu_scan, '+7 hours') = date('now', '+7 hours')`, [], (err, row) => { result.totalSudahAbsen = row?.count || 0; checkComplete(); });
}

function getLaporan(tanggalMulai, tanggalAkhir, peran, kelas, callback) {
    let query = `
        SELECT
            a.id,
            datetime(a.waktu_scan, '+7 hours') as waktu_scan,
            a.jenis_absen, a.foto_bukti, a.keterangan,
            p.nomor_induk, p.nama_lengkap, p.kelas, p.peran
        FROM absensi a
        JOIN pengguna p ON a.nomor_induk = p.nomor_induk
        WHERE date(a.waktu_scan, '+7 hours') BETWEEN ? AND ?
    `;
    const params = [tanggalMulai, tanggalAkhir];

    if (peran !== 'Semua') { query += ` AND p.peran = ?`; params.push(peran); }
    if (kelas !== 'Semua') { query += ` AND p.kelas = ?`; params.push(kelas); }
    query += ` ORDER BY a.waktu_scan DESC`;

    db.all(query, params, (err, rows) => callback(err, rows || []));
}

function updateAbsensi(id, data, callback) {
    const { jenis_absen, keterangan } = data;
    db.run(
        `UPDATE absensi SET jenis_absen = ?, keterangan = ? WHERE id = ?`,
        [jenis_absen, keterangan || '', id],
        function(err) {
            if (err) return callback(err);
            if (this.changes === 0) return callback(new Error('Data absensi tidak ditemukan.'));
            callback(null, { id, jenis_absen, keterangan });
        }
    );
}

function hapusAbsensi(id, callback) {
    db.run(`DELETE FROM absensi WHERE id = ?`, [id], function(err) {
        if (err) return callback(err);
        if (this.changes === 0) return callback(new Error('Data absensi tidak ditemukan.'));
        callback(null);
    });
}

// Endpoint publik: hanya nama, kelas, status, jam (tanpa data sensitif)
function getAbsensiHariIni(kelas, cari, callback) {
    let query = `
        SELECT
            p.nama_lengkap,
            p.kelas,
            a.jenis_absen,
            a.keterangan,
            time(a.waktu_scan, '+7 hours') as jam_absen
        FROM absensi a
        JOIN pengguna p ON a.nomor_induk = p.nomor_induk
        WHERE date(a.waktu_scan, '+7 hours') = date('now', '+7 hours')
          AND p.peran = 'Siswa'
    `;
    const params = [];

    if (kelas && kelas !== 'Semua') { query += ` AND p.kelas = ?`; params.push(kelas); }
    if (cari && cari.trim()) {
        query += ` AND (p.nama_lengkap LIKE ? OR p.nomor_induk LIKE ?)`;
        params.push(`%${cari}%`, `%${cari}%`);
    }
    query += ` ORDER BY a.waktu_scan DESC`;

    db.all(query, params, (err, rows) => callback(err, rows || []));
}

// ==========================================
// SISWA
// ==========================================

function getSiswa(callback) {
    db.all(`SELECT * FROM pengguna WHERE peran = 'Siswa' ORDER BY kelas ASC, nama_lengkap ASC`, [], (err, rows) => callback(err, rows || []));
}

function tambahSiswa(data, callback) {
    db.run(`INSERT INTO pengguna (nomor_induk, nama_lengkap, peran, kelas, nomor_wa_ortu, status) VALUES (?, ?, 'Siswa', ?, ?, 'Aktif')`,
        [data.nis, data.nama_lengkap, data.kelas, data.nomor_wa_ortu || ''],
        (err) => callback(err)
    );
}

function hapusSiswa(id, callback) {
    db.run(`DELETE FROM pengguna WHERE id = ? AND peran = 'Siswa'`, [id], function(err) {
        if (err) return callback(err);
        if (this.changes === 0) return callback(new Error('Siswa tidak ditemukan.'));
        callback(null);
    });
}

function hapusGuru(id, callback) {
    db.run(`DELETE FROM pengguna WHERE id = ? AND peran = 'Guru'`, [id], function(err) {
        if (err) return callback(err);
        if (this.changes === 0) return callback(new Error('Guru tidak ditemukan.'));
        callback(null);
    });
}

function importSiswa(dataArray, callback) {
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare(`INSERT OR IGNORE INTO pengguna (nomor_induk, nama_lengkap, peran, kelas, nomor_wa_ortu, status) VALUES (?, ?, 'Siswa', ?, ?, 'Aktif')`);
        dataArray.forEach(siswa => {
            stmt.run([siswa.NIS?.toString(), siswa.Nama, siswa.Kelas, siswa.WA?.toString() || '']);
        });
        stmt.finalize();
        db.run('COMMIT', (err) => callback(err));
    });
}

function updateSiswa(data, callback) {
    db.run(`UPDATE pengguna SET nomor_induk = ?, nama_lengkap = ?, kelas = ?, nomor_wa_ortu = ?, status = ? WHERE id = ?`,
        [data.nis, data.nama_lengkap, data.kelas, data.nomor_wa_ortu || '', data.status, data.id],
        (err) => callback(err)
    );
}

// ==========================================
// GURU
// ==========================================

function getGuru(callback) {
    db.all(`SELECT * FROM pengguna WHERE peran = 'Guru' ORDER BY nama_lengkap ASC`, [], (err, rows) => callback(err, rows || []));
}

function tambahGuru(data, callback) {
    db.run(`INSERT INTO pengguna (nomor_induk, nama_lengkap, peran, kelas, nomor_wa_ortu, status) VALUES (?, ?, 'Guru', ?, ?, 'Aktif')`,
        [data.nip, data.nama_lengkap, data.jabatan, data.nomor_wa_ortu || ''],
        (err) => callback(err)
    );
}

function updateGuru(data, callback) {
    db.run(`UPDATE pengguna SET nomor_induk = ?, nama_lengkap = ?, kelas = ?, nomor_wa_ortu = ?, status = ? WHERE id = ?`,
        [data.nip, data.nama_lengkap, data.jabatan, data.nomor_wa_ortu || '', data.status, data.id],
        (err) => callback(err)
    );
}

function getDaftarKelas(callback) {
    db.all(`SELECT DISTINCT kelas FROM pengguna WHERE peran = 'Siswa' AND status = 'Aktif' ORDER BY kelas ASC`, [], (err, rows) => {
        callback(err, rows ? rows.map(r => r.kelas) : []);
    });
}

// ==========================================
// REKAP & PENCARIAN PUBLIK + CHART ADMIN
// ==========================================

function getRekapPerKelas(periode, callback) {
    let dateCondition = "date(a.waktu_scan, '+7 hours') = date('now', '+7 hours')";
    if (periode === 'minggu') {
        dateCondition = "date(a.waktu_scan, '+7 hours') >= date('now', '+7 hours', '-6 days')";
    } else if (periode === 'bulan') {
        dateCondition = "date(a.waktu_scan, '+7 hours') >= date('now', '+7 hours', '-29 days')";
    }

    db.all(`SELECT kelas, COUNT(*) as total_siswa FROM pengguna WHERE peran = 'Siswa' AND status = 'Aktif' GROUP BY kelas ORDER BY kelas ASC`, [], (errKelas, kelasRows) => {
        if (errKelas) return callback(errKelas);
        if (!kelasRows || kelasRows.length === 0) return callback(null, []);

        const queryAbsen = `
            SELECT p.kelas, a.jenis_absen, COUNT(*) as total
            FROM absensi a
            JOIN pengguna p ON a.nomor_induk = p.nomor_induk
            WHERE p.peran = 'Siswa' AND p.status = 'Aktif' AND ${dateCondition}
            GROUP BY p.kelas, a.jenis_absen
        `;

        db.all(queryAbsen, [], (errAbsen, absenRows) => {
            if (errAbsen) return callback(errAbsen);

            const mapKelas = {};
            kelasRows.forEach(k => {
                mapKelas[k.kelas] = {
                    kelas: k.kelas,
                    totalSiswa: k.total_siswa,
                    hadir: 0,
                    terlambat: 0,
                    izin: 0,
                    sakit: 0,
                    alpa: 0,
                    persentase: 0
                };
            });

            (absenRows || []).forEach(row => {
                if (mapKelas[row.kelas]) {
                    const j = (row.jenis_absen || '').toLowerCase();
                    if (j === 'masuk' || j === 'hadir') {
                        mapKelas[row.kelas].hadir += row.total;
                    } else if (j === 'terlambat') {
                        mapKelas[row.kelas].terlambat += row.total;
                        mapKelas[row.kelas].hadir += row.total;
                    } else if (j === 'izin') {
                        mapKelas[row.kelas].izin += row.total;
                    } else if (j === 'sakit') {
                        mapKelas[row.kelas].sakit += row.total;
                    } else if (j === 'alpa') {
                        mapKelas[row.kelas].alpa += row.total;
                    }
                }
            });

            const hasil = Object.values(mapKelas).map(item => {
                let divisor = item.totalSiswa;
                if (periode === 'minggu') divisor = item.totalSiswa * 6;
                else if (periode === 'bulan') divisor = item.totalSiswa * 24;

                let pct = divisor > 0 ? Math.round((item.hadir / divisor) * 100) : 0;
                if (pct > 100) pct = 100;
                item.persentase = pct;
                return item;
            });

            callback(null, hasil);
        });
    });
}

function cariSiswaPublik(keyword, callback) {
    const q = `%${keyword}%`;
    db.all(`
        SELECT id, nama_lengkap, kelas
        FROM pengguna
        WHERE peran = 'Siswa' AND status = 'Aktif'
          AND (nama_lengkap LIKE ? OR nomor_induk LIKE ?)
        ORDER BY nama_lengkap ASC
        LIMIT 10
    `, [q, q], (err, rows) => {
        callback(err, rows || []);
    });
}

function getRekapSiswaPublik(id, callback) {
    db.get(`
        SELECT id, nomor_induk, nama_lengkap, kelas
        FROM pengguna
        WHERE id = ? AND peran = 'Siswa' AND status = 'Aktif'
    `, [id], (err, siswa) => {
        if (err) return callback(err);
        if (!siswa) return callback(null, null);

        db.all(`
            SELECT
                date(waktu_scan, '+7 hours') as tanggal,
                time(waktu_scan, '+7 hours') as jam,
                jenis_absen,
                keterangan
            FROM absensi
            WHERE nomor_induk = ?
            ORDER BY waktu_scan DESC
            LIMIT 10
        `, [siswa.nomor_induk], (errRiwayat, riwayatRows) => {
            if (errRiwayat) return callback(errRiwayat);

            db.all(`
                SELECT jenis_absen, COUNT(*) as count
                FROM absensi
                WHERE nomor_induk = ?
                  AND date(waktu_scan, '+7 hours') >= date('now', '+7 hours', '-30 days')
                GROUP BY jenis_absen
            `, [siswa.nomor_induk], (errRingkasan, ringkasanRows) => {
                if (errRingkasan) return callback(errRingkasan);

                const ringkasan = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpa: 0 };
                (ringkasanRows || []).forEach(r => {
                    const j = (r.jenis_absen || '').toLowerCase();
                    if (j === 'masuk' || j === 'hadir') ringkasan.hadir += r.count;
                    else if (j === 'terlambat') ringkasan.terlambat += r.count;
                    else if (j === 'izin') ringkasan.izin += r.count;
                    else if (j === 'sakit') ringkasan.sakit += r.count;
                    else if (j === 'alpa') ringkasan.alpa += r.count;
                });

                callback(null, {
                    id: siswa.id,
                    nama_lengkap: siswa.nama_lengkap,
                    kelas: siswa.kelas,
                    ringkasan,
                    riwayat: riwayatRows || []
                });
            });
        });
    });
}

function getRekapSiswaByNis(nis, callback) {
    db.get(`
        SELECT id, nomor_induk, nama_lengkap, kelas
        FROM pengguna
        WHERE nomor_induk = ? AND peran = 'Siswa' AND status = 'Aktif'
    `, [nis], (err, siswa) => {
        if (err) return callback(err);
        if (!siswa) return callback(null, null);

        // Ambil riwayat absensi 30 hari terakhir
        db.all(`
            SELECT
                date(waktu_scan, '+7 hours') as tanggal,
                time(waktu_scan, '+7 hours') as jam,
                jenis_absen,
                keterangan
            FROM absensi
            WHERE nomor_induk = ?
              AND date(waktu_scan, '+7 hours') >= date('now', '+7 hours', '-30 days')
            ORDER BY waktu_scan DESC
        `, [siswa.nomor_induk], (errRiwayat, riwayatRows) => {
            if (errRiwayat) return callback(errRiwayat);

            const ringkasan = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpa: 0 };
            (riwayatRows || []).forEach(r => {
                const j = (r.jenis_absen || '').toLowerCase();
                if (j === 'masuk' || j === 'hadir') ringkasan.hadir += 1;
                else if (j === 'terlambat') ringkasan.terlambat += 1;
                else if (j === 'izin') ringkasan.izin += 1;
                else if (j === 'sakit') ringkasan.sakit += 1;
                else if (j === 'alpa') ringkasan.alpa += 1;
            });

            // Hitung estimasi hari sekolah dalam 30 hari (sekitar 22-24 hari efektif)
            const totalAbsen = ringkasan.hadir + ringkasan.terlambat + ringkasan.izin + ringkasan.sakit + ringkasan.alpa;
            const persentase = totalAbsen > 0
                ? Math.min(100, Math.round(((ringkasan.hadir + ringkasan.terlambat) / totalAbsen) * 100))
                : 100;

            callback(null, {
                nis: siswa.nomor_induk,
                nama_lengkap: siswa.nama_lengkap,
                kelas: siswa.kelas,
                ringkasan: {
                    ...ringkasan,
                    persentase
                },
                riwayat: riwayatRows || []
            });
        });
    });
}

function getTrenKehadiran7Hari(callback) {
    const cfg = appConfig.getConfig();
    const batasJam = (cfg.jamBatasMasuk || '07:15') + ':00';
    const query = `
        SELECT
            date(waktu_scan, '+7 hours') as tanggal,
            SUM(CASE WHEN jenis_absen = 'Masuk' THEN 1 ELSE 0 END) as hadir,
            SUM(CASE WHEN jenis_absen = 'Terlambat' OR (jenis_absen = 'Masuk' AND time(waktu_scan, '+7 hours') > ?) THEN 1 ELSE 0 END) as terlambat,
            SUM(CASE WHEN jenis_absen = 'Izin' THEN 1 ELSE 0 END) as izin,
            SUM(CASE WHEN jenis_absen = 'Sakit' THEN 1 ELSE 0 END) as sakit,
            SUM(CASE WHEN jenis_absen = 'Alpa' THEN 1 ELSE 0 END) as alpa
        FROM absensi
        WHERE date(waktu_scan, '+7 hours') >= date('now', '+7 hours', '-6 days')
        GROUP BY date(waktu_scan, '+7 hours')
        ORDER BY date(waktu_scan, '+7 hours') ASC
    `;
    db.all(query, [batasJam], (err, rows) => {
        if (err) return callback(err);

        const daysMap = {};
        const labels = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;
            labels.push(dateStr);
            daysMap[dateStr] = { tanggal: dateStr, hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpa: 0 };
        }

        (rows || []).forEach(r => {
            if (daysMap[r.tanggal]) {
                daysMap[r.tanggal] = {
                    tanggal: r.tanggal,
                    hadir: r.hadir || 0,
                    terlambat: r.terlambat || 0,
                    izin: r.izin || 0,
                    sakit: r.sakit || 0,
                    alpa: r.alpa || 0
                };
            }
        });

        const hasil = labels.map(l => daysMap[l]);
        callback(null, hasil);
    });
}

module.exports = {
    initDB, cekLogin, getAdminAccount, updateAdminAccount,
    registerGuruUser, getPendingUsers, getAllUsers, updateUserStatus, resetUserPassword, deleteUser,
    catatAbsen, inputKetidakhadiran, getRekapSiswa, getStatistikHariIni, getLaporan, getAbsensiHariIni,
    updateAbsensi, hapusAbsensi,
    getSiswa, tambahSiswa, hapusSiswa, importSiswa, updateSiswa,
    getGuru, tambahGuru, hapusGuru, updateGuru, getDaftarKelas,
    getRekapPerKelas, cariSiswaPublik, getRekapSiswaPublik, getRekapSiswaByNis, getTrenKehadiran7Hari
};