import { EnvError, invalidReport } from "./errors";

export type Category = "water" | "waste" | "air" | "indicators";
export type ReportInput = {
  id?: string;
  revision?: number;
  companyId: string;
  year: number;
  period: 0 | 1 | 2;
  category: Category;
  values: Record<string, string | number>;
  status: "draft" | "submitted";
};
export type Report = ReportInput & { id: string; revision: number; updatedAt: string };
export type Warning = { field: string; change: number | null; message: string };

// Keys must agree with the UI; extend only when each field and unit is defined.
const FIELDS: Record<Category, readonly string[]> = {
  water: ["water_consumption", "wastewater_generated", "water_recycled", "wastewater_discharged", "water_sources", "water_effluents"],
  waste: ["hazardous_waste", "non_hazardous_waste", "recycled_waste", "disposed_waste", "waste_streams"],
  air: ["greenhouse_gases", "sox", "nox", "voc", "air_flaring", "air_combustion", "air_flare_composition", "air_feed_products"],
  indicators: ["E1", "E2", "E3", "E4", "E5", "E6", "E7_volume", "E7_management", "E8", "E9", "E10", "E11", "E12_amount", "E12_count", "E13", "E14", "E15", "E16", "E17", "E18_area", "E18_percent", "E19", "E20", "E20_monitored", "E20_eligible", "field_comments"],
};
type RowFields = { text: readonly string[]; numeric: readonly string[] };
const ROW_FIELDS: Record<string, RowFields> = {
  water_sources: { text: ["source", "water_type", "supply_location", "consumption_location", "unit"], numeric: ["amount"] },
  water_effluents: { text: ["stream_type", "pond", "management", "quality_unit"], numeric: ["volume", "cod", "ph", "nh3", "turbidity"] },
  waste_streams: { text: ["production_unit", "product_unit", "form_code", "hazard_code", "waste_name"], numeric: ["product_amount", "opening_balance", "incoming", "generated", "period_total", "reuse", "sale", "incineration", "landfill", "external_recycling", "management_total", "closing_balance"] },
  air_flaring: { text: ["month", "flare_unit", "pollutant_units"], numeric: ["flare_gas", "co", "nox", "co2", "so2", "thc", "methane"] },
  air_combustion: { text: ["production_unit", "source_type", "fuel_type", "fuel_unit", "stack_pollutants"], numeric: ["source_count", "fuel_amount"] },
  air_flare_composition: { text: ["name", "formula", "basis"], numeric: ["percentage"] },
  air_feed_products: { text: ["name", "unit"], numeric: ["amount"] },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INPUT_KEYS = new Set(["id", "revision", "companyId", "year", "period", "category", "values", "status", "updatedAt"]);

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validText(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
function validRows(value: unknown, fields: RowFields): boolean {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 30000) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return false; }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 100) return false;
  return parsed.every(row => {
    if (!object(row)) return false;
    const entries = Object.entries(row);
    return entries.length > 0 && entries.every(([key, item]) =>
      fields.text.includes(key) ? validText(item, 1000) :
      fields.numeric.includes(key) && typeof item === "number" && Number.isFinite(item) && item >= 0
    );
  });
}
function validFieldComments(value: unknown): boolean {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 30000) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return false; }
  if (!object(parsed)) return false;
  const indicatorFields = new Set(FIELDS.indicators.filter(field => field !== "field_comments"));
  return Object.entries(parsed).every(([key, comment]) => indicatorFields.has(key) && validText(comment, 2000));
}

/** New reports omit id/revision; edits require both, including the revision read by the editor. */
export function parseReport(input: unknown, allowLegacyCandidates = false): ReportInput {
  if (!object(input) || Object.keys(input).some(key => !INPUT_KEYS.has(key))) throw invalidReport();
  const r = input;
  if (!validText(r.companyId) || typeof r.year !== "number" || !Number.isInteger(r.year) || r.year < 1300 || r.year > 1500 ||
    typeof r.category !== "string" || !Object.hasOwn(FIELDS, r.category) ||
    (r.period !== 0 && r.period !== 1 && r.period !== 2) ||
    (r.category === "indicators" && r.period !== 0) ||
    (r.status !== "draft" && r.status !== "submitted") || !object(r.values)) throw invalidReport();
  if (r.id === undefined ? r.revision !== undefined :
    (typeof r.id !== "string" || !UUID.test(r.id) || typeof r.revision !== "number" || !Number.isSafeInteger(r.revision) || r.revision < 1 || r.revision >= 2147483647)) throw invalidReport();
  if (r.updatedAt !== undefined && (typeof r.updatedAt !== "string" || !Number.isFinite(Date.parse(r.updatedAt)))) throw invalidReport();
  const category = r.category as Category;
  const entries = Object.entries(r.values);
  if (!entries.length || entries.length > 500 || Buffer.byteLength(JSON.stringify(r.values), "utf8") > 96000) throw invalidReport();
  for (const [key, value] of entries) {
    if (!FIELDS[category].includes(key)) {
      if (!allowLegacyCandidates || !validText(key) || ["__proto__", "constructor", "prototype"].includes(key) ||
        (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) ||
        (typeof value === "string" && Buffer.byteLength(value, "utf8") > 30000)) throw invalidReport();
      continue;
    }
    if (Object.hasOwn(ROW_FIELDS, key)) {
      if (!validRows(value, ROW_FIELDS[key])) throw invalidReport();
      continue;
    }
    if (category === "indicators" && key === "field_comments") {
      if (!validFieldComments(value)) throw invalidReport();
      continue;
    }
    if (category === "indicators" && key === "E7_management") {
      if (!validText(value, 10000)) throw invalidReport();
    } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw invalidReport();
    if (category === "indicators" && typeof value === "number" && (key === "E18_percent" || key === "E20") && value > 100) throw invalidReport();
    if (category === "indicators" && ["E12_count", "E20_monitored", "E20_eligible"].includes(key) && !Number.isSafeInteger(value)) throw invalidReport();
  }
  if (category === "indicators" && typeof r.values.E20_monitored === "number" && typeof r.values.E20_eligible === "number" && (r.values.E20_eligible <= 0 || r.values.E20_monitored > r.values.E20_eligible)) throw invalidReport();
  return {
    ...(typeof r.id === "string" ? { id: r.id, revision: r.revision as number } : {}),
    companyId: r.companyId, year: r.year, period: r.period, category,
    values: Object.fromEntries(entries) as Record<string, string | number>, status: r.status,
  };
}

/** Legacy fields may be displayed/exported, but are not accepted as new fields. */
export function reportFromRow(row: unknown): Report {
  const invalid = () => new EnvError("DATABASE_RESPONSE_INVALID", "دادهٔ گزارش در پایگاه داده معتبر نیست.", 503);
  if (!object(row) || typeof row.id !== "string" || !UUID.test(row.id) || !validText(row.company_id) ||
    typeof row.year !== "number" || !Number.isInteger(row.year) || row.year < 1 || row.year > 9999 ||
    typeof row.category !== "string" || !Object.hasOwn(FIELDS, row.category) ||
    (row.period !== 0 && row.period !== 1 && row.period !== 2) ||
    (row.category === "indicators" && row.period !== 0) ||
    (row.status !== "draft" && row.status !== "submitted") || !object(row.values) ||
    typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at)) ||
    typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1) throw invalid();
  const entries = Object.entries(row.values);
  if (entries.length > 500 || entries.some(([key, value]) => !validText(key) ||
    (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) ||
    (typeof value === "string" && Buffer.byteLength(value, "utf8") > 30000))) throw invalid();
  return {
    id: row.id, companyId: row.company_id, year: row.year, period: row.period,
    category: row.category as Category, values: Object.fromEntries(entries) as Record<string, string | number>,
    status: row.status, updatedAt: row.updated_at, revision: row.revision,
  };
}

/** Preserve source-only legacy keys when a current form cannot display them. */
export function preserveLegacyValues(input: ReportInput, original: Report): ReportInput {
  // A partial form submission must not erase a historical value that the current
  // UI does not render. Explicit deletion is intentionally not exposed here.
  return { ...input, values: { ...original.values, ...input.values } };
}

/** Unknown historical fields may only round-trip unchanged on an existing report. */
export function assertLegacyValuesUnchanged(input: ReportInput, original?: Report): void {
  for (const [key, value] of Object.entries(input.values)) {
    if (!FIELDS[input.category].includes(key) && (!original || !Object.hasOwn(original.values, key) || original.values[key] !== value)) throw invalidReport();
  }
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function change(current: number, baseline: number): number | null {
  if (baseline === 0) return null;
  const result = (current - baseline) / Math.abs(baseline) * 100;
  return Number.isFinite(result) ? result : null;
}
function formatted(value: number) { return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }).format(value); }

/** Compare only the same company, category, period and field. */
export function reportWarnings(report: ReportInput, existing: Report[]): Warning[] {
  const history = existing.filter(item => item.id !== report.id && item.status === "submitted" && item.companyId === report.companyId && item.category === report.category && item.period === report.period && item.year < report.year);
  const warnings: Warning[] = [];
  for (const [field, raw] of Object.entries(report.values)) {
    if (!FIELDS[report.category].includes(field)) continue;
    if (report.category === "indicators" && field === "E7_management") continue;
    const current = numeric(raw);
    if (current === null) continue;
    const points = history.map(item => ({ year: item.year, value: numeric(item.values[field]) })).filter((point): point is { year: number; value: number } => point.value !== null);
    const previous = points.find(point => point.year === report.year - 1);
    const average = points.length ? points.reduce((sum, point) => sum + point.value / points.length, 0) : null;
    const annual = previous ? change(current, previous.value) : null;
    const averageChange = average !== null && Number.isFinite(average) ? change(current, average) : null;
    const annualText = !previous ? "برای دورهٔ مشابه سال قبل سابقهٔ عددی موجود نیست" : previous.value === 0 ? "مبنای سال قبل صفر است و درصد تغییر تعریف نمی‌شود" : annual === null ? "درصد تغییر نسبت به سال قبل قابل محاسبه نیست" : `تغییر نسبت به سال قبل ${formatted(annual)}٪ (مبنای ${formatted(previous.value)})`;
    const averageText = average === null ? "میانگین تاریخی در دسترس نیست" : average === 0 ? `میانگین ${points.length} دورهٔ قبلی صفر است و درصد آن تعریف نمی‌شود` : averageChange === null ? "مقایسه با میانگین تاریخی قابل محاسبه نیست" : `تغییر نسبت به میانگین ${points.length} دورهٔ قبلی ${formatted(averageChange)}٪ (میانگین ${formatted(average)})`;
    const threshold = report.category === "indicators" ? 30 : 20;
    const unusual = (annual !== null && Math.abs(annual) >= threshold) || (averageChange !== null && Math.abs(averageChange) >= threshold);
    warnings.push({ field, change: annual, message: `${annualText}؛ ${averageText}. ${unusual ? `تغییر به آستانهٔ ${formatted(threshold)}٪ رسیده یا از آن بیشتر است. ` : `آستانهٔ هشدار ${formatted(threshold)}٪ است. `}این مقایسه تقریبی است و به‌تنهایی نشانهٔ خطا نیست.` });
  }
  return warnings;
}

export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[\s\uFEFF\u200B]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function reportsCsv(reports: Report[]): string {
  const header = ["id", "companyId", "year", "period", "category", "values", "status", "updatedAt", "revision"];
  const rows = reports.map(report => [report.id, report.companyId, report.year, report.period, report.category, JSON.stringify(report.values), report.status, report.updatedAt, report.revision]);
  return "\uFEFF" + [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
