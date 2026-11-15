import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyAutofill, comparableReport, e20Autofill, indicatorAutofill, ReportForm } from '../../client/src/enviro/ReportForm';
import type { Category, Report } from '../../client/src/enviro/data';

function report(category: Category, period: 0 | 1 | 2, values: Report['values'], overrides: Partial<Report> = {}): Report {
  return { id: `${category}-${period}`, companyId: 'a', year: 1404, category, period, values, status: 'submitted', ...overrides };
}

const complete = () => [
  report('water', 1, { wastewater_generated: 10 }), report('water', 2, { wastewater_generated: 20 }),
  report('waste', 1, { hazardous_waste: 1.5, non_hazardous_waste: 3 }), report('waste', 2, { hazardous_waste: 2, non_hazardous_waste: 4 }),
  report('air', 1, { sox: 5, nox: 7, voc: 9 }), report('air', 2, { sox: 6, nox: 8, voc: 10 }),
];
const valuesOf = (suggestions: ReturnType<typeof indicatorAutofill>) => Object.fromEntries(Object.entries(suggestions).map(([key, item]) => [key, item.value]));

describe('annual indicator form autofill', () => {
  it('uses only the six explicit mappings and converts tonnes to kilograms', () => {
    const suggestions = indicatorAutofill(complete(), 'a', '1404');
    expect(valuesOf(suggestions)).toEqual({ E7_volume: '30', E8: '3500', E9: '7000', E15: '11', E16: '15', E17: '19' });
    expect(suggestions.E8.description).toContain('hazardous_waste');
    expect(suggestions.E8.description).toContain('۱۰۰۰');
    expect(suggestions.E8.halves).toHaveLength(2);
    expect(suggestions.E8.halves?.every(text => text.includes('ارسال‌شده'))).toBe(true);
  });

  it('requires both submitted halves for the same category, company and year', () => {
    const first = report('water', 1, { wastewater_generated: 10 });
    const second = report('water', 2, { wastewater_generated: 20 });
    for (const other of [
      { ...second, companyId: 'b' }, { ...second, year: 1403 }, { ...second, category: 'waste' as const },
      { ...second, status: 'draft' as const },
    ]) {
      const suggestion = indicatorAutofill([first, other], 'a', '1404').E7_volume;
      expect(suggestion.value).toBeNull();
      expect(suggestion.halves?.[0]).toContain('ارسال‌شده');
      expect(suggestion.halves?.[1]).toMatch(/وجود ندارد|ارسال‌شده نیست/);
    }
    const missingFirst = indicatorAutofill([second], 'a', '1404').E7_volume;
    expect(missingFirst.value).toBeNull();
    expect(missingFirst.halves?.[0]).toContain('وجود ندارد');
    expect(missingFirst.halves?.[1]).toContain('ارسال‌شده');
  });

  it('distinguishes empty, invalid, duplicate and zero source values', () => {
    const first = report('water', 1, { wastewater_generated: 0 });
    expect(indicatorAutofill([first, report('water', 2, { wastewater_generated: '۰' })], 'a', '1404').E7_volume.value).toBe('0');
    for (const missing of ['', '  ']) {
      const result = indicatorAutofill([first, report('water', 2, { wastewater_generated: missing })], 'a', '1404').E7_volume;
      expect(result.value).toBeNull();
      expect(result.halves?.[1]).toContain('خالی');
    }
    for (const invalid of ['-1', 'NaN', 'Infinity', '0x10', '1,,2', ',', '1e-999', -5, Infinity]) {
      const result = indicatorAutofill([first, report('water', 2, { wastewater_generated: invalid })], 'a', '1404').E7_volume;
      expect(result.value).toBeNull();
      expect(result.halves?.[1]).toContain('نامعتبر');
    }
    const duplicated = indicatorAutofill([first, { ...first, id: 'duplicate' }, report('water', 2, { wastewater_generated: 1 })], 'a', '1404').E7_volume;
    expect(duplicated.value).toBeNull();
    expect(duplicated.halves?.[0]).toContain('چند گزارش');
    const overflow = indicatorAutofill([report('water', 1, { wastewater_generated: 1e308 }), report('water', 2, { wastewater_generated: 1e308 })], 'a', '1404').E7_volume;
    expect(overflow.value).toBeNull();
    expect(overflow.description).toContain('خارج از محدوده');
  });

  it('adds decimal values before unit conversion without binary floating-point artifacts', () => {
    const data = [report('water', 1, { wastewater_generated: 0.1 }), report('water', 2, { wastewater_generated: 0.2 }),
      report('waste', 1, { hazardous_waste: 0.1 }), report('waste', 2, { hazardous_waste: 0.2 })];
    const result = indicatorAutofill(data, 'a', '1404');
    expect(result.E7_volume.value).toBe('0.3');
    expect(result.E8.value).toBe('300');
  });

  it('updates derived values for new scope or source changes while preserving manual values and deliberate clears', () => {
    const initial = indicatorAutofill(complete(), 'a', '1404');
    expect(applyAutofill({ E8: '123', E9: '0' }, initial, {})).toMatchObject({ E8: '123', E9: '0', E15: '11' });
    expect(applyAutofill({ E8: '' }, initial, { E8: true }).E8).toBe('');
    expect(applyAutofill({ E8: '' }, initial, { E8: false }).E8).toBe('3500');
    expect(applyAutofill({}, indicatorAutofill(complete(), 'b', '1404'), {}).E8).toBeUndefined();
    expect(applyAutofill({}, indicatorAutofill(complete(), 'a', '1405'), {}).E8).toBeUndefined();
    expect(applyAutofill({}, indicatorAutofill(complete().filter(r => r.id !== 'waste-2'), 'a', '1404'), {}).E8).toBeUndefined();
    expect(applyAutofill({ E8: '123' }, indicatorAutofill(complete(), 'b', '1404'), {}).E8).toBe('123');
  });

  it('only accepts years in the database range, including endpoints', () => {
    for (const year of [1300, 1500]) {
      const reports = complete().map(item => ({ ...item, year }));
      expect(indicatorAutofill(reports, 'a', String(year)).E8.value).toBe('3500');
    }
    for (const year of ['', '1299', '1501', '1404.0', '1e3']) {
      expect(indicatorAutofill(complete(), 'a', year).E8.value).toBeNull();
    }
  });

  it('computes E20 only from valid monitored and eligible counts and respects a manual value', () => {
    for (const [monitored, eligible] of [['', '10'], ['1', ''], ['1', '0'], ['2', '1'], ['-1', '5'], ['bad', '5'], ['1', 'Infinity']]) {
      expect(e20Autofill({ E20_monitored: monitored, E20_eligible: eligible }).value).toBeNull();
    }
    expect(e20Autofill({ E20_monitored: '۰', E20_eligible: '۵' }).value).toBe('0');
    expect(e20Autofill({ E20_monitored: '2', E20_eligible: '2' }).value).toBe('100');
    const suggestion = e20Autofill({ E20_monitored: '2', E20_eligible: '8' });
    expect(suggestion.value).toBe('25');
    expect(applyAutofill({ E20: '77' }, { E20: suggestion }, {}).E20).toBe('77');
    expect(applyAutofill({}, { E20: suggestion }, {}).E20).toBe('25');
  });
});

describe('same-period comparison', () => {
  it('finds only the same company, category and period in year minus one', () => {
    const data = [report('water', 1, {}, { year: 1404 }), report('water', 2, {}, { year: 1403 }), report('water', 1, {}, { year: 1403, companyId: 'b' }), report('water', 1, {}, { year: 1403, id: 'match' })];
    expect(comparableReport(data, 'a', 'water', '1404', 1)?.id).toBe('match');
    expect(comparableReport(data, 'a', 'water', '1404', 2)?.period).toBe(2);
    expect(comparableReport(data, 'a', 'water', '1405', 1)?.year).toBe(1404);
    expect(comparableReport(data, 'a', 'water', '1501', 1)).toBeUndefined();
    const annual = report('indicators', 0, {}, { year: 1403 });
    expect(comparableReport([annual], 'a', 'indicators', '1404', 2)).toBe(annual);
  });

  it('shows the temporary 20% threshold and uses the correct comparison in the rendered form', () => {
    // Vitest's standalone configuration uses the classic JSX transform.
    vi.stubGlobal('React', React);
    const prior = report('water', 1, { water_consumption: 100 }, { year: 1403, id: 'prior' });
    const wrongHalf = report('water', 2, { water_consumption: 300 }, { year: 1403, id: 'wrong-half' });
    const current = report('water', 1, { water_consumption: 120 }, { id: 'current' });
    const render = (value: number) => renderToStaticMarkup(createElement(ReportForm, {
      category: 'water', companies: [{ id: 'a', name: 'شرکت الف' }], reports: [wrongHalf, prior],
      initialReport: { ...current, values: { water_consumption: value } }, canSave: false, demo: false, setView: () => {}, onSaved: () => {},
    }));
    const markup = render(120);
    expect(markup).toContain('آستانه هشدار موقت ۲۰٪');
    expect(markup).toContain('تغییر ۲۰٪ نسبت به دوره مشابه سال قبل');
    expect(render(119)).not.toContain('تغییر ۱۹٪');
    vi.unstubAllGlobals();
  });
});
