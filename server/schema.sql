CREATE DATABASE IF NOT EXISTS water_tank_auth
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE water_tank_auth;

CREATE TABLE IF NOT EXISTS karyawan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL, -- ketik password APA ADANYA di sini - trigger di bawah otomatis meng-hash-nya
  password_salt VARCHAR(16) NOT NULL DEFAULT '',
  nama VARCHAR(100) NOT NULL,
  jabatan VARCHAR(100) NOT NULL DEFAULT 'Karyawan',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Setiap INSERT: generate salt acak, lalu ganti password_hash jadi SHA2(salt+password).
-- Jadi baik lewat phpMyAdmin maupun script create-admin, tinggal isi password polos.
DELIMITER $$

CREATE TRIGGER karyawan_before_insert
BEFORE INSERT ON karyawan
FOR EACH ROW
BEGIN
  SET NEW.password_salt = SUBSTRING(MD5(RAND()), 1, 16);
  SET NEW.password_hash = SHA2(CONCAT(NEW.password_salt, NEW.password_hash), 256);
END$$

-- Kalau kolom password_hash diubah (ganti password), hash ulang dengan salt baru.
-- Kalau cuma ubah kolom lain (misal jabatan) dan password_hash tidak disentuh, tidak di-hash ulang.
CREATE TRIGGER karyawan_before_update
BEFORE UPDATE ON karyawan
FOR EACH ROW
BEGIN
  IF NEW.password_hash <> OLD.password_hash THEN
    SET NEW.password_salt = SUBSTRING(MD5(RAND()), 1, 16);
    SET NEW.password_hash = SHA2(CONCAT(NEW.password_salt, NEW.password_hash), 256);
  END IF;
END$$

DELIMITER ;
