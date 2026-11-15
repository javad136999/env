import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, BarChart3, Bell, Building2, Check, ChevronDown, ChevronLeft, CircleHelp, Download, Droplets, FileBarChart2, FileText, LayoutDashboard, Leaf, Menu, PanelRightClose, Recycle, RefreshCw, ShieldCheck, Wind, X } from 'lucide-react';
import { Analytics, Dashboard, type View } from './enviro/Dashboard';
import { Archive, Companies } from './enviro/Archive';
import { ReportForm } from './enviro/ReportForm';
import { categories, companyName, demoCompanies, demoReports, faNumber, type Category, type Company, type EnvContext, type Report } from './enviro/data';
import { envFetch } from './enviro/api';
import { startLogin } from './const';

const navReports: { id: View; label: string; icon: typeof Droplets }[] = [
  { id: 'water', label: 'آب و پساب', icon: Droplets }, { id: 'waste', label: 'پسماند', icon: Recycle }, { id: 'air', label: 'هوا و انتشار', icon: Wind }, { id: 'indicators', label: 'شاخص‌های سالیانه', icon: FileBarChart2 },
];
const dateText = new Intl.DateTimeFormat('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

function App() {
  const [context, setContext] = useState<EnvContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<View>('dashboard');
  const [selectedReport, setSelectedReport] = useState<Report | undefined>();
  const [demoRole, setDemoRole] = useState<'admin' | 'company'>('admin');
  const [demoCompany, setDemoCompany] = useState(demoCompanies[0].id);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setConnectionError('');
    envFetch('/api/env/context', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('خطای دریافت اطلاعات اتصال');
      const data: EnvContext = await response.json();
      if (typeof data.configured !== 'boolean' || typeof data.authenticated !== 'boolean' || (data.authenticated && !data.user)) throw new Error('پاسخ نامعتبر از سرور');
      setContext(data);
    }).catch(error => { if (error.name !== 'AbortError') { setContext(null); setConnectionError('دریافت اطلاعات از سرور امکان‌پذیر نیست.'); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  const connected = !!context?.configured && !!context.authenticated && (context.user?.role === 'admin' || context.user?.role === 'company');
  const pending = context?.user?.role === 'pending';
  const demo = !connected && !pending;
  const isAdmin = demo ? demoRole === 'admin' : context?.user?.role === 'admin';
  const allCompanies: Company[] = demo ? demoCompanies : Array.isArray(context?.companies) ? context.companies : [];
  const allReports: Report[] = demo ? demoReports : Array.isArray(context?.reports) ? context.reports.filter(report => !!categories[report.category]) : [];
  const companyId = demo ? demoCompany : context?.user?.companyId;
  const companies = useMemo(() => isAdmin ? allCompanies : allCompanies.filter(company => company.id === companyId), [isAdmin, allCompanies, companyId]);
  const reports = useMemo(() => isAdmin ? allReports : allReports.filter(report => !!companyId && report.companyId === companyId), [isAdmin, allReports, companyId]);
  const navigate = (next: View) => { setSelectedReport(undefined); setView(next); setMobileOpen(false); setNoticeOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openReport = (report: Report) => { setSelectedReport(report); setView(report.category); setMobileOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const onSaved = (report: Report) => { setContext(current => current ? { ...current, reports: [...(current.reports ?? []).filter(item => item.id !== report.id), report] } : current); };
  const onCompanyCreated = (company: Company) => { setContext(current => current?.user?.role === 'admin' ? { ...current, companies: [...(current.companies ?? []).filter(item => item.id !== company.id), company] } : current); };
  async function exportReports() {
    setExportMessage('');
    try {
      let blob: Blob;
      if (demo) {
        const escape = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
        const lines = [['نمایش نمونه', 'شرکت', 'سال', 'دوره', 'حوزه', 'وضعیت'], ...reports.map(item => ['نمونه', companyName(companies, item.companyId), item.year, item.period, categories[item.category].label, item.status])];
        blob = new Blob(['\ufeff' + lines.map(line => line.map(escape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
      } else {
        const response = await envFetch('/api/env/export');
        if (!response.ok) throw new Error('export failed');
        blob = await response.blob();
      }
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = demo ? 'sample-environment-reports.csv' : 'environment-reports.csv'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      setExportMessage(demo ? 'فایل نمونه دریافت شد؛ این فایل حاوی داده واقعی نیست.' : 'فایل خروجی از سرور دریافت شد.');
    } catch { setExportMessage('دریافت خروجی ناموفق بود؛ اتصال به سرور را بررسی کنید.'); }
  }
  async function logout() {
    setExportMessage('');
    try {
      const response = await envFetch('/api/trpc/auth.logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: null }) });
      if (!response.ok) throw new Error('logout failed');
      try { sessionStorage.removeItem('manus-cookie'); localStorage.removeItem('manus-runtime-user-info'); } catch { /* storage may be unavailable */ }
      setContext({ authenticated: false, configured: !!context?.configured });
      setView('dashboard');
      setNoticeOpen(false);
      setExportMessage('از حساب خارج شدید.');
    } catch { setExportMessage('خروج ناموفق بود؛ نشست شما همچنان فعال است.'); }
  }
  const statusText = loading ? 'در حال بررسی اتصال' : connected ? 'متصل به سامانه' : 'نمایش نمونه';
  return <div className="app-shell" dir="rtl">
    {mobileOpen && <button className="mobile-backdrop" aria-label="بستن منو" onClick={() => setMobileOpen(false)}/>}
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}><div className="brand"><div className="brand-mark"><Leaf size={25}/><span /></div><div><strong>زیست‌نگار</strong><small>سامانه محیط زیست</small></div><button className="sidebar-close" aria-label="بستن منو" onClick={() => setMobileOpen(false)}><PanelRightClose size={19}/></button></div>
      <div className="side-context"><span className="side-context-icon"><Building2 size={18}/></span><div><small>فضای کاری</small><strong>{isAdmin ? 'مدیریت محیط زیست' : companyName(allCompanies, companyId || '')}</strong></div><ChevronDown size={15}/></div>
      <nav className="side-nav" aria-label="منوی اصلی"><div className="nav-label">منوی اصلی</div><button className={view === 'dashboard' ? 'active' : ''} onClick={() => navigate('dashboard')}><LayoutDashboard size={19}/><span>داشبورد</span>{view === 'dashboard' && <i/>}</button><div className="nav-label second">گزارش‌دهی</div>{navReports.map(item => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={19}/><span>{item.label}</span>{view === item.id && <i/>}</button>; })}<div className="nav-label second">بررسی و مدیریت</div><button className={view === 'analytics' ? 'active' : ''} onClick={() => navigate('analytics')}><BarChart3 size={19}/><span>تحلیل و نمودارها</span>{view === 'analytics' && <i/>}</button><button className={view === 'archive' ? 'active' : ''} onClick={() => navigate('archive')}><FileText size={19}/><span>آرشیو گزارش‌ها</span>{view === 'archive' && <i/>}</button>{isAdmin && <button className={view === 'companies' ? 'active' : ''} onClick={() => navigate('companies')}><Building2 size={19}/><span>مدیریت شرکت‌ها</span>{view === 'companies' && <i/>}</button>}</nav>
      <div className="sidebar-bottom"><div className="side-help"><span><Leaf size={20}/></span><strong>برای فردایی سبزتر</strong><p>با ثبت دقیق اطلاعات، در حفظ محیط زیست سهیم باشیم.</p><button onClick={() => { setNoticeOpen(true); setMobileOpen(false); }}>راهنمای سامانه <ArrowLeft size={14}/></button></div><div className="side-version"><span className="online-dot"/> سامانه گزارش‌دهی محیط زیست <small>نسخه نمایشی</small></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-right"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="باز کردن منو"><Menu size={21}/></button><span className="topbar-greeting">سامانه یکپارچه گزارش محیط زیست</span><span className="topbar-divider"/><span className="topbar-date">{dateText}</span></div><div className="topbar-left"><span className={`connection-pill ${connected ? 'live' : ''}`}><i/>{statusText}</span><button className="icon-button notification-button" aria-label="راهنما و وضعیت سامانه" onClick={() => setNoticeOpen(!noticeOpen)}><Bell size={19}/><span/></button><div className="topbar-divider"/><div className="user-chip"><div className="avatar">{connected ? (context?.user?.name?.slice(0, 1) || 'ک') : 'ز'}</div><div><strong>{connected ? context?.user?.name : 'کاربر نمونه'}</strong><small>{isAdmin ? 'پنل مدیریت' : 'پنل شرکت'}</small></div><ChevronDown size={15}/></div></div></header>
      {noticeOpen && <div className="notice-popover"><div><strong>راهنمای سامانه</strong><button onClick={() => setNoticeOpen(false)} aria-label="بستن"><X size={16}/></button></div><p>از منوی سمت راست برای ثبت گزارش‌های شش‌ماهه و شاخص‌های سالیانه استفاده کنید. در آرشیو می‌توانید گزارش‌ها را جست‌وجو و خروجی دریافت کنید.</p><small>{demo ? 'در حالت نمونه، هیچ تغییری در سرور ذخیره نمی‌شود.' : 'وضعیت دسترسی و اطلاعات از سرور دریافت می‌شود.'}</small>{connected && <button className="outline-btn" onClick={logout}>خروج از حساب</button>}</div>}
      <main className="main-content">
        <div className={`connection-banner ${connected ? 'connected-banner' : ''}`}><span className="banner-icon">{connected ? <Check size={17}/> : <AlertCircle size={18}/>}</span><div><strong>{loading ? 'در حال بررسی وضعیت اتصال' : connected ? 'اتصال سامانه برقرار است' : 'نمایش نمونه؛ اطلاعات واقعی نیست'}</strong><span>{loading ? 'تا زمان دریافت پاسخ سرور، داده‌های نمونه نمایش داده می‌شوند.' : connected ? 'اطلاعات این نما از پایگاه داده سامانه دریافت شده‌اند.' : connectionError || (context?.user?.role === 'pending' ? 'حساب هنوز به شرکت یا نقش اختصاص داده نشده است؛ ثبت واقعی در دسترس نیست.' : context?.configured && !context.authenticated ? 'دسترسی کاربر تأیید نشده است؛ ثبت واقعی در دسترس نیست.' : 'پایگاه داده سامانه هنوز پیکربندی نشده است؛ ثبت واقعی در دسترس نیست.')}</span></div>{!connected && context?.configured && !context.authenticated && window.__MANUS_CONFIG__?.oauthPortalUrl && window.__MANUS_CONFIG__?.projectId && <button onClick={() => { try { startLogin(); } catch { setExportMessage('ورود واقعی پیکربندی نشده است.'); } }}>ورود با حساب Manus</button>}{!connected && <button onClick={() => setReload(value => value + 1)}><RefreshCw size={14}/> بررسی مجدد</button>}</div>
        {demo && <div className="demo-controls"><div><span className="demo-tag">نمایش نمونه</span><span>پیش‌نمایش رابط، بدون ورود واقعی یا ذخیره دائمی</span></div><div className="role-controls"><span>پیش‌نمایش پنل:</span><button className={demoRole === 'admin' ? 'selected' : ''} onClick={() => { setDemoRole('admin'); if (view === 'companies') setView('dashboard'); }}>مدیریت</button><button className={demoRole === 'company' ? 'selected' : ''} onClick={() => { setDemoRole('company'); if (view === 'companies') setView('dashboard'); }}>شرکت</button>{demoRole === 'company' && <select aria-label="انتخاب شرکت نمونه" value={demoCompany} onChange={event => setDemoCompany(event.target.value)}>{demoCompanies.map(company => <option value={company.id} key={company.id}>{company.name}</option>)}</select>}</div></div>}
        {exportMessage && <div className="export-message" role="status"><InfoIcon/>{exportMessage}<button onClick={() => setExportMessage('')} aria-label="بستن پیام"><X size={15}/></button></div>}
        {view === 'dashboard' && <Dashboard reports={reports} companies={companies} demo={demo} isAdmin={isAdmin} setView={navigate} openReport={openReport}/>}
        {view === 'analytics' && <Analytics reports={reports} setView={navigate}/>}
        {view === 'archive' && <Archive reports={reports} companies={companies} demo={demo} openReport={openReport} onExport={exportReports} setView={navigate}/>}
        {view === 'companies' && isAdmin && <Companies reports={reports} companies={companies} setView={navigate} canManageAccess={connected && context?.user?.role === 'admin'} onCompanyCreated={onCompanyCreated} onRefreshContext={() => setReload(value => value + 1)}/>}
        {(view === 'water' || view === 'waste' || view === 'air' || view === 'indicators') && <ReportForm key={`${view}-${selectedReport?.id ?? 'new'}-${demoRole}-${companyId}`} category={view as Category} companies={companies} reports={reports} initialReport={selectedReport} canSave={connected} demo={demo} setView={navigate} onSaved={onSaved}/>}
        <footer className="main-footer"><span>زیست‌نگار <i/> سامانه گزارش محیط زیست پتروشیمی</span><span>{demo ? 'تمام داده‌های این نما نمونه هستند' : 'اطلاعات بر اساس دسترسی حساب شما'}</span></footer>
      </main>
    </div>
  </div>;
}
function InfoIcon() { return <ShieldCheck size={17}/>; }
export default App;
