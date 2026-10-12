/**
 * admin.js — Frontend Dashboard Admin (versi Web)
 * Menggantikan ipcRenderer Electron dengan fetch() ke REST API
 */

const daftarKelas = ["7A", "7B", "7C", "7D", "7E", "8A", "8B", "8C", "9A", "9B"];

// Variabel chart global — deklarasikan di sini agar tersedia sebelum renderChartsDashboard()
let chartTren7Hari = null;
let chartDistribusiHariIni = null;

// Helper: fetch dengan auth
async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        credentials: 'same-origin',
        ...options
    });
    if (res.status === 401) {
        window.location.href = '/login';
        return null;
    }
    return res;
}

// FUNGSI PENGAMAN
const klik = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
const pantau = (id, evt, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(evt, fn); };

// Helper: escape HTML entities untuk mencegah XSS
function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// =====================================
// CEK SESI AKTIF + FORCE CHANGE PASSWORD
// =====================================
(async () => {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const data = await res.json();
    if (!data.loggedIn) {
        window.location.href = '/login';
        return;
    }

    const el = document.getElementById('profile-username');
    if (el) el.textContent = data.username;
    const elSidebarUser = document.getElementById('sidebar-user-name');
    if (elSidebarUser) elSidebarUser.textContent = data.username;

    const avaUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.username)}&background=4F46E5&color=fff`;
    const ava = document.getElementById('profile-avatar');
    if (ava) ava.src = avaUrl;
    const avaSidebar = document.getElementById('sidebar-user-avatar');
    if (avaSidebar) avaSidebar.src = avaUrl;

    // Cek apakah wajib ganti password (dari URL param atau dari token)
    const urlParams = new URLSearchParams(window.location.search);
    if (data.mustChangePassword || urlParams.get('changePassword') === 'required') {
        // Tampilkan modal wajib ganti password — tidak bisa di-skip
        const modal = document.getElementById('modal-ganti-password-wajib');
        if (modal) modal.style.display = 'flex';

        const btnKonfirm = document.getElementById('btn-konfirm-ganti-pw');
        const errEl = document.getElementById('ganti-pw-error');

        if (btnKonfirm) {
            btnKonfirm.addEventListener('click', async () => {
                const pw = document.getElementById('ganti-pw-baru')?.value || '';
                const konfirm = document.getElementById('ganti-pw-konfirm')?.value || '';

                errEl.style.display = 'none';

                if (!pw || !konfirm) {
                    errEl.textContent = 'Semua kolom wajib diisi.';
                    errEl.style.display = 'block';
                    return;
                }
                if (pw.length < 8) {
                    errEl.textContent = 'Password minimal 8 karakter.';
                    errEl.style.display = 'block';
                    return;
                }
                if (pw !== konfirm) {
                    errEl.textContent = 'Password dan konfirmasi tidak cocok.';
                    errEl.style.display = 'block';
                    return;
                }
                if (pw === 'admin123') {
                    errEl.textContent = 'Gunakan password yang berbeda dari password default!';
                    errEl.style.display = 'block';
                    return;
                }

                btnKonfirm.disabled = true;
                btnKonfirm.textContent = 'Menyimpan...';

                const result = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ password: pw, konfirmasi: konfirm })
                });
                const body = await result.json();

                if (body.sukses) {
                    modal.style.display = 'none';
                    // Bersihkan URL param
                    window.history.replaceState({}, '', '/admin');
                    showToast('Password berhasil diubah! Selamat menggunakan AbsenSekolah.', 'success');
                } else {
                    errEl.textContent = body.pesan || 'Gagal menyimpan password.';
                    errEl.style.display = 'block';
                    btnKonfirm.disabled = false;
                    btnKonfirm.innerHTML = '<i class="fa-solid fa-key"></i> Simpan Password Baru';
                }
            });
        }
    }
})();

// =====================================
// INIT DROPDOWN KELAS
// =====================================
function inisialisasiDropdownKelas() {
    const filterSelect = document.getElementById('filter-kelas');
    const inputSelect = document.getElementById('input-kelas');
    const editSelect = document.getElementById('edit-kelas');
    const filterLap = document.getElementById('filter-kelas-lap');

    if (filterSelect) filterSelect.innerHTML = '<option value="Semua">Semua Kelas</option>';
    if (inputSelect) inputSelect.innerHTML = '<option value="" disabled selected>-- Pilih Kelas --</option>';
    if (editSelect) editSelect.innerHTML = '<option value="" disabled selected>-- Pilih Kelas --</option>';
    if (filterLap) filterLap.innerHTML = '<option value="Semua">Semua Kelas/Jabatan</option>';

    daftarKelas.forEach(kls => {
        if (filterSelect) filterSelect.appendChild(new Option(kls, kls));
        if (inputSelect) inputSelect.appendChild(new Option(kls, kls));
        if (editSelect) editSelect.appendChild(new Option(kls, kls));
        if (filterLap) filterLap.appendChild(new Option(kls, kls));
    });
}
inisialisasiDropdownKelas();

// =====================================
// NAVIGASI
// =====================================
function bukaLayar(idLayar, idMenuAktif) {
    ['view-dashboard', 'view-siswa', 'view-guru', 'view-laporan', 'view-pengaturan', 'view-users'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    ['menu-dashboard', 'menu-siswa', 'menu-guru', 'menu-laporan', 'menu-pengaturan', 'menu-users'].forEach(id => {
        const el = document.getElementById(id); if (el) el.classList.remove('active');
    });
    const targetLayar = document.getElementById(idLayar);
    if (targetLayar) targetLayar.style.display = 'block';
    const targetMenu = document.getElementById(idMenuAktif);
    if (targetMenu) targetMenu.classList.add('active');

    // Update Topbar Title
    const titleMap = {
        'view-dashboard': 'Dashboard',
        'view-siswa': 'Data Siswa',
        'view-guru': 'Data Guru',
        'view-laporan': 'Laporan Kehadiran',
        'view-users': 'Kelola User',
        'view-pengaturan': 'Pengaturan Sekolah'
    };
    const topbarTitle = document.getElementById('topbar-page-title');
    if (topbarTitle && titleMap[idLayar]) {
        topbarTitle.textContent = titleMap[idLayar];
    }
}

// Global Search Bar Handler in Topbar
const globalSearchInput = document.getElementById('topbar-global-search');
if (globalSearchInput) {
    globalSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const searchSiswa = document.getElementById('search-siswa');
        if (searchSiswa && document.getElementById('view-siswa')?.style.display !== 'none') {
            searchSiswa.value = query;
            searchSiswa.dispatchEvent(new Event('input'));
        }
        const dashboardRows = document.querySelectorAll('#tabel-riwayat-dashboard tr');
        dashboardRows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(query) ? '' : 'none';
        });
    });
}

pantau('menu-dashboard', 'click', (e) => { e.preventDefault(); bukaLayar('view-dashboard', 'menu-dashboard'); muatStatistikDashboard(); });
pantau('menu-siswa', 'click', (e) => { e.preventDefault(); bukaLayar('view-siswa', 'menu-siswa'); muatDataSiswa(); });
pantau('menu-guru', 'click', (e) => { e.preventDefault(); bukaLayar('view-guru', 'menu-guru'); muatDataGuru(); });
pantau('menu-laporan', 'click', (e) => { e.preventDefault(); bukaLayar('view-laporan', 'menu-laporan'); initLaporan(); });
pantau('menu-users', 'click', (e) => { e.preventDefault(); bukaLayar('view-users', 'menu-users'); muatDataUsers(); });
pantau('menu-pengaturan', 'click', (e) => { e.preventDefault(); bukaLayar('view-pengaturan', 'menu-pengaturan'); initPengaturan(); });
klik('menu-scanner', () => { window.location.href = '/scanner'; });

// =====================================
// LOGOUT
// =====================================
document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.href = '/login';
});

// =====================================
// TOAST
// =====================================
function showToast(pesan, tipe = 'success') {
    const existing = document.getElementById('toast-notif');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'toast-notif';
    const bg = tipe === 'success' ? '#10B981' : '#EF4444';
    const icon = tipe === 'success' ? 'fa-circle-check' : 'fa-circle-xmark';
    toast.style.cssText = `position:fixed;bottom:30px;right:30px;background:${bg};color:white;padding:14px 22px;border-radius:12px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:10px;box-shadow:0 8px 20px rgba(0,0,0,0.2);z-index:9999;animation:slideInToast 0.3s ease;`;
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> ${pesan}`;
    if (!document.getElementById('toast-style')) {
        const style = document.createElement('style');
        style.id = 'toast-style';
        style.textContent = '@keyframes slideInToast{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
        document.head.appendChild(style);
    }
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = '0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// =====================================
// NAMA SEKOLAH DINAMIS (CONFIG PUBLIK)
// =====================================
async function muatInfoSekolahAdmin() {
    const elWelcome = document.getElementById('welcome-nama-sekolah');
    const elBrand = document.getElementById('brand-nama-sekolah');
    try {
        const res = await fetch('/api/public/info-sekolah');
        if (!res.ok) throw new Error('Gagal memuat info sekolah');
        const data = await res.json();
        const nama = data.namaSekolah || 'AbsenSekolah';

        if (elWelcome) elWelcome.textContent = nama;
        if (elBrand) elBrand.textContent = nama.toUpperCase();
        document.title = `Dashboard Admin - ${nama}`;
    } catch (err) {
        console.warn('[INFO SEKOLAH ADMIN]', err.message);
        if (elWelcome) elWelcome.textContent = 'Sekolah';
    }
}

// =====================================
// DASHBOARD STATISTIK & CHARTS (CHART.JS)
// =====================================
let lastTrenData = [];
let lastDistData = {};

function renderChartsDashboard(trenData, distData) {
    if (trenData) lastTrenData = trenData;
    if (distData) lastDistData = distData;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#9CA3AF' : '#64748B';
    const gridColor = isDark ? '#374151' : '#E2E8F0';

    // 1. Memory leak prevention: destroy previous instances
    if (chartTren7Hari) {
        chartTren7Hari.destroy();
        chartTren7Hari = null;
    }
    if (chartDistribusiHariIni) {
        chartDistribusiHariIni.destroy();
        chartDistribusiHariIni = null;
    }

    // 2. Render Tren Kehadiran 7 Hari Terakhir
    // Helper: show empty state overlay
    function showChartEmptyState(canvasId, message) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const wrapper = canvas.parentElement;
        // Remove existing empty state if any
        const existing = wrapper.querySelector('.chart-empty-state');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.className = 'chart-empty-state';
        overlay.innerHTML = `<div class="chart-empty-icon"><i class="fa-solid fa-chart-bar"></i></div><p>${message}</p>`;
        wrapper.style.position = 'relative';
        wrapper.appendChild(overlay);
    }
    function hideChartEmptyState(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const wrapper = canvas.parentElement;
        const existing = wrapper.querySelector('.chart-empty-state');
        if (existing) existing.remove();
    }
    const ctxTren = document.getElementById('chart-tren-7hari');
    if (ctxTren && typeof Chart !== 'undefined') {
        const labels = (lastTrenData || []).map(d => {
            if (!d.tanggal) return '-';
            const parts = d.tanggal.split('-');
            if (parts.length === 3) {
                const bln = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][parseInt(parts[1], 10) - 1] || parts[1];
                return `${parseInt(parts[2], 10)} ${bln}`;
            }
            return d.tanggal;
        });

        const hadirData = (lastTrenData || []).map(d => Math.max(0, (d.hadir || 0) - (d.terlambat || 0)));
        const terlambatData = (lastTrenData || []).map(d => d.terlambat || 0);
        const izinSakitData = (lastTrenData || []).map(d => (d.izin || 0) + (d.sakit || 0));
        const alpaData = (lastTrenData || []).map(d => d.alpa || 0);

        // Check if tren data has any actual values
        const trenHasData = hadirData.some(v => v > 0) || terlambatData.some(v => v > 0) || izinSakitData.some(v => v > 0) || alpaData.some(v => v > 0);
        if (!trenHasData && labels.length === 0) {
            showChartEmptyState('chart-tren-7hari', 'Belum ada data kehadiran 7 hari terakhir');
        } else {
            hideChartEmptyState('chart-tren-7hari');
        }

        chartTren7Hari = new Chart(ctxTren, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Hadir Tepat Waktu',
                        data: hadirData,
                        borderColor: '#10B981',
                        backgroundColor: 'rgba(16, 185, 129, 0.12)',
                        fill: true,
                        tension: 0.35,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    },
                    {
                        label: 'Terlambat',
                        data: terlambatData,
                        borderColor: '#F59E0B',
                        backgroundColor: 'rgba(245, 158, 11, 0.12)',
                        fill: true,
                        tension: 0.35,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    },
                    {
                        label: 'Izin / Sakit',
                        data: izinSakitData,
                        borderColor: '#6366F1',
                        backgroundColor: 'rgba(99, 102, 241, 0.12)',
                        fill: false,
                        tension: 0.35,
                        borderDash: [4, 4],
                        pointRadius: 3
                    },
                    {
                        label: 'Alpa',
                        data: alpaData,
                        borderColor: '#EF4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.12)',
                        fill: false,
                        tension: 0.35,
                        pointRadius: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 8,
                            boxHeight: 8,
                            padding: 16,
                            color: textColor,
                            font: { family: 'Inter', size: 11 }
                        }
                    },
                    tooltip: { padding: 10, cornerRadius: 8 }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textColor, font: { family: 'Inter', size: 11 } }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: trenHasData ? undefined : 5,
                        grid: { color: gridColor },
                        ticks: { precision: 0, stepSize: 1, color: textColor, font: { family: 'Inter', size: 11 } }
                    }
                }
            }
        });
    }

    // 3. Render Distribusi Kehadiran Hari Ini (Donut / Pie)
    const ctxDist = document.getElementById('chart-distribusi-hari-ini');
    if (ctxDist && typeof Chart !== 'undefined') {
        const d = lastDistData || { hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpa: 0, belumAbsen: 0 };
        const total = (d.hadir || 0) + (d.terlambat || 0) + (d.izin || 0) + (d.sakit || 0) + (d.alpa || 0) + (d.belumAbsen || 0);

        const labels = ['Hadir Tepat Waktu', 'Terlambat', 'Izin', 'Sakit', 'Alpa', 'Belum Absen'];
        const values = total > 0
            ? [d.hadir || 0, d.terlambat || 0, d.izin || 0, d.sakit || 0, d.alpa || 0, d.belumAbsen || 0]
            : [0, 0, 0, 0, 0, 1];
        const colors = total > 0
            ? ['#10B981', '#F59E0B', '#0284C7', '#A855F7', '#EF4444', isDark ? '#374151' : '#CBD5E1']
            : [isDark ? '#1F2937' : '#E2E8F0', isDark ? '#1F2937' : '#E2E8F0', isDark ? '#1F2937' : '#E2E8F0', isDark ? '#1F2937' : '#E2E8F0', isDark ? '#1F2937' : '#E2E8F0', isDark ? '#1F2937' : '#E2E8F0'];

        // Show/hide empty state for distribution chart
        if (total === 0) {
            showChartEmptyState('chart-distribusi-hari-ini', 'Belum ada data absensi hari ini');
        } else {
            hideChartEmptyState('chart-distribusi-hari-ini');
        }

        chartDistribusiHariIni = new Chart(ctxDist, {
            type: 'doughnut',
            data: {
                labels: total > 0 ? labels : ['Belum ada data'],
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: isDark ? '#111827' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 8,
                            boxHeight: 8,
                            padding: 14,
                            color: textColor,
                            font: { family: 'Inter', size: 11 }
                        }
                    },
                    tooltip: {
                        enabled: total > 0,
                        callbacks: {
                            label: (ctx) => {
                                const val = ctx.raw || 0;
                                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                                return ` ${ctx.label}: ${val} orang (${pct}%)`;
                            }
                        }
                    }
                },
                cutout: '62%'
            }
        });
    }
}

// Hook dipanggil oleh theme.js ketika dark/light mode berganti
window.onThemeChange = function(theme) {
    renderChartsDashboard(lastTrenData, lastDistData);
};

async function muatStatistikDashboard() {
    // Muat ringkasan angka kartu statistik
    const res = await apiFetch('/api/absensi/statistik');
    if (res) {
        const data = await res.json();
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val !== undefined ? val : 0; };
        set('stat-siswa', data.totalSiswa);
        set('stat-guru', data.totalGuru);
        set('stat-hadir', data.hadirPagi);
        set('stat-terlambat', data.terlambat);
    }

    // Muat data chart lengkap (tren 7 hari + distribusi hari ini)
    try {
        const resChart = await apiFetch('/api/absensi/chart-data');
        if (resChart) {
            const chartData = await resChart.json();
            renderChartsDashboard(chartData.tren7Hari || [], chartData.distribusiHariIni || {});
        }
    } catch (errChart) {
        console.error('[CHART DASHBOARD ERROR]', errChart);
    }

    // Muat riwayat absensi terbaru di dashboard (hari ini)
    const today = new Date().toISOString().split('T')[0];
    const resLap = await apiFetch(`/api/absensi/laporan?mulai=${today}&akhir=${today}&peran=Semua&kelas=Semua`);
    if (!resLap) return;
    const rows = await resLap.json();
    const tbody = document.getElementById('tabel-riwayat-dashboard');
    if (!tbody) return;
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888;">Belum ada absensi hari ini.</td></tr>';
        return;
    }
    tbody.innerHTML = rows.slice(0, 10).map(r => {
        const jam = r.waktu_scan?.split(' ')[1] || '-';
        const statusClass = r.jenis_absen === 'Masuk' ? 'status-masuk' : r.jenis_absen === 'Pulang' ? 'status-pulang' : 'status-izin';
        return `<tr><td>${escapeHtml(r.nama_lengkap)}</td><td>${escapeHtml(r.peran)}</td><td>${escapeHtml(jam)}</td><td class="${statusClass}">${escapeHtml(r.jenis_absen)}</td></tr>`;
    }).join('');
}

// =====================================
// DATA SISWA
// =====================================
let semuaDataSiswa = [];

async function muatDataSiswa() {
    const res = await apiFetch('/api/siswa');
    if (!res) return;
    semuaDataSiswa = await res.json();
    renderTabelSiswa();
    updateDatalistSiswa();
}

function updateDatalistSiswa() {
    const dataList = document.getElementById('list-siswa-absen');
    if (!dataList) return;
    dataList.innerHTML = '';
    semuaDataSiswa.forEach(s => {
        if (s.status === 'Aktif') {
            const opt = document.createElement('option');
            opt.value = `${s.nomor_induk} - ${s.nama_lengkap}`;
            dataList.appendChild(opt);
        }
    });
}

pantau('filter-kelas', 'change', renderTabelSiswa);
pantau('filter-status', 'change', renderTabelSiswa);
pantau('search-siswa', 'input', renderTabelSiswa);

function renderTabelSiswa() {
    const fKelas = document.getElementById('filter-kelas')?.value || 'Semua';
    const fStatus = document.getElementById('filter-status')?.value || 'Aktif';
    const fSearch = document.getElementById('search-siswa')?.value.toLowerCase() || '';
    const tbody = document.getElementById('tabel-data-siswa');
    if (!tbody) return;

    const filteredData = semuaDataSiswa.filter(s => {
        const matchKelas = fKelas === 'Semua' || s.kelas === fKelas;
        const matchStatus = fStatus === 'Semua' || s.status === fStatus;
        const matchSearch = s.nama_lengkap.toLowerCase().includes(fSearch) || (s.nomor_induk && s.nomor_induk.includes(fSearch));
        return matchKelas && matchStatus && matchSearch;
    });

    const summary = document.getElementById('summary-kelas');
    if (summary) summary.innerText = `Total: ${filteredData.length} Siswa`;

    if (!filteredData.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Data tidak ditemukan.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredData.map(row => {
        const rowStr = JSON.stringify(row).replace(/"/g, '&quot;');
        const badgeStatus = row.status === 'Aktif' ? 'badge-status-aktif' : 'badge-status-pindah';
        return `<tr>
            <td><strong>${escapeHtml(row.nomor_induk)}</strong></td>
            <td>${escapeHtml(row.nama_lengkap)}</td>
            <td><span style="background:#EEF2FF;color:#4F46E5;padding:4px 10px;border-radius:6px;font-weight:600;font-size:12px;">${escapeHtml(row.kelas)}</span></td>
            <td><span class="${badgeStatus}">${escapeHtml(row.status || 'Aktif')}</span></td>
            <td style="display:flex;gap:5px;">
                <button class="btn-info" style="background:#10B981;" onclick="downloadQRSiswa('${escapeHtml(row.nomor_induk)}','${escapeHtml(row.nama_lengkap).replace(/'/g, "\\'")}')"><i class="fa-solid fa-qrcode"></i></button>
                <button class="btn-info" onclick="bukaDetail(${rowStr},'Siswa')"><i class="fa-solid fa-eye"></i> Detail</button>
                <button class="btn-warning" onclick="bukaModalEditSiswa(${rowStr})"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-delete" onclick="hapusSiswa(${row.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}

// =====================================
// DATA GURU
// =====================================
let semuaDataGuru = [];

async function muatDataGuru() {
    const res = await apiFetch('/api/guru');
    if (!res) return;
    semuaDataGuru = await res.json();
    renderTabelGuru();
}

pantau('filter-status-guru', 'change', renderTabelGuru);
pantau('search-guru', 'input', renderTabelGuru);

function renderTabelGuru() {
    const fStatus = document.getElementById('filter-status-guru')?.value || 'Aktif';
    const fSearch = document.getElementById('search-guru')?.value.toLowerCase() || '';
    const tbody = document.getElementById('tabel-data-guru');
    if (!tbody) return;

    const filteredData = semuaDataGuru.filter(g => {
        const matchStatus = fStatus === 'Semua' || g.status === fStatus;
        const matchSearch = g.nama_lengkap.toLowerCase().includes(fSearch) || (g.nomor_induk && g.nomor_induk.includes(fSearch));
        return matchStatus && matchSearch;
    });

    const summary = document.getElementById('summary-guru');
    if (summary) summary.innerText = `Total: ${filteredData.length} Guru`;

    if (!filteredData.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Data guru tidak ditemukan.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredData.map(row => {
        const rowStr = JSON.stringify(row).replace(/"/g, '&quot;');
        const badgeStatus = row.status === 'Aktif' ? 'badge-status-aktif' : 'badge-status-pindah';
        return `<tr>
            <td><strong>${row.nomor_induk}</strong></td>
            <td>${row.nama_lengkap}</td>
            <td><span style="background:#FFFBEB;color:#D97706;border:1px solid #FDE68A;padding:4px 10px;border-radius:6px;font-weight:600;font-size:12px;">${row.kelas}</span></td>
            <td><span class="${badgeStatus}">${row.status || 'Aktif'}</span></td>
            <td style="display:flex;gap:5px;">
                <button class="btn-info" style="background:#10B981;" onclick="downloadQRGuru('${row.nomor_induk}','${row.nama_lengkap.replace(/'/g, "\\'")}')"><i class="fa-solid fa-qrcode"></i></button>
                <button class="btn-info" onclick="bukaDetail(${rowStr},'Guru')"><i class="fa-solid fa-eye"></i> Detail</button>
                <button class="btn-warning" onclick="bukaModalEditGuru(${rowStr})"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-delete" onclick="hapusGuru(${row.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}

// =====================================
// MODALS GLOBAL
// =====================================
function bukaModalHelper(id) {
    const m = document.getElementById(id);
    if (!m) return;
    if (typeof window.openModal === 'function') {
        window.openModal(m);
    } else {
        m.style.display = 'flex';
        m.classList.add('is-open');
    }
}

function tutupModalHelper(modalEl) {
    if (!modalEl) return;
    if (typeof window.closeModal === 'function') {
        window.closeModal(modalEl);
    } else {
        modalEl.classList.remove('is-open');
        modalEl.style.display = 'none';
    }
}

document.querySelectorAll('.btn-tutup-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach(m => tutupModalHelper(m));
    });
});

// Tutup modal jika user mengklik backdrop luar
document.querySelectorAll('.modal').forEach(modalEl => {
    modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) tutupModalHelper(modalEl);
    });
});

window.bukaDetail = async (d, tipe) => {
    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
    setTxt('det-nama', d.nama_lengkap);
    setTxt('det-nis', tipe === 'Siswa' ? `NIS: ${d.nomor_induk} | Kelas: ${d.kelas}` : `NIP: ${d.nomor_induk} | Jabatan: ${d.kelas}`);
    setTxt('det-status', d.status || 'Aktif');
    const ava = document.getElementById('det-avatar');
    if (ava) ava.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(d.nama_lengkap)}&background=EEF2FF&color=4F46E5`;
    setTxt('rek-masuk', '0'); setTxt('rek-pulang', '0');

    const res = await apiFetch(`/api/absensi/rekap/${d.nomor_induk}`);
    if (res) {
        const rows = await res.json();
        rows.forEach(r => {
            const el = document.getElementById(r.jenis_absen === 'Masuk' ? 'rek-masuk' : 'rek-pulang');
            if (el) el.innerText = r.total;
        });
    }
    bukaModalHelper('modal-detail');
};

// =====================================
// CRUD SISWA
// =====================================
klik('btn-input-absen', () => {
    const cariInput = document.getElementById('input-cari-absen');
    if (cariInput) cariInput.value = '';
    const statusSelect = document.getElementById('input-status-absen');
    if (statusSelect) statusSelect.value = 'Sakit';
    const ketInput = document.getElementById('input-keterangan-absen');
    if (ketInput) ketInput.value = '';
    bukaModalHelper('modal-input-absen');
});

klik('btn-simpan-absen', async () => {
    const searchVal = document.getElementById('input-cari-absen')?.value || '';
    const status = document.getElementById('input-status-absen')?.value;
    const keterangan = document.getElementById('input-keterangan-absen')?.value || '';
    const nis = searchVal.split(' - ')[0].trim();
    if (!nis) return alert('Pilih siswa dari daftar!');

    const res = await apiFetch('/api/absensi/manual-input', {
        method: 'POST',
        body: JSON.stringify({ nis, status, keterangan })
    });
    if (!res) return;
    const data = await res.json();
    if (data.sukses) {
        showToast(`Ketidakhadiran ${data.nama} berhasil dicatat!`, 'success');
        tutupModalHelper(document.getElementById('modal-input-absen'));
        muatStatistikDashboard();
    } else {
        showToast(data.pesan || 'Gagal mencatat ketidakhadiran!', 'error');
    }
});

klik('btn-tambah', () => {
    const inNis = document.getElementById('input-nis');
    if (inNis) inNis.value = '';
    const inNama = document.getElementById('input-nama');
    if (inNama) inNama.value = '';
    const inKelas = document.getElementById('input-kelas');
    if (inKelas) inKelas.selectedIndex = 0;
    bukaModalHelper('modal-tambah');
});

klik('btn-simpan', async () => {
    const data = {
        nis: document.getElementById('input-nis')?.value?.trim(),
        nama_lengkap: document.getElementById('input-nama')?.value?.trim(),
        kelas: document.getElementById('input-kelas')?.value,
        nomor_wa_ortu: ''
    };
    if (!data.nis || !data.nama_lengkap || !data.kelas) return alert('Isi form dengan lengkap!');

    const res = await apiFetch('/api/siswa', { method: 'POST', body: JSON.stringify(data) });
    if (!res) return;
    const result = await res.json();
    if (result.sukses) {
        tutupModalHelper(document.getElementById('modal-tambah'));
        showToast('Siswa berhasil ditambahkan!', 'success');
        await muatDataSiswa();
        downloadQRSiswa(data.nis, data.nama_lengkap);
    } else {
        showToast(result.error || 'Gagal menambah data!', 'error');
    }
});

window.bukaModalEditSiswa = (d) => {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('edit-id', d.id); setVal('edit-nis', d.nomor_induk); setVal('edit-nama', d.nama_lengkap);
    setVal('edit-kelas', d.kelas); setVal('edit-status', d.status || 'Aktif');
    bukaModalHelper('modal-edit');
};

klik('btn-update', async () => {
    const data = {
        nis: document.getElementById('edit-nis')?.value,
        nama_lengkap: document.getElementById('edit-nama')?.value,
        kelas: document.getElementById('edit-kelas')?.value,
        nomor_wa_ortu: '',
        status: document.getElementById('edit-status')?.value
    };
    const id = document.getElementById('edit-id')?.value;
    const res = await apiFetch(`/api/siswa/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    if (!res) return;
    tutupModalHelper(document.getElementById('modal-edit'));
    showToast('Data siswa diperbarui!', 'success');
    muatDataSiswa();
});

window.hapusSiswa = async (id) => {
    if (!confirm('Yakin hapus permanen siswa ini?')) return;
    const res = await apiFetch(`/api/siswa/${id}`, { method: 'DELETE' });
    if (!res) return;
    showToast('Siswa berhasil dihapus.', 'success');
    muatDataSiswa();
};

// =====================================
// CRUD GURU
// =====================================
klik('btn-tambah-guru', () => {
    const inNip = document.getElementById('input-nip');
    if (inNip) inNip.value = '';
    const inNamaG = document.getElementById('input-nama-guru');
    if (inNamaG) inNamaG.value = '';
    const inJab = document.getElementById('input-jabatan');
    if (inJab) inJab.value = '';
    bukaModalHelper('modal-tambah-guru');
});

klik('btn-simpan-guru', async () => {
    const data = {
        nip: document.getElementById('input-nip')?.value?.trim(),
        nama_lengkap: document.getElementById('input-nama-guru')?.value?.trim(),
        jabatan: document.getElementById('input-jabatan')?.value?.trim(),
        nomor_wa_ortu: ''
    };
    if (!data.nip || !data.nama_lengkap || !data.jabatan) return alert('Isi form guru dengan lengkap!');
    const res = await apiFetch('/api/guru', { method: 'POST', body: JSON.stringify(data) });
    if (!res) return;
    const result = await res.json();
    if (result.sukses) {
        tutupModalHelper(document.getElementById('modal-tambah-guru'));
        showToast('Guru berhasil ditambahkan!', 'success');
        muatDataGuru();
    } else { showToast(result.error || 'Gagal menambah guru!', 'error'); }
});

window.bukaModalEditGuru = (d) => {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('edit-id-guru', d.id); setVal('edit-nip', d.nomor_induk); setVal('edit-nama-guru', d.nama_lengkap);
    setVal('edit-jabatan', d.kelas); setVal('edit-status-guru', d.status || 'Aktif');
    bukaModalHelper('modal-edit-guru');
};

klik('btn-update-guru', async () => {
    const data = {
        nip: document.getElementById('edit-nip')?.value,
        nama_lengkap: document.getElementById('edit-nama-guru')?.value,
        jabatan: document.getElementById('edit-jabatan')?.value,
        nomor_wa_ortu: '',
        status: document.getElementById('edit-status-guru')?.value
    };
    const id = document.getElementById('edit-id-guru')?.value;
    await apiFetch(`/api/guru/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    tutupModalHelper(document.getElementById('modal-edit-guru'));
    showToast('Data guru diperbarui!', 'success');
    muatDataGuru();
});

window.hapusGuru = async (id) => {
    if (!confirm('Yakin hapus permanen guru ini?')) return;
    await apiFetch(`/api/guru/${id}`, { method: 'DELETE' });
    showToast('Guru berhasil dihapus.', 'success');
    muatDataGuru();
};

// =====================================
// QR CODE DOWNLOAD
// =====================================
window.downloadQRSiswa = (nis, nama) => {
    const tempDiv = document.getElementById('qrcode-temp');
    tempDiv.innerHTML = '';
    new QRCode(tempDiv, { text: nis, width: 512, height: 512 });
    setTimeout(() => {
        const canvas = tempDiv.querySelector('canvas');
        const imgEl = tempDiv.querySelector('img');
        const src = canvas ? canvas.toDataURL('image/png') : imgEl?.src;
        if (!src) return;
        const a = document.createElement('a');
        a.href = src;
        a.download = `QR_Siswa_${nama.replace(/[^a-z0-9]/gi, '_')}.png`;
        a.click();
    }, 100);
};

window.downloadQRGuru = (nip, nama) => {
    const tempDiv = document.getElementById('qrcode-temp');
    tempDiv.innerHTML = '';
    new QRCode(tempDiv, { text: nip, width: 512, height: 512 });
    setTimeout(() => {
        const canvas = tempDiv.querySelector('canvas');
        const imgEl = tempDiv.querySelector('img');
        const src = canvas ? canvas.toDataURL('image/png') : imgEl?.src;
        if (!src) return;
        const a = document.createElement('a');
        a.href = src;
        a.download = `QR_Guru_${nama.replace(/[^a-z0-9]/gi, '_')}.png`;
        a.click();
    }, 100);
};

// =====================================
// EXCEL IMPORT / EXPORT
// =====================================
klik('btn-export', () => { window.location.href = '/api/siswa/export'; });

klik('btn-import', () => { document.getElementById('input-excel')?.click(); });

pantau('input-excel', 'change', async (e) => {
    if (!e.target.files[0]) return;
    const formData = new FormData();
    formData.append('file', e.target.files[0]);
    e.target.value = '';

    const res = await fetch('/api/siswa/import', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin'
    });
    const data = await res.json();
    if (data.sukses) {
        showToast(data.pesan || 'Import sukses!', 'success');
        muatDataSiswa();
    } else {
        showToast(data.error || 'Gagal import!', 'error');
    }
});

// =====================================
// DOWNLOAD ZIP QR KELAS
// =====================================
pantau('btn-download-zip', 'click', async () => {
    const kelasPilih = document.getElementById('filter-kelas')?.value || 'Semua';
    if (kelasPilih === 'Semua') return alert('Silakan filter satu kelas spesifik terlebih dahulu untuk didownload.');

    const siswaAktif = semuaDataSiswa.filter(s => s.kelas === kelasPilih && s.status === 'Aktif');
    if (!siswaAktif.length) return alert('Tidak ada siswa aktif di kelas ini.');

    const btn = document.getElementById('btn-download-zip');
    const teksAsli = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
    btn.disabled = true;

    try {
        // Buat QR base64 di browser, kirim ke server untuk di-ZIP
        const tempDiv = document.getElementById('qrcode-temp');
        const siswaWithQR = [];

        const buatQR = (teks) => new Promise(resolve => {
            tempDiv.innerHTML = '';
            new QRCode(tempDiv, { text: teks, width: 512, height: 512 });
            setTimeout(() => {
                const canvas = tempDiv.querySelector('canvas');
                const imgEl = tempDiv.querySelector('img');
                const src = canvas ? canvas.toDataURL('image/png') : imgEl?.src;
                resolve(src ? src.split(',')[1] : null);
            }, 80);
        });

        for (const siswa of siswaAktif) {
            const base64 = await buatQR(siswa.nomor_induk);
            if (base64) siswaWithQR.push({ ...siswa, base64 });
        }

        const res = await fetch('/api/siswa/qr-zip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ kelas: kelasPilih, siswaList: siswaWithQR })
        });

        if (!res.ok) { alert('Gagal membuat ZIP.'); return; }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `QR_Kelas_${kelasPilih}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`ZIP QR Kelas ${kelasPilih} berhasil diunduh!`, 'success');
    } catch (err) {
        alert('Terjadi kesalahan saat membuat ZIP.');
    } finally {
        btn.innerHTML = teksAsli;
        btn.disabled = false;
    }
});

// =====================================
// LAPORAN
// =====================================
let filterLaporanSaatIni = {};
let dataLaporanSaatIni = [];

function initLaporan() {
    const today = new Date().toISOString().split('T')[0];
    const mulaiEl = document.getElementById('filter-tgl-mulai');
    const akhirEl = document.getElementById('filter-tgl-akhir');
    if (mulaiEl) mulaiEl.value = today;
    if (akhirEl) akhirEl.value = today;
    muatLaporan();
}

async function muatLaporan() {
    const mulai = document.getElementById('filter-tgl-mulai')?.value;
    const akhir = document.getElementById('filter-tgl-akhir')?.value;
    const peran = document.getElementById('filter-peran-lap')?.value || 'Semua';
    const kelas = document.getElementById('filter-kelas-lap')?.value || 'Semua';

    if (!mulai || !akhir) return alert('Pilih rentang tanggal!');
    filterLaporanSaatIni = { mulai, akhir, peran, kelas };

    const res = await apiFetch(`/api/absensi/laporan?mulai=${mulai}&akhir=${akhir}&peran=${peran}&kelas=${encodeURIComponent(kelas)}`);
    if (!res) return;
    const rows = await res.json();
    dataLaporanSaatIni = rows || [];

    const tbody = document.getElementById('tabel-data-laporan');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;">Tidak ada data absensi pada rentang tanggal ini.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(r => {
        const tglArr = r.waktu_scan?.split(' ') || ['-', '-'];
        const badgeStatus = r.jenis_absen === 'Masuk' ? 'status-masuk' : r.jenis_absen === 'Pulang' ? 'status-pulang' : 'status-izin';
        const peranBadge = r.peran === 'Guru' ? 'background:#FFFBEB;color:#D97706;border:1px solid #FDE68A;' : 'background:#EEF2FF;color:#4F46E5;';
        const rowStr = JSON.stringify(r).replace(/"/g, '&quot;');
        return `<tr>
            <td><strong>${escapeHtml(tglArr[0])}</strong> <span style="color:#888;font-size:12px;margin-left:5px;">${escapeHtml(tglArr[1] || '-')}</span></td>
            <td>${escapeHtml(r.nomor_induk)}</td><td>${escapeHtml(r.nama_lengkap)}</td>
            <td><strong>${escapeHtml(r.peran)}</strong></td>
            <td><span style="${peranBadge}padding:4px 10px;border-radius:6px;font-size:12px;font-weight:bold;">${escapeHtml(r.kelas)}</span></td>
            <td><span class="${badgeStatus}" style="padding:4px 10px;border-radius:6px;font-weight:bold;">${escapeHtml(r.jenis_absen)}</span></td>
            <td><span style="font-size:12px;">${escapeHtml(r.keterangan || '-')}</span></td>
            <td style="display:flex;gap:5px;">
                <button class="btn-warning" style="padding:6px 10px;" title="Koreksi Absensi" onclick="bukaModalEditAbsen(${rowStr})"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-delete" style="padding:6px 10px;" title="Hapus Catatan Absensi" onclick="hapusDataAbsen(${r.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}

window.bukaModalEditAbsen = (row) => {
    const idEl = document.getElementById('edit-absen-id');
    if (idEl) idEl.value = row.id;

    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setTxt('edit-absen-nama', row.nama_lengkap);
    setTxt('edit-absen-nomor', row.nomor_induk);
    setTxt('edit-absen-peran', row.peran);
    setTxt('edit-absen-waktu', row.waktu_scan);

    const statusEl = document.getElementById('edit-absen-status');
    if (statusEl) statusEl.value = row.jenis_absen;

    const ketEl = document.getElementById('edit-absen-keterangan');
    if (ketEl) ketEl.value = row.keterangan && row.keterangan !== 'MANUAL' ? row.keterangan : '';

    bukaModalHelper('modal-edit-absen');
};

klik('btn-update-absen', async () => {
    const id = document.getElementById('edit-absen-id')?.value;
    const jenis_absen = document.getElementById('edit-absen-status')?.value;
    const keterangan = document.getElementById('edit-absen-keterangan')?.value || '';

    if (!id || !jenis_absen) return alert('Data tidak lengkap.');

    const res = await apiFetch(`/api/absensi/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ jenis_absen, keterangan })
    });
    if (!res) return;
    const result = await res.json();
    if (result.sukses) {
        showToast('Data absensi berhasil diperbarui!', 'success');
        tutupModalHelper(document.getElementById('modal-edit-absen'));
        muatLaporan();
        muatStatistikDashboard();
    } else {
        showToast(result.error || 'Gagal memperbarui absensi!', 'error');
    }
});

window.hapusDataAbsen = async (id) => {
    if (!id) return;
    if (!confirm('Yakin ingin menghapus catatan absensi ini? Data yang dihapus tidak dapat dipulihkan.')) return;

    const res = await apiFetch(`/api/absensi/${id}`, { method: 'DELETE' });
    if (!res) return;
    const result = await res.json();
    if (result.sukses) {
        showToast('Catatan absensi berhasil dihapus.', 'success');
        muatLaporan();
        muatStatistikDashboard();
    } else {
        showToast(result.error || 'Gagal menghapus data absensi!', 'error');
    }
};

klik('btn-cari-laporan', muatLaporan);

klik('btn-export-laporan', () => {
    const { mulai, akhir, peran = 'Semua', kelas = 'Semua' } = filterLaporanSaatIni;
    if (!mulai || !akhir) return showToast('Pilih rentang tanggal terlebih dahulu!', 'error');
    if (!dataLaporanSaatIni || dataLaporanSaatIni.length === 0) {
        return showToast('Data laporan kosong untuk rentang tanggal ini. Tidak ada file yang dapat diekspor.', 'error');
    }
    window.location.href = `/api/absensi/export-excel?mulai=${mulai}&akhir=${akhir}&peran=${peran}&kelas=${encodeURIComponent(kelas)}`;
});

// =====================================
// PENGATURAN
// =====================================
function initPengaturan() {
    muatAkunAdmin();
    muatAppConfig();
    initSettingsTabs();
}

function initSettingsTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.settings-tab-content').forEach(t => t.style.display = 'none');
            btn.classList.add('active');
            const target = document.getElementById(btn.dataset.tab);
            if (target) target.style.display = 'block';
        };
    });
}

const togglePasswordVisibility = (toggleId, inputId) => {
    const toggleEl = document.getElementById(toggleId);
    const inputEl = document.getElementById(inputId);
    if (toggleEl && inputEl) {
        toggleEl.addEventListener('click', () => {
            const isPassword = inputEl.type === 'password';
            inputEl.type = isPassword ? 'text' : 'password';
            toggleEl.className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
            toggleEl.style.cssText = 'position:absolute;right:14px;top:50%;transform:translateY(-50%);cursor:pointer;color:#aaa;';
        });
    }
};
togglePasswordVisibility('toggle-pw-baru', 'set-password-baru');
togglePasswordVisibility('toggle-pw-konfirm', 'set-password-konfirm');

async function muatAkunAdmin() {
    const res = await apiFetch('/api/pengaturan/admin-akun');
    if (!res) return;
    const row = await res.json();
    const el = document.getElementById('set-username-lama');
    if (el && row) el.value = row.username;
}

let configAppCache = {};

async function muatAppConfig() {
    const res = await apiFetch('/api/pengaturan/config');
    if (!res) return;
    const cfg = await res.json();
    configAppCache = cfg;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('set-nama-sekolah', cfg.namaSekolah);
    setVal('set-jam-batas-masuk', cfg.jamBatasMasuk);
    setVal('set-jam-pulang', cfg.jamPulangMulai);

    // Hari Operasional checkboxes
    const hariOp = Array.isArray(cfg.hariOperasional) ? cfg.hariOperasional : [1, 2, 3, 4, 5, 6];
    [0, 1, 2, 3, 4, 5, 6].forEach(h => {
        const chk = document.getElementById(`hari-${h}`);
        if (chk) chk.checked = hariOp.includes(h);
    });

    // Render tabel hari libur
    renderTabelHariLibur(cfg.hariLiburKhusus || []);

    // Muat riwayat backup
    muatRiwayatBackup();

    // Cek apakah ada logo
    const logoRes = await fetch('/api/pengaturan/logo');
    if (logoRes.ok) {
        const logoUrl = '/api/pengaturan/logo?t=' + Date.now();
        tampilkanLogo(logoUrl);
        updateSidebarLogo(logoUrl);
    }
}

function renderTabelHariLibur(liburList) {
    const tbody = document.getElementById('tabel-hari-libur');
    if (!tbody) return;
    if (!liburList || liburList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#888;">Belum ada hari libur khusus yang ditambahkan.</td></tr>';
        return;
    }
    tbody.innerHTML = liburList.map((item, index) => `
        <tr>
            <td><strong>${escapeHtml(item.tanggal)}</strong></td>
            <td>${escapeHtml(item.keterangan || '-')}</td>
            <td>
                <button class="btn-delete" style="padding:6px 12px; font-size:12px;" onclick="hapusHariLibur(${index})">
                    <i class="fa-solid fa-trash"></i> Hapus
                </button>
            </td>
        </tr>
    `).join('');
}

window.hapusHariLibur = async (index) => {
    const liburList = (configAppCache.hariLiburKhusus || []).slice();
    liburList.splice(index, 1);
    const res = await apiFetch('/api/pengaturan/config', {
        method: 'POST',
        body: JSON.stringify({ hariLiburKhusus: liburList })
    });
    if (!res) return;
    configAppCache.hariLiburKhusus = liburList;
    renderTabelHariLibur(liburList);
    showToast('Hari libur berhasil dihapus.', 'success');
};

klik('btn-tambah-libur', async () => {
    const tgl = document.getElementById('input-tgl-libur')?.value;
    const ket = document.getElementById('input-ket-libur')?.value?.trim();
    if (!tgl || !ket) return showToast('Pilih tanggal dan isi keterangan libur!', 'error');

    const liburList = (configAppCache.hariLiburKhusus || []).slice();
    if (liburList.some(l => l.tanggal === tgl)) {
        return showToast('Tanggal ini sudah ada di daftar libur!', 'error');
    }
    liburList.push({ tanggal: tgl, keterangan: ket });
    liburList.sort((a, b) => a.tanggal.localeCompare(b.tanggal));

    const res = await apiFetch('/api/pengaturan/config', {
        method: 'POST',
        body: JSON.stringify({ hariLiburKhusus: liburList })
    });
    if (!res) return;
    configAppCache.hariLiburKhusus = liburList;
    renderTabelHariLibur(liburList);
    document.getElementById('input-tgl-libur').value = '';
    document.getElementById('input-ket-libur').value = '';
    showToast('Hari libur baru berhasil ditambahkan!', 'success');
});

klik('btn-simpan-hari-op', async () => {
    const hariOp = [];
    [0, 1, 2, 3, 4, 5, 6].forEach(h => {
        const chk = document.getElementById(`hari-${h}`);
        if (chk && chk.checked) hariOp.push(h);
    });
    if (hariOp.length === 0) return showToast('Pilih minimal satu hari kegiatan operasional!', 'error');

    const res = await apiFetch('/api/pengaturan/config', {
        method: 'POST',
        body: JSON.stringify({ hariOperasional: hariOp })
    });
    if (!res) return;
    showToast('Hari operasional sekolah berhasil disimpan!', 'success');
});

// BACKUP & RESTORE & CLEANUP
klik('btn-download-db', () => {
    window.location.href = '/api/pengaturan/backup/download';
});

klik('btn-buat-backup-snapshot', async () => {
    const res = await apiFetch('/api/pengaturan/backup/create', { method: 'POST' });
    if (!res) return;
    const data = await res.json();
    if (data.sukses) {
        showToast(`Snapshot backup berhasil dibuat: ${data.file} (${data.ukuranKB} KB)`, 'success');
        muatRiwayatBackup();
    } else {
        showToast(data.error || 'Gagal membuat snapshot backup.', 'error');
    }
});

async function muatRiwayatBackup() {
    const tbody = document.getElementById('tabel-riwayat-backup');
    if (!tbody) return;
    try {
        const res = await apiFetch('/api/pengaturan/backup/list');
        if (!res) return;
        const data = await res.json();
        const list = data.list || [];
        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#888;">Belum ada riwayat backup lokal.</td></tr>';
            return;
        }
        tbody.innerHTML = list.slice(0, 10).map(b => `
            <tr>
                <td><strong>${b.nama}</strong></td>
                <td>${b.ukuranKB} KB</td>
                <td>${new Date(b.waktu).toLocaleString('id-ID')}</td>
            </tr>
        `).join('');
    } catch (_) {}
}

klik('btn-jalankan-cleanup', async () => {
    if (!confirm('Yakin ingin membersihkan log dan file sisa lama sekarang?')) return;
    const res = await apiFetch('/api/pengaturan/cleanup', { method: 'POST' });
    if (!res) return;
    const data = await res.json();
    if (data.sukses) {
        showToast(data.pesan || 'Pembersihan log dan sisa file selesai!', 'success');
    } else {
        showToast(data.error || 'Gagal menjalankan pembersihan.', 'error');
    }
});

klik('btn-simpan-akun', async () => {
    const uBaru = document.getElementById('set-username-baru')?.value.trim();
    const pw1 = document.getElementById('set-password-baru')?.value;
    const pw2 = document.getElementById('set-password-konfirm')?.value;
    const uLama = document.getElementById('set-username-lama')?.value;
    const username = uBaru || uLama;
    if (!username) return showToast('Username tidak boleh kosong!', 'error');
    if (pw1 && pw1 !== pw2) return showToast('Konfirmasi password tidak cocok!', 'error');
    const password = pw1 || '*KEEP*';
    const res = await apiFetch('/api/pengaturan/admin-akun', { method: 'POST', body: JSON.stringify({ username, password }) });
    if (!res) return;
    const data = await res.json();
    if (data.sukses) {
        showToast('Akun berhasil diperbarui! Silakan login ulang jika mengubah password.', 'success');
        document.getElementById('set-password-baru').value = '';
        document.getElementById('set-password-konfirm').value = '';
        muatAkunAdmin();
    } else { showToast('Gagal menyimpan akun!', 'error'); }
});

klik('btn-simpan-profil', async () => {
    const nama = document.getElementById('set-nama-sekolah')?.value.trim();
    if (!nama) return showToast('Nama sekolah tidak boleh kosong!', 'error');
    const res = await apiFetch('/api/pengaturan/config', { method: 'POST', body: JSON.stringify({ namaSekolah: nama }) });
    if (!res) return;
    showToast('Profil sekolah berhasil disimpan!', 'success');
    const brandEl = document.querySelector('.brand');
    if (brandEl) { const textNode = [...brandEl.childNodes].find(n => n.nodeType === 3); if (textNode) textNode.textContent = ` ${nama}`; }
});

klik('btn-simpan-absensi', async () => {
    const jamMasuk = document.getElementById('set-jam-batas-masuk')?.value;
    const jamPulang = document.getElementById('set-jam-pulang')?.value;
    if (!jamMasuk || !jamPulang) return showToast('Lengkapi jam batas masuk dan jam pulang!', 'error');
    await apiFetch('/api/pengaturan/config', { method: 'POST', body: JSON.stringify({ jamBatasMasuk: jamMasuk, jamPulangMulai: jamPulang }) });
    showToast('Pengaturan waktu absensi berhasil disimpan!', 'success');
});

// Logo upload
pantau('input-logo', 'change', async (e) => {
    if (!e.target.files[0]) return;
    const formData = new FormData();
    formData.append('logo', e.target.files[0]);
    const res = await fetch('/api/pengaturan/logo', { method: 'POST', body: formData, credentials: 'same-origin' });
    const data = await res.json();
    if (data.sukses) {
        const logoUrl = '/api/pengaturan/logo?t=' + Date.now();
        tampilkanLogo(logoUrl);
        updateSidebarLogo(logoUrl);
        showToast('Logo berhasil diunggah!', 'success');
    } else { showToast(data.error || 'Gagal upload logo!', 'error'); }
    e.target.value = '';
});

klik('btn-hapus-logo', async () => {
    if (!confirm('Yakin ingin menghapus logo sekolah?')) return;
    await apiFetch('/api/pengaturan/logo', { method: 'DELETE' });
    tampilkanLogo('');
    updateSidebarLogo('');
    showToast('Logo berhasil dihapus.', 'success');
});

function tampilkanLogo(logoUrl) {
    const img = document.getElementById('logo-preview');
    const icon = document.getElementById('logo-placeholder-icon');
    if (!img) return;
    if (logoUrl) {
        img.src = logoUrl; img.style.display = 'block';
        if (icon) icon.style.display = 'none';
    } else {
        img.src = ''; img.style.display = 'none';
        if (icon) icon.style.display = 'block';
    }
}

function updateSidebarLogo(logoUrl) {
    const brand = document.querySelector('.brand');
    if (!brand) return;
    let existingLogo = brand.querySelector('.brand-logo');
    const iconEl = brand.querySelector('i');
    if (logoUrl) {
        if (!existingLogo) { existingLogo = document.createElement('img'); existingLogo.className = 'brand-logo'; brand.insertBefore(existingLogo, brand.firstChild); }
        existingLogo.src = logoUrl;
        if (iconEl) iconEl.style.display = 'none';
    } else {
        if (existingLogo) existingLogo.remove();
        if (iconEl) iconEl.style.display = '';
    }
}

// =====================================
// KELOLA USER (ADMIN ONLY)
// =====================================
let allUsersData = [];

async function muatDataUsers() {
    try {
        const res = await apiFetch('/api/auth/users');
        if (!res) return;
        const result = await res.json();
        if (result.sukses) {
            allUsersData = result.data || [];
            renderTabelUsers();
            updatePendingBadge();
        }
    } catch (e) {
        console.error('Gagal memuat data user:', e);
    }
}

function updatePendingBadge() {
    const pendingCount = allUsersData.filter(u => u.status === 'pending').length;
    const badge = document.getElementById('badge-pending-users');
    if (badge) {
        if (pendingCount > 0) {
            badge.textContent = pendingCount;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

function renderTabelUsers() {
    const tbody = document.getElementById('tabel-data-users');
    if (!tbody) return;

    const filterRole = document.getElementById('filter-role-user')?.value || 'Semua';
    const filterStatus = document.getElementById('filter-status-user')?.value || 'Semua';

    let filtered = allUsersData.filter(u => {
        if (filterRole !== 'Semua' && u.role !== filterRole) return false;
        if (filterStatus !== 'Semua' && u.status !== filterStatus) return false;
        return true;
    });

    const summaryEl = document.getElementById('summary-users');
    if (summaryEl) summaryEl.textContent = `Total: ${filtered.length} User`;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888;">Tidak ada data user.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(u => {
        let statusBadge = '';
        if (u.status === 'pending') {
            statusBadge = '<span class="badge" style="background:#F59E0B; color:white; padding:4px 8px; border-radius:6px; font-size:12px;">Pending</span>';
        } else if (u.status === 'approved') {
            statusBadge = '<span class="badge" style="background:#10B981; color:white; padding:4px 8px; border-radius:6px; font-size:12px;">Aktif (Approved)</span>';
        } else if (u.status === 'rejected') {
            statusBadge = '<span class="badge" style="background:#EF4444; color:white; padding:4px 8px; border-radius:6px; font-size:12px;">Ditolak</span>';
        }

        let roleBadge = u.role === 'admin'
            ? '<span style="color:#4F46E5; font-weight:600;"><i class="fa-solid fa-user-shield"></i> Admin</span>'
            : '<span style="color:#059669; font-weight:600;"><i class="fa-solid fa-chalkboard-user"></i> Guru</span>';

        let tglDaftar = u.created_at ? new Date(u.created_at).toLocaleString('id-ID') : '-';
        let rawProfil = u.nama_guru ? u.nama_guru : (u.guru_id ? `ID: ${u.guru_id}` : '-');
        let profilGuru = escapeHtml(rawProfil);
        let safeUsername = escapeHtml(u.username);
        let safeNamaLengkap = escapeHtml(u.nama_lengkap);
        let jsonUserStr = JSON.stringify(u.username || '').replace(/"/g, '&quot;');

        let aksi = '';
        if (u.role !== 'admin') {
            const btnSetujui = `<button style="background:#10B981; color:white; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:5px;" onclick="ubahStatusUser(${u.id}, 'approved')"><i class="fa-solid fa-check"></i> Setujui</button>`;
            const btnNonaktif = `<button style="background:#F59E0B; color:white; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:5px;" onclick="ubahStatusUser(${u.id}, 'rejected')"><i class="fa-solid fa-ban"></i> Nonaktifkan</button>`;
            const btnResetPw = `<button style="background:#4F46E5; color:white; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:5px;" onclick="bukaModalResetPw(${u.id}, ${jsonUserStr})"><i class="fa-solid fa-key"></i> Reset PW</button>`;
            const btnHapus = `<button style="background:#EF4444; color:white; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:5px;" onclick="hapusUser(${u.id}, ${jsonUserStr})"><i class="fa-solid fa-trash"></i> Hapus</button>`;

            if (u.status === 'pending') {
                aksi = `<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">${btnSetujui} ${btnNonaktif} ${btnHapus}</div>`;
            } else if (u.status === 'approved') {
                aksi = `<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">${btnNonaktif} ${btnResetPw} ${btnHapus}</div>`;
            } else if (u.status === 'rejected') {
                aksi = `<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">${btnSetujui} ${btnHapus}</div>`;
            }
        } else {
            aksi = '<small style="color:#888;">Super Admin</small>';
        }

        return `
            <tr>
                <td><strong>${safeUsername}</strong></td>
                <td>${safeNamaLengkap}</td>
                <td>${profilGuru}</td>
                <td>${roleBadge}</td>
                <td>${statusBadge}</td>
                <td>${escapeHtml(tglDaftar)}</td>
                <td>${aksi}</td>
            </tr>
        `;
    }).join('');
}

async function ubahStatusUser(userId, status) {
    const statusLabel = status === 'approved' ? 'menyetujui' : (status === 'rejected' ? 'menolak/menonaktifkan' : status);
    if (!confirm(`Yakin ingin ${statusLabel} akun ini?`)) return;

    try {
        const res = await apiFetch(`/api/auth/users/${userId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
        if (!res) return;
        const data = await res.json();
        if (data.sukses) {
            showToast(data.pesan, 'success');
            muatDataUsers();
        } else {
            showToast(data.pesan || 'Gagal mengubah status.', 'error');
        }
    } catch (e) {
        showToast('Kesalahan koneksi.', 'error');
    }
}

async function hapusUser(userId, username) {
    if (!confirm(`Apakah Anda yakin ingin menghapus akun "${username}" secara permanen? Akun yang dihapus tidak dapat dipulihkan.`)) return;

    try {
        const res = await apiFetch(`/api/auth/users/${userId}`, {
            method: 'DELETE'
        });
        if (!res) return;
        const data = await res.json();
        if (data.sukses) {
            showToast(data.pesan, 'success');
            muatDataUsers();
        } else {
            showToast(data.pesan || 'Gagal menghapus user.', 'error');
        }
    } catch (e) {
        showToast('Kesalahan koneksi.', 'error');
    }
}

function bukaModalResetPw(userId, username) {
    document.getElementById('reset-user-id').value = userId;
    document.getElementById('reset-user-name').textContent = username;
    document.getElementById('reset-user-pw').value = '';
    bukaModalHelper('modal-reset-password-user');
}

klik('btn-submit-reset-pw', async () => {
    const userId = document.getElementById('reset-user-id').value;
    const newPassword = document.getElementById('reset-user-pw').value;
    if (!newPassword || newPassword.length < 6) {
        return showToast('Password baru minimal 6 karakter!', 'error');
    }

    try {
        const res = await apiFetch(`/api/auth/users/${userId}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ newPassword })
        });
        if (!res) return;
        const data = await res.json();
        if (data.sukses) {
            showToast(data.pesan, 'success');
            tutupModalHelper(document.getElementById('modal-reset-password-user'));
        } else {
            showToast(data.pesan || 'Gagal reset password.', 'error');
        }
    } catch (e) {
        showToast('Kesalahan koneksi.', 'error');
    }
});

pantau('filter-role-user', 'change', renderTabelUsers);
pantau('filter-status-user', 'change', renderTabelUsers);

// =====================================
// INIT SAAT LOAD
// =====================================
window.addEventListener('DOMContentLoaded', () => {
    muatInfoSekolahAdmin();
    muatStatistikDashboard();
    // Muat data siswa di background untuk autocomplete absen manual
    muatDataSiswa();
    // Muat data users di background untuk pending badge
    muatDataUsers();
});
