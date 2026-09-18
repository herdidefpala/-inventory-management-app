# Inventory Management Stock — Prototipe UI/UX

Prototipe antarmuka lengkap untuk sistem manajemen inventory (stock masuk,
keluar, transfer, dan stock opname) yang sedang dibangun bertahap sesuai PRD,
dengan tema warna mengikuti referensi dashboard Finary (hijau-teal, kartu
putih, pill badge). Saat ini berjalan penuh di browser dengan **localStorage**
sebagai pengganti sementara Supabase, sehingga semua alur bisa diklik dan
diuji dulu sebelum backend disambungkan.

## Isi proyek

```
index.html          → shell aplikasi: layar login + seluruh halaman app
css/styles.css       → design system (warna, tipografi, komponen, responsif)
js/data.js           → data contoh (lihat "Tentang data contoh" di bawah)
js/app.js            → seluruh logic: auth, navigasi, dashboard, form SO,
                        rekap, master data, audit log, pengaturan
netlify.toml          → konfigurasi deploy Netlify (static, tanpa build step)
.env.example          → placeholder variabel Supabase untuk fase berikutnya
```

Tidak ada proses build — murni HTML/CSS/JS, jadi bisa langsung di-deploy.

## Menjalankan secara lokal

Buka `index.html` langsung di browser, atau jalankan server statis sederhana
dari folder ini agar path relatif (css/js) selalu konsisten:

```bash
npx serve .
# atau
python3 -m http.server 8080
```

Di layar login, pilih chip **"Coba sebagai Admin"** atau **"Coba sebagai
Operator"** untuk melihat kedua tampilan role (menu Master Data/Audit
Log/Pengaturan otomatis disembunyikan untuk Operator).

## Deploy ke Netlify

**Cara tercepat (drag & drop):**
1. Buka [app.netlify.com/drop](https://app.netlify.com/drop)
2. Seret seluruh folder `stock-opname-app` ke halaman tersebut

**Cara via Git (direkomendasikan untuk update berkelanjutan):**
1. Push folder ini ke repo GitHub/GitLab
2. Di Netlify: **Add new site → Import an existing project**
3. Build command: kosongkan. Publish directory: `.`
4. Deploy

## Tentang data contoh

SKU, nama produk, dan kode lokasi diambil dari `master_data.xlsx` yang Anda
unggah (gudang aksesoris elektronik/kabel — terlihat dari nama produk seperti
Vention, HDMI, dsb). Sekitar 90 SKU dan 100+ lokasi asli dipetakan ke skema
tabel PRD.

Yang **asli** dari file Anda: kode SKU, nama produk, kode lokasi (pola
`L1-rak-level-bin`).

Yang **simulasi** (dibuat untuk mengisi prototipe, bukan dari file Anda):
kategori produk (ditebak dari kata kunci di nama produk), pembagian gudang
(Utama/Rusak/Returan), jenis lokasi (Picking/Simpan/After Pick/Returan),
daftar staff, seluruh riwayat transaksi stock opname, dan isi audit log.

Saat integrasi Supabase, `master_data.xlsx` yang sesungguhnya perlu diproses
ulang dengan aturan mapping yang lebih ketat (lihat §18 PRD — banyak baris
tanpa kode lokasi valid perlu masuk ke antrian exception, bukan dipaksa jadi
lokasi).

## Fitur yang sudah berfungsi penuh (bukan sekadar tampilan)

- Login/registrasi (mock, langsung masuk) dengan 2 role berbeda
- Dashboard: KPI, hero progress, 7 chart (Chart.js), tabel "Perlu Perhatian" —
  semua dihitung real-time dari data di localStorage, plus filter periode/
  gudang/operator/jenis lokasi
- Input Stock Opname: pencarian lokasi & SKU, auto-lookup Qty System,
  hitung selisih & status otomatis, catatan wajib saat ada selisih, mode
  "Simpan & Input Berikutnya" yang mempertahankan lokasi terpilih
- Rekap SO: filter lengkap, ringkasan akurasi, tabel + pagination, export
  CSV (kompatibel Excel) yang benar-benar mengunduh file, dan export PDF
  via print-preview browser
- Master Data (Barang/Lokasi/Staff): tambah/ubah/hapus/nonaktifkan, plus
  wizard import 3 langkah (unduh template → pratinjau → konfirmasi)
- Audit Log: baca-saja, tidak ada tombol hapus di mana pun (sesuai PRD)
- Pengaturan: identitas perusahaan, matriks hak akses per role, reset data
  bertahap dengan konfirmasi ganda (harus ketik "RESET")

## Rencana integrasi Supabase (fase berikutnya)

Setiap titik di `js/app.js` yang perlu diganti ke pemanggilan Supabase sudah
ditandai komentar `// SUPABASE:`. Urutan migrasi yang disarankan mengikuti
roadmap PRD:

1. **Auth** — ganti `signInAs()`/`logout()` dengan
   `supabase.auth.signInWithPassword` / `signUp` / `signOut`
2. **Skema tabel** — buat tabel `warehouses`, `skus`, `locations`, `staff`,
   `stock_balances`, `stock_opname_items`, `audit_logs`, `settings` mengikuti
   bentuk objek di `js/data.js` (field sudah dinamai selaras)
3. **Baca data** — ganti `loadState()` dengan query Supabase saat halaman
   dimuat (bisa pakai Supabase JS client langsung dari halaman statis ini,
   tidak wajib migrasi ke React/Vite kecuali ingin build step)
4. **Tulis data** — ganti setiap `saveState()` + mutasi array dengan
   `supabase.from(...).insert/update/delete`, aktifkan Row Level Security
   sesuai matriks di halaman Pengaturan
5. **Audit log** — buat sebagai tabel append-only (policy tanpa `DELETE`)
   agar aturan "tidak bisa dihapus dari UI" berlaku juga di level database
6. **Import wizard** — sambungkan ke parser XLSX sungguhan (mis. SheetJS)
   dan validasi baris sesuai §18 PRD, gantikan pool data simulasi saat ini

---
Dibuat mengikuti PRD yang diunggah — lihat komentar `// SUPABASE:` di
`js/app.js` sebagai peta migrasi.
