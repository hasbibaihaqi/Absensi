/**
 * app_config.js — Konfigurasi aplikasi
 * Versi web: field-field terkait WhatsApp dihapus.
 */

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../database/app_config.json');

const defaultConfig = {
    namaSekolah: 'AbsenSekolah',
    logoPath: '',
    jamBatasMasuk: '07:15',
    jamPulangMulai: '12:00',
    // Manajemen Hari Kerja: 1:Senin, 2:Selasa, 3:Rabu, 4:Kamis, 5:Jumat, 6:Sabtu, 0:Minggu
    hariOperasional: [1, 2, 3, 4, 5, 6],
    // Daftar hari libur kustom: [{ tanggal: 'YYYY-MM-DD', keterangan: 'Keterangan libur' }]
    hariLiburKhusus: []
};

function getConfig() {
    if (fs.existsSync(configPath)) {
        try {
            const data = fs.readFileSync(configPath, 'utf8');
            const saved = JSON.parse(data);
            // Hapus field WA lama jika ada (bersihkan saat baca)
            delete saved.templatePesan;
            delete saved.templatePesanPulang;
            delete saved.templatePesanTerlambat;
            delete saved.templatePesanTidakHadir;
            delete saved.enableNotifGuru;
            return Object.assign({}, defaultConfig, saved);
        } catch (e) {
            console.error('[CONFIG] Error reading app_config:', e);
        }
    }
    return Object.assign({}, defaultConfig);
}

function saveConfig(newConfig) {
    try {
        const dirPath = path.join(__dirname, '../database');
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        // Jangan simpan field WA
        delete newConfig.templatePesan;
        delete newConfig.templatePesanPulang;
        delete newConfig.templatePesanTerlambat;
        delete newConfig.templatePesanTidakHadir;
        delete newConfig.enableNotifGuru;

        const current = getConfig();
        const merged = Object.assign(current, newConfig);
        fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('[CONFIG] Error saving app_config:', e);
        return false;
    }
}

module.exports = { getConfig, saveConfig };
