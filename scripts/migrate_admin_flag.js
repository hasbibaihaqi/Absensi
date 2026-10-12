require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = process.env.DB_PATH
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : path.join(__dirname, '../database/absensi.sqlite');

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Pastikan kolom ada
    db.run(`ALTER TABLE admin ADD COLUMN must_change_password INTEGER DEFAULT 0`, () => {});

    // Cek status admin saat ini
    db.all('SELECT id, username, password, must_change_password FROM admin', (err, rows) => {
        if (err) { console.error(err); db.close(); return; }
        console.log('Admin accounts:');
        rows.forEach(r => {
            console.log(` - id=${r.id} | username=${r.username} | must_change_password=${r.must_change_password}`);

            // Jika password masih admin123, set flag wajib ganti
            bcrypt.compare('admin123', r.password, (e, match) => {
                if (match) {
                    db.run('UPDATE admin SET must_change_password = 1 WHERE id = ?', [r.id], () => {
                        console.log(`   ✅ Flag must_change_password=1 set untuk "${r.username}" (masih password default)`);
                    });
                } else {
                    console.log(`   ℹ️  "${r.username}" sudah punya password custom — tidak diubah`);
                }
            });
        });
        setTimeout(() => {
            console.log('\nVerifikasi selesai.');
            db.close();
        }, 1500);
    });
});
