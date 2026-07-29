-- Jalankan seluruh isi file ini di Supabase Dashboard -> SQL Editor -> New query -> Run.

-- Ekstensi bawaan Postgres untuk hashing password (bcrypt), setara SHA2+trigger yang
-- dipakai di MySQL sebelumnya, tapi bcrypt lebih kuat.
create extension if not exists pgcrypto;

create table if not exists karyawan (
  id bigint generated always as identity primary key,
  username text not null unique,
  password_hash text not null, -- ketik password APA ADANYA di sini - trigger di bawah otomatis hash bcrypt
  nama text not null,
  jabatan text not null default 'Karyawan',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Setiap INSERT/UPDATE ke password_hash: otomatis di-hash pakai bcrypt sebelum tersimpan.
-- Jadi di Table Editor, tinggal ketik password apa adanya ke kolom password_hash.
create or replace function karyawan_hash_password()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    new.password_hash := crypt(new.password_hash, gen_salt('bf'));
  elsif TG_OP = 'UPDATE' then
    if new.password_hash is distinct from old.password_hash then
      new.password_hash := crypt(new.password_hash, gen_salt('bf'));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists karyawan_before_insert on karyawan;
create trigger karyawan_before_insert
before insert on karyawan
for each row execute function karyawan_hash_password();

drop trigger if exists karyawan_before_update on karyawan;
create trigger karyawan_before_update
before update on karyawan
for each row execute function karyawan_hash_password();

-- RLS diaktifkan TANPA policy sama sekali - jadi tabel ini tidak bisa diakses langsung
-- lewat REST API oleh siapa pun (termasuk anon key di frontend). Satu-satunya jalan masuk
-- yang diizinkan adalah lewat fungsi login_karyawan di bawah (security definer, jadi boleh
-- baca tabel ini secara terbatas meski RLS aktif).
alter table karyawan enable row level security;

-- Fungsi ini yang dipanggil dari website untuk verifikasi login. Hanya mengembalikan
-- baris kalau username+password cocok DAN is_active - tidak pernah membocorkan password_hash.
create or replace function login_karyawan(p_username text, p_password text)
returns table (id bigint, username text, nama text, jabatan text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select k.id, k.username, k.nama, k.jabatan
    from karyawan k
    where k.username = p_username
      and k.is_active = true
      and k.password_hash = crypt(p_password, k.password_hash);
end;
$$;

grant execute on function login_karyawan(text, text) to anon;

-- Contoh menambah akun (opsional, boleh dihapus baris ini kalau mau isi manual lewat Table Editor):
-- insert into karyawan (username, password_hash, nama, jabatan) values ('admin', 'admin123', 'Admin', 'Administrator');
