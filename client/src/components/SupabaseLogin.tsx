import { useState, type FormEvent } from 'react';
import { LockKeyhole, LogIn } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Props = { onSignedIn: () => void };

export function SupabaseLogin({ onSignedIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    if (!supabase) {
      setMessage('تنظیمات عمومی Supabase کامل نیست؛ VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY را در Vercel بررسی کنید.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setPassword('');
      onSignedIn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ورود انجام نشد؛ ایمیل و رمز عبور را بررسی کنید.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="supabase-login" dir="rtl" aria-labelledby="supabase-login-title">
      <div className="supabase-login-heading">
        <span className="supabase-login-icon"><LockKeyhole size={18} /></span>
        <div>
          <h2 id="supabase-login-title">ورود کاربران</h2>
          <p>با ایمیل و رمز عبور حساب Supabase وارد شوید.</p>
        </div>
      </div>
      <form className="supabase-login-form" onSubmit={submit}>
        <label>
          <span>ایمیل</span>
          <input type="email" name="email" autoComplete="username" dir="ltr" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" />
        </label>
        <label>
          <span>رمز عبور</span>
          <input type="password" name="password" autoComplete="current-password" dir="ltr" required value={password} onChange={event => setPassword(event.target.value)} placeholder="رمز عبور حساب" />
        </label>
        <button type="submit" disabled={busy}>
          <LogIn size={16} />
          {busy ? 'در حال ورود…' : 'ورود'}
        </button>
      </form>
      {message && <p className="supabase-login-message" role="alert">{message}</p>}
      <p className="supabase-login-note">ساخت حساب عمومی از این فرم غیرفعال است؛ حساب‌ها باید از بخش Authentication در Supabase ساخته شوند.</p>
    </section>
  );
}
