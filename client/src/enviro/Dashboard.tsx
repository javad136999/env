import { useMemo, useState } from 'react';
import { Activity, AlertCircle, ArrowDownLeft, ArrowLeft, ArrowUpLeft, BarChart3, Building2, CheckCircle2, ChevronDown, Clock3, Download, Droplets, FileBarChart2, FileCheck2, FileText, MoreHorizontal, Recycle, Wind, Waves, Flame, Factory } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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

const comparisonCategories: Category[] = ['water', 'waste', 'air'];
function numericValue(report: Report | undefined, key: string) {
  const value = report?.values[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value.replace(/,/g, '')))) return Number(value.replace(/,/g, ''));
  return null;
}

function rowValues(report: Report, section: string): Record<string, unknown>[] {
  try { const raw = report.values[section]; const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row)) : []; } catch { return []; }
}
function numericUnknown(value: unknown): number | null { if (typeof value === 'number' && Number.isFinite(value)) return value; if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value.replace(/,/g, '')))) return Number(value.replace(/,/g, '')); return null; }
function sumRows(report: Report, section: string, key: string): number | null { const values = rowValues(report, section).map(row => numericUnknown(row[key])).filter((value): value is number => value !== null); return values.length ? values.reduce((sum, value) => sum + value, 0) : null; }
type EnvironmentalCategory = 'water' | 'waste' | 'air' | 'flaring';
function environmentalMetric(report: Report, category: EnvironmentalCategory): number | null {
  if (category === 'water') return numericValue(report, 'E7_volume');
  if (category === 'waste') return numericValue(report, 'E8') !== null || numericValue(report, 'E9') !== null ? (numericValue(report, 'E8') ?? 0) + (numericValue(report, 'E9') ?? 0) : null;
  if (category === 'flaring') return numericValue(report, 'E13');
  return ['E15', 'E16', 'E17'].map(key => numericValue(report, key)).filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0) || null;
}
function fallbackMetric(report: Report, category: EnvironmentalCategory): number | null {
  if (category === 'water') return numericValue(report, 'wastewater_generated') ?? sumRows(report, 'water_effluents', 'volume');
  if (category === 'flaring') return sumRows(report, 'air_flaring', 'flare_gas');
  return null;
}
const environmentalCategories: { key: EnvironmentalCategory; title: string; subtitle: string; unit: string; color: string; icon: typeof Droplets }[] = [
  { key: 'water', title: 'آب و پساب', subtitle: 'E7 · حجم پساب تولیدی', unit: 'm³', color: '#3b9b88', icon: Droplets },
  { key: 'waste', title: 'پسماند', subtitle: 'E8 + E9 · پسماند تولیدی', unit: 'kg', color: '#d0a044', icon: Recycle },
  { key: 'flaring', title: 'فلرینگ', subtitle: 'E13 · گاز ارسالی به فلر', unit: 'ton', color: '#d07b63', icon: Activity },
  { key: 'air', title: 'هوا و انتشار', subtitle: 'E15 + E16 + E17 · آلاینده‌ها', unit: 'ton', color: '#7d8fc8', icon: Wind },
];

function IndicatorCharts({ reports }: { reports: Report[] }) {
  const fields = categories.indicators.fields.filter(field => field.type !== 'text');
  const submittedYears = [...new Set(reports.filter(report => report.status === 'submitted').map(report => report.year))];
  if (!submittedYears.length) return null;
  const latestYear = Math.max(1405, ...submittedYears);
  const years = Array.from({ length: latestYear - 1400 + 1 }, (_, index) => 1400 + index);
  return <div className="indicator-detail-section"><div className="indicator-detail-heading"><div><h3>روند تک‌تک شاخص‌های وزارت نفت</h3><p>هر نمودار فقط مقدار همان شاخص را در سال‌های مختلف نشان می‌دهد.</p></div><span className="indicator-alert-rule">آستانه هشدار: ۳۰٪ اختلاف با میانگین سایر سال‌ها</span></div><div className="indicator-detail-grid">{fields.map((field, index) => { const points = years.map(year => ({ year, label: faNumber(String(year)), value: indicatorValueForYear(reports, year, field.key) })); const numericPoints = points.filter(point => point.value !== null); const warnings = numericPoints.map(point => { const others = numericPoints.filter(item => item.year !== point.year).map(item => item.value as number); const average = others.length ? others.reduce((sum, value) => sum + value, 0) / others.length : null; const change = average !== null && average !== 0 ? (point.value as number - average) / Math.abs(average) * 100 : null; return change !== null && Math.abs(change) >= 30 ? { year: point.year, change } : null; }).filter((item): item is { year: number; change: number } => item !== null); const color = ['#3b9b88', '#d0a044', '#7d8fc8', '#d07b63'][index % 4]; return <article className="indicator-detail-card" key={field.key}><div className="indicator-detail-card-head"><div><strong>{field.key}</strong><span>{field.label.replace(/^E\d+[_ ]?/, '')}</span></div><small>{field.unit ?? 'بدون واحد'}</small></div><div className="indicator-detail-chart" dir="ltr"><ResponsiveContainer width="100%" height="100%"><BarChart data={points} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}><CartesianGrid stroke="#edf2ee" vertical={false} strokeDasharray="4 6"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#96a69b', fontSize: 8, fontFamily: 'Vazirmatn' }}/><YAxis tickLine={false} axisLine={false} tick={{ fill: '#a2afa7', fontSize: 8, fontFamily: 'Vazirmatn' }}/><Tooltip contentStyle={{ border: '1px solid #e2ebe4', borderRadius: 9, direction: 'rtl', fontFamily: 'Vazirmatn', fontSize: 10 }} formatter={(value: unknown) => [value === null || value === undefined ? 'ثبت نشده' : faNumber(Number(value)), field.unit ?? 'مقدار']}/><Bar dataKey="value" fill={color} radius={[4,4,0,0]} maxBarSize={24}/></BarChart></ResponsiveContainer></div>{warnings.length ? <div className="indicator-warning"><AlertCircle size={14}/><span>{warnings.map(item => `سال ${faNumber(String(item.year))}: ${item.change >= 0 ? '+' : ''}${faNumber(item.change.toFixed(1))}٪ نسبت به میانگین سایر سال‌ها`).join(' · ')}؛ نیاز به بررسی دارد.</span></div> : <div className="indicator-ok"><CheckCircle2 size={14}/><span>اختلاف غیرعادی بالاتر از آستانهٔ ۳۰٪ مشاهده نشد.</span></div>}</article>; })}</div></div>;
}

function sumIndicatorFallback(reports: Report[], year: number, category: Category, key: string): number | null {
  const values = reports.filter(report => report.category === category && report.status === 'submitted' && report.year === year && report.period !== 0)
    .map(report => numericValue(report, key)).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function indicatorValueForYear(reports: Report[], year: number, fieldKey: string): number | null {
  const annual = reports.filter(report => report.category === 'indicators' && report.status === 'submitted' && report.period === 0 && report.year === year);
  const direct = annual.map(report => numericValue(report, fieldKey)).find((value): value is number => value !== null);
  if (direct !== undefined) return direct;
  // E8/E9 are also recorded in the detailed waste forms. Use only the same
  // company/year and submitted periods; never turn an absent record into zero.
  if (fieldKey === 'E8') return sumIndicatorFallback(reports, year, 'waste', 'hazardous_waste');
  if (fieldKey === 'E9') return sumIndicatorFallback(reports, year, 'waste', 'non_hazardous_waste');
  return null;
}

function CompanyEnvironmentalDashboard({ reports }: { reports: Report[] }) {
  const indicatorReports = reports.filter(report => report.category === 'indicators' && report.period === 0 && report.status === 'submitted');
  const yearsWithAnyReport = reports.filter(report => report.status === 'submitted').map(report => report.year);
  const years = [...new Set(yearsWithAnyReport)].sort((a, b) => a - b);
  const numericFields = categories.indicators.fields.filter(field => field.type !== 'text');
  const actualValues = indicatorReports.reduce((count, report) => count + numericFields.filter(field => numericValue(report, field.key) !== null).length, 0);
  const auditYears = Array.from({ length: 6 }, (_, index) => 1400 + index);
  const expectedValues = auditYears.length * numericFields.length;
  const missingValues = Math.max(0, expectedValues - indicatorReports.filter(report => auditYears.includes(report.year)).reduce((count, report) => count + numericFields.filter(field => numericValue(report, field.key) !== null).length, 0));
  const yearLedger = auditYears.map(year => { const report = indicatorReports.find(item => item.year === year); const filled = report ? numericFields.filter(field => numericValue(report, field.key) !== null).length : 0; return { year, report, filled }; });
  return <section className="company-environment-panel"><div className="company-environment-heading"><div><div className="eyebrow"><span /> تحلیل عملکرد شرکت <b>/</b> شاخص‌های وزارت نفت</div><h2>روند تک‌تک شاخص‌های وزارت نفت</h2><p>همه شرکت‌ها از یک قالب یکسان استفاده می‌کنند؛ نمودارها فقط از مقادیر واقعی همین شرکت در Supabase ساخته می‌شوند.</p></div><span className="indicator-alert-rule">آستانه هشدار: ۳۰٪ اختلاف با میانگین سایر سال‌ها</span></div>{years.length > 0 && <><div className="company-data-source"><span className="source-check"><CheckCircle2 size={14}/> منبع: Supabase</span><span>مقدار واقعی ثبت‌شده: <b>{faNumber(actualValues)}</b></span><span>فاقد مقدار: <b>{faNumber(missingValues)}</b></span><span>مقادیر نمونه در داشبورد شرکت نمایش داده نمی‌شود.</span></div><div className="indicator-year-ledger"><strong>وضعیت گزارش سالانه</strong><div>{yearLedger.map(item => <span className={item.report ? item.filled === numericFields.length ? 'complete' : 'partial' : 'missing'} key={item.year}><b>{faNumber(String(item.year))}</b>{item.report ? <small>{faNumber(item.filled)} از {faNumber(numericFields.length)} مقدار</small> : <small>گزارش ثبت نشده</small>}</span>)}</div></div></>}{!years.length ? <div className="environment-empty"><Activity size={22}/><div><strong>هنوز شاخص سالانهٔ ارسال‌شده‌ای برای تحلیل وجود ندارد.</strong><span>پس از ارسال گزارش شاخص‌های وزارت نفت، نمودار E1 تا E20 نمایش داده می‌شود.</span></div></div> : <IndicatorCharts reports={reports}/>}</section>;
}

function SemiannualComparison({ reports, isAdmin }: { reports: Report[]; isAdmin: boolean }) {
  const availableYears = useMemo(() => [...new Set(reports.filter(report => report.period !== 0).map(report => report.year))].sort((a, b) => b - a), [reports]);
  const [category, setCategory] = useState<Category>('water');
  const [year, setYear] = useState('');
  const definition = categories[category];
  const metrics = definition.fields.filter(field => field.type !== 'text');
  const [metric, setMetric] = useState(metrics[0]?.key ?? '');
  const activeYear = year && availableYears.includes(Number(year)) ? Number(year) : availableYears[0];
  const previousYear = activeYear ? activeYear - 1 : 0;
  const current = (period: 1 | 2) => reports.find(report => report.category === category && report.year === activeYear && report.period === period && report.status === 'submitted');
  const previous = (period: 1 | 2) => reports.find(report => report.category === category && report.year === previousYear && report.period === period && report.status === 'submitted');
  const chartData = [1, 2].map(period => ({ name: period === 1 ? 'نیمسال اول' : 'نیمسال دوم', current: numericValue(current(period as 1 | 2), metric), previous: numericValue(previous(period as 1 | 2), metric) })).filter(row => row.current !== null || row.previous !== null);
  const selectedField = definition.fields.find(field => field.key === metric);
  const hasPrevious = chartData.some(row => row.previous !== null);
  return <section className="panel comparison-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><BarChart3 size={17}/></span><h2>مقایسه عملکرد شش‌ماهه</h2></div><p>{isAdmin ? 'مقایسه گزارش‌های موجود در نمای مدیریتی' : 'مقایسه نیمسال‌های امسال با سال قبل'}</p></div><span className="comparison-badge">مبنای مقایسه: ارسال‌شده</span></div><div className="comparison-controls"><label>حوزه<select value={category} onChange={event => { const next = event.target.value as Category; setCategory(next); setMetric(categories[next].fields.find(field => field.type !== 'text')?.key ?? ''); }}>{comparisonCategories.map(item => <option value={item} key={item}>{categories[item].label}</option>)}</select></label><label>شاخص<select value={metric} onChange={event => setMetric(event.target.value)}>{metrics.map(field => <option value={field.key} key={field.key}>{field.label}</option>)}</select></label><label>سال<select value={activeYear || ''} onChange={event => setYear(event.target.value)}><option value="">آخرین سال</option>{availableYears.map(item => <option value={item} key={item}>{faNumber(String(item))}</option>)}</select></label></div>{!activeYear || !chartData.length ? <div className="comparison-empty">برای این حوزه هنوز گزارش شش‌ماهه ارسال‌شده وجود ندارد.</div> : <><div className="comparison-meta"><strong>{selectedField?.label}</strong><span>{selectedField?.unit ?? 'بدون واحد'} · سال {faNumber(String(activeYear))} در برابر {faNumber(String(previousYear))}</span>{!hasPrevious && <em>برای سال قبل داده‌ای ثبت نشده است.</em>}</div><div className="comparison-chart" dir="ltr"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 12, right: 10, left: -16, bottom: 0 }}><CartesianGrid stroke="#eef2ef" vertical={false} strokeDasharray="4 6"/><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#8fa097', fontSize: 11, fontFamily: 'Vazirmatn' }}/><YAxis tickLine={false} axisLine={false} tick={{ fill: '#a6b2ab', fontSize: 10, fontFamily: 'Vazirmatn' }}/><Tooltip contentStyle={{ border: '1px solid #e5ece7', borderRadius: 12, direction: 'rtl', fontFamily: 'Vazirmatn', fontSize: 12 }} formatter={(value: unknown, name: string) => [typeof value === 'number' ? faNumber(value) : '—', name === 'current' ? `سال ${faNumber(String(activeYear))}` : `سال ${faNumber(String(previousYear))}`]}/><Legend verticalAlign="top" align="right" iconType="circle" formatter={(value: string) => value === 'current' ? `سال ${faNumber(String(activeYear))}` : `سال ${faNumber(String(previousYear))}`} /><Bar dataKey="previous" name="previous" fill="#d9e5dc" radius={[5,5,0,0]} maxBarSize={26}/><Bar dataKey="current" name="current" fill={definition.color} radius={[5,5,0,0]} maxBarSize={26}/></BarChart></ResponsiveContainer></div></>}</section>;
}

function HistoricalTrend({ reports, isAdmin }: { reports: Report[]; isAdmin: boolean }) {
  const [category, setCategory] = useState<Category>('indicators');
  const availableCategories = orderedCategories.filter(item => reports.some(report => report.category === item));
  const definition = categories[category];
  const metricOptions = definition.fields.filter(field => field.type !== 'text' && reports.some(report => report.category === category && numericValue(report, field.key) !== null));
  const [metric, setMetric] = useState('E1');
  const activeMetric = metricOptions.some(field => field.key === metric) ? metric : metricOptions[0]?.key ?? '';
  const chartData = useMemo(() => {
    const years = [...new Set(reports.filter(report => report.category === category).map(report => report.year))].sort((a, b) => a - b);
    return years.map(year => {
      const yearReports = reports.filter(report => report.category === category && report.year === year && report.status === 'submitted');
      const metricReports = category === 'indicators' ? yearReports.filter(report => report.period === 0) : yearReports.filter(report => report.period !== 0);
      const values = metricReports.map(report => numericValue(report, activeMetric)).filter((value): value is number => value !== null);
      return { year, label: faNumber(String(year)), value: values.length ? values.reduce((sum, value) => sum + value, 0) : null, reports: yearReports.length };
    });
  }, [reports, category, activeMetric]);
  const latest = chartData.at(-1);
  const previous = chartData.at(-2);
  const change = latest?.value !== null && latest?.value !== undefined && previous?.value !== null && previous?.value !== undefined && previous.value !== 0 ? ((latest.value - previous.value) / Math.abs(previous.value)) * 100 : null;
  const selectedField = definition.fields.find(field => field.key === activeMetric);
  return <section className="panel historical-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><BarChart3 size={17}/></span><h2>روند تاریخی عملکرد</h2></div><p>{isAdmin ? 'نمایش روند داده‌های ثبت‌شده در همه شرکت‌ها' : 'مقایسه داده‌های ثبت‌شده شرکت در سال‌های گذشته'}</p></div><span className="comparison-badge">منبع: گزارش‌های ثبت‌شده</span></div><div className="historical-controls"><label>حوزه<select value={category} onChange={event => { const next = event.target.value as Category; setCategory(next); setMetric(categories[next].fields.find(field => field.type !== 'text')?.key ?? ''); }}>{availableCategories.map(item => <option value={item} key={item}>{categories[item].label}</option>)}</select></label><label className="historical-metric">شاخص قابل مقایسه<select value={activeMetric} onChange={event => setMetric(event.target.value)}>{metricOptions.map(field => <option value={field.key} key={field.key}>{field.label}</option>)}</select></label></div>{!chartData.length ? <div className="comparison-empty">برای این حوزه داده تاریخی قابل نمایش وجود ندارد.</div> : <><div className="historical-summary"><div><span>آخرین سال</span><strong>{latest?.label ?? '—'}</strong></div><div><span>مقدار آخرین سال</span><strong>{latest?.value === null || latest?.value === undefined ? '—' : faNumber(latest.value)}</strong><small>{selectedField?.unit ?? 'واحد'}</small></div><div><span>تغییر نسبت به سال قبل</span><strong className={change === null ? '' : change >= 0 ? 'positive' : 'negative'}>{change === null ? '—' : `${change >= 0 ? '+' : ''}${faNumber(change.toFixed(1))}٪`}</strong></div></div><div className="historical-chart" dir="ltr"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 12, right: 12, left: -10, bottom: 0 }}><CartesianGrid stroke="#eef2ef" vertical={false} strokeDasharray="4 6"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#8fa097', fontSize: 11, fontFamily: 'Vazirmatn' }}/><YAxis tickLine={false} axisLine={false} tick={{ fill: '#a6b2a6', fontSize: 10, fontFamily: 'Vazirmatn' }}/><Tooltip contentStyle={{ border: '1px solid #e5ece7', borderRadius: 12, direction: 'rtl', fontFamily: 'Vazirmatn', fontSize: 12 }} formatter={(value: unknown) => [value === null || value === undefined ? 'ثبت نشده' : faNumber(Number(value)), selectedField?.unit ?? 'مقدار']}/><Line type="monotone" dataKey="value" connectNulls={false} stroke="#4a9a75" strokeWidth={3} dot={{ r: 4, fill: '#fff', stroke: '#4a9a75', strokeWidth: 2 }} activeDot={{ r: 6, fill: '#4a9a75' }}/></LineChart></ResponsiveContainer></div><div className="historical-footnote"><span>شاخص انتخاب‌شده: <strong>{selectedField?.label ?? 'بدون شاخص عددی'}</strong></span><span>{faNumber(chartData.reduce((sum, row) => sum + row.reports, 0))} رکورد در این روند</span></div></>}</section>;
}

function escapeHtml(value: unknown) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character)); }
function openIndicatorsPdf(reports: Report[], companies: Company[], year: number) {
  const rows = reports.filter(report => report.category === 'indicators' && report.year === year && report.status === 'submitted');
  const companySections = companies.map(company => { const report = rows.find(item => item.companyId === company.id); const cells = categories.indicators.fields.map(field => `<tr><td>${escapeHtml(field.key)}</td><td>${escapeHtml(field.label)}</td><td>${escapeHtml(report?.values[field.key] ?? 'ثبت نشده')}</td><td>${escapeHtml(field.unit ?? '—')}</td></tr>`).join(''); return `<section class="company"><div class="company-head"><h2>${escapeHtml(company.name)}</h2><span class="${report ? 'ok' : 'missing'}">${report ? 'ثبت و ارسال شده' : 'گزارش ثبت نشده'}</span></div><table><thead><tr><th>کد</th><th>شاخص محیط‌زیستی وزارت نفت</th><th>مقدار</th><th>واحد</th></tr></thead><tbody>${cells}</tbody></table></section>`; }).join('');
  const submittedCompanies = rows.filter(report => companies.some(company => company.id === report.companyId)).length;
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) return;
  popup.document.write(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><title>گزارش سالانه شاخص‌های محیط‌زیستی ${escapeHtml(year)}</title><style>@import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700;800&display=swap');*{box-sizing:border-box}body{font-family:Vazirmatn,Tahoma,sans-serif;color:#203a30;margin:0;background:#f4f8f5;font-size:11px}.page{max-width:980px;margin:0 auto;background:#fff;padding:34px 40px}.cover{border-bottom:3px solid #347f5b;padding-bottom:24px;margin-bottom:22px}.brand{color:#347f5b;font-weight:800;font-size:13px}.cover h1{font-size:25px;margin:22px 0 8px;color:#1e4a38}.cover p{color:#799082;margin:0}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0 28px}.summary div{border:1px solid #e3ece6;border-radius:10px;padding:13px;background:#fbfdfb}.summary strong{display:block;font-size:20px;color:#347f5b}.summary span{font-size:9px;color:#8c9e93}.company{break-inside:avoid;margin:25px 0 34px}.company-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #dfeae2;padding-bottom:9px;margin-bottom:9px}.company-head h2{font-size:16px;margin:0;color:#285b43}.company-head span{font-size:9px;padding:5px 8px;border-radius:5px}.ok{background:#eaf6ec;color:#4f9569}.missing{background:#fff4e4;color:#b88945}table{width:100%;border-collapse:collapse}th{background:#edf6ef;color:#4b745b;font-weight:700}th,td{padding:7px 8px;border:1px solid #e2ebe4;text-align:right}td:first-child{width:70px;font-weight:700;color:#679276;direction:ltr;text-align:left}td:nth-child(3){font-weight:700;color:#365e47}footer{border-top:1px solid #e5eee8;margin-top:28px;padding-top:12px;color:#9aac9f;font-size:9px}@media print{body{background:#fff}.page{max-width:none;padding:12mm 10mm}.company{break-inside:avoid}button{display:none}@page{size:A4;margin:10mm}}</style></head><body><main class="page"><header class="cover"><div class="brand">زیست‌نگار · سامانه گزارش محیط‌زیست پتروشیمی</div><h1>گزارش جامع سالانه شاخص‌های محیط‌زیستی وزارت نفت</h1><p>سال گزارش: ${escapeHtml(faNumber(String(year)))} · تهیه‌شده از داده‌های ثبت‌شده در سامانه</p></header><div class="summary"><div><strong>${escapeHtml(faNumber(companies.length))}</strong><span>تعداد شرکت‌ها</span></div><div><strong>${escapeHtml(faNumber(submittedCompanies))}</strong><span>گزارش‌های ارسال‌شده</span></div><div><strong>${escapeHtml(faNumber(categories.indicators.fields.length))}</strong><span>شاخص‌های پوشش‌داده‌شده</span></div></div>${companySections || '<div style="padding:30px;text-align:center;color:#8da095">برای سال انتخاب‌شده گزارش ارسال‌شده‌ای وجود ندارد.</div>'}<footer>این گزارش از اطلاعات ثبت‌شده در سامانه تولید شده است. مقادیر خالی به معنی ثبت‌نشدن داده در زمان تهیه گزارش است.</footer></main><script>window.onload=()=>setTimeout(()=>window.print(),350)</script></body></html>`);
  popup.document.close();
}

function AdminCompanyStatus({ reports, companies }: { reports: Report[]; companies: Company[] }) {
  const expected = 7;
  const indicatorYears = useMemo(() => [...new Set(reports.filter(report => report.category === 'indicators').map(report => report.year))].sort((a, b) => b - a), [reports]);
  const [indicatorYear, setIndicatorYear] = useState(indicatorYears[0] ?? new Date().getFullYear() - 621);
  return <section className="panel company-status-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><Building2 size={17}/></span><h2>وضعیت ثبت گزارش شرکت‌ها</h2></div><p>کنترل سریع گزارش‌های شش‌ماهه و شاخص سالانه هر شرکت</p></div><div className="admin-report-actions"><label>سال شاخص‌ها<select value={indicatorYear} onChange={event => setIndicatorYear(Number(event.target.value))}>{indicatorYears.length ? indicatorYears.map(year => <option value={year} key={year}>{faNumber(String(year))}</option>) : <option value={indicatorYear}>{faNumber(String(indicatorYear))}</option>}</select></label><button className="outline-btn" type="button" disabled={!companies.length} onClick={() => openIndicatorsPdf(reports, companies, indicatorYear)}><Download size={15}/> دریافت گزارش PDF شاخص‌ها</button></div></div>{companies.length === 0 ? <div className="comparison-empty">هنوز شرکتی در سامانه ثبت نشده است. از بخش مدیریت شرکت‌ها، اولین شرکت را اضافه کنید.</div> : <div className="company-status-list">{companies.map(company => { const companyReports = reports.filter(report => report.companyId === company.id); const submitted = companyReports.filter(report => report.status === 'submitted').length; const drafts = companyReports.filter(report => report.status === 'draft').length; const coverage = Math.min(100, Math.round(submitted / expected * 100)); const missing = Math.max(0, expected - submitted - drafts); const status = submitted >= expected ? 'complete' : submitted + drafts > 0 ? 'partial' : 'empty'; return <div className="company-status-row" key={company.id}><div className="company-status-name"><span className="company-status-symbol"><Building2 size={17}/></span><div><strong>{company.name}</strong><small>{submitted} از {expected} گزارش ارسال شده</small></div></div><div className="company-progress"><div><span>پوشش ثبت</span><b>{faNumber(coverage)}٪</b></div><div className="progress-track"><span style={{ width: `${coverage}%`, background: status === 'complete' ? '#4b9a75' : status === 'partial' ? '#d2a451' : '#c7d4ca' }}/></div></div><div className="company-status-counts"><span className="status submitted"><i/>ارسال‌شده: {faNumber(submitted)}</span>{drafts > 0 && <span className="status draft"><i/>پیش‌نویس: {faNumber(drafts)}</span>}{missing > 0 && <span className="company-missing">ناقص: {faNumber(missing)}</span>}</div><span className={`company-state ${status}`}>{status === 'complete' ? 'کامل' : status === 'partial' ? 'نیازمند تکمیل' : 'بدون گزارش'}</span></div>; })}</div>}</section>;
}


type IndustryPoint = { year: number; label: string; sampled?: boolean; [key: string]: number | string | boolean | null | undefined };
function textOf(row: Record<string, unknown>, keys: string[]) { return keys.map(key => String(row[key] ?? '')).join(' ').toLocaleLowerCase(); }
function sumTopLevel(reports: Report[], year: number, category: Category, key: string, period?: 0 | 1 | 2): number | null {
  const values = reports.filter(report => report.status === 'submitted' && report.year === year && report.category === category && (period === undefined || report.period === period))
    .map(report => numericValue(report, key)).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}
function sumRowsFor(reports: Report[], year: number, category: Category, section: string, key: string, match?: (row: Record<string, unknown>) => boolean): number | null {
  const values = reports.filter(report => report.status === 'submitted' && report.year === year && report.category === category && report.period !== 0)
    .flatMap(report => rowValues(report, section)).filter(row => !match || match(row)).map(row => numericUnknown(row[key])).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}
function hasRowsFor(reports: Report[], year: number, category: Category, section: string, match: (row: Record<string, unknown>) => boolean) {
  return reports.filter(report => report.status === 'submitted' && report.year === year && report.category === category && report.period !== 0).flatMap(report => rowValues(report, section)).some(match);
}
function industryYears(reports: Report[]) { const latest = Math.max(1405, ...reports.filter(report => report.status === 'submitted').map(report => report.year)); return Array.from({ length: latest - 1400 + 1 }, (_, index) => 1400 + index); }
const officialIndustryTotals: Record<number, Record<string, number | null>> = {
  1403: { underground: 0, surface: 1800419046, network: 97772533, sea: null, cooling: 4106728482, process: 24717830, total: 4368547028, ordinary: 65912981, hazardous: 54691585, flare: 575785, co: null, nox: 37101, so2: 901, thc: 136595, methane: null, co2e: 20290180 },
  1404: { underground: 1350500, surface: 3482384983, network: 76191447, sea: null, cooling: 5782679432, process: 4191096, total: 6132728124, ordinary: 16625182, hazardous: 24554799, flare: 523569, co: null, nox: 5730, so2: 1006, thc: 6420, methane: null, co2e: 16085234 },
};
type IndustryData = { water: IndustryPoint[]; wastewater: IndustryPoint[]; waste: IndustryPoint[]; flaring: IndustryPoint[]; pollutants: IndustryPoint[]; co2e: IndustryPoint[] };
function applyOfficialIndustryTotals(data: IndustryData): IndustryData {
  return Object.fromEntries(Object.entries(data).map(([name, points]) => [name, points.map(point => {
    const official = officialIndustryTotals[point.year];
    if (!official) return point;
    const next = { ...point };
    Object.keys(official).forEach(key => { if (Object.prototype.hasOwnProperty.call(official, key)) next[key] = official[key]; });
    return next;
  })])) as IndustryData;
}
function industryData(reports: Report[]): IndustryData {
  const years = industryYears(reports);
  const data: IndustryData = {
    water: years.map(year => ({ year, label: faNumber(String(year)), underground: sumTopLevel(reports, year, 'indicators', 'E1', 0), surface: sumTopLevel(reports, year, 'indicators', 'E2', 0), network: sumTopLevel(reports, year, 'indicators', 'E3', 0), sea: sumRowsFor(reports, year, 'water', 'water_sources', 'amount', (row: Record<string, unknown>) => /دریا|خلیج|sea/i.test(textOf(row, ['source', 'water_type', 'supply_location'])) && /متر|m3|m³/i.test(textOf(row, ['unit']))) })),
    wastewater: years.map(year => { const cooling = (row: Record<string, unknown>) => /کولینگ|خنک|یک\s*بار\s*گذر|once.?through|cooling/i.test(textOf(row, ['stream_type', 'management'])); const process = (row: Record<string, unknown>) => /فرایند|فرآیند|صنعتی|process/i.test(textOf(row, ['stream_type', 'management'])); const coolingValue = sumRowsFor(reports, year, 'water', 'water_effluents', 'volume', cooling); const processValue = sumRowsFor(reports, year, 'water', 'water_effluents', 'volume', process); const totalRows = sumRowsFor(reports, year, 'water', 'water_effluents', 'volume'); const fallback = sumTopLevel(reports, year, 'water', 'wastewater_generated'); return { year, label: faNumber(String(year)), cooling: hasRowsFor(reports, year, 'water', 'water_effluents', cooling) ? coolingValue : null, process: hasRowsFor(reports, year, 'water', 'water_effluents', process) ? processValue : null, total: totalRows || fallback || null }; }),
    waste: years.map(year => ({ year, label: faNumber(String(year)), ordinary: sumTopLevel(reports, year, 'waste', 'non_hazardous_waste'), hazardous: sumTopLevel(reports, year, 'waste', 'hazardous_waste') })),
    flaring: years.map(year => ({ year, label: faNumber(String(year)), flare: sumTopLevel(reports, year, 'indicators', 'E13', 0) || sumRowsFor(reports, year, 'air', 'air_flaring', 'flare_gas') })),
    pollutants: years.map(year => ({ year, label: faNumber(String(year)), co: sumRowsFor(reports, year, 'air', 'air_flaring', 'co'), nox: sumTopLevel(reports, year, 'indicators', 'E16', 0) ?? sumRowsFor(reports, year, 'air', 'air_flaring', 'nox'), so2: sumTopLevel(reports, year, 'indicators', 'E15', 0) ?? sumRowsFor(reports, year, 'air', 'air_flaring', 'so2'), thc: sumTopLevel(reports, year, 'indicators', 'E17', 0) ?? sumRowsFor(reports, year, 'air', 'air_flaring', 'thc'), methane: sumRowsFor(reports, year, 'air', 'air_flaring', 'methane') })),
    co2e: years.map(year => ({ year, label: faNumber(String(year)), co2e: sumTopLevel(reports, year, 'indicators', 'E14', 0) || sumTopLevel(reports, year, 'air', 'greenhouse_gases') })),
  };
  return applyOfficialIndustryTotals(data);
}
function DataQualityAlerts({ reports, companies }: { reports: Report[]; companies: Company[] }) {
  const fields = categories.indicators.fields.filter(field => field.type !== 'text');
  const years = Array.from({ length: 6 }, (_, index) => 1400 + index);
  const submitted = reports.filter(report => report.category === 'indicators' && report.period === 0 && report.status === 'submitted');
  const missingReports: { company: string; year: number; reason: string }[] = [];
  const partialReports: { company: string; year: number; reason: string }[] = [];
  companies.forEach(company => years.forEach(year => {
    const report = submitted.find(item => item.companyId === company.id && item.year === year);
    if (!report) missingReports.push({ company: company.name, year, reason: 'گزارش شاخص سالانه ثبت نشده است؛ شیت سالانه بررسی شود.' });
    else {
      const missing = fields.filter(field => numericValue(report, field.key) === null);
      if (missing.length) partialReports.push({ company: company.name, year, reason: `${faNumber(missing.length)} شاخص خالی است: ${missing.slice(0, 4).map(field => field.key).join('، ')}${missing.length > 4 ? ' و موارد دیگر' : ''}` });
    }
  }));
  const aggregateChecks = [1403, 1404].flatMap(year => {
    const official = officialIndustryTotals[year];
    const yearReports = submitted.filter(report => report.year === year);
    return ['underground', 'surface', 'network', 'ordinary', 'hazardous', 'flare', 'nox', 'so2', 'thc', 'co2e'].flatMap(key => {
      const target = official?.[key];
      if (target === null || target === undefined) return [];
      const field = ({ underground: 'E1', surface: 'E2', network: 'E3', ordinary: 'E9', hazardous: 'E8', flare: 'E13', nox: 'E16', so2: 'E15', thc: 'E17', co2e: 'E14' } as Record<string, string>)[key];
      const current = yearReports.reduce((sum, report) => sum + (numericValue(report, field) ?? 0), 0);
      const difference = Math.abs(target - current);
      return difference > Math.max(1, Math.abs(target) * 0.03) ? [{ company: 'مجموع صنعت', year, reason: `${key} با شیت تجمیعی ${faNumber((difference / Math.max(1, Math.abs(target)) * 100).toFixed(1))}٪ اختلاف دارد؛ پوشش شرکت‌ها بررسی شود.` }] : [];
    });
  });
  const alerts = [...missingReports, ...partialReports, ...aggregateChecks];
  const sourceChecks = [
    { year: 1403, label: 'تب عسلویه - سال', state: 'تطبیق‌شده با ۳۷ شرکت' },
    { year: 1404, label: 'تب عسلویه - سال', state: 'تطبیق‌شده با ۳۴ شرکت' },
  ];
  return <section className="data-quality-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><AlertCircle size={17}/></span><h2>مرکز هشدار کیفیت داده</h2></div><p>کنترل خودکار گزارش‌های خالی، ناقص و اختلاف با شیت‌های تجمیعی</p></div><span className={alerts.length ? 'quality-badge warning' : 'quality-badge ok'}>{alerts.length ? `${faNumber(alerts.length)} هشدار فعال` : 'بدون هشدار'}</span></div><div className="quality-summary"><div><strong>{faNumber(missingReports.length)}</strong><span>گزارش سالانه خالی</span></div><div><strong>{faNumber(partialReports.length)}</strong><span>گزارش ناقص</span></div><div><strong>{faNumber(aggregateChecks.length)}</strong><span>اختلاف با تجمیع رسمی</span></div><div><strong>{faNumber(fields.length)}</strong><span>شاخص تحت پایش</span></div></div><div className="quality-sources"><strong>وضعیت کنترل شیت‌ها</strong>{sourceChecks.map(item => <span key={item.year}><b>{faNumber(String(item.year))}</b>{item.label} · {item.state}</span>)}</div>{alerts.length ? <div className="quality-alert-list">{alerts.slice(0, 12).map((alert, index) => <div className="quality-alert" key={`${alert.company}-${alert.year}-${index}`}><AlertCircle size={15}/><div><strong>{alert.company} · سال {faNumber(String(alert.year))}</strong><span>{alert.reason}</span></div></div>)}{alerts.length > 12 && <small className="quality-more">{faNumber(alerts.length - 12)} هشدار دیگر در همین بررسی شناسایی شد.</small>}</div> : <div className="quality-clear"><CheckCircle2 size={16}/> همه گزارش‌های شرکت‌ها و مجموع‌های رسمی در محدودهٔ کنترل قرار دارند.</div>}</section>;
}

function IndustryChart({ title, subtitle, data, bars, height = 235 }: { title: string; subtitle: string; data: IndustryPoint[]; bars: { key: string; name: string; color: string }[]; height?: number }) {
  const chartData = data.map(point => Object.fromEntries(Object.entries(point).map(([key, value]) => {
    if (value === null || value === undefined || value === '') return [key, null];
    if (key !== 'year' && key !== 'label' && key !== 'sampled') { const numeric = Number(String(value).replace(/,/g, '')); return [key, Number.isFinite(numeric) ? numeric : null]; }
    return [key, value];
  })) as IndustryPoint);
  const hasValue = chartData.some(point => bars.some(bar => typeof point[bar.key] === 'number' && Number.isFinite(point[bar.key]) && point[bar.key] !== 0));
  return <div className="industry-chart-card"><div className="industry-chart-heading"><div><h3>{title}</h3><p>{subtitle}</p></div><BarChart3 size={18}/></div>{!hasValue ? <div className="comparison-empty">برای این شاخص در گزارش‌های ارسال‌شده دادهٔ عددی وجود ندارد.</div> : <><div className="industry-chart" dir="ltr" style={{ height }}><div className="industry-static-bars">{chartData.map(point => { const values = bars.map(bar => typeof point[bar.key] === 'number' ? Number(point[bar.key]) : 0); const max = Math.max(1, ...chartData.flatMap(item => bars.map(bar => typeof item[bar.key] === 'number' ? Math.abs(Number(item[bar.key])) : 0))); return <div className="industry-static-column" key={String(point.year)}><div className="industry-static-column-bars">{bars.map((bar, index) => { const value = values[index]; return <span key={bar.key} title={`${bar.name}: ${value ? faNumber(value) : 'ثبت نشده'}`} style={{ height: `${value ? Math.max(2, Math.abs(value) / max * 100) : 0}%`, background: bar.color }} />; })}</div><small>{point.label}</small></div>; })}</div></div><div className="industry-chart-note">منبع: شیت تجمیعی رسمی کل کشور برای ۱۴۰۳ و ۱۴۰۴ یا گزارش‌های ارسال‌شدهٔ شرکت‌ها برای سال‌های دیگر. مقدار ساختگی در این نمودار استفاده نمی‌شود.</div></>}</div>;
}
function IndustryOverview({ reports }: { reports: Report[] }) {
  const [viewYear, setViewYear] = useState('all');
  const data = useMemo(() => industryData(reports), [reports]);
  const filter = (points: IndustryPoint[]) => viewYear === 'all' ? points : points.filter(point => point.year === Number(viewYear));
  const years = industryYears(reports).reverse();
  const f = { water: filter(data.water), wastewater: filter(data.wastewater), waste: filter(data.waste), flaring: filter(data.flaring), pollutants: filter(data.pollutants), co2e: filter(data.co2e) };
  return <section className="industry-overview"><div className="industry-overview-head"><div><div className="eyebrow"><span/> نمای کلی صنعت پتروشیمی <b>/</b> تجمیع داده‌های محیط‌زیستی</div><h2>تصویر یکپارچه عملکرد محیط‌زیستی صنعت</h2><p>برای سال‌های ۱۴۰۳ و ۱۴۰۴ از ارقام رسمی شیت تجمیعی کل کشور و برای سایر سال‌ها از مجموع گزارش‌های ارسال‌شده استفاده می‌شود.</p></div><label>سال نمایش<select value={viewYear} onChange={event => setViewYear(event.target.value)}><option value="all">همه سال‌ها</option>{years.map(year => <option value={year} key={year}>{faNumber(String(year))}</option>)}</select></label></div><div className="industry-kpis"><div><Droplets size={18}/><span>برداشت آب</span><strong>{faNumber(f.water.reduce((sum, point) => sum + (Number(point.underground) || 0) + (Number(point.surface) || 0) + (Number(point.sea) || 0), 0))}<small> m³</small></strong></div><div><Waves size={18}/><span>پساب تولیدی</span><strong>{faNumber(f.wastewater.reduce((sum, point) => sum + (Number(point.total) || 0), 0))}<small> m³</small></strong></div><div><Recycle size={18}/><span>کل پسماند</span><strong>{faNumber(f.waste.reduce((sum, point) => sum + (Number(point.ordinary) || 0) + (Number(point.hazardous) || 0), 0))}<small> تن</small></strong></div><div><Flame size={18}/><span>گاز فلر</span><strong>{faNumber(f.flaring.reduce((sum, point) => sum + (Number(point.flare) || 0), 0))}<small> ton</small></strong></div></div><div className="industry-sample-notice">منبع داده: شیت تجمیعی رسمی کل کشور برای سال‌های ۱۴۰۳ و ۱۴۰۴؛ سال‌های دیگر از گزارش‌های ارسال‌شدهٔ تفکیکی شرکت‌ها محاسبه شده‌اند. مقدار فاقد داده به‌صورت صفر یا نمونه جایگزین نمی‌شود.</div><div className="industry-chart-grid"><IndustryChart title="برداشت آب به تفکیک منبع" subtitle="زیرزمینی، سطحی و شبکه/تأسیسات · m³" data={f.water} bars={[{ key: 'underground', name: 'زیرزمینی', color: '#3c9a73' }, { key: 'surface', name: 'سطحی', color: '#6c9cc7' }, { key: 'network', name: 'شبکه/تأسیسات', color: '#8b78bd' }, { key: 'sea', name: 'دریا', color: '#4aa9b1' }]}/><IndustryChart title="پساب تولیدی به تفکیک جریان" subtitle="کولینگ یک‌بارگذر، فرایندی و کل پساب · m³" data={f.wastewater} bars={[{ key: 'cooling', name: 'کولینگ یک‌بارگذر', color: '#5d9fc0' }, { key: 'process', name: 'پساب فرایندی', color: '#8b78bd' }, { key: 'total', name: 'کل پساب', color: '#3c9a73' }]}/><IndustryChart title="پسماند تولیدی" subtitle="عادی و خطرناک · تن" data={f.waste} bars={[{ key: 'ordinary', name: 'عادی / غیرخطرناک', color: '#d0a044' }, { key: 'hazardous', name: 'خطرناک', color: '#c87563' }]}/><IndustryChart title="گاز ارسالی به فلر" subtitle="تجمیع E13 و فرم فلرینگ · ton" data={f.flaring} bars={[{ key: 'flare', name: 'فلرینگ', color: '#d07b63' }]}/><IndustryChart title="آلاینده‌های ناشی از فلرینگ" subtitle="CO، NOx، SO₂، THC و متان · واحد مندرج در گزارش" data={f.pollutants} bars={[{ key: 'co', name: 'CO', color: '#9a7b65' }, { key: 'nox', name: 'NOx', color: '#7d8fc8' }, { key: 'so2', name: 'SO₂', color: '#d0a044' }, { key: 'thc', name: 'THC', color: '#76a88a' }, { key: 'methane', name: 'متان', color: '#7e9eaf' }]}/><IndustryChart title="گازهای گلخانه‌ای معادل CO₂" subtitle="E14 یا گازهای گلخانه‌ای ثبت‌شده · ton CO₂e" data={f.co2e} bars={[{ key: 'co2e', name: 'CO₂e', color: '#527f8b' }]}/></div></section>;
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
    {!isAdmin && <CompanyEnvironmentalDashboard reports={reports}/>} 
    <div className="section-label"><div><span className="section-dot"/> خلاصه وضعیت <span className="muted-label">{demo ? '· نمایش نمونه' : '· اطلاعات حساب شما'}</span></div><label className="dashboard-year-filter">سال نمایش<select value={selectedYear} onChange={event => setSelectedYear(event.target.value)}><option value="all">همه سال‌ها</option>{years.map(year => <option value={year} key={year}>{faNumber(String(year))}</option>)}</select></label></div>
    <section className="kpi-grid">
      <div className="kpi-card featured"><div className="kpi-head"><span>کل گزارش‌ها</span><span className="kpi-icon"><FileText size={20}/></span></div><div className="kpi-value">{faNumber(reports.length)} <small>گزارش</small></div><div className="featured-bottom"><span><BarChart3 size={14}/> در همه حوزه‌ها</span><span className="white-arrow"><ArrowUpLeft size={15}/></span></div><div className="kpi-rings" /></div>
      <div className="kpi-card"><div className="kpi-head"><span>گزارش‌های ارسال‌شده</span><span className="kpi-icon pale-green"><FileCheck2 size={19}/></span></div><div className="kpi-value">{faNumber(submitted)} <small>گزارش</small></div><div className="kpi-foot"><span className="soft-badge green"><CheckCircle2 size={13}/> {reports.length ? `${faNumber(ratio)}٪` : '—'}</span><span>از کل گزارش‌ها</span></div></div>
      <div className="kpi-card"><div className="kpi-head"><span>در حال تکمیل</span><span className="kpi-icon pale-amber"><Clock3 size={19}/></span></div><div className="kpi-value">{faNumber(drafts)} <small>گزارش</small></div><div className="kpi-foot"><span className="soft-badge amber">پیش‌نویس</span><span>نیازمند بررسی و تکمیل</span></div></div>
      <div className="kpi-card"><div className="kpi-head"><span>{isAdmin ? 'شرکت‌ها' : 'پوشش ثبت گزارش'}</span><span className="kpi-icon pale-blue">{isAdmin ? <Building2 size={19}/> : <FileBarChart2 size={19}/>}</span></div><div className="kpi-value">{faNumber(isAdmin ? companies.length : coverage)} <small>{isAdmin ? 'شرکت' : '٪'}</small></div><div className="kpi-foot"><span className="soft-badge blue">{isAdmin ? 'در دسترس' : 'پوشش تقریبی'}</span><span>{isAdmin ? 'در نمای فعلی' : `${faNumber(expectedPerYear)} گزارش هدف در سال`}</span></div></div>
    </section>
    {isAdmin && <IndustryOverview reports={reports}/>}
    {isAdmin && <DataQualityAlerts reports={reports} companies={companies}/>}
    {isAdmin && <section className="dashboard-grid"><div className="panel trend-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><BarChart3 size={17}/></span><h2>روند گزارش‌دهی</h2></div><p>تعداد گزارش‌ها به تفکیک حوزه و دوره</p></div><button className="small-select" onClick={() => setView('analytics')}>مشاهده تحلیل <ChevronDown size={14}/></button></div><div className="chart-legend"><span><i className="legend-water"/>آب و پساب</span><span><i className="legend-waste"/>پسماند</span><span><i className="legend-air"/>هوا</span></div><ReportsChart reports={visibleReports}/></div>
      <div className="panel overview-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><CheckCircle2 size={17}/></span><h2>وضعیت گزارش‌ها</h2></div><p>نگاهی به گزارش‌های موجود</p></div><MoreHorizontal size={20} color="#a4b1aa"/></div><div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(#4a9a75 0% ${ratio}%, #e9f0eb ${ratio}% 100%)` }}><div><strong>{reports.length ? `${faNumber(ratio)}٪` : '—'}</strong><span>{reports.length ? 'ارسال شده' : 'داده‌ای نیست'}</span></div></div></div><div className="donut-stats"><div><i className="dot-green"/><span>ارسال شده</span><b>{faNumber(submitted)}</b></div><div><i className="dot-light"/><span>پیش‌نویس</span><b>{faNumber(drafts)}</b></div></div></div></section>}
    {isAdmin && <><SemiannualComparison reports={visibleReports} isAdmin={isAdmin}/><HistoricalTrend reports={visibleReports} isAdmin={isAdmin}/></>}
    {isAdmin && <AdminCompanyStatus reports={visibleReports} companies={companies}/>} 
    <section className="bottom-grid"><div className="panel recent-panel"><div className="panel-heading recent-heading"><div><div className="panel-title"><span className="mini-icon"><FileText size={17}/></span><h2>آخرین گزارش‌ها</h2></div><p>فهرست آخرین گزارش‌های موجود در سامانه</p></div><button className="text-link" onClick={() => setView('archive')}>مشاهده همه <ArrowLeft size={15}/></button></div><ReportTable reports={sorted.slice(0, 5)} companies={companies} openReport={openReport}/></div>
      <div className="panel quick-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><ArrowDownLeft size={17}/></span><h2>دسترسی سریع</h2></div><p>ثبت اطلاعات در حوزه‌های مختلف</p></div></div><div className="quick-list">{orderedCategories.map(category => { const item = categories[category]; const Icon = item.icon; return <button key={category} onClick={() => setView(category)}><span className={`quick-icon icon-${category}`}><Icon size={18}/></span><span><strong>{item.label}</strong><small>{category === 'indicators' ? 'گزارش سالیانه' : 'گزارش شش‌ماهه'}</small></span><ArrowLeft size={16}/></button>; })}</div></div></section>
  </>;
}

export function Analytics({ reports, setView }: { reports: Report[]; setView: (view: View) => void }) {
  return <><section className="page-intro"><div className="eyebrow"><span /> گزارش‌ها <b>/</b> تحلیل و نمودارها</div><h1>تحلیل و نمودارها</h1><p>نمایی از تعداد گزارش‌های موجود در هر دوره و حوزه</p></section><div className="analytics-layout"><div className="panel trend-panel"><div className="panel-heading"><div><div className="panel-title"><span className="mini-icon"><BarChart3 size={17}/></span><h2>روند گزارش‌دهی</h2></div><p>تعداد گزارش‌ها به تفکیک دوره</p></div><button className="text-link" onClick={() => setView('archive')}>آرشیو گزارش‌ها <ArrowLeft size={15}/></button></div><div className="chart-legend"><span><i className="legend-water"/>آب و پساب</span><span><i className="legend-waste"/>پسماند</span><span><i className="legend-air"/>هوا</span></div><ReportsChart reports={reports}/></div><div className="panel category-summary"><div className="panel-title"><span className="mini-icon"><BarChart3 size={17}/></span><h2>گزارش‌ها به تفکیک حوزه</h2></div><p className="panel-sub">تعداد گزارش‌ها در نمای فعلی</p>{orderedCategories.map(category => { const count = reports.filter(report => report.category === category).length; const percent = reports.length ? count / reports.length * 100 : 0; const Icon = categories[category].icon; return <div className="category-line" key={category}><div><span><Icon size={15}/> {categories[category].label}</span><b>{faNumber(count)}</b></div><div className="progress-track"><span style={{ width: `${percent}%`, background: categories[category].color }}/></div></div>; })}</div></div></>;
}
