import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowLeft, ArrowUpLeft, BarChart3, Building2, CheckCircle2, ChevronDown, Clock3, Droplets, FileBarChart2, FileCheck2, FileText, MoreHorizontal, Recycle, Wind } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { categories, companyName, faNumber, periodLabel, type Category, type Company, type Report } from './data';

export type View = 'dashboard' | 'water' | 'waste' | 'air' | 'indicators' | 'analytics' | 'archive' | 'companies';

type DashboardProps = { reports: Report[]; companies: Company[]; demo: boolean; isAdmin: boolean; setView: (view: View) => void; openReport: (report: Report) => void };

const orderedCategories: Category[] = ['water', 'waste', 'air', 'indicators'];

export function ReportTable({ reports, companies, openReport }: { reports: Report[]; companies: Company[]; openReport: (report: Report) => void }) {
  return <div className="table-wrap"><table className="reports-table"><thead><tr><th>گزارش</th><th>شرکت</th><th>دوره گزارش</th><th>وضعیت</th><th aria-label="عملیات" /></tr></thead><tbody>
    {reports.length === 0 ? <tr><td colSpan={5} className="empty-cell">گزارشی برای نمایش وجود ندارد.</td></tr> : reports.map(report => {
      const category = categories[report.category];
      if (!category) return null;
      const Icon = category.icon;
      return <tr key={report.id}>
        <td><div className="report-name"><span className={`report-icon icon-${report.category}`}><Icon size={17} /></span><span><strong>{category.label}</strong><small>گزارش {periodLabel(report)}</small></span></div></td>
        <td>{companyName(companies, report.companyId)}</td>
        <td>{periodLabel(report)} {faNumber(String(report.year))}</td>
        <td><span className={`status ${report.status}`}><i />{report.status === 'submitted' ? 'ارسال شده' : 'پیش‌نویس'}</span></td>
        <td><button className="row-action" aria-label={`مشاهده و ویرایش گزارش ${category.label}`} onClick={() => openReport(report)}>ویرایش <ArrowLeft size={14} /></button></td>
      </tr>;
    })}
  </tbody></table></div>;
}

function buildChart(reports: Report[]) {
  const periods = [...new Set(reports.filter(report => report.category !== 'indicators' && report.period !== 0).map(report => `${report.year}-${report.period}`))].sort().slice(-6);
  return periods.map(period => {
    const [year, half] = period.split('-').map(Number);
    const rows = reports.filter(report => report.year === year && report.period === half);
    return { name: `${faNumber(String(year))} / ${faNumber(half)}`, water: rows.filter(item => item.category === 'water').length, waste: rows.filter(item => item.category === 'waste').length, air: rows.filter(item => item.category === 'air').length, indicators: rows.filter(item => item.category === 'indicators').length };
  });
}

function ReportsChart({ reports }: { reports: Report[] }) {
  const data = buildChart(reports);
  if (!data.length) return <div className="chart-empty">هنوز داده‌ای برای نمودار وجود ندارد.</div>;
  return <div className="chart-area" dir="ltr"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 12, right: 8, left: -27, bottom: 0 }}>
    <defs><linearGradient id="greenGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3f9a73" stopOpacity={0.23}/><stop offset="100%" stopColor="#3f9a73" stopOpacity={0.01}/></linearGradient></defs>
    <CartesianGrid stroke="#eef2ef" vertical={false} strokeDasharray="4 6" />
    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#9ca9a2', fontSize: 11, fontFamily: 'Vazirmatn' }} dy={11} />
    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#a6b2ab', fontSize: 11, fontFamily: 'Vazirmatn' }} />
    <Tooltip contentStyle={{ border: '1px solid #e5ece7', borderRadius: 12, direction: 'rtl', fontFamily: 'Vazirmatn', fontSize: 12 }} formatter={(value: number, name: string) => [faNumber(value), name]} />
    <Area type="monotone" dataKey="water" name="آب و پساب" stroke="#3c9a73" strokeWidth={2.5} fill="url(#greenGradient)" />
    <Area type="monotone" dataKey="waste" name="پسماند" stroke="#d8ad54" strokeWidth={2} fill="transparent" />
    <Area type="monotone" dataKey="air" name="هوا" stroke="#92a9d0" strokeWidth={2} fill="transparent" />
  </AreaChart></ResponsiveContainer></div>;
}

export function Dashboard({ reports, companies, demo, isAdmin, setView, openReport }: DashboardProps) {
  const years = useMemo(() => [...new Set(reports.map(report => report.year))].sort((a, b) => b - a), [reports]);
  const [selectedYear, setSelectedYear] = useState('all');
  const visibleReports = selectedYear === 'all' ? reports : reports.filter(report => report.year === Number(selectedYear));
  const submitted = visibleReports.filter(report => report.status === 'submitted').length;
  const drafts = visibleReports.filter(report => report.status === 'draft').length;
  const ratio = visibleReports.length ? Math.round(submitted / visibleReports.length * 100) : 0;
  const expectedPerYear = isAdmin ? Math.max(companies.length * 7, 7) : 7;
  const coverage = visibleReports.length ? Math.min(100, Math.round(visibleReports.length / expectedPerYear * 100)) : 0;
  const sorted = [...visibleReports].sort((a, b) => b.year - a.year || b.period - a.period);
  return <>
    <section className="welcome-row"><div><div className="eyebrow"><span /> نمای کلی سامانه <b>/</b> داشبورد</div><h1>داشبورد محیط زیست <span className="title-spark">✳</span></h1><p>تصویری روشن از عملکرد و گزارش‌های محیط زیستی</p></div><div className="welcome-actions"><button className="outline-btn" onClick={() => setView('archive')}><FileText size={17}/> آرشیو گزارش‌ها</button><button className="primary-btn" onClick={() => setView('water')}><span className="plus">＋</span> ثبت گزارش جدید</button></div></section>
    <div className="section-label"><div><span className="section-dot"/> خلاصه وضعیت <span className="muted-label">{demo ? '· نمایش نمونه' : '· اطلاعات حساب شما'}</span></div><label className="dashboard-year-filter">سال نمایش<select value={selectedYear} onChange={event => setSelectedYear(event.target.value)}><option value="all">همه سال‌ها</option>{years.map(year => <option value={year} key={year}>{faNumber(String(year))}</option>)}</select></label></div>
    <section className="kpi-grid">
      <div className="kpi-card featured"><div className="kpi-head"><span>کل گزارش‌ها</span><span className="kpi-icon"><FileText size={20}/></span></div><div className="kpi-value">{faNumber(reports.length)} <small>گزارش</small></div><div className="featured-bottom"><span><BarChart3 size={14}/> در همه حوزه‌ها</span><span className="white-arrow"><ArrowUpLeft size={15}/></span></div><div className="kpi-rings" /></div>
      <div className="kpi-card"><div className="kpi-head"><span>گزارش‌های ارسال‌شده</span><span className="kpi-icon pale-green"><FileCheck2 size={19}/></span></div><div className="kpi-value">{faNumber(submitted)} <small>گزارش</small></div><div className="kpi-foot"><span className="soft-badge green"><CheckCircle2 size={13}/> {reports.length ? `${faNumber(ratio)}٪` : '—'}</span><span>از کل گزارش‌ها</span></div></div>
      <div className="kpi-card"><div className="kpi-head"><span>در حال تکمیل</span><span className="kpi-icon pale-amber"><Clock3 size={19}/></span></div><div className="kpi-value">{faNumber(drafts)} <small>گزارش</small></div><div className="kpi-foot"><span className="soft-badge amber">پیش‌نویس</span><span>نیازمند بررسی و تکمیل</span></div></div>
      <div className="kpi-card"><div className="kpi-head"><span>{isAdmin ? 'شرکت‌ها' : 'پوشش ثبت گزارش'}</span><span className="kpi-icon pale-blue">{isAdmin ? <Building2 size={19}/> : <FileBarChart2 size={19}/>}</span></div><div className="kpi-value">{faNumber(isAdmin ? companies.length : coverage)} <small>{isAdmin ? 'شرکت' : '٪'}</small></div><div className="kpi-foot"><span className="soft-badge blue">{isAdmin ? 'در دسترس' : 'پوشش تقریبی'}</span><span>{isAdmin ? 'در نمای فعلی' : `${faNumber(expectedPerYear)} گزارش هدف در سال`}</span></div></div>
    </section>
    <section className="dashboard-grid"><div className="panel trend-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><BarChart3 size={17}/></span><h2>روند گزارش‌دهی</h2></div><p>تعداد گزارش‌ها به تفکیک حوزه و دوره</p></div><button className="small-select" onClick={() => setView('analytics')}>مشاهده تحلیل <ChevronDown size={14}/></button></div><div className="chart-legend"><span><i className="legend-water"/>آب و پساب</span><span><i className="legend-waste"/>پسماند</span><span><i className="legend-air"/>هوا</span></div><ReportsChart reports={visibleReports}/></div>
      <div className="panel overview-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><CheckCircle2 size={17}/></span><h2>وضعیت گزارش‌ها</h2></div><p>نگاهی به گزارش‌های موجود</p></div><MoreHorizontal size={20} color="#a4b1aa"/></div><div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(#4a9a75 0% ${ratio}%, #e9f0eb ${ratio}% 100%)` }}><div><strong>{reports.length ? `${faNumber(ratio)}٪` : '—'}</strong><span>{reports.length ? 'ارسال شده' : 'داده‌ای نیست'}</span></div></div></div><div className="donut-stats"><div><i className="dot-green"/><span>ارسال شده</span><b>{faNumber(submitted)}</b></div><div><i className="dot-light"/><span>پیش‌نویس</span><b>{faNumber(drafts)}</b></div></div></div></section>
    <section className="bottom-grid"><div className="panel recent-panel"><div className="panel-heading recent-heading"><div><div className="panel-title"><span className="mini-icon"><FileText size={17}/></span><h2>آخرین گزارش‌ها</h2></div><p>فهرست آخرین گزارش‌های موجود در سامانه</p></div><button className="text-link" onClick={() => setView('archive')}>مشاهده همه <ArrowLeft size={15}/></button></div><ReportTable reports={sorted.slice(0, 5)} companies={companies} openReport={openReport}/></div>
      <div className="panel quick-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><ArrowDownLeft size={17}/></span><h2>دسترسی سریع</h2></div><p>ثبت اطلاعات در حوزه‌های مختلف</p></div></div><div className="quick-list">{orderedCategories.map(category => { const item = categories[category]; const Icon = item.icon; return <button key={category} onClick={() => setView(category)}><span className={`quick-icon icon-${category}`}><Icon size={18}/></span><span><strong>{item.label}</strong><small>{category === 'indicators' ? 'گزارش سالیانه' : 'گزارش شش‌ماهه'}</small></span><ArrowLeft size={16}/></button>; })}</div></div></section>
  </>;
}

export function Analytics({ reports, setView }: { reports: Report[]; setView: (view: View) => void }) {
  return <><section className="page-intro"><div className="eyebrow"><span /> گزارش‌ها <b>/</b> تحلیل و نمودارها</div><h1>تحلیل و نمودارها</h1><p>نمایی از تعداد گزارش‌های موجود در هر دوره و حوزه</p></section><div className="analytics-layout"><div className="panel trend-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><BarChart3 size={17}/></span><h2>روند گزارش‌دهی</h2></div><p>تعداد گزارش‌ها به تفکیک دوره</p></div><button className="text-link" onClick={() => setView('archive')}>آرشیو گزارش‌ها <ArrowLeft size={15}/></button></div><div className="chart-legend"><span><i className="legend-water"/>آب و پساب</span><span><i className="legend-waste"/>پسماند</span><span><i className="legend-air"/>هوا</span></div><ReportsChart reports={reports}/></div><div className="panel category-summary"><div className="panel-title"><span className="mini-icon"><BarChart3 size={17}/></span><h2>گزارش‌ها به تفکیک حوزه</h2></div><p className="panel-sub">تعداد گزارش‌ها در نمای فعلی</p>{orderedCategories.map(category => { const count = reports.filter(report => report.category === category).length; const percent = reports.length ? count / reports.length * 100 : 0; const Icon = categories[category].icon; return <div className="category-line" key={category}><div><span><Icon size={15}/> {categories[category].label}</span><b>{faNumber(count)}</b></div><div className="progress-track"><span style={{ width: `${percent}%`, background: categories[category].color }}/></div></div>; })}</div></div></>;
}
