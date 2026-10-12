/**
 * scripts/clean_duplicate_absensi.js
 *
 * Skrip ini dibuat untuk membersihkan data duplikat lama pada tabel absensi,
 * mempertahankan HANYA 1 data "Masuk" pertama dan 1 data "Pulang" pertama
 * per siswa/guru per tanggal WIB.
 *
 * Cara menjalankan:
 *   node scripts/clean_duplicate_absensi.js
 *   atau untuk melihat preview tanpa menghapus:
 *   node scripts/clean_duplicate_absensi.js --dry-run
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../database/absensi.sqlite');
const isDryRun = process.argv.includes('--dry-run');

console.log('========================================================');
console.log('SKRIP PEMBERSIHAN DATA DUPLIKAT ABSENSI');
console.log('Database:', dbPath);
console.log('Mode    :', isDryRun ? 'DRY-RUN (Hanya simulasi, tidak menghapus)' : 'EKSEKUSI (Menghapus duplikat)');
console.log('========================================================\n');

if (!fs.existsSync(dbPath)) {
    console.error('File database tidak ditemukan!');
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // 1. Pastikan kolom tanggal_wib terisi
    db.run(`UPDATE absensi SET tanggal_wib = date(waktu_scan, '+7 hours') WHERE tanggal_wib IS NULL`);

    // 2. Cari baris-baris duplikat yang BUKAN merupakan baris pertama (MIN(id))
    const queryDuplikat = `
        SELECT a.id, a.nomor_induk, p.nama_lengkap, a.jenis_absen, a.tanggal_wib, a.waktu_scan
        FROM absensi a
        LEFT JOIN pengguna p ON a.nomor_induk = p.nomor_induk
        WHERE a.id NOT IN (
            SELECT MIN(id)
            FROM absensi
            GROUP BY nomor_induk, tanggal_wib, jenis_absen
        )
        ORDER BY a.tanggal_wib DESC, a.nomor_induk ASC, a.id ASC
    `;

    db.all(queryDuplikat, [], (err, rows) => {
        if (err) {
            console.error('Error saat mencari duplikat:', err.message);
            db.close();
            return;
        }

        if (!rows || rows.length === 0) {
            console.log('Tidak ditemukan data duplikat. Database sudah bersih!');
            db.close();
            return;
        }

        console.log(`Ditemukan ${rows.length} data absensi duplikat yang memenuhi syarat pembersihan:\n`);
        rows.forEach((r, idx) => {
            console.log(`[${idx + 1}] ID: ${r.id} | NIS/NIP: ${r.nomor_induk} (${r.nama_lengkap || '-'}) | Status: ${r.jenis_absen} | Tanggal: ${r.tanggal_wib} | Waktu: ${r.waktu_scan}`);
        });

        if (isDryRun) {
            console.log('\n[INFO] Mode dry-run selesai. Tidak ada baris yang dihapus.');
            console.log('Jalankan tanpa flag --dry-run untuk melakukan pembersihan permanen.');
            db.close();
            return;
        }

        const idsToDelete = rows.map(r => r.id);
        const placeholders = idsToDelete.map(() => '?').join(',');

        db.run(`DELETE FROM absensi WHERE id IN (${placeholders})`, idsToDelete, function(delErr) {
            if (delErr) {
                console.error('\nGagal menghapus data duplikat:', delErr.message);
            } else {
                console.log(`\nBERHASIL! Sebanyak ${this.changes} baris duplikat telah dihapus secara permanen.`);
                console.log('Sekarang setiap siswa/guru hanya memiliki maksimal 1 "Masuk" dan 1 "Pulang" per tanggal.');
            }
            db.close();
        });
    });
});
