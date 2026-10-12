/**
 * live-clock.js — Real-Time Server Clock Component
 * Tersinkronisasi dengan waktu server (WIB / Asia/Jakarta)
 */

(function () {
    let serverTimeOffset = 0; // Selisih waktu server dengan Date.now() client
    let syncInterval = null;
    let tickInterval = null;

    const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    /**
     * Ambil acuan waktu dari endpoint server /api/public/server-time
     */
    async function syncServerTime() {
        try {
            const startFetch = Date.now();
            const res = await fetch('/api/public/server-time');
            const data = await res.json();
            const endFetch = Date.now();
            
            // Hitung latency (estimasi RTT / 2)
            const latency = Math.round((endFetch - startFetch) / 2);
            
            if (data && data.timestamp) {
                // Selisih = (waktu server + latency) - Date.now() client
                serverTimeOffset = (data.timestamp + latency) - Date.now();
            }
        } catch (err) {
            console.warn('[LIVE CLOCK] Gagal sinkronisasi waktu server, menggunakan estimasi lokal:', err);
        }
    }

    /**
     * Format angka dengan leading zero (01, 02, dst)
     */
    function pad(num) {
        return num < 10 ? '0' + num : num;
    }

    /**
     * Dapatkan objek Date server saat ini (dalam WIB / UTC+7)
     */
    function getCurrentServerDate() {
        const localNow = new Date(Date.now() + serverTimeOffset);
        
        // Konversi ke WIB (UTC+7) secara presisi
        const utc = localNow.getTime() + (localNow.getTimezoneOffset() * 60000);
        const wibTime = new Date(utc + (3600000 * 7));
        return wibTime;
    }

    /**
     * Render jam & tanggal ke elemen HTML
     */
    function updateClockDisplay() {
        const now = getCurrentServerDate();

        const dayName = DAYS[now.getDay()];
        const dayNum = now.getDate();
        const monthName = MONTHS[now.getMonth()];
        const year = now.getFullYear();

        const hours = pad(now.getHours());
        const minutes = pad(now.getMinutes());
        const seconds = pad(now.getSeconds());

        const formattedDate = `${dayName}, ${dayNum} ${monthName} ${year}`;
        const formattedTime = `${hours}:${minutes}:${seconds}`;

        // Update semua elemen jam yang ada di DOM
        const timeElements = document.querySelectorAll('.live-clock-time, #clock-time, #scanner-clock-time');
        const dateElements = document.querySelectorAll('.live-clock-date, #clock-date, #scanner-clock-date');

        timeElements.forEach(el => {
            el.textContent = formattedTime;
        });

        dateElements.forEach(el => {
            el.textContent = formattedDate;
        });
    }

    /**
     * Inisialisasi komponen jam
     */
    async function initLiveClock() {
        // Sinkronisasi pertama kali
        await syncServerTime();
        updateClockDisplay();

        // Update tampilan tiap 1 detik
        if (!tickInterval) {
            tickInterval = setInterval(updateClockDisplay, 1000);
        }

        // Re-sinkronisasi ke server tiap 5 menit (300.000 ms) untuk cegah drift
        if (!syncInterval) {
            syncInterval = setInterval(syncServerTime, 5 * 60 * 1000);
        }
    }

    // Jalankan saat DOM siap
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLiveClock);
    } else {
        initLiveClock();
    }
})();
