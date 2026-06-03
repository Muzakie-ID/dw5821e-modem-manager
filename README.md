# Dell DW5821e Modem Manager

Aplikasi desktop premium berbasis **Electron** untuk mengelola dan memantau modem rakitan **Dell DW5821e** (Qualcomm Snapdragon X20 LTE / Fibocom L860-GL) secara langsung dari PC Windows Anda melalui antarmuka Serial (COM Port).

---

## 🌟 Fitur Utama

- **Dashboard Real-Time**: Visualisasi kekuatan sinyal (gauge meter & chart) beserta informasi operator, tipe jaringan, IMEI, IMSI, status SIM card, dan registrasi jaringan.
- **Connection Manager**: Deteksi otomatis (auto-select) port COM modem (Dell/Fibocom) dengan opsi pemilihan baud rate manual.
- **AT Command Terminal**: Terminal interaktif terintegrasi dilengkapi riwayat perintah (history), respon ber-syntax-highlighting, dan tombol pintasan (quick command presets).
- **Network Settings**: Pengaturan APN, pemindaian operator seluler (manual/otomatis), pembacaan pita frekuensi (bands), serta opsi menyalakan/mematikan pemancar radio (`AT+CFUN`).
- **Signal Monitor**: Grafik pemantauan sinyal real-time yang diperbarui secara periodik.

---

## 🛠️ Tech Stack

- **Framework**: Electron
- **Backend**: Node.js & `serialport`
- **Frontend**: HTML5, Vanilla CSS (Premium Dark Theme & Glassmorphism), JavaScript (ES6)

---

## 🚀 Memulai (Langkah Pengembangan)

### Prasyarat
1. Driver Dell DW5821e sudah terinstal di PC agar COM port terdeteksi di Device Manager.
2. Node.js (v18 ke atas disarankan) terinstal di PC.

### Instalasi & Menjalankan Mode Dev
1. Clone repositori:
   ```bash
   git clone https://github.com/Muzakie-ID/dw5821e-modem-manager.git
   cd dw5821e-modem-manager
   ```
2. Instal dependensi:
   ```bash
   npm install
   ```
3. Jalankan aplikasi:
   ```bash
   npm start
   ```

---

## 📦 Membangun Executable (.EXE)

Untuk mengompilasi aplikasi menjadi installer setup atau executable portabel:

```bash
npm run build
```

Hasil kompilasi dapat ditemukan di folder `dist/`:
- **Portable Version**: `dist/DW5821e Modem Manager 1.0.0.exe`
- **NSIS Setup Installer**: `dist/DW5821e Modem Manager Setup 1.0.0.exe`

---

## 📝 Lisensi

Proyek ini dilisensikan di bawah lisensi MIT.
