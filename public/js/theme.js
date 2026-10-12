/**
 * theme.js — Script penanganan Dark Mode / Light Mode
 * Menghindari flash tema yang salah (FOUC), persistensi ke localStorage,
 * dan sinkronisasi dengan Chart.js jika ada.
 */

(function () {
    // 1. Dapatkan tema yang tersimpan atau preferensi sistem
    function getPreferredTheme() {
        try {
            const saved = localStorage.getItem('app-theme');
            if (saved === 'dark' || saved === 'light') return saved;
        } catch (e) {
            // localStorage mungkin di-disable di browser
        }
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    }

    // 2. Terapkan tema ke document root
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try {
            localStorage.setItem('app-theme', theme);
        } catch (e) {}

        // Perbarui semua tombol toggle di halaman
        document.querySelectorAll('.theme-toggle-btn, .theme-toggle-light').forEach(btn => {
            btn.setAttribute('aria-label', theme === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap');
            const icon = btn.querySelector('i');
            if (icon) {
                if (theme === 'dark') {
                    icon.className = 'fa-solid fa-sun';
                } else {
                    icon.className = 'fa-solid fa-moon';
                }
            }
        });

        // Callback ke chart jika fungsi update tersedia
        if (typeof window.onThemeChange === 'function') {
            window.onThemeChange(theme);
        }
    }

    // 3. Fungsi toggle tema yang dipanggil pengguna
    window.toggleTheme = function () {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
    };

    // 4. Inisialisasi awal segera sebelum DOM render penuh
    const initialTheme = getPreferredTheme();
    document.documentElement.setAttribute('data-theme', initialTheme);

    // 5. Update icon saat DOM sudah siap
    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(document.documentElement.getAttribute('data-theme') || initialTheme);
    });

    // 6. Dengarkan perubahan preferensi sistem jika pengguna belum memilih manual
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            try {
                if (!localStorage.getItem('app-theme')) {
                    applyTheme(e.matches ? 'dark' : 'light');
                }
            } catch (err) {}
        });
    }
})();
