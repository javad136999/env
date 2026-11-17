import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronLeft, Info, Plus, Save, Search, Send, Trash2 } from 'lucide-react';
import { categories, companyName, faNumber, periodLabel, referenceLabel, rowSections, type Category, type Company, type Report, type ReportStatus, type Warning } from './data';
import type { View } from './Dashboard';
import { envFetch } from './api';

type Props = { category: Category; companies: Company[]; reports: Report[]; initialReport?: Report; canSave: boolean; demo: boolean; setView: (view: View) => void; onSaved: (report: Report) => void };
const normalizeNumber = (value: string) => value.replace(/[۰-۹]/g, n => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(n))).replace(/[٠-٩]/g, n => String('٠١٢٣٤٥٦٧٨٩'.indexOf(n))).replace(/,/g, '').trim();
type InputRow = Record<string, string>;
function readFieldComments(report?: Report): Record<string, string> {
  try {
    const raw = report?.values.field_comments;
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string'))
      : {};
  } catch { return {}; }
}

const indicatorSources = [
  { target: 'E7_volume', category: 'water', key: 'wastewater_generated', label: 'پساب تولیدی', sourceUnit: 'm³', targetUnit: 'm³', factor: 1 },
  { target: 'E8', category: 'waste', key: 'hazardous_waste', label: 'پسماند خطرناک تولیدی', sourceUnit: 'تن', targetUnit: 'kg', factor: 1000 },
  { target: 'E9', category: 'waste', key: 'non_hazardous_waste', label: 'پسماند غیرخطرناک تولیدی', sourceUnit: 'تن', targetUnit: 'kg', factor: 1000 },
  { target: 'E15', category: 'air', key: 'sox', label: 'انتشار SOx', sourceUnit: 'تن', targetUnit: 'ton', factor: 1 },
  { target: 'E16', category: 'air', key: 'nox', label: 'انتشار NOx', sourceUnit: 'تن', targetUnit: 'ton', factor: 1 },
  { target: 'E17', category: 'air', key: 'voc', label: 'انتشار VOC', sourceUnit: 'تن', targetUnit: 'ton', factor: 1 },
] as const;

type AutoSuggestion = { value: string | null; description: string; halves?: string[] };

function validYear(year: string): boolean {
  return /^\d{4}$/.test(year) && Number(year) >= 1300 && Number(year) <= 1500;
}

// Reject blank, malformed, negative and non-finite source values; zero is valid.
function nonNegativeNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[۰-۹]/g, n => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(n))).replace(/[٠-٩]/g, n => String('٠١٢٣٤٥٦٧٨٩'.indexOf(n))).trim();
  if (digits.includes(',') && !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?(?:[eE][+-]?\d+)?$/.test(digits)) return null;
  const normalized = digits.replace(/,/g, '');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || (parsed === 0 && /[1-9]/.test(normalized.split(/[eE]/)[0]))) return null;
  return parsed;
}

// Sum decimal representations before converting back to the numeric API type.
function decimalSum(first: number, second: number, factor: 1 | 1000): number | null {
  const parts = (value: number) => {
    const [mantissa, exponent = '0'] = String(value).split('e');
    const [whole, fractional = ''] = mantissa.split('.');
    return { digits: BigInt(whole + fractional), exponent: Number(exponent) - fractional.length };
  };
  const a = parts(first); const b = parts(second);
  const exponent = Math.min(a.exponent, b.exponent);
  const digits = a.digits * 10n ** BigInt(a.exponent - exponent) + b.digits * 10n ** BigInt(b.exponent - exponent);
  const total = Number(`${digits}e${exponent + (factor === 1000 ? 3 : 0)}`);
  return Number.isFinite(total) ? total : null;
}

export function indicatorAutofill(reports: Report[], companyId: string, year: string): Record<string, AutoSuggestion> {
  return Object.fromEntries(indicatorSources.map(source => {
    const halves = ([1, 2] as const).map(period => {
      const title = period === 1 ? 'نیمسال اول' : 'نیمسال دوم';
      if (!companyId || !validYear(year)) return { value: null, text: `${title}: شرکت یا سال معتبر انتخاب نشده است.` };
      const matching = reports.filter(report => report.companyId === companyId && report.year === Number(year) && report.category === source.category && report.period === period);
      if (!matching.length) return { value: null, text: `${title}: گزارش وجود ندارد؛ داده کافی نیست.` };
      if (matching.length !== 1) return { value: null, text: `${title}: چند گزارش منطبق وجود دارد؛ منبع نامشخص است.` };
      const report = matching[0];
      if (report.status !== 'submitted') return { value: null, text: `${title}: گزارش ارسال‌شده نیست؛ داده کافی نیست.` };
      const raw = report.values[source.key];
      if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return { value: null, text: `${title}: مقدار منبع خالی است؛ داده کافی نیست.` };
      const value = nonNegativeNumber(raw);
      if (value === null) return { value: null, text: `${title}: مقدار منبع نامعتبر است؛ داده کافی نیست.` };
      return { value, text: `${title}: گزارش ارسال‌شده، ${faNumber(String(value))} ${source.sourceUnit}.` };
    });
    const complete = halves[0].value !== null && halves[1].value !== null;
    const total = complete ? decimalSum(halves[0].value!, halves[1].value!, source.factor) : null;
    const overflow = complete && total === null;
    return [source.target, {
      value: total === null ? null : String(total),
      description: `منبع: ${categories[source.category].label}، ${source.label} (${source.key})؛ جمع دو نیمسال همان شرکت و سال${source.factor === 1000 ? `، تبدیل تن به ${source.targetUnit} با ضرب در ۱۰۰۰` : `، واحد ${source.sourceUnit}`}.${overflow ? ' مجموع یا تبدیل خارج از محدوده عددی معتبر است.' : ''}`,
      halves: halves.map(half => half.text),
    }];
  }));
}

export function e20Autofill(values: Record<string, string>): AutoSuggestion {
  const monitored = nonNegativeNumber(values.E20_monitored);
  const eligible = nonNegativeNumber(values.E20_eligible);
  const description = 'فرمول: E20_monitored ÷ E20_eligible × ۱۰۰؛ فقط با مخرج مثبت و صورت نامنفی و حداکثر برابر مخرج.';
  if (monitored === null || eligible === null) return { value: null, description: `${description} تعدادهای معتبر هر دو فیلد لازم است.` };
  if (eligible <= 0) return { value: null, description: `${description} مخرج باید مثبت باشد.` };
  if (monitored > eligible) return { value: null, description: `${description} تعداد پایش‌شده بیشتر از تعداد مشمول است.` };
  return { value: String(monitored / eligible * 100), description };
}

export function applyAutofill(values: Record<string, string>, suggestions: Record<string, AutoSuggestion>, suppressed: Record<string, boolean>): Record<string, string> {
  const result = { ...values };
  for (const [key, suggestion] of Object.entries(suggestions)) {
    if (!(values[key] ?? '').trim() && !suppressed[key] && suggestion.value !== null) result[key] = suggestion.value;
  }
  return result;
}

export function comparableReport(reports: Report[], companyId: string, category: Category, year: string, period: 1 | 2, initialReportId?: string): Report | undefined {
  if (!validYear(year)) return undefined;
  return reports.find(item => item.companyId === companyId && item.category === category && item.id !== initialReportId && item.year === Number(year) - 1 && item.period === (category === 'indicators' ? 0 : period));
}

function readRows(report: Report | undefined, category: Category): Record<string, InputRow[]> {
  return Object.fromEntries(rowSections[category].map(section => {
    try {
      const raw = report?.values[section.key];
      const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : [];
      const rows = Array.isArray(parsed) ? parsed.filter(row => row && typeof row === 'object' && !Array.isArray(row)).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? '')]))) : [];
      return [section.key, rows];
    } catch { return [section.key, []]; }
  }));
}

export function ReportForm({ category, companies, reports, initialReport, canSave, demo, setView, onSaved }: Props) {
  const definition = categories[category];
  const Icon = definition.icon;
  const [companyId, setCompanyId] = useState(initialReport?.companyId || companies[0]?.id || '');
  const [year, setYear] = useState(String(initialReport?.year ?? new Intl.DateTimeFormat('fa-IR-u-nu-latn', { year: 'numeric' }).format(new Date())));
  const [period, setPeriod] = useState<1 | 2>(initialReport?.period === 2 ? 2 : 1);
  const [savedId, setSavedId] = useState(initialReport?.id);
  const [revision, setRevision] = useState(initialReport?.revision);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initialReport?.values ?? {}).map(([key, value]) => [key, String(value)])));
  const [fieldComments, setFieldComments] = useState<Record<string, string>>(() => readFieldComments(initialReport));
  // A deliberately cleared field stays blank until the user opts back into autofill.
  const [suppressed, setSuppressed] = useState<Record<string, boolean>>({});
  const [rows, setRows] = useState<Record<string, InputRow[]>>(() => readRows(initialReport, category));
  const [fieldSearch, setFieldSearch] = useState('');
  const [showOnlyEmpty, setShowOnlyEmpty] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [serverWarnings, setServerWarnings] = useState<Warning[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!companyId && companies[0]) setCompanyId(companies[0].id); }, [companies, companyId]);
  const suggestions = useMemo<Record<string, AutoSuggestion>>(() => category === 'indicators' ? { ...indicatorAutofill(reports, companyId, year), E20: e20Autofill(values) } : {}, [category, reports, companyId, year, values]);
  const effectiveValues = applyAutofill(values, suggestions, suppressed);
  const visibleFields = definition.fields.filter(field => {
    const matchesSearch = !fieldSearch.trim() || `${field.label} ${field.key}`.toLocaleLowerCase().includes(fieldSearch.trim().toLocaleLowerCase());
    const isEmpty = !(effectiveValues[field.key] ?? '').trim();
    return matchesSearch && (!showOnlyEmpty || isEmpty);
  });
  const filledFieldCount = definition.fields.filter(field => (effectiveValues[field.key] ?? '').trim()).length;
  const legacySource = typeof initialReport?.values.legacy_source === 'string' ? initialReport.values.legacy_source : undefined;
  const previous = useMemo(() => comparableReport(reports, companyId, category, year, period, initialReport?.id), [reports, companyId, category, year, period, initialReport?.id]);
  const comparisons = definition.fields.flatMap<Warning>(field => {
    if (field.type === 'text') return [];
    const currentRaw = effectiveValues[field.key];
    const priorRaw = previous?.values[field.key];
    const current = nonNegativeNumber(currentRaw); const prior = nonNegativeNumber(priorRaw);
    if (current === null || prior === null) return [];
    if (prior === 0) return [{ field: field.key, message: `${field.label}: مقدار دوره مشابه سال قبل صفر است؛ درصد تغییر قابل محاسبه نیست.`, change: null }];
    const change = (current - prior) / Math.abs(prior) * 100;
    const threshold = category === 'indicators' ? 30 : 20;
    return Number.isFinite(change) && Math.abs(change) >= threshold ? [{ field: field.key, message: `${field.label}: تغییر ${faNumber(Math.abs(change))}٪ نسبت به دوره مشابه سال قبل.`, change }] : [];
  });
  async function submit(status: ReportStatus) {
    setMessage(null); setServerWarnings([]);
    if (!canSave) { setMessage({ kind: 'error', text: 'درخواست ثبت انجام نشد. برای ذخیره، اتصال تنظیم‌شده و دسترسی تأییدشده لازم است؛ تغییرات این فرم فقط موقت‌اند.' }); return; }
    if (!companyId || !validYear(year)) { setMessage({ kind: 'error', text: 'لطفاً شرکت و سال معتبر بین ۱۳۰۰ تا ۱۵۰۰ را انتخاب کنید.' }); return; }
    if (savedId && revision === undefined) { setMessage({ kind: 'error', text: 'نسخه گزارش برای ویرایش در دسترس نیست. اطلاعات را از سرور بازخوانی کنید.' }); return; }
    const knownKeys = new Set([...definition.fields.map(field => field.key), ...rowSections[category].map(section => section.key), 'field_comments']);
    const output: Record<string, string | number> = Object.fromEntries(Object.entries(initialReport?.values ?? {}).filter(([key]) => !knownKeys.has(key)));
    for (const field of definition.fields) {
      const raw = (effectiveValues[field.key] ?? '').trim();
      if (!raw) continue;
      if (field.type === 'text') { output[field.key] = raw; continue; }
      const parsed = nonNegativeNumber(raw);
      if (parsed === null) { setMessage({ kind: 'error', text: `مقدار «${field.label}» باید عددی نامنفی باشد.` }); return; }
      output[field.key] = parsed;
    }
    for (const section of rowSections[category]) {
      const resultRows: Record<string, string | number>[] = [];
      for (const row of rows[section.key] ?? []) {
        const outputRow: Record<string, string | number> = {};
        for (const field of section.fields) {
          const raw = (row[field.key] ?? '').trim();
          if (!raw) continue;
          if (field.type === 'text') { outputRow[field.key] = raw; continue; }
          const parsed = nonNegativeNumber(raw);
          if (parsed === null) { setMessage({ kind: 'error', text: `مقدار «${field.label}» در بخش ${section.title} باید عددی نامنفی باشد.` }); return; }
          outputRow[field.key] = parsed;
        }
        if (Object.keys(outputRow).length) resultRows.push(outputRow);
      }
      if (resultRows.length) output[section.key] = JSON.stringify(resultRows);
    }
    if (!Object.keys(output).length) { setMessage({ kind: 'error', text: 'حداقل یک مقدار را وارد کنید.' }); return; }
    if (category === 'indicators') {
      const comments = Object.fromEntries(Object.entries(fieldComments).filter(([, comment]) => comment.trim()).map(([key, comment]) => [key, comment.trim()]));
      if (Object.keys(comments).length) output.field_comments = JSON.stringify(comments);
    }
    const report: Omit<Report, 'id'> & { id?: string } = { ...(savedId ? { id: savedId, revision } : {}), companyId, year: Number(year), period: category === 'indicators' ? 0 : period, category, values: output, status };
    setSaving(true);
    try {
      const response = await envFetch('/api/env/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
      if (response.status === 409) { setMessage({ kind: 'error', text: 'این گزارش هم‌زمان تغییر کرده است. آخرین نسخه را از آرشیو باز کنید و دوباره ویرایش کنید.' }); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result: { report?: Report; warnings?: Warning[] } = await response.json();
      if (!result.report) throw new Error('پاسخ نامعتبر');
      setSavedId(result.report.id); setRevision(result.report.revision); onSaved(result.report); setServerWarnings(Array.isArray(result.warnings) ? result.warnings : []);
      setMessage({ kind: 'success', text: status === 'submitted' ? 'گزارش با پاسخ موفق سرور ارسال شد.' : 'پیش‌نویس با پاسخ موفق سرور ثبت شد.' });
    } catch { setMessage({ kind: 'error', text: 'درخواست ثبت ناموفق بود. ارتباط و تنظیمات سرور را بررسی کنید؛ ثبت گزارش تأیید نشده است.' }); }
    finally { setSaving(false); }
  }
  return <><section className="page-intro"><div className="eyebrow"><span /> گزارش‌ها <b>/</b> {definition.label}</div><div className="intro-line"><div><h1>{initialReport ? 'مشاهده و ویرایش گزارش' : `گزارش ${definition.label}`}</h1><p>{definition.description}</p></div><button className="outline-btn" onClick={() => setView('archive')}>بازگشت به آرشیو <ArrowLeft size={16}/></button></div></section>
    <div className="form-layout"><div className="form-main"><section className="panel form-panel"><div className="form-panel-heading"><span className={`large-category-icon icon-${category}`}><Icon size={22}/></span><div><h2>مشخصات گزارش</h2><p>ابتدا شرکت و دوره گزارش را مشخص کنید.</p></div></div><div className="form-grid meta-grid"><label>شرکت <span>*</span><select value={companyId} onChange={event => { setCompanyId(event.target.value); setServerWarnings([]); }}><option value="">انتخاب شرکت</option>{companies.map(company => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><label>سال گزارش <span>*</span><input type="text" inputMode="numeric" value={year} onChange={event => { setYear(normalizeNumber(event.target.value)); setServerWarnings([]); }} placeholder="مثلاً ۱۴۰۴" aria-describedby="report-year-range"/><small id="report-year-range">سال مجاز: ۱۳۰۰ تا ۱۵۰۰</small></label><label>دوره گزارش<select disabled={category === 'indicators'} value={category === 'indicators' ? '0' : String(period)} onChange={event => { setPeriod(Number(event.target.value) as 1 | 2); setServerWarnings([]); }}>{category === 'indicators' ? <option value="0">سالیانه</option> : <><option value="1">شش‌ماهه اول</option><option value="2">شش‌ماهه دوم</option></>}</select></label></div></section>
      <section className="panel form-panel data-panel"><div className="form-panel-heading"><span className="large-category-icon neutral-icon"><FileTextIcon/></span><div><h2>اطلاعات {definition.label}</h2><p>{category === 'indicators' ? 'مقادیر را بررسی کنید؛ فقط شاخص‌های مشخص‌شده در صورت کفایت منابع خودکار تکمیل می‌شوند.' : 'مقادیر مربوط به دوره انتخاب‌شده را وارد کنید.'}</p></div></div>{category === 'indicators' ? <div className="inline-info"><Info size={17}/><span>مرجع عناوین: {referenceLabel}. آخرین نسخه بودن این مرجع تأیید نشده است. مقادیر موجود یا دستی حفظ می‌شوند؛ سایر شاخص‌ها را بر اساس مستندات وارد کنید.</span></div> : <div className="inline-info"><Info size={17}/><span>فیلدهای این بخش نمونه و قابل تنظیم‌اند و باید با تعاریف نهایی گزارش‌دهی تطبیق داده شوند.</span></div>}
        {category !== 'indicators' && <div className="subsection-title">مقادیر خلاصه <small>اختیاری؛ مستقل از ردیف‌های جزئیات</small></div>}
        <div className="data-toolbar"><div className="data-toolbar-title"><strong>فیلدهای داده</strong><span>{faNumber(filledFieldCount)} از {faNumber(definition.fields.length)} تکمیل شده</span></div><label className="data-search"><Search size={15}/><input value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} placeholder="جست‌وجوی نام فیلد یا کد..." aria-label="جست‌وجوی فیلدها" /></label><button type="button" className={`empty-filter ${showOnlyEmpty ? 'active' : ''}`} onClick={() => setShowOnlyEmpty(current => !current)}>{showOnlyEmpty ? 'نمایش همه فیلدها' : 'فقط خالی‌ها'}</button></div>
        <div className="database-fields">{visibleFields.length === 0 ? <div className="row-empty">فیلدی با این فیلتر پیدا نشد.</div> : visibleFields.map(field => {
          const suggestion = suggestions[field.key];
          const hasManualValue = !!(values[field.key] ?? '').trim();
          const fieldWarning = category === 'indicators' ? comparisons.find(item => item.field === field.key) : undefined;
          return <div className={`database-field-row ${(effectiveValues[field.key] ?? '').trim() ? 'is-filled' : 'is-empty'}`} key={field.key}><div className="database-field-meta"><strong>{field.label}</strong><code>{field.key}</code>{field.unit && <span>{field.unit}</span>}</div><div className="database-field-value">
            <label><span className="sr-only">{field.label}</span><div className="input-unit"><input type="text" inputMode={field.type === 'text' ? 'text' : 'decimal'} value={effectiveValues[field.key] ?? ''} aria-describedby={suggestion ? `indicator-help-${field.key}` : undefined} onChange={event => {
              const nextValue = event.target.value;
              setValues(current => ({ ...current, [field.key]: nextValue }));
              if (suggestion) setSuppressed(current => ({ ...current, [field.key]: !nextValue.trim() }));
              setServerWarnings([]);
            }} placeholder={field.placeholder || 'مقدار را وارد کنید'} />{field.unit && <span dir="auto">{field.unit}</span>}</div></label></div><span className="field-status">{(effectiveValues[field.key] ?? '').trim() ? <><CheckCircle2 size={14}/> ثبت شده</> : <><Info size={14}/> خالی</>}</span><div className="database-field-details">
            {suggestion && <div id={`indicator-help-${field.key}`} style={{ fontSize: '11px', lineHeight: 1.8, marginTop: '6px', color: '#536d5c' }}>
              <div>{hasManualValue ? 'مقدار موجود یا دستی حفظ شده است.' : suppressed[field.key] ? 'مقدار به‌صورت دستی خالی شده است.' : suggestion.value !== null ? 'مقدار به‌صورت خودکار تکمیل شده است.' : 'تکمیل خودکار ممکن نیست؛ در صورت نیاز دستی وارد کنید.'}</div>
              <div>{suggestion.description}</div>
              {suggestion.halves?.map(half => <div key={half}>{half}</div>)}
              {suppressed[field.key] && suggestion.value !== null && <button type="button" className="text-link" onClick={() => { setSuppressed(current => ({ ...current, [field.key]: false })); setServerWarnings([]); }}>استفاده از مقدار خودکار</button>}
            </div>}
            {fieldWarning && <div className="comparison-warning" style={{ marginTop: 8, padding: '7px 9px', border: '1px solid #f0e5c7', borderRadius: 7, color: '#a08242', fontSize: 11 }}>{fieldWarning.message}</div>}
            {category === 'indicators' && <label style={{ marginTop: 8, fontWeight: 500 }}>علت تغییر / توضیحات<textarea value={fieldComments[field.key] ?? ''} onChange={event => setFieldComments(current => ({ ...current, [field.key]: event.target.value }))} maxLength={2000} rows={2} placeholder="در صورت تغییر قابل توجه، علت را توضیح دهید" style={{ display: 'block', width: '100%', marginTop: 6, border: '1px solid #e2ebe4', borderRadius: 8, padding: '9px 10px', resize: 'vertical', color: '#536d5c', fontSize: 11, lineHeight: 1.8 }} /></label>}
          </div></div>;
        })}</div>
        {legacySource && <div className="legacy-data-notice"><Info size={17}/><div><strong>این رکورد از دادهٔ واردشدهٔ قدیمی تشکیل شده است.</strong><p>منبع اصلی گزارش در سامانه حفظ شده و قابل مشاهده است؛ فیلدهای استاندارد قابل تکمیل یا اصلاح هستند.</p></div></div>}
        {rowSections[category].map(section => <div className="row-section" key={section.key}><div className="row-section-heading"><div><h3>{section.title}</h3><p>{section.description}</p></div><button className="add-row" onClick={() => setRows(current => ({ ...current, [section.key]: [...(current[section.key] ?? []), {}] }))}><Plus size={15}/> افزودن ردیف</button></div>{(rows[section.key] ?? []).length === 0 ? <div className="row-empty">هنوز ردیفی اضافه نشده است.</div> : (rows[section.key] ?? []).map((row, index) => <div className="detail-row" key={index}><div className="detail-row-top"><strong>ردیف {faNumber(index + 1)}</strong><button aria-label={`حذف ردیف ${faNumber(index + 1)} از ${section.title}`} onClick={() => setRows(current => ({ ...current, [section.key]: (current[section.key] ?? []).filter((_, rowIndex) => rowIndex !== index) }))}><Trash2 size={15}/> حذف</button></div><div className="form-grid detail-grid">{section.fields.map(field => <label key={field.key}>{field.label}<div className="input-unit"><input aria-label={`${field.label}، ردیف ${index + 1}، ${section.title}`} type="text" inputMode={field.type === 'text' ? 'text' : 'decimal'} value={row[field.key] ?? ''} onChange={event => { const nextValue = event.target.value; setRows(current => ({ ...current, [section.key]: (current[section.key] ?? []).map((item, rowIndex) => rowIndex === index ? { ...item, [field.key]: nextValue } : item) })); }} placeholder={field.placeholder || 'وارد کنید'} />{field.unit && <span dir="auto">{field.unit}</span>}</div></label>)}</div></div>)}</div>)}
        <div className="form-footer"><span><Info size={15}/> فیلد خالی به معنی داده ناموجود است، نه صفر.</span><div><button className="outline-btn" disabled={saving} onClick={() => submit('draft')}><Save size={16}/> ذخیره پیش‌نویس</button><button className="primary-btn" disabled={saving} onClick={() => submit('submitted')}><Send size={16}/> {saving ? 'در حال ارسال...' : 'ارسال گزارش'}</button></div></div>{message && <div role="alert" className={`form-message ${message.kind}`}>{message.kind === 'error' ? <AlertCircle size={18}/> : <CheckCircle2 size={18}/>}<span>{message.text}</span></div>}</section></div>
      <aside className="form-aside"><div className="panel guidance"><div className="panel-title"><span className="mini-icon"><Info size={17}/></span><h2>راهنمای ثبت</h2></div><div className="guide-step"><b>۱</b><p><strong>انتخاب دوره</strong><small>شرکت، سال و دوره مورد نظر را انتخاب کنید.</small></p></div><div className="guide-step"><b>۲</b><p><strong>ورود اطلاعات</strong><small>مقادیر را با واحد نمایش‌داده‌شده وارد کنید.</small></p></div><div className="guide-step"><b>۳</b><p><strong>بررسی و ارسال</strong><small>پس از بررسی تغییرات، گزارش را ارسال کنید.</small></p></div></div><div className="comparison-card"><div className="comparison-title"><AlertCircle size={19}/><strong>مقایسه با دوره مشابه سال قبل</strong></div><p>{previous ? `مبنای مقایسه: ${companyName(companies, previous.companyId)}، ${periodLabel(previous)} ${faNumber(String(previous.year))}.` : 'داده‌ای از دوره مشابه سال قبل برای مقایسه وجود ندارد.'}</p><small>{category === 'indicators' ? 'برای شاخص‌های وزارت نفت، تغییر ۳۰٪ یا بیشتر هشدار ایجاد می‌کند. علت تغییر را کنار همان فیلد ثبت کنید.' : 'آستانه هشدار موقت ۲۰٪ است؛ این مقایسه تقریبی است و به‌تنهایی نشانه خطا نیست. مبنای صفر نیز نمایش داده می‌شود.'}</small>{comparisons.map(item => <div className="comparison-warning" key={item.field}>{item.message}</div>)}{serverWarnings.map((item, index) => <div className="comparison-warning" key={`${item.field}-${index}`}>{item.message}</div>)}</div><button className="aside-link" onClick={() => setView('analytics')}>مشاهده تحلیل گزارش‌ها <ChevronLeft size={16}/></button></aside></div>
  </>;
}
function FileTextIcon() { return <span className="document-glyph">≡</span>; }
