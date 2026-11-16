import { useState, type FormEvent } from 'react';
import { LockKeyhole, LogIn } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { envFetch } from '@/enviro/api';

type Props = { onSignedIn: () => void };

export function SupabaseLogin({ onSignedIn }: Props) {
  const [mode, setMode] = useState<'company' | 'supabase'>('company');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    if (mode === 'company') {
      setBusy(true);
      try {
        const response = await envFetch('/api/env/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: email.trim(), password }) });
        const payload = await response.json() as { error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message || 'ورود انجام نشد.');
        setPassword('');
        onSignedIn();
      } catch (error) { setMessage(error instanceof Error ? error.message : 'ورود انجام نشد.'); } finally { setBusy(false); }
      return;
    }
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
          <p>{mode === 'company' ? 'با نام کاربری اختصاصی شرکت وارد شوید.' : 'با ایمیل و رمز عبور حساب Supabase وارد شوید.'}</p>
        </div>
      </div>
      <div className="login-mode-tabs"><button type="button" className={mode === 'company' ? 'active' : ''} onClick={() => { setMode('company'); setMessage(''); }}>ورود شرکت‌ها</button><button type="button" className={mode === 'supabase' ? 'active' : ''} onClick={() => { setMode('supabase'); setMessage(''); }}>ورود Supabase</button></div>
      <form className="supabase-login-form" onSubmit={submit}>
        <label>
          <span>{mode === 'company' ? 'نام کاربری شرکت' : 'ایمیل'}</span>
          <input type={mode === 'company' ? 'text' : 'email'} name="email" autoComplete="username" dir="ltr" required value={email} onChange={event => setEmail(event.target.value)} placeholder={mode === 'company' ? 'نام پتروشیمی' : 'name@example.com'} />
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
      <p className="supabase-login-note">{mode === 'company' ? 'حساب شرکت توسط مدیر سامانه ایجاد می‌شود.' : 'ساخت حساب عمومی از این فرم غیرفعال است؛ حساب‌ها باید از بخش Authentication در Supabase ساخته شوند.'}</p>
    </section>
  );
}

export function LocalPasswordChange({ onComplete }: { onComplete: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await envFetch('/api/env/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, password }) });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || 'تغییر رمز انجام نشد.');
      onComplete();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تغییر رمز انجام نشد.'); } finally { setBusy(false); }
  }
  return <section className="supabase-login" dir="rtl"><div className="supabase-login-heading"><span className="supabase-login-icon"><LockKeyhole size={18}/></span><div><h2>تغییر رمز عبور</h2><p>برای ادامه، رمز موقت خود را تغییر دهید.</p></div></div><form className="supabase-login-form" onSubmit={submit}><label><span>رمز فعلی</span><input type="password" required minLength={1} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}/></label><label><span>رمز جدید</span><input type="password" required minLength={8} value={password} onChange={event => setPassword(event.target.value)}/></label><button type="submit" disabled={busy}><LogIn size={16}/>{busy ? 'در حال ذخیره…' : 'ذخیره رمز جدید'}</button></form>{message && <p className="supabase-login-message" role="alert">{message}</p>}</section>;
}
