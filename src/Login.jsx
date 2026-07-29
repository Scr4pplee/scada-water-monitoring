import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabaseClient';

const colors = {
  biru: '#1f98ae',
  biruMuda: '#e1eff2',
  merah: '#cc5050',
};

const EXIT_ANIM_MS = 500; // samakan dengan duration-500 di className card login

export default function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false); // fade-in begitu komponen muncul
  const [exiting, setExiting] = useState(false); // fade-out begitu login berhasil

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10); // sedikit delay biar transisi CSS-nya kepakai
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Verifikasi username+password dilakukan di dalam database (fungsi login_karyawan),
    // bukan di browser - password_hash tabel karyawan tidak pernah dikirim ke client.
    const { data, error: rpcError } = await supabase.rpc('login_karyawan', {
      p_username: username.trim(),
      p_password: password,
    });

    if (rpcError || !data || data.length === 0) {
      setError('Username atau password salah');
      setLoading(false);
      return;
    }

    setExiting(true); // mulai fade-out card login
    setTimeout(() => onLoginSuccess(data[0]), EXIT_ANIM_MS); // baru pindah ke dashboard setelah animasi selesai
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6 font-sans">
      <form
        onSubmit={handleSubmit}
        className={`w-full max-w-sm bg-gray-50 rounded-[40px] p-10 shadow-sm transition-all duration-500 ease-out ${
          visible && !exiting ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        }`}
      >
        <h1 className="text-[28px] font-black text-slate-800 tracking-tight mb-1">Login</h1>
        <p className="text-[13px] font-bold uppercase tracking-widest mb-8" style={{ color: colors.biru }}>
          Water Tank Monitor
        </p>

        {error && (
          <div className="mb-6 p-4 rounded-2xl text-sm font-bold" style={{ backgroundColor: '#fdeaea', color: colors.merah }}>
            {error}
          </div>
        )}

        <div className="mb-5">
          <label className="font-bold block mb-2 text-slate-400 text-xs uppercase tracking-widest">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            className="w-full p-5 rounded-[24px] border-none bg-white shadow-inner font-bold text-lg outline-none"
          />
        </div>

        <div className="mb-8">
          <label className="font-bold block mb-2 text-slate-400 text-xs uppercase tracking-widest">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full p-5 rounded-[24px] border-none bg-white shadow-inner font-bold text-lg outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-5 rounded-[24px] font-black text-white bg-slate-800 hover:bg-slate-700 transition-all active:scale-95 uppercase disabled:opacity-50"
        >
          {loading ? 'Memproses...' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}
