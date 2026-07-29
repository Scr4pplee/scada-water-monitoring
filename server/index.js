require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  try {
    // Verifikasi password dilakukan oleh MySQL sendiri (SHA2 + salt per-baris yang
    // otomatis diisi trigger saat akun dibuat/diubah, lewat phpMyAdmin atau create-admin).
    // Kalau username & password cocok, query mengembalikan 1 baris; kalau tidak, 0 baris.
    const [rows] = await pool.query(
      `SELECT id, username, nama, jabatan
       FROM karyawan
       WHERE username = ?
         AND is_active = 1
         AND password_hash = SHA2(CONCAT(password_salt, ?), 256)
       LIMIT 1`,
      [username, password]
    );
    const user = rows[0];

    // Pesan error sama untuk "user tidak ada" & "password salah" - supaya tidak bisa dipakai
    // untuk menebak username mana saja yang valid (user enumeration).
    if (!user) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, nama: user.nama, jabatan: user.jabatan },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({ token, username: user.username, nama: user.nama, jabatan: user.jabatan });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

app.get('/api/verify', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token tidak ada' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ username: payload.username, nama: payload.nama, jabatan: payload.jabatan });
  } catch (err) {
    res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Auth server jalan di http://localhost:${PORT}`);
});
