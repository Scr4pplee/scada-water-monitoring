import React, { useEffect, useState, useRef, useCallback } from 'react';
import { db } from './lib/firebase';
import { ref, onValue, update, query, limitToLast, increment } from "firebase/database";
// Import komponen grafik untuk tren real-time
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Login from './Login';
import { supabase } from './lib/supabaseClient';

// Ambil nama/jabatan dari user_metadata Supabase Auth (diisi admin lewat Dashboard saat
// membuat akun). Kalau belum diisi, fallback ke email supaya tetap ada yang ditampilkan.
function toUser(session) {
  const meta = session.user.user_metadata || {};
  return {
    email: session.user.email,
    nama: meta.nama || session.user.email,
    jabatan: meta.jabatan || 'Karyawan',
  };
}

function Dashboard({ user, onLogout, showLoginToast, onLoginToastShown }) {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showSuccess, setShowSuccess] = useState(false);
  const [showLoginSuccess, setShowLoginSuccess] = useState(false); // toast login masih terpasang di DOM
  const [loginToastEntered, setLoginToastEntered] = useState(false); // toast sedang di posisi/opacity penuh
  const [mounted, setMounted] = useState(false); // fade-in dashboard begitu muncul setelah login
  const [history, setHistory] = useState([]); // State untuk data grafik tren
  const [showAlerts, setShowAlerts] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [usageDaily, setUsageDaily] = useState({}); // { 'YYYY-MM-DD': { liter } } dari Firebase

  const alertRef = useRef(null);
  const usagePanelRef = useRef(null);
  const lastLevelRef = useRef({ percent: null, dateStr: null }); // baseline buat hitung selisih level

  // State data utama sistem
  const [data, setData] = useState({
    ultrasonic_1: 0, // jarak RAW dari sensor (cm), belum dikalibrasi
    control_mode: 'Manual',
    pump_status: 'OFF',
    tank_height_config: 100,
    water_threshold: 30,
    tank_volume_liter: 0,
    sensor_offset: 0, // offset kalibrasi jarak sensor (cm), diterapkan di website
  });

  const [settingsForm, setSettingsForm] = useState({
    tank_height_config: '',
    water_threshold: '',
    tank_volume_liter: '',
    sensor_offset: '',
  });

  const colors = {
    biru: '#1f98ae',
    biruMuda: '#e1eff2',
    ijo: '#50cc64',
    merah: '#cc5050',
  };

  // Kalkulasi persentase level air berdasarkan tinggi tangki
  const calcPercent = (cm, tankHeight) => {
    if (!tankHeight || tankHeight <= 0 || cm == null || isNaN(cm)) return 0;
    const percent = Math.round(((tankHeight - cm) / tankHeight) * 100);
    return Math.min(Math.max(percent, 0), 100);
  };

  // Jam Real-time
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fade-in dashboard begitu pertama kali muncul (habis login)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Tampilkan toast "Login Berhasil" sesaat kalau baru saja login, dengan animasi
  // masuk (fade + turun) dan keluar (fade + naik) sebelum benar-benar dilepas dari DOM.
  useEffect(() => {
    if (!showLoginToast) return;
    setShowLoginSuccess(true);
    const enterTimer = setTimeout(() => setLoginToastEntered(true), 10);
    const exitTimer = setTimeout(() => setLoginToastEntered(false), 3000);
    const unmountTimer = setTimeout(() => {
      setShowLoginSuccess(false);
      onLoginToastShown?.();
    }, 3300); // 3000ms tampil + 300ms durasi animasi keluar
    return () => {
      clearTimeout(enterTimer);
      clearTimeout(exitTimer);
      clearTimeout(unmountTimer);
    };
  }, [showLoginToast, onLoginToastShown]);

  // Tutup panel alert/penggunaan air kalau klik di luar area-nya
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (alertRef.current && !alertRef.current.contains(e.target)) setShowAlerts(false);
      if (usagePanelRef.current && !usagePanelRef.current.contains(e.target)) setShowUsage(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Ambil riwayat penggunaan air 7 hari terakhir dari Firebase
  // (disimpan di node terpisah 'usage_daily', BUKAN di dalam 'device_01' - supaya
  // penulisannya tidak ikut memicu ulang listener sensor real-time di bawah)
  useEffect(() => {
    const usageQuery = query(ref(db, 'usage_daily'), limitToLast(7));
    const unsubscribe = onValue(usageQuery, (snapshot) => {
      setUsageDaily(snapshot.val() || {});
    });
    return () => unsubscribe();
  }, []);

  // Kalibrasi: firmware cuma kirim jarak RAW, offset-nya diterapkan di sini supaya
  // bisa dikalibrasi ulang tanpa upload ulang firmware. "Tidak terbaca" dicek dari raw,
  // bukan dari hasil kalibrasi, supaya offset negatif tidak menutupi kondisi sensor mati.
  const sensorOffset = parseFloat(data.sensor_offset) || 0;
  const calibratedCm = data.ultrasonic_1 > 0 ? data.ultrasonic_1 + sensorOffset : data.ultrasonic_1;

  // Ambang Batas Air (di Pengaturan) khusus buat urusan pengisian (status ISI ULANG & pompa otomatis).
  // Notifikasi "air mau habis" ini sengaja dipisah - selalu di 15%, tidak ikut berubah walau
  // Ambang Batas Air diganti - dan berlaku sama baik mode Otomatis maupun Manual.
  const CRITICAL_WATER_PERCENT = 15;

  const percent = calcPercent(calibratedCm, data.tank_height_config);

  const alerts = [];
  if (data.ultrasonic_1 <= 0) {
    alerts.push({ id: 'err1', text: 'Sensor HC-SR04 tidak dapat membaca data. Mohon periksa kembali perangkat.' });
  } else if (percent <= CRITICAL_WATER_PERCENT) {
    alerts.push({ id: 'low1', text: `Ketersediaan air pada tangki tersisa ${percent}%, harap melakukan pengisian ulang pada tangki.` });
  }

  // Ringkasan penggunaan air: total hari ini + riwayat 7 hari terakhir
  const todayStr = new Date().toLocaleDateString('en-CA');
  const todayUsage = usageDaily[todayStr] || { liter: 0 };
  const todayTotalLiter = todayUsage.liter || 0;
  const usageHistoryList = Object.entries(usageDaily)
    .map(([date, v]) => ({ date, liter: v.liter || 0 }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // Listen data dari Firebase secara Real-time
  useEffect(() => {
    const dataRef = ref(db, 'device_01');
    const unsubscribe = onValue(dataRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        const newData = {
          ultrasonic_1: val.sensors?.ultrasonic_1 || 0,
          pump_status: val.control?.pump_status || 'OFF',
          control_mode: val.control?.control_mode || 'Manual',
          tank_height_config: val.settings?.tank_height_config || 100,
          water_threshold: val.settings?.water_threshold || 30,
          tank_volume_liter: val.settings?.tank_volume_liter || 0,
          sensor_offset: val.settings?.sensor_offset || 0,
        };

        setData(newData);

        // Update settings form jika sedang tidak mengetik
        if (activeTab !== 'Settings') {
          setSettingsForm({
            tank_height_config: newData.tank_height_config,
            water_threshold: newData.water_threshold,
            tank_volume_liter: newData.tank_volume_liter,
            sensor_offset: newData.sensor_offset,
          });
        }

        // Terapkan offset kalibrasi ke jarak RAW dari firmware sebelum dipakai lebih lanjut
        const newCalibratedCm = newData.ultrasonic_1 > 0 ? newData.ultrasonic_1 + newData.sensor_offset : newData.ultrasonic_1;

        // Estimasi penggunaan air: setiap kali level tangki TURUN dari pembacaan sebelumnya,
        // selisihnya dianggap air terpakai (kenaikan level = pompa mengisi, bukan penggunaan).
        // Catatan: ini estimasi dari perubahan level, bukan flow meter, jadi hanya akurat sebatas
        // resolusi sensor. Butuh "Kapasitas Tangki Penuh (Liter)" terisi di Settings agar terhitung.
        const todayKey = new Date().toLocaleDateString('en-CA');
        const pNow = calcPercent(newCalibratedCm, newData.tank_height_config);
        const prevLevel = lastLevelRef.current;

        if (prevLevel.dateStr === todayKey && newData.tank_volume_liter > 0) {
          const drop = prevLevel.percent != null ? Math.max(0, prevLevel.percent - pNow) : 0;
          const liters = (drop / 100) * newData.tank_volume_liter;

          if (liters > 0) {
            update(ref(db, `usage_daily/${todayKey}`), {
              liter: increment(liters),
            }).catch((err) => console.error('Usage update error:', err));
          }
        }
        lastLevelRef.current = { percent: pNow, dateStr: todayKey };

        // Simpan ke history untuk grafik HANYA kalau pembacaan sensornya benar-benar berubah.
        // 'device_01' juga menyimpan control_mode/pump_status/settings, jadi tanpa pengecekan ini
        // setiap perubahan itu (bukan cuma perubahan sensor) akan menambah titik duplikat ke grafik.
        setHistory((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.val1 === newCalibratedCm) {
            return prev;
          }
          const newPoint = {
            time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            val1: newCalibratedCm,
          };
          return [...prev, newPoint].slice(-240); // ~2 menit riwayat di update rate 500ms
        });
      }
    });

    return () => unsubscribe();
  }, [activeTab]);

  // Fungsi Master untuk Update Data ke Firebase
  const updateDB = useCallback(async (path, patch) => {
    try {
      await update(ref(db, `device_01/${path}`), patch);
      return true;
    } catch (error) {
      console.error('Update error:', error);
      return false;
    }
  }, []);

  // Logika Otomatis Pompa (Auto Mode) - pakai jarak yang sudah dikalibrasi (calibratedCm)
  useEffect(() => {
    if (data.control_mode !== 'Auto') return;
    // Sensor tidak terbaca (raw <= 0) - jangan ambil keputusan dari data yang tidak valid
    if (data.ultrasonic_1 <= 0) return;

    const threshold = parseFloat(data.water_threshold);

    const shouldBeOn  = percent <= threshold && data.pump_status === 'OFF';
    const shouldBeOff = percent >= 80 && data.pump_status === 'ON';

    if (shouldBeOn) {
      updateDB('control', { pump_status: 'ON' });
    } else if (shouldBeOff) {
      updateDB('control', { pump_status: 'OFF' });
    }
  }, [percent, data.control_mode, data.water_threshold, data.pump_status, data.ultrasonic_1, updateDB]);

  // Handlers untuk UI
  const handleModeChange = (mode) => {
    updateDB('control', { control_mode: mode });
  };

  const handleManualToggle = () => {
    if (data.control_mode !== 'Manual') return;
    updateDB('control', { pump_status: data.pump_status === 'ON' ? 'OFF' : 'ON' });
  };

  const handleSaveSettings = async () => {
    const patch = {
      tank_height_config: parseFloat(settingsForm.tank_height_config),
      water_threshold:    parseFloat(settingsForm.water_threshold),
      tank_volume_liter:  parseFloat(settingsForm.tank_volume_liter),
      sensor_offset:      parseFloat(settingsForm.sensor_offset),
    };
    if (Object.values(patch).some(isNaN)) return;

    const ok = await updateDB('settings', patch);
    if (ok) {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    }
  };

  // Komponen Dashboard (Konten Utama)
  const DashboardContent = () => {
    const threshold  = parseFloat(data.water_threshold) || 30;
    const isManual   = data.control_mode === 'Manual';
    const isLow      = percent > 0 && percent <= threshold;
    const isFilling  = data.pump_status === 'ON';

    return (
      <div className="grid grid-cols-12 gap-4 sm:gap-6 animate-in fade-in duration-500">
        <div className="col-span-12 mb-2">
          <h1 className="text-[28px] sm:text-[42px] font-black text-slate-800 tracking-tight">Dashboard</h1>
          <p className="text-[14px] sm:text-[20px] font-bold uppercase tracking-widest" style={{ color: colors.biru }}>HC-SR04</p>
        </div>

        {/* Visualisasi Tangki Air */}
        <div className="col-span-12 lg:col-span-4 bg-gray-50 rounded-[40px] p-8 shadow-sm flex flex-col items-center justify-center min-h-[350px]">
          <div className="relative w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 200 320" className="w-auto h-full max-h-[280px]">
              <path d="M70 10 h60 v15 h15 q25 0 25 35 v230 q0 15 -15 15 h-110 q-15 0 -15 -15 v-230 q0 -35 25 -35 h15 v-15 z" fill={colors.biruMuda} />
              <rect
                x="35" y={290 - (240 * percent / 100)}
                width="130" height={(240 * percent / 100)}
                fill={isFilling || isLow ? colors.merah : colors.biru}
                className="transition-all duration-1000 ease-in-out" rx="4"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pb-4">
              <span className="text-[36px] sm:text-[54px] font-black text-slate-800 drop-shadow-md">{percent}%</span>
              <span className={`text-xs font-bold uppercase ${isFilling || isLow ? 'text-red-500' : 'text-slate-400'}`}>
                {isFilling ? 'MENGISI' : isLow ? 'ISI ULANG' : 'OPTIMAL'}
              </span>
            </div>
          </div>
        </div>

        {/* Status dan Kontrol */}
        <div className="col-span-12 lg:col-span-8 grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
          <div className="bg-gray-50 rounded-[40px] p-6 shadow-sm">
            <span className="font-bold text-slate-400 text-xs uppercase tracking-widest mb-2 block">Mode Kontrol</span>
            {[{ value: 'Auto', label: 'Otomatis' }, { value: 'Manual', label: 'Manual' }].map((m) => (
              <button key={m.value} onClick={() => handleModeChange(m.value)} className="w-full py-3 mb-2 rounded-2xl font-black transition-all" style={{ backgroundColor: data.control_mode === m.value ? colors.biru : colors.biruMuda, color: data.control_mode === m.value ? '#fff' : colors.biru }}>{m.label}</button>
            ))}
          </div>

          <div className="bg-gray-50 rounded-[40px] p-6 shadow-sm flex flex-col justify-center items-center text-center">
            <span className="font-bold text-slate-400 text-xs uppercase tracking-widest">Status Tangki</span>
            <p className="text-[20px] sm:text-[28px] font-black mt-2 uppercase" style={{ color: isFilling || isLow ? colors.merah : colors.ijo }}>
              {isFilling ? 'MENGISI' : isLow ? 'ISI ULANG' : 'SIAP'}
            </p>
            <p className="text-[11px] font-bold text-slate-400 mt-1">{calibratedCm > 0 ? calibratedCm.toFixed(1) : '–'} cm</p>
          </div>

          <div className="bg-gray-50 rounded-[40px] p-6 shadow-sm flex flex-col justify-center items-center">
            <span className="font-bold text-slate-400 text-xs uppercase tracking-widest">Status Pompa</span>
            <p className="text-[22px] sm:text-[32px] font-black uppercase mt-2" style={{ color: isFilling ? colors.ijo : colors.merah }}>{data.pump_status === 'ON' ? 'MENYALA' : 'MATI'}</p>
          </div>

          <div className="bg-gray-50 rounded-[40px] p-6 shadow-sm flex flex-col justify-center items-center gap-3">
            <span className="font-bold text-slate-400 text-xs uppercase tracking-widest">Saklar Manual</span>
            <label className={`relative inline-flex items-center scale-150 mt-2 ${isManual ? 'cursor-pointer' : 'opacity-30 cursor-not-allowed'}`}>
              <input type="checkbox" className="sr-only peer" checked={isFilling} disabled={!isManual} onChange={handleManualToggle} />
              <div className="w-11 h-6 bg-slate-200 rounded-full peer-checked:bg-cyan-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
            </label>
          </div>

          <div className="bg-gray-50 rounded-[40px] p-6 shadow-sm flex flex-col justify-center items-center">
            <span className="font-bold text-slate-400 text-xs uppercase tracking-widest mb-1 text-green-500 animate-pulse">● Terhubung</span>
            <p className="text-[10px] text-slate-400 font-bold">{currentTime.toLocaleTimeString('id-ID', { hour12: false })}</p>
          </div>
        </div>

        {/* Grafik Tren Riwayat Level Air (cm) */}
        <div className="col-span-12 bg-gray-50 rounded-[40px] p-4 sm:p-8 h-[300px] sm:h-[350px] shadow-sm">
          <h3 className="font-black text-[16px] sm:text-[20px] mb-4 sm:mb-6 text-slate-800 uppercase tracking-tight">Riwayat Level Air (cm)</h3>
          <ResponsiveContainer width="100%" height="80%">
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="time" fontSize={10} tick={{fill: '#94a3b8'}} axisLine={false} tickLine={false} />
              <YAxis domain={['auto', 'auto']} fontSize={10} tickFormatter={(v) => `${v}cm`} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}} />
              <Line type="monotone" dataKey="val1" stroke={colors.biru} strokeWidth={4} dot={{ r: 4, fill: colors.biru, strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  return (
    <div className={`min-h-screen bg-white p-4 sm:p-6 font-sans max-w-[1200px] mx-auto text-slate-800 transition-opacity duration-500 ease-out ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {showSuccess && <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-green-500 text-white px-8 py-4 rounded-3xl font-black shadow-2xl">✓ Settings Tersimpan</div>}
      {showLoginSuccess && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-green-500 text-white px-8 py-4 rounded-3xl font-black shadow-2xl transition-all duration-300 ease-out ${
            loginToastEntered ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3'
          }`}
        >
          ✓ Login Berhasil
        </div>
      )}

      <nav className="flex flex-wrap gap-4 sm:gap-8 mb-8 sm:mb-12 items-center">
        {[{ id: 'Dashboard', label: 'Dashboard' }, { id: 'Settings', label: 'Pengaturan' }].map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} className={`text-[14px] sm:text-[18px] font-black transition-all ${activeTab === t.id ? 'text-slate-800' : 'text-slate-300'}`}>{t.label}</button>
        ))}

        <div className="ml-auto flex items-center gap-3">
          <div className="relative" ref={alertRef}>
            <button
              onClick={() => setShowAlerts((v) => !v)}
              className="relative p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-all"
              aria-label="Peringatan"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke={colors.biru} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {alerts.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center">
                  {alerts.length}
                </span>
              )}
            </button>

            {showAlerts && (
              <div className="absolute top-14 right-0 w-72 max-w-[80vw] bg-white rounded-3xl shadow-2xl border border-slate-100 p-4 z-[100]">
                <p className="font-black text-xs uppercase tracking-widest text-slate-400 mb-3">Peringatan</p>
                {alerts.length === 0 ? (
                  <p className="text-sm text-slate-400 font-bold py-4 text-center">Tidak ada peringatan</p>
                ) : (
                  <div className="space-y-2">
                    {alerts.map((a) => (
                      <div key={a.id} className="flex items-start gap-2 p-3 rounded-2xl" style={{ backgroundColor: colors.biruMuda }}>
                        <span style={{ color: colors.merah }} className="font-black leading-none mt-0.5">●</span>
                        <span className="text-sm font-bold text-slate-700">{a.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="relative" ref={usagePanelRef}>
            <button
              onClick={() => setShowUsage((v) => !v)}
              className="relative p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-all"
              aria-label="Penggunaan Air"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke={colors.biru} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M12 2.69s-6 7.2-6 11.31a6 6 0 0 0 12 0c0-4.11-6-11.31-6-11.31z" />
              </svg>
            </button>

            {showUsage && (
              <div className="absolute top-14 right-0 w-80 max-w-[85vw] bg-white rounded-3xl shadow-2xl border border-slate-100 p-4 z-[100]">
                <p className="font-black text-xs uppercase tracking-widest text-slate-400 mb-3">Penggunaan Air Hari Ini</p>
                <p className="text-[32px] font-black leading-none" style={{ color: colors.biru }}>
                  {todayTotalLiter.toFixed(1)} <span className="text-sm font-bold text-slate-400">Liter</span>
                </p>

                <p className="font-black text-xs uppercase tracking-widest text-slate-400 mb-2 mt-4">7 Hari Terakhir</p>
                {usageHistoryList.length === 0 ? (
                  <p className="text-sm text-slate-400 font-bold py-3 text-center">Belum ada data</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {usageHistoryList.map((h) => (
                      <div key={h.date} className="flex justify-between items-center p-2.5 rounded-xl" style={{ backgroundColor: colors.biruMuda }}>
                        <span className="text-xs font-bold text-slate-600">{h.date}</span>
                        <span className="text-xs font-black" style={{ color: colors.biru }}>{h.liter.toFixed(1)} L</span>
                      </div>
                    ))}
                  </div>
                )}

                {!(data.tank_volume_liter > 0) && (
                  <p className="text-[11px] font-bold text-red-400 mt-3">
                    Isi "Kapasitas Tangki Penuh (Liter)" di Pengaturan agar penggunaan air bisa dihitung.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="bg-slate-50 px-4 sm:px-6 py-2 rounded-2xl text-[14px] sm:text-[18px] font-black" style={{ color: colors.biru }}>
            {currentTime.toLocaleTimeString('id-ID', { hour12: false })}
          </div>

          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-[13px] font-black text-slate-800">{user?.nama}</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{user?.jabatan}</span>
          </div>

          <button
            onClick={onLogout}
            className="p-3 rounded-2xl bg-slate-50 hover:bg-red-50 transition-all"
            aria-label="Logout"
            title="Logout"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke={colors.merah} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </div>
      </nav>

      <main>
        {activeTab === 'Dashboard' && <DashboardContent />}
        {activeTab === 'Settings' && (
          <div className="p-6 sm:p-10 bg-gray-50 rounded-[40px] max-w-xl mx-auto shadow-sm">
            <h2 className="text-[24px] sm:text-[32px] font-black mb-8 text-slate-800 uppercase tracking-tighter">Kalibrasi Sistem</h2>
            <div className="space-y-6">
              {[
                { label: 'Tinggi Maksimal Tangki (cm)', key: 'tank_height_config' },
                { label: 'Ambang Batas Air (%)',  key: 'water_threshold' },
                { label: 'Kapasitas Tangki Penuh (Liter)', key: 'tank_volume_liter' },
                { label: 'Kalibrasi Offset Sensor (cm)', key: 'sensor_offset' },
              ].map((field) => (
                <div key={field.key}>
                  <label className="font-bold block mb-2 text-slate-400 text-xs uppercase tracking-widest">{field.label}</label>
                  <input type="number" value={settingsForm[field.key]} onChange={(e) => setSettingsForm((prev) => ({ ...prev, [field.key]: e.target.value }))} className="w-full p-5 rounded-[24px] border-none bg-white shadow-inner font-bold text-lg outline-none" />
                </div>
              ))}
              <button onClick={handleSaveSettings} className="w-full py-5 rounded-[24px] font-black text-white bg-slate-800 hover:bg-slate-700 transition-all active:scale-95 mt-4 uppercase">Simpan Pengaturan</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Gerbang autentikasi: pakai sesi Supabase Auth. onAuthStateChange menjaga status login
// tetap sinkron (termasuk kalau sesi kedaluwarsa/logout dari tab lain), tanpa localStorage
// atau token custom - Supabase yang menyimpan & mengelola sesinya sendiri.
function App() {
  const [authState, setAuthState] = useState({ status: 'checking', user: null }); // 'checking' | 'authed' | 'guest'
  const [justLoggedIn, setJustLoggedIn] = useState(false); // true hanya kalau baru submit form login, bukan pas restore sesi

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthState(session ? { status: 'authed', user: toUser(session) } : { status: 'guest', user: null });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthState(session ? { status: 'authed', user: toUser(session) } : { status: 'guest', user: null });
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLoginSuccess = () => {
    setJustLoggedIn(true); // authState sudah ikut ter-update lewat onAuthStateChange di atas
  };

  const handleLogout = () => {
    supabase.auth.signOut();
  };

  if (authState.status === 'checking') {
    return <div className="min-h-screen bg-white" />;
  }

  if (authState.status === 'guest') {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <Dashboard
      user={authState.user}
      onLogout={handleLogout}
      showLoginToast={justLoggedIn}
      onLoginToastShown={() => setJustLoggedIn(false)}
    />
  );
}

export default App;
