## 8. Permanent Redirect (301) untuk Perubahan Slug

Implementasikan mekanisme permanent redirect agar permalink lama tetap dapat diakses ketika slug halaman Published diubah.

Tujuan: menjaga SEO, mempertahankan backlink, dan mencegah pengunjung mendapatkan halaman 404 setelah perubahan permalink.

### A. Deteksi Perubahan Slug

Ketika pengguna mengubah slug halaman:

1. Backend harus membandingkan slug lama dengan slug baru.
2. Jika slug tidak berubah, jangan membuat redirect baru.
3. Jika slug berubah dan halaman sudah pernah Published, simpan permalink lama sebagai sumber redirect permanen.
4. Permalink baru menjadi URL utama halaman.
5. Jika halaman masih Draft dan belum pernah dipublikasikan, tidak perlu membuat redirect dari slug sebelumnya.

Contoh:

Sebelum perubahan:

- Judul: About Us
- Slug: `about-us`
- URL: `https://domain.com/about-us`

Setelah slug diubah:

- Judul: About Our Company
- Slug: `about-our-company`
- URL baru: `https://domain.com/about-our-company`

Request ke URL lama:

`https://domain.com/about-us`

Harus menghasilkan:

`HTTP 301 Moved Permanently`

Dengan header `Location` yang mengarah ke:

`https://domain.com/about-our-company`

### B. Penyimpanan Riwayat Permalink

Buat mekanisme penyimpanan redirect yang terintegrasi dengan modul Pages.

Gunakan tabel atau struktur data redirect sesuai pola database project.

Minimal data yang diperlukan:

- `id`
- `page_id` — referensi halaman tujuan
- `old_slug` — slug lama
- `created_at`

Ketentuan:

- Slug lama harus tetap unik di antara seluruh permalink dan redirect aktif.
- Jangan menghapus riwayat redirect ketika halaman diedit.
- Jika slug halaman berubah beberapa kali, seluruh permalink lama harus mengarah ke permalink terbaru.

Contoh perubahan:

`/about-us` → `/about-our-company` → `/about-qhomemart`

Hasil yang diharapkan:

- `/about-us` → 301 ke `/about-qhomemart`
- `/about-our-company` → 301 ke `/about-qhomemart`
- `/about-qhomemart` → 200

Hindari redirect berantai. Semua permalink lama harus langsung menuju URL canonical terbaru.

### C. Penanganan Request Redirect

Implementasikan redirect di server-side routing atau middleware SSR yang sudah digunakan project.

Urutan pemeriksaan request:

1. Cari halaman Published berdasarkan slug yang diminta.
2. Jika ditemukan, tampilkan halaman dengan status HTTP 200.
3. Jika halaman tidak ditemukan, cari slug tersebut di tabel redirect.
4. Jika ditemukan redirect aktif, kembalikan HTTP 301 dengan header `Location` menuju permalink terbaru.
5. Jika tidak ditemukan halaman maupun redirect, kembalikan HTTP 404.

Redirect harus benar-benar menghasilkan HTTP status 301, bukan hanya mengubah URL melalui JavaScript, `window.location`, atau menampilkan halaman pemberitahuan.

Pastikan redirect bekerja ketika URL lama dibuka secara langsung, melalui browser, crawler, maupun request HTTP.

### D. Integrasi AJAX dan Dashboard

Ketika pengguna mengubah slug halaman melalui dashboard:

1. Kirim perubahan menggunakan AJAX.
2. Backend melakukan validasi slug dan menyimpan perubahan.
3. Backend membuat atau memperbarui redirect lama dalam transaksi database yang konsisten dengan perubahan slug.
4. Setelah operasi berhasil, frontend memperbarui permalink baru tanpa full page reload.
5. Tampilkan notifikasi bahwa permalink telah berubah dan URL lama akan diarahkan ke URL baru.

Jika perubahan slug gagal disimpan, jangan membuat redirect baru.

Jika perubahan slug berhasil tetapi pembuatan redirect gagal, batalkan seluruh transaksi agar data halaman dan redirect tetap konsisten.

### E. Validasi dan Pencegahan Redirect Loop

- Jangan mengizinkan redirect menuju slug yang sama.
- Jangan membuat redirect yang menunjuk kembali ke permalink lama.
- Jangan mengizinkan slug baru menggunakan slug yang masih terdaftar sebagai sumber redirect aktif, kecuali sistem dapat memperbarui redirect secara aman tanpa membuat konflik.
- Pastikan slug redirect tidak bertabrakan dengan halaman Published lain.
- Jika sebuah halaman dihapus, jangan biarkan redirect aktif mengarah ke halaman yang sudah tidak tersedia.
- Jika target redirect tidak lagi Published, redirect harus dinonaktifkan atau diarahkan sesuai kebijakan halaman yang dihapus.

### F. Pengujian

Tambahkan test untuk skenario berikut:

1. Mengubah slug halaman Published menghasilkan redirect HTTP 301 dari slug lama ke slug baru.
2. Halaman dengan slug baru tetap menghasilkan HTTP 200.
3. Mengubah slug beberapa kali membuat seluruh permalink lama langsung mengarah ke permalink terbaru.
4. Slug yang tidak dikenal menghasilkan HTTP 404.
5. Mengubah slug Draft tidak membuat redirect yang tidak diperlukan.
6. Redirect tidak mengalami loop atau rantai redirect.
7. Konflik slug dan kegagalan penyimpanan tidak menghasilkan redirect yang rusak.
8. Redirect tetap berfungsi setelah server restart.
9. Perubahan slug melalui AJAX tidak memerlukan reload dashboard.

Jangan mengklaim redirect SEO berhasil hanya karena URL berubah di browser. Pastikan status HTTP 301 dan header `Location` benar-benar diuji melalui request HTTP.

Catatan teknis: redirect 301 dilakukan pada layer server/router SSR, bukan di JavaScript frontend. Ini memastikan Googlebot dan crawler lainnya menerima status permanen yang sebenarnya, serta permalink lama tetap berfungsi meskipun pengguna tidak menjalankan JavaScript.
