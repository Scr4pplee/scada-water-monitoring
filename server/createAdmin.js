// Script CLI buat admin menambahkan akun karyawan baru secara manual.
// Jalankan dari folder server/: npm run create-admin
require('dotenv').config();
const readline = require('readline');
const pool = require('./db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

async function main() {
  console.log('=== Tambah Akun Karyawan Baru ===');
  const username = (await ask('Username: ')).trim();
  const password = await ask('Password: '); // catatan: input ini akan tampil di terminal
  const nama = (await ask('Nama lengkap: ')).trim();
  const jabatan = (await ask('Jabatan (kosongkan untuk "Karyawan"): ')).trim() || 'Karyawan';
  rl.close();

  if (!username || !password) {
    console.error('Username dan password wajib diisi.');
    process.exit(1);
  }

  try {
    // password dikirim apa adanya - trigger karyawan_before_insert di database
    // yang otomatis mengganti jadi SHA2(salt+password) sebelum tersimpan.
    await pool.query(
      'INSERT INTO karyawan (username, password_hash, nama, jabatan) VALUES (?, ?, ?, ?)',
      [username, password, nama, jabatan]
    );
    console.log(`Akun "${username}" (${nama} - ${jabatan}) berhasil dibuat.`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      console.error(`Username "${username}" sudah dipakai.`);
    } else {
      console.error('Gagal menyimpan akun:', err.message);
    }
  } finally {
    await pool.end();
  }
}

main();
