/**
 * animations.js — Fondasi Animasi Terpadu Aplikasi Absensi Sekolah
 * FASE 2 (Bagian I): Motion Design & Progressive Enhancement
 *
 * Prinsip:
 * - Hanya animasikan transform dan opacity (performa GPU)
 * - Hormati prefers-reduced-motion
 * - Progressive enhancement: animasi hanya aktif jika JS jalan
 * - Tidak menggunakan library berat (murni Vanilla JS + CSS)
 */

(function () {
    'use strict';

    /* ================================================
       1. PROGRESSIVE ENHANCEMENT — Tandai JS aktif
       ================================================ */
    document.documentElement.classList.add('js');

    /* ================================================
       2. Cek prefers-reduced-motion sekali
       ================================================ */
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ================================================
       3. SCROLL REVEAL — IntersectionObserver
       ================================================ */
    function initScrollReveal() {
        if (prefersReducedMotion) {
            // Tampilkan semua elemen tanpa animasi jika motion dikurangi
            document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible'));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    io.unobserve(entry.target); // Hanya trigger sekali
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

        document.querySelectorAll('.reveal').forEach(el => io.observe(el));
    }

    /* ================================================
       4. COUNT-UP — Angka naik dari 0 ke nilai target
       ================================================ */
    function countUp(el, target, duration) {
        if (prefersReducedMotion) {
            el.textContent = target.toLocaleString('id-ID');
            return;
        }
        const start = performance.now();
        const startVal = 0;

        function step(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // Easing: ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(startVal + (target - startVal) * eased);
            el.textContent = current.toLocaleString('id-ID');
            if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    /**
     * Panggil countUp pada elemen dengan data-count-target.
     * Gunakan IntersectionObserver agar count-up berjalan saat elemen masuk viewport.
     * @param {NodeList|Array} elements
     */
    function initCountUp(elements) {
        if (!elements || !elements.length) return;
        if (prefersReducedMotion) {
            elements.forEach(el => {
                const target = parseInt(el.dataset.countTarget || el.textContent, 10);
                if (!isNaN(target)) el.textContent = target.toLocaleString('id-ID');
            });
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const target = parseInt(el.dataset.countTarget || el.textContent, 10);
                    if (!isNaN(target)) countUp(el, target, 850);
                    io.unobserve(el);
                }
            });
        }, { threshold: 0.5 });
        elements.forEach(el => io.observe(el));
    }

    /* ================================================
       5. FORM SHAKE — Animasi goyang saat validasi gagal
       ================================================ */
    window.formShake = function (el) {
        if (prefersReducedMotion || !el) return;
        el.classList.remove('anim-shake');
        // Force reflow agar class bisa ditambah ulang
        void el.offsetWidth;
        el.classList.add('anim-shake');
        el.addEventListener('animationend', () => el.classList.remove('anim-shake'), { once: true });
    };

    /* ================================================
       6. TOAST — Notifikasi slide-in otomatis
       ================================================ */
    window.showToast = function (message, type, duration) {
        type = type || 'info';
        duration = duration || 3500;

        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const iconMap = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
        toast.innerHTML = `<i class="fa-solid ${iconMap[type] || iconMap.info}" aria-hidden="true"></i><span>${message}</span>`;
        container.appendChild(toast);

        // Paksa reflow lalu aktifkan animasi masuk
        void toast.offsetWidth;
        toast.classList.add('is-visible');

        setTimeout(() => {
            toast.classList.remove('is-visible');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        }, duration);
    };

    /* ================================================
       7. MODAL ANIMATION — Fade + scale saat buka/tutup
       ================================================ */
    window.openModal = function (modal) {
        if (!modal) return;
        modal.style.display = 'flex';
        if (!prefersReducedMotion) {
            void modal.offsetWidth;
            modal.classList.add('is-open');
        }
    };

    window.closeModal = function (modal) {
        if (!modal) return;
        if (!prefersReducedMotion) {
            modal.classList.remove('is-open');
            modal.addEventListener('transitionend', () => { modal.style.display = 'none'; }, { once: true });
        } else {
            modal.style.display = 'none';
        }
    };

    /* ================================================
       8. BANNER SELAMAT DATANG — Sapaan Waktu (WIB) & Text Reveal
       ================================================ */
    function getJamWIB() {
        // Hitung waktu WIB (UTC+7) secara presisi
        const now = new Date();
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
        const wibDate = new Date(utcTime + (3600000 * 7));
        return wibDate.getHours();
    }

    function initSapaanWaktu() {
        const el = document.getElementById('banner-sapaan');
        if (!el) return;
        const jam = getJamWIB();
        let sapaan;
        if (jam >= 5 && jam < 11)       sapaan = 'SELAMAT PAGI';
        else if (jam >= 11 && jam < 15)  sapaan = 'SELAMAT SIANG';
        else if (jam >= 15 && jam < 18)  sapaan = 'SELAMAT SORE';
        else                             sapaan = 'SELAMAT MALAM';

        el.textContent = sapaan;
    }

    function initBannerTextReveal() {
        const bannerContent = document.querySelector('.banner-content');
        if (!bannerContent) return;
        if (prefersReducedMotion) {
            bannerContent.classList.add('is-animated');
            return;
        }
        // Jalankan animasi reveal entrance teks sekali saat awal dibuka
        requestAnimationFrame(() => {
            bannerContent.classList.add('is-animated');
        });
    }

    /* ================================================
       9. STAGGER — Animasi anak elemen berurutan
       ================================================ */
    function initStagger() {
        if (prefersReducedMotion) return;
        document.querySelectorAll('.stagger > *').forEach((el, i) => {
            el.style.setProperty('--i', i);
        });
    }

    /* ================================================
       10. PROGRESS BAR — Animasi scaleX dari kiri
       ================================================ */
    function initProgressBars() {
        if (prefersReducedMotion) {
            document.querySelectorAll('[data-progress]').forEach(bar => {
                const pct = parseFloat(bar.dataset.progress) || 0;
                bar.style.transform = `scaleX(${pct / 100})`;
            });
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const bar = entry.target;
                    const pct = parseFloat(bar.dataset.progress) || 0;
                    requestAnimationFrame(() => {
                        bar.style.transition = 'transform 1.1s cubic-bezier(.22,1,.36,1)';
                        bar.style.transform = `scaleX(${pct / 100})`;
                    });
                    io.unobserve(bar);
                }
            });
        }, { threshold: 0.1 });
        document.querySelectorAll('[data-progress]').forEach(bar => {
            bar.style.transform = 'scaleX(0)';
            bar.style.transformOrigin = 'left';
            io.observe(bar);
        });
    }

    /* ================================================
       11. SIDEBAR DRAWER (Mobile) — Slide-in + Backdrop
       ================================================ */
    function initSidebarDrawer() {
        const sidebar = document.querySelector('.sidebar');
        const toggleBtn = document.getElementById('btn-toggle-sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (!sidebar || !toggleBtn) return;

        toggleBtn.addEventListener('click', () => {
            const isOpen = sidebar.classList.contains('is-open');
            if (isOpen) {
                sidebar.classList.remove('is-open');
                if (backdrop) backdrop.classList.remove('is-visible');
            } else {
                sidebar.classList.add('is-open');
                if (backdrop) backdrop.classList.add('is-visible');
            }
        });

        if (backdrop) {
            backdrop.addEventListener('click', () => {
                sidebar.classList.remove('is-open');
                backdrop.classList.remove('is-visible');
            });
        }
    }

    /* ================================================
       12. INIT — Jalankan semua saat DOM siap
       ================================================ */
    function init() {
        initSapaanWaktu();
        initBannerTextReveal();
        initScrollReveal();
        initStagger();
        initProgressBars();
        initSidebarDrawer();

        // Perbarui sapaan waktu secara wajar setiap 5 menit (tanpa render berlebihan)
        setInterval(initSapaanWaktu, 5 * 60 * 1000);

        // Count-up untuk kartu statistik di dashboard admin
        const statEls = document.querySelectorAll('[data-count-target]');
        if (statEls.length) initCountUp(statEls);

        // Animasi masuk halaman (hanya sekali, tidak diulang saat refresh data)
        if (!prefersReducedMotion) {
            const pageReveal = document.querySelectorAll('.page-enter');
            pageReveal.forEach((el, i) => {
                el.style.animationDelay = `${i * 80}ms`;
                el.classList.add('is-entering');
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Ekspos API publik
    window.AnimationUtils = {
        countUp,
        initCountUp,
        initScrollReveal,
        initProgressBars,
    };

})();
