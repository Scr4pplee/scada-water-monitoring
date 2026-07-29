// File jembatan untuk Hostinger Node.js App: startup file yang diminta harus bernama
// server.js di root, jadi file ini hanya memanggil kode backend beneran di server/index.js.
// Pakai dynamic import() (bukan require) karena package.json root ini "type": "module".
import('./server/index.js');
