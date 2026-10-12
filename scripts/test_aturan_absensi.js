const dbHandler = require('../services/db_handler');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.resolve(__dirname, '../database/absensi.sqlite'));

const testNIS = 'TEST_999999';
const testNIS_Race = 'TEST_RACE_888';

db.serialize(() => {
    db.run("INSERT OR IGNORE INTO pengguna (nomor_induk, nama_lengkap, peran, kelas, status) VALUES (?, 'Siswa Test Anti Double', 'Siswa', 'XII RPL', 'Aktif')", [testNIS]);

    const today = new Date(Date.now() + 7*3600*1000).toISOString().slice(0, 10);
    db.run("DELETE FROM absensi WHERE nomor_induk = ? AND (tanggal_wib = ? OR date(waktu_scan, '+7 hours') = ?)", [testNIS, today, today], () => {

        console.log('=== MULAI TEST OTOMASI ATURAN ABSENSI ===\n');

        // Test 1: Scan Pulang sebelum Masuk -> Ditolak
        dbHandler.catatAbsen(testNIS, 'MANUAL', (err1, res1) => {
            console.log('1. Scan Pulang sebelum Masuk:');
            console.log('   Error:', err1 ? err1.message : 'TIDAK ADA');
            if (!err1 || !err1.message.includes('belum tercatat Masuk')) {
                console.error('GAGAL pada Test 1');
                process.exit(1);
            }

            // Test 2: Scan pertama = Masuk -> Sukses
            dbHandler.catatAbsen(testNIS, 'MANUAL', (err2, res2) => {
                console.log('\n2. Scan Masuk Pertama:');
                console.log('   Hasil:', res2 ? ('Sukses ' + res2.jenis + ' (' + res2.nama + ')') : err2.message);
                if (err2 || res2.jenis !== 'Masuk') {
                    console.error('GAGAL pada Test 2');
                    process.exit(1);
                }

                // Test 3: Scan Masuk ke-2 di hari yang sama -> Ditolak (ALREADY_SCANNED)
                dbHandler.catatAbsen(testNIS, 'MANUAL', (err3, res3) => {
                    console.log('\n3. Scan Masuk Kedua:');
                    console.log('   Error Code:', err3 ? err3.code : 'TIDAK ADA');
                    console.log('   Error Msg :', err3 ? err3.message : 'TIDAK ADA');
                    if (!err3 || err3.code !== 'ALREADY_SCANNED') {
                        console.error('GAGAL pada Test 3');
                        process.exit(1);
                    }

                    // Test 4: Scan Pulang pertama -> Sukses
                    dbHandler.catatAbsen(testNIS, 'MANUAL', (err4, res4) => {
                        console.log('\n4. Scan Pulang Pertama:');
                        console.log('   Hasil:', res4 ? ('Sukses ' + res4.jenis + ' (' + res4.nama + ')') : err4.message);
                        if (err4 || res4.jenis !== 'Pulang') {
                            console.error('GAGAL pada Test 4');
                            process.exit(1);
                        }

                        // Test 5: Scan Pulang ke-2 di hari yang sama -> Ditolak (ALREADY_SCANNED)
                        dbHandler.catatAbsen(testNIS, 'MANUAL', (err5, res5) => {
                            console.log('\n5. Scan Pulang Kedua:');
                            console.log('   Error Code:', err5 ? err5.code : 'TIDAK ADA');
                            console.log('   Error Msg :', err5 ? err5.message : 'TIDAK ADA');
                            if (!err5 || err5.code !== 'ALREADY_SCANNED') {
                                console.error('GAGAL pada Test 5');
                                process.exit(1);
                            }

                            // Test 6: Simulasi Race condition (dua scan serentak)
                            db.run("INSERT OR IGNORE INTO pengguna (nomor_induk, nama_lengkap, peran, kelas, status) VALUES (?, 'Siswa Test Race', 'Siswa', 'XII TKJ', 'Aktif')", [testNIS_Race], () => {
                                db.run("DELETE FROM absensi WHERE nomor_induk = ? AND (tanggal_wib = ? OR date(waktu_scan, '+7 hours') = ?)", [testNIS_Race, today, today], () => {
                                    let selesai = 0;
                                    let suksesCount = 0;
                                    let tolakCount = 0;

                                    const onRaceDone = (errR, resR) => {
                                        selesai++;
                                        if (resR) suksesCount++;
                                        if (errR) tolakCount++;
                                        if (selesai === 2) {
                                            console.log('\n6. Simulasi Dua Scan Masuk Serentak (Race Condition):');
                                            console.log('   Sukses: ' + suksesCount + ', Ditolak: ' + tolakCount);
                                            if (suksesCount !== 1 || tolakCount !== 1) {
                                                console.error('GAGAL pada Test 6');
                                                process.exit(1);
                                            }

                                            // Test 7: Hari berikutnya -> Bisa absen lagi
                                            db.run("UPDATE absensi SET tanggal_wib = '2026-10-11' WHERE nomor_induk = ?", [testNIS], () => {
                                                dbHandler.catatAbsen(testNIS, 'MANUAL', (err7, res7) => {
                                                    console.log('\n7. Scan di Hari Berikutnya:');
                                                    console.log('   Hasil:', res7 ? ('Sukses ' + res7.jenis + ' (' + res7.nama + ')') : (err7 ? err7.message : 'Error'));
                                                    if (err7 || res7.jenis !== 'Masuk') {
                                                        console.error('GAGAL pada Test 7');
                                                        process.exit(1);
                                                    }

                                                    // Cleanup data test
                                                    db.run("DELETE FROM absensi WHERE nomor_induk IN (?, ?)", [testNIS, testNIS_Race]);
                                                    db.run("DELETE FROM pengguna WHERE nomor_induk IN (?, ?)", [testNIS, testNIS_Race]);
                                                    console.log('\n=================================================');
                                                    console.log('SEMUA 7 SKENARIO PENGUJIAN BERHASIL (100% PASSED)');
                                                    console.log('=================================================');
                                                    db.close();
                                                }, 'Masuk');
                                            });
                                        }
                                    };

                                    // Panggil secara serentak paralel
                                    dbHandler.catatAbsen(testNIS_Race, 'MANUAL', onRaceDone, 'Masuk');
                                    dbHandler.catatAbsen(testNIS_Race, 'MANUAL', onRaceDone, 'Masuk');
                                });
                            });
                        }, 'Pulang');
                    }, 'Pulang');
                }, 'Masuk');
            }, 'Masuk');
        }, 'Pulang');
    });
});
