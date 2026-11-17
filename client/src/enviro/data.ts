import type { LucideIcon } from 'lucide-react';
import { Droplets, Wind, Recycle, BarChart3 } from 'lucide-react';

export type Category = 'water' | 'waste' | 'air' | 'indicators';
export type ReportStatus = 'draft' | 'submitted';
export type Report = {
  id: string;
  companyId: string;
  year: number;
  period: 0 | 1 | 2;
  category: Category;
  values: Record<string, string | number>;
  status: ReportStatus;
  revision?: number;
};
export type Company = { id: string; name: string };
export type EnvContext = {
  authenticated: boolean;
  configured: boolean;
  mustChangePassword?: boolean;
  user?: { name: string; role: 'admin' | 'company' | 'pending'; companyId?: string };
  companies?: Company[];
  reports?: Report[];
};
export type Warning = { field: string; change: number | null; message: string };
export type FieldDefinition = { key: string; label: string; unit?: string; placeholder?: string; type?: 'number' | 'text' };
export type CategoryDefinition = { label: string; short: string; description: string; icon: LucideIcon; color: string; fields: FieldDefinition[] };

// These are example input fields, not a mandated reporting taxonomy. Replace here when definitions are approved.
export const categories: Record<Category, CategoryDefinition> = {
  water: { label: 'آب و پساب', short: 'آب و پساب', description: 'اطلاعات برداشت، مصرف و مدیریت آب و پساب', icon: Droplets, color: '#3797b4', fields: [
    { key: 'water_consumption', label: 'آب مصرفی', unit: 'متر مکعب', placeholder: 'مقدار آب مصرفی' },
    { key: 'wastewater_generated', label: 'پساب تولیدی', unit: 'متر مکعب', placeholder: 'مقدار پساب تولیدی' },
    { key: 'water_recycled', label: 'آب بازچرخانی‌شده', unit: 'متر مکعب', placeholder: 'مقدار آب بازچرخانی' },
    { key: 'wastewater_discharged', label: 'پساب تخلیه‌شده', unit: 'متر مکعب', placeholder: 'مقدار پساب تخلیه‌شده' },
  ] },
  waste: { label: 'پسماند', short: 'پسماند', description: 'مقادیر تولید، بازیافت و دفع پسماند', icon: Recycle, color: '#d5a43f', fields: [
    { key: 'hazardous_waste', label: 'پسماند خطرناک تولیدی', unit: 'تن' },
    { key: 'non_hazardous_waste', label: 'پسماند غیرخطرناک تولیدی', unit: 'تن' },
    { key: 'recycled_waste', label: 'پسماند بازیافت‌شده', unit: 'تن' },
    { key: 'disposed_waste', label: 'پسماند دفع‌شده', unit: 'تن' },
  ] },
  air: { label: 'هوا و انتشار', short: 'هوا', description: 'اطلاعات انتشار و پایش آلاینده‌های هوا', icon: Wind, color: '#8a79c5', fields: [
    { key: 'greenhouse_gases', label: 'گازهای گلخانه‌ای', unit: 'تن معادل CO₂' },
    { key: 'sox', label: 'اکسیدهای گوگرد (SOx)', unit: 'تن' },
    { key: 'nox', label: 'اکسیدهای نیتروژن (NOx)', unit: 'تن' },
    { key: 'voc', label: 'ترکیبات آلی فرار (VOC)', unit: 'تن' },
  ] },
  indicators: { label: 'شاخص‌های سالیانه', short: 'شاخص‌ها', description: 'ثبت مقادیر سالانه شاخص‌های E1 تا E20', icon: BarChart3, color: '#408d6e', fields: [
    { key: 'E1', label: 'E1 · آب برداشت از منابع زیرزمینی', unit: 'm³' },
    { key: 'E2', label: 'E2 · آب برداشت از منابع سطحی', unit: 'm³' },
    { key: 'E3', label: 'E3 · آب/بخار تازه دریافتی از شبکه', unit: 'm³' },
    { key: 'E4', label: 'E4 · هیدروکربن تخلیه‌شده', unit: 'kg' },
    { key: 'E5', label: 'E5 · بار آلی کل COD تخلیه‌شده', unit: 'kg' },
    { key: 'E6', label: 'E6 · بار COD مازاد بر حد استاندارد', unit: 'kg' },
    { key: 'E7_volume', label: 'E7 · حجم پساب تولیدی', unit: 'm³' },
    { key: 'E7_management', label: 'E7 · مدیریت پساب تولیدی', type: 'text', placeholder: 'شرح روش مدیریت' },
    { key: 'E8', label: 'E8 · پسماند خطرناک تولیدی', unit: 'kg' },
    { key: 'E9', label: 'E9 · پسماند غیرخطرناک تولیدی', unit: 'kg' },
    { key: 'E10', label: 'E10 · بازیافت/استفاده مجدد پسماند خطرناک', unit: 'kg' },
    { key: 'E11', label: 'E11 · بازیافت/استفاده مجدد پسماند غیرخطرناک', unit: 'kg' },
    { key: 'E12_amount', label: 'E12 · مقدار ریزش ناخواسته بیش از ۱۵۰ کیلوگرم', unit: 'kg' },
    { key: 'E12_count', label: 'E12 · تعداد ریزش ناخواسته بیش از ۱۵۰ کیلوگرم', unit: 'مورد' },
    { key: 'E13', label: 'E13 · گاز ارسالی به فلر', unit: 'ton' },
    { key: 'E14', label: 'E14 · انتشار مستقیم/غیرمستقیم گازهای گلخانه‌ای', unit: 'ton CO₂e' },
    { key: 'E15', label: 'E15 · انتشار SOx', unit: 'ton' },
    { key: 'E16', label: 'E16 · انتشار NOx', unit: 'ton' },
    { key: 'E17', label: 'E17 · انتشار VOC', unit: 'ton' },
    { key: 'E18_area', label: 'E18 · مساحت فضای سبز', unit: 'm²' },
    { key: 'E18_percent', label: 'E18 · درصد فضای سبز', unit: '٪' },
    { key: 'E19', label: 'E19 · عوارض آلایندگی پرداختی دو سال قبل دوره', unit: 'میلیون ریال' },
    { key: 'E20', label: 'E20 · سهم نقطه-پارامترهای مشمول تحت پایش پیوسته', unit: '٪' },
    { key: 'E20_monitored', label: 'E20 · تعداد نقطه-پارامتر دارای پایش پیوسته', unit: 'مورد' },
    { key: 'E20_eligible', label: 'E20 · تعداد نقطه-پارامتر مشمول', unit: 'مورد' },
  ] },
};

export type RowSection = { key: string; title: string; description: string; fields: FieldDefinition[] };
// Repeatable rows are serialized as JSON strings in report.values, preserving distinct units and missing values.
export const rowSections: Record<Category, RowSection[]> = {
  water: [
    { key: 'water_sources', title: 'منابع و مصارف آب', description: 'برای هر منبع یا نوع آب یک ردیف جداگانه وارد کنید. آب و بخار را با واحدهای متفاوت جمع نکنید.', fields: [
      { key: 'source', label: 'منبع آب / کد E1 تا E3', type: 'text' }, { key: 'water_type', label: 'نوع آب یا بخار', type: 'text' },
      { key: 'supply_location', label: 'محل تأمین', type: 'text' }, { key: 'consumption_location', label: 'محل مصرف', type: 'text' },
      { key: 'amount', label: 'مقدار دوره' }, { key: 'unit', label: 'واحد مقدار (مثلاً مترمکعب یا تن)', type: 'text' },
    ] },
    { key: 'water_effluents', title: 'جریان‌ها و کیفیت پساب', description: 'برای هر جریان، حجم، محل و روش مدیریت و پارامترهای قابل اندازه‌گیری را جداگانه ثبت کنید.', fields: [
      { key: 'stream_type', label: 'نوع جریان پساب', type: 'text', placeholder: 'فرآیندی، بهداشتی، بلودان یا سایر' }, { key: 'volume', label: 'حجم دوره', unit: 'مترمکعب' },
      { key: 'pond', label: 'حوضچه / محل', type: 'text' }, { key: 'management', label: 'نوع مدیریت یا تصفیه', type: 'text' },
      { key: 'cod', label: 'COD' }, { key: 'ph', label: 'pH' }, { key: 'nh3', label: 'NH3' }, { key: 'turbidity', label: 'TURB' },
      { key: 'quality_unit', label: 'واحد / روش پارامترهای کیفیت', type: 'text' },
    ] },
  ],
  waste: [
    { key: 'waste_streams', title: 'ردیف‌های پسماند', description: 'هر شرکت می‌تواند ردیف‌های متفاوت داشته باشد. «مانده اول دوره» از «موجودی پایان» دوره قبل همان ردیف پیشنهاد می‌شود و قابل اصلاح است.', fields: [
      { key: 'opening_balance', label: 'مانده اول دوره', unit: 'تن' }, { key: 'production_unit', label: 'واحد تولیدی', type: 'text' }, { key: 'product_amount', label: 'مقدار محصول' }, { key: 'product_unit', label: 'واحد محصول', type: 'text' },
      { key: 'form_code', label: 'کد فرم', type: 'text' }, { key: 'hazard_code', label: 'کد خطر', type: 'text' }, { key: 'waste_name', label: 'نام پسماند', type: 'text' },
      { key: 'incoming', label: 'ورودی', unit: 'تن' }, { key: 'generated', label: 'تولید دوره', unit: 'تن' },
      { key: 'period_total', label: 'مجموع دوره', unit: 'تن' }, { key: 'reuse', label: 'استفاده مجدد', unit: 'تن' }, { key: 'sale', label: 'فروش', unit: 'تن' },
      { key: 'incineration', label: 'سوزاندن', unit: 'تن' }, { key: 'landfill', label: 'دفن', unit: 'تن' }, { key: 'external_recycling', label: 'بازیافت / انتقال خارج', unit: 'تن' },
      { key: 'management_total', label: 'مجموع مدیریت', unit: 'تن' }, { key: 'closing_balance', label: 'موجودی پایان', unit: 'تن' },
    ] },
  ],
  air: [
    { key: 'air_flaring', title: 'تناژ فلرینگ برحسب ماه', description: 'مقدار گاز ارسالی به فلر و آلاینده‌های ثبت‌شده را برای هر ماه دوره وارد کنید.', fields: [
      { key: 'month', label: 'ماه', type: 'text' }, { key: 'flare_gas', label: 'تناژ / مقدار گاز ارسالی به فلر' }, { key: 'flare_unit', label: 'واحد گاز فلر', type: 'text' },
      { key: 'co', label: 'CO' }, { key: 'nox', label: 'NOx' }, { key: 'co2', label: 'CO₂' }, { key: 'so2', label: 'SO₂' }, { key: 'thc', label: 'THC / VOC' }, { key: 'methane', label: 'متان' },
      { key: 'pollutant_units', label: 'واحد آلاینده‌ها', type: 'text', placeholder: 'واحد هر آلاینده را ذکر کنید' },
    ] },
    { key: 'air_flare_composition', title: 'ترکیب درصد فلرینگ', description: 'ترکیب گاز فلر را به تفکیک ماده، فرمول و مبنای درصد ثبت کنید.', fields: [
      { key: 'name', label: 'نام ترکیب', type: 'text' }, { key: 'formula', label: 'فرمول ترکیب', type: 'text' }, { key: 'basis', label: 'مبنای مولی / جرمی', type: 'text' }, { key: 'percentage', label: 'درصد ترکیب', unit: '٪' },
    ] },
    { key: 'air_feed_products', title: 'خوراک و محصول', description: 'خوراک و محصولات مرتبط با گزارش هوا و فلرینگ را با مقدار و واحد مستقل وارد کنید.', fields: [
      { key: 'name', label: 'نام خوراک / محصول', type: 'text' }, { key: 'amount', label: 'مقدار دوره' }, { key: 'unit', label: 'واحد', type: 'text' },
    ] },
    { key: 'air_combustion', title: 'محاسبات فلرینگ', description: 'پارامترهای محاسبه فلرینگ، منابع احتراقی و ضرایب انتشار را طبق شیت محاسبات ثبت کنید.', fields: [
      { key: 'production_unit', label: 'واحد / منبع محاسبه', type: 'text' }, { key: 'source_type', label: 'نوع منبع احتراقی', type: 'text' }, { key: 'source_count', label: 'تعداد منبع', unit: 'عدد' },
      { key: 'fuel_type', label: 'نوع سوخت / گاز فلر', type: 'text' }, { key: 'fuel_amount', label: 'مقدار سوخت یا گاز ورودی' }, { key: 'fuel_unit', label: 'واحد ورودی', type: 'text' },
      { key: 'calculation_method', label: 'روش / فرمول محاسبه', type: 'text' }, { key: 'emission_factor', label: 'ضریب انتشار' }, { key: 'factor_unit', label: 'واحد ضریب', type: 'text' },
      { key: 'calculated_amount', label: 'مقدار محاسبه‌شده' }, { key: 'calculated_unit', label: 'واحد خروجی', type: 'text' }, { key: 'stack_pollutants', label: 'آلاینده‌های محاسبه‌شده و واحد آن‌ها', type: 'text' },
    ] },
  ],
  indicators: [],
};

export const demoCompanies: Company[] = [
  { id: 'demo-1', name: 'پتروشیمی آفتاب' },
  { id: 'demo-2', name: 'پتروشیمی ساحل' },
  { id: 'demo-3', name: 'پتروشیمی سپهر' },
  { id: 'demo-4', name: 'پتروشیمی اروند' },
];
export const demoReports: Report[] = [
  { id: 'demo-r1', companyId: 'demo-1', year: 1404, period: 1, category: 'water', values: { water_consumption: 245000, wastewater_generated: 186000, water_recycled: 72000, wastewater_discharged: 114000 }, status: 'submitted' },
  { id: 'demo-r2', companyId: 'demo-2', year: 1404, period: 1, category: 'waste', values: { hazardous_waste: 68000, non_hazardous_waste: 120000, recycled_waste: 74000, disposed_waste: 114000 }, status: 'submitted' },
  { id: 'demo-r3', companyId: 'demo-3', year: 1404, period: 1, category: 'air', values: { greenhouse_gases: 1250, sox: 38, nox: 42, voc: 16 }, status: 'draft' },
  { id: 'demo-r4', companyId: 'demo-1', year: 1404, period: 0, category: 'indicators', values: { E1: 45000, E2: 28000 }, status: 'submitted' },
  { id: 'demo-r5', companyId: 'demo-4', year: 1404, period: 1, category: 'water', values: { water_consumption: 198000, wastewater_generated: 140000, water_recycled: 60000, wastewater_discharged: 80000 }, status: 'submitted' },
  { id: 'demo-r6', companyId: 'demo-1', year: 1403, period: 2, category: 'water', values: { water_consumption: 218000, wastewater_generated: 165000, water_recycled: 68000, wastewater_discharged: 97000 }, status: 'submitted' },
  { id: 'demo-r7', companyId: 'demo-2', year: 1403, period: 2, category: 'air', values: { greenhouse_gases: 1100, sox: 32, nox: 39, voc: 14 }, status: 'submitted' },
  { id: 'demo-r8', companyId: 'demo-3', year: 1403, period: 1, category: 'waste', values: { hazardous_waste: 56000, non_hazardous_waste: 96000, recycled_waste: 43000, disposed_waste: 109000 }, status: 'submitted' },
  { id: 'demo-r9', companyId: 'demo-4', year: 1402, period: 2, category: 'air', values: { greenhouse_gases: 980, sox: 28, nox: 35, voc: 12 }, status: 'submitted' },
  { id: 'demo-r10', companyId: 'demo-2', year: 1402, period: 1, category: 'water', values: { water_consumption: 180000, wastewater_generated: 130000, water_recycled: 57000, wastewater_discharged: 73000 }, status: 'submitted' },
];
export const faNumber = (value: number | string) => typeof value === 'number' ? new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(value) : value.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
export const periodLabel = (report: Pick<Report, 'category' | 'period'>) => report.category === 'indicators' ? 'سالیانه' : report.period === 1 ? 'شش‌ماهه اول' : 'شش‌ماهه دوم';
export const companyName = (companies: Company[], id: string) => companies.find(company => company.id === id)?.name ?? 'شرکت نامشخص';
export const referenceLabel = 'روش اجرایی MOP-HSED-Pr-002، ویرایش ۳، ابلاغ ۱۳۹۹';
