# Testing Checklist — Inventory Seven Retail

**Uji di 2 device (laptop + HP), login akun yang sama.** Setelah aksi di satu device, **refresh/login ulang** di device satunya sebelum cek datanya muncul — realtime belum ada.

---

## 0. Persiapan

- [ ] Buka aplikasi di laptop & HP, login akun yang sama di keduanya
- [ ] Buka Console (F12 → tab Console) di laptop untuk pantau error selama testing

---

## 1. Dashboard & Tampilan Umum

- [ ] Dashboard terbuka tanpa error merah di console
- [ ] Chart di Dashboard Utama tampil normal (tren masuk/keluar, kategori, dst)
- [ ] Badge "Tersambung Supabase" & judul halaman besar sudah tidak ada di atas
- [ ] Sidebar sudah tidak ada kartu "Mulai Hitung Fisik"

---

## 2. Master Data

**Ulangi 6 langkah ini untuk: Gudang, SKU/Barang, Lokasi, Supplier, Customer, Staff.**

- [ ] Tambah data baru di Device A → toast hijau muncul
- [ ] Refresh/login ulang Device B → data baru dari A ikut muncul
- [ ] Edit data yang sudah ada di Device B → toast hijau, refresh A → berubah
- [ ] Nonaktifkan (toggle status) satu data → tetap nonaktif setelah refresh
- [ ] Hapus satu data uji coba → hilang di kedua device setelah refresh
- [ ] Khusus Staff: tambah staff baru → toast "belum bisa login" muncul, data tetap ada setelah refresh (tidak hilang lagi)

---

## 3. Transaksi

**Ulangi untuk: Input SO, Barang Masuk, Barang Keluar, Transfer Antar Gudang, Transfer Antar Lokasi.**

- [ ] Input satu transaksi di Device A → toast hijau
- [ ] Refresh Device B → transaksi baru muncul di "Input Hari Ini" / Rekap
- [ ] Cek Stock Gudang → Qty berubah sesuai
- [ ] Khusus Input SO dengan selisih: Catatan wajib terisi, hasil pengaruhi Qty Stock
- [ ] Khusus Barang Keluar: coba keluarkan melebihi stok tersedia → harus ditolak, pesan jelas
- [ ] Khusus Transfer (Gudang & Lokasi): stok lokasi asal berkurang, lokasi tujuan bertambah, sama di kedua device

---

## 4. Pengaturan & Hak Akses

- [ ] Ubah Info Perusahaan / Preferensi Sistem di satu device → refresh device lain → ikut berubah
- [ ] Centang/hilangkan satu Hak Akses → refresh → **cek apakah tetap tersimpan** ⚠️
- [ ] Kalau soal di atas balik ke posisi semula setelah refresh → laporkan modul+role-nya (baris itu belum ke-seed di Supabase)

---

## 5. Import Massal

**Ulangi untuk: Master Barang, Master Lokasi, Barang Masuk Massal, Barang Keluar Massal.**

- [ ] Unduh template, isi 2-3 baris data valid, unggah → pratinjau menampilkan data ASLI dari file (bukan data contoh)
- [ ] Sengaja isi 1 baris salah (kode kosong / sudah ada / referensi tidak ditemukan) → baris itu ditolak dengan pesan jelas, sisanya tetap bisa diimport
- [ ] Konfirmasi import → toast hijau, data masuk ke tabel terkait
- [ ] Refresh device lain → data hasil import ikut muncul
- [ ] Khusus Barang Keluar Massal: baris dengan qty melebihi stok harus ditolak otomatis

---

## 6. Laporan (belum sempat dites langsung, seharusnya otomatis benar)

- [ ] Rekap SO — data & filter tampil normal
- [ ] Laporan Stock — angka masuk akal, sesuai transaksi yang sudah diinput
- [ ] Audit Log — semua aksi di atas tercatat rapi

---

## 7. Uji Kondisi Gagal

- [ ] Matikan koneksi internet sebentar, coba submit sesuatu → toast merah muncul, form **tidak** tertutup, data lokal tidak berubah

---

## Notes

- ⚠️ **Soal Hak Akses**: Kalau centang tidak tersimpan setelah refresh → kemungkinan baris modul+role itu belum ada di tabel `permissions` Supabase. Laporkan modul & role-nya.
