// File jembatan untuk Hostinger: "Direktori root" & "Startup file" default Node.js App
// di Hostinger tidak bisa diarahkan langsung ke folder server/, jadi file ini di root
// yang jadi startup file-nya, dan cuma memanggil kode backend beneran di server/index.js.
require('./server/index.js');
