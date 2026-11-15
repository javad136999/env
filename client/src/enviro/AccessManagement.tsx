import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Building2, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { envFetch } from './api';
import { faNumber, type Company } from './data';

type AccountRole = 'pending' | 'company' | 'admin';
type Account = { openId: string; name: string | null; email: string | null; role: AccountRole; companyId: string | null };
type Props = { companies: Company[]; enabled: boolean; onCompanyCreated: (company: Company) => void; onRefreshContext: () => void };
type Message = { kind: 'success' | 'error'; text: string; accountId?: string };

const roleLabels: Record<AccountRole, string> = { pending: 'در انتظار', company: 'کاربر شرکت', admin: 'مدیر' };
const companyIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isAccount(value: unknown): value is Account {
  return isObject(value) && typeof value.openId === 'string' && value.openId.length > 0 &&
    (value.name === null || typeof value.name === 'string') && (value.email === null || typeof value.email === 'string') &&
    (value.role === 'pending' || value.role === 'company' || value.role === 'admin') &&
    (value.companyId === null || typeof value.companyId === 'string');
}
async function readResponse(response: Response): Promise<unknown> {
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error('پاسخ سرور قابل تأیید نیست؛ برای بررسی نتیجه، اطلاعات را به‌روزرسانی کنید.'); }
  if (!response.ok) {
    const message = isObject(data) && isObject(data.error) && typeof data.error.message === 'string' ? data.error.message : 'درخواست ناموفق بود.';
    throw new Error(message);
  }
  return data;
}
function errorMessage(error: unknown): string {
  return error instanceof Error && error.name !== 'TypeError' ? error.message : 'ارتباط با سرور برقرار نشد؛ نتیجه را با به‌روزرسانی بررسی کنید.';
}

export function AccessManagement({ companies, enabled, onCompanyCreated, onRefreshContext }: Props) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const request = useRef<AbortController | null>(null);

  const loadAccounts = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setLoadError('');
    try {
      const data = await readResponse(await envFetch('/api/env/admin/accounts', { signal: controller.signal }));
      if (!isObject(data) || !Array.isArray(data.accounts) || !data.accounts.every(isAccount)) throw new Error('قالب فهرست حساب‌ها معتبر نیست؛ بعداً دوباره تلاش کنید.');
      if (!controller.signal.aborted) setAccounts(data.accounts);
    } catch (error) {
      if (!controller.signal.aborted) { setAccounts(null); setLoadError(errorMessage(error)); }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void loadAccounts();
    else { request.current?.abort(); setAccounts(null); setLoading(false); setLoadError(''); setMessage(null); }
    return () => { request.current?.abort(); };
  }, [enabled, loadAccounts]);

  const locked = !enabled || loading || !!busy;
  const pendingCount = accounts?.filter(account => account.role === 'pending').length ?? 0;
  const orderedAccounts = accounts ? [...accounts].sort((a, b) => Number(b.role === 'pending') - Number(a.role === 'pending') || (a.name || a.email || a.openId).localeCompare(b.name || b.email || b.openId, 'fa')) : [];

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setMessage(null);
    const id = companyId.trim(); const name = companyName.trim();
    if (!companyIdPattern.test(id)) { setMessage({ kind: 'error', text: 'شناسه باید ۱ تا ۶۴ نویسه انگلیسی، عدد، خط تیره یا زیرخط باشد و با حرف یا عدد شروع شود.' }); return; }
    if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) { setMessage({ kind: 'error', text: 'نام شرکت را به‌صورت معتبر و حداکثر ۲۰۰ نویسه وارد کنید.' }); return; }
    if (companies.some(company => company.id === id)) { setMessage({ kind: 'error', text: 'این شناسه در فهرست شرکت‌ها وجود دارد؛ شناسه جدید انتخاب کنید.' }); return; }
    setBusy('company');
    try {
      const data = await readResponse(await envFetch('/api/env/admin/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) }));
      if (!isObject(data) || !isObject(data.company) || data.company.id !== id || data.company.name !== name) throw new Error('پاسخ ثبت شرکت قابل تأیید نیست؛ فهرست را به‌روزرسانی کنید.');
      onCompanyCreated({ id, name });
      setCompanyId(''); setCompanyName('');
      setMessage({ kind: 'success', text: 'مشخصات شرکت با پاسخ تأییدشده سرور ذخیره شد.' });
    } catch (error) { setMessage({ kind: 'error', text: errorMessage(error) }); }
    finally { setBusy(''); }
  }

  async function saveAccount(account: Account, role: AccountRole, selectedCompany: string) {
    if (locked) return;
    setMessage(null);
    const nextCompany = role === 'pending' ? null : selectedCompany;
    if (role !== 'pending' && !companies.some(company => company.id === nextCompany)) {
      setMessage({ kind: 'error', text: 'برای نقش شرکت یا مدیر، یک شرکت معتبر انتخاب کنید.', accountId: account.openId }); return;
    }
    if (account.role === 'admin' && role !== 'admin') {
      setMessage({ kind: 'error', text: 'سرور فعلاً کاهش نقش مدیر را مجاز نمی‌داند.', accountId: account.openId }); return;
    }
    setBusy(account.openId);
    try {
      const data = await readResponse(await envFetch('/api/env/admin/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openId: account.openId, role, companyId: nextCompany }) }));
      if (!isObject(data) || !isAccount(data.account) || data.account.openId !== account.openId || data.account.role !== role || data.account.companyId !== nextCompany) throw new Error('پاسخ تغییر حساب قابل تأیید نیست؛ فهرست را به‌روزرسانی کنید.');
      const updated = data.account;
      setAccounts(current => current?.map(item => item.openId === updated.openId ? updated : item) ?? null);
      setMessage({ kind: 'success', text: 'نقش و شرکت حساب با پاسخ تأییدشده سرور ذخیره شد.', accountId: account.openId });
    } catch (error) { setMessage({ kind: 'error', text: errorMessage(error), accountId: account.openId }); }
    finally { setBusy(''); }
  }

  return <section aria-labelledby="access-heading" style={{ marginTop: 24 }}>
    <div className="panel form-panel">
      <div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><ShieldCheck size={17}/></span><h2 id="access-heading">مدیریت دسترسی حساب‌ها</h2></div><p>ساخت شرکت و تخصیص نقش و شرکت به حساب‌های واردشده</p></div></div>
      {!enabled && <div className="form-message error" role="status"><AlertCircle size={16}/> در حالت نمونه مدیریت حساب و ثبت شرکت غیرفعال است؛ برای انجام عملیات با حساب مدیر وارد شوید.</div>}
      <form onSubmit={createCompany}>
        <div className="form-grid fields-grid">
          <label>نام شرکت<input value={companyName} onChange={event => setCompanyName(event.target.value)} disabled={locked} maxLength={200} placeholder="نام شرکت" required/></label>
          <label>شناسه شرکت<input value={companyId} onChange={event => setCompanyId(event.target.value)} disabled={locked} maxLength={64} placeholder="company-id" dir="ltr" required/></label>
        </div>
        <div className="form-footer"><span><Building2 size={15}/> شناسه انگلیسی و یکتا انتخاب کنید. ابتدا فهرست را به‌روز کنید؛ شناسه تکراری می‌تواند نام شرکت موجود را تغییر دهد.</span><div><button className="primary-btn" type="submit" disabled={locked} style={{ opacity: locked ? 0.5 : 1 }}>{busy === 'company' ? 'در حال ثبت...' : 'ثبت شرکت جدید'}</button></div></div>
      </form>
      {message && !message.accountId && <div className={`form-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</div>}
    </div>
    <div className="panel form-panel" style={{ marginTop: 16 }}>
      <div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><Users size={17}/></span><h2>حساب‌ها</h2>{enabled && accounts && <span className="count-pill">{faNumber(pendingCount)} در انتظار</span>}</div><p>حساب‌های در انتظار ابتدا نمایش داده می‌شوند. نقش مدیر نیازمند انتخاب شرکت است.</p></div><button className="outline-btn" type="button" disabled={locked} style={{ opacity: locked ? 0.5 : 1 }} onClick={() => { setMessage(null); onRefreshContext(); void loadAccounts(); }}><RefreshCw size={15}/> به‌روزرسانی</button></div>
      <div className="inline-info" style={{ marginTop: 16 }}><AlertCircle size={16}/><span>به دلیل محدودیت فعلی سرور، کاهش نقش مدیر مجاز نیست. برای نقش «در انتظار»، انتساب شرکت حذف می‌شود.</span></div>
      {loading && <div className="empty-card" role="status">در حال دریافت حساب‌ها...</div>}
      {enabled && !loading && loadError && <div className="form-message error" role="alert">{loadError}</div>}
      {enabled && !loading && !loadError && accounts && accounts.length === 0 && <div className="empty-card">حسابی برای نمایش وجود ندارد.</div>}
      {enabled && !loading && !loadError && orderedAccounts.length > 0 && <div className="company-grid" style={{ marginTop: 16 }}>{orderedAccounts.map(account => <AccountEditor key={`${account.openId}:${account.role}:${account.companyId ?? ''}`} account={account} companies={companies} locked={locked} saving={busy === account.openId} message={message?.accountId === account.openId ? message : null} onSave={saveAccount}/>)}</div>}
    </div>
  </section>;
}

type AccountEditorProps = { account: Account; companies: Company[]; locked: boolean; saving: boolean; message: Message | null; onSave: (account: Account, role: AccountRole, company: string) => void };
function AccountEditor({ account, companies, locked, saving, message, onSave }: AccountEditorProps) {
  const [role, setRole] = useState<AccountRole>(account.role);
  const [company, setCompany] = useState(account.companyId ?? '');
  const currentCompany = account.companyId ? companies.find(item => item.id === account.companyId) : undefined;
  const changed = role !== account.role || (role === 'pending' ? account.companyId !== null : company !== account.companyId);
  return <form className="panel company-card" onSubmit={event => { event.preventDefault(); onSave(account, role, company); }}>
    <h2 style={{ overflowWrap: 'anywhere' }}>{account.name || account.email || 'حساب بدون نام'}</h2>
    {account.email && <p dir="ltr" style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{account.email}</p>}
    <p style={{ overflowWrap: 'anywhere' }}>شناسه حساب: <bdi>{account.openId}</bdi></p>
    <p>نقش فعلی: <strong>{roleLabels[account.role]}</strong></p>
    <p style={{ overflowWrap: 'anywhere' }}>شرکت فعلی: <strong>{currentCompany ? currentCompany.name : account.companyId ? `نامشخص (${account.companyId})` : 'انتساب ندارد'}</strong></p>
    <div className="form-grid" style={{ marginTop: 16 }}>
      <label>نقش جدید<select value={role} disabled={locked} onChange={event => setRole(event.target.value as AccountRole)}>
        <option value="pending" disabled={account.role === 'admin'}>در انتظار</option><option value="company" disabled={account.role === 'admin'}>کاربر شرکت</option><option value="admin">مدیر</option>
      </select></label>
      <label>شرکت<select value={role === 'pending' ? '' : company} disabled={locked || role === 'pending'} onChange={event => setCompany(event.target.value)} required={role !== 'pending'}>
        <option value="">{role === 'pending' ? 'بدون شرکت' : 'انتخاب شرکت'}</option>{companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    </div>
    {account.role === 'admin' && <p>کاهش نقش این مدیر از طریق سرور مجاز نیست.</p>}
    {message && <div className={`form-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</div>}
    <button className="outline-btn" type="submit" style={{ marginTop: 16, opacity: locked || !changed || (role !== 'pending' && !company) ? 0.5 : 1 }} disabled={locked || !changed || (role !== 'pending' && !company)}>{saving ? 'در حال ذخیره...' : 'ذخیره دسترسی'}</button>
  </form>;
}
