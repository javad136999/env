#!/usr/bin/env python3
"""Conservative offline normalization of private Google Sheets GridData archives.

Fixed input/output paths are intentional. No network, database, project-file or Git
writes occur. Only /home/ubuntu/env-history/normalized/{companies,company_sources,
reports,unresolved,summary}.json are created/replaced, with private permissions.
Run: python3 -B scripts/normalize-indicator-history.py
Self-test (no files): python3 -B scripts/normalize-indicator-history.py --self-test

This is a limited allowlist, NOT a general spreadsheet parser. See summary.json
for scope, reasons, denominators and downstream safeguards. Missing format metadata
and unaudited formulas make arbitrary numeric cells unsafe to transfer.
"""
from __future__ import annotations

import collections
import decimal
import fcntl
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata
import uuid

ROOT = Path('/home/ubuntu/env-history')
RAW = ROOT / 'raw'
MANIFEST = ROOT / 'manifest.json'
OUT = ROOT / 'normalized'
NAMESPACE = uuid.UUID('92b57570-f6f9-5f2b-aee1-de617d66d6b6')
DIGITS = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
CODES = ['E' + str(i) for i in range(1, 21)]
# Explicit source labels only. No semantic inference from code alone. Source
# units are copied verbatim from the label; UI equivalents require exact units.
SAFE_SCALARS = {
    'E1': ('مقدار آب برداشت شده از آبهای زیرزمینی (متر مکعب)', 'متر مکعب'),
    'E2': ('مقدار آب برداشت شده از آبهای سطحی (متر مکعب)', 'متر مکعب'),
    'E4': ('مقدار هیدروکربن تخلیه شده به محیط (کیلوگرم)', 'کیلوگرم'),
    'E8': ('مقدار پسماندهای خطرناک تولید شده (کیلوگرم)', 'کیلوگرم'),
    'E9': ('مقدار پسماندهای غیرخطرناک تولید شده (کیلوگرم)', 'کیلوگرم'),
    'E15': ('مقدار انتشار اکسیدهای گوگرد (تن)', 'تن'),
    'E16': ('مقدار انتشار اکسیدهای نیتروژن (تن)', 'تن'),
    'E17': ('مقدار انتشار ترکیبات آلی فرار (تن)', 'تن'),
}
# Source vs UI mismatch, unspecified definitions or multi-component values.
SKIP_CODES = {
    'E3': 'multiple_water_steam_components_or_totals',
    'E5': 'source_does_not_specify_ui_cod_definition',
    'E6': 'source_does_not_specify_ui_excess_cod_definition',
    'E7': 'multi_component_or_generated_volume_not_proven',
    'E10': 'source_recycling_not_ui_recycling_or_reuse',
    'E11': 'source_recycling_not_ui_recycling_or_reuse',
    'E12': 'source_does_not_specify_ui_150kg_threshold_or_has_components',
    'E13': 'source_flaring_not_explicit_ui_gas_sent_to_flare',
    'E14': 'source_does_not_specify_ui_direct_and_indirect_scope',
    'E19': 'source_does_not_specify_ui_two_year_payment_lag',
    'E20': 'source_does_not_prove_ui_numerator_denominator_or_method',
}


def norm(value):
    text = unicodedata.normalize('NFKC', str(value or '')).translate(DIGITS)
    text = text.replace('ي', 'ی').replace('ى', 'ی').replace('ك', 'ک')
    text = re.sub('[\u064b-\u065f\u0670\u200c\u200d\u200e\u200f\ufeff]', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def company_key(label):
    """Shared company-ID convention; do not collapse or infer different names."""
    name = unicodedata.normalize('NFKC', label).replace('ي', 'ی').replace('ك', 'ک').lower()
    name = name.replace('\u200c', ' ')
    name = re.sub(r'\s+', ' ', name).strip()
    name = re.sub(r'^پتروشیمی(?:\s+|$)', '', name, count=1).strip()
    return name


def company_id(label):
    return 'co-' + hashlib.sha256(company_key(label).encode('utf-8')).hexdigest()[:16]


def label_from_filename(name):
    s = norm(name)
    match = re.fullmatch(r'(?:شاخصهای وزارت نفت|گزارش شاخصها)\s*[-–—]\s*(.+?)', s)
    if not match:
        return None
    label = match.group(1).strip()
    if (len(label) < 2 or len(label) > 160 or
            re.search(r'[/\\&+،\d–—-]|(?i:copy)|کپی|نسخه|جمع.?بندی|فرم مادر|نمونه|تست', label)):
        return None
    if not re.search('[\u0600-\u06ff]', label):
        return None
    # Preserve the actual filename spelling, not the normalized comparison form.
    m = re.fullmatch(r'\s*(?:شاخص[‌ ]های وزارت نفت|گزارش شاخص[‌ ]ها)\s*[-–—]\s*(.+?)\s*', name)
    return m.group(1).strip() if m else None


def tab_period(title):
    s = norm(title)
    if re.search(r'(?i:copy)|کپی|نسخه|جمع.?بندی|خلاصه', s):
        return None, 'copy_or_summary'
    if re.search(r'سه\s*ماه|شش\s*ماه|نیم\s*سال|فصل|quarter|half', s, re.I):
        return None, 'nonannual'
    m = re.fullmatch(r'سال\s*(1[34]\d\d)', s)
    if m and 1300 <= int(m.group(1)) <= 1500:
        return int(m.group(1)), 'annual'
    m = re.fullmatch(r'محیط\s*زیست\s*(1[34]\d\d)', s)
    if m and 1300 <= int(m.group(1)) <= 1500:
        return int(m.group(1)), 'environment_year_requires_header'
    return None, 'other'


def colname(col):
    result = ''
    col += 1
    while col:
        col, rem = divmod(col - 1, 26)
        result = chr(65 + rem) + result
    return result


def address(row, col):
    return colname(col) + str(row + 1)


def grid(sheet):
    result = {}
    for block in sheet.get('data', []):
        sr, sc = block.get('startRow', 0), block.get('startColumn', 0)
        if not isinstance(sr, int) or not isinstance(sc, int) or min(sr, sc) < 0:
            raise ValueError('invalid_grid_offset')
        for ri, rd in enumerate(block.get('rowData', [])):
            for ci, cell in enumerate(rd.get('values', [])):
                if not isinstance(cell, dict):
                    raise ValueError('invalid_grid_cell')
                pos = (sr + ri, sc + ci)
                if pos in result:
                    # Even identical overlap is ambiguous and must not be guessed.
                    raise ValueError('overlapping_grid_blocks')
                result[pos] = cell
    return result


def cell(g, row, col):
    return g.get((row, col), {})


def text(g, row, col):
    c = cell(g, row, col)
    u, e = c.get('userEnteredValue', {}), c.get('effectiveValue', {})
    # Do not treat computed strings as stable source labels.
    if 'formulaValue' in u:
        return ''
    val = u.get('stringValue', e.get('stringValue', ''))
    return val if isinstance(val, str) else ''


def occupied(c):
    # A formula returning blank, a dash, an error or zero all count as occupied.
    return bool(c.get('userEnteredValue') or c.get('effectiveValue') or c.get('formattedValue'))


def exact_merge(sheet, r0, r1, c0, c1):
    return any(m.get('startRowIndex', 0) == r0 and m.get('endRowIndex') == r1 and
               m.get('startColumnIndex', 0) == c0 and m.get('endColumnIndex') == c1
               for m in sheet.get('merges', []))


def numeric(c):
    """Only direct, displayed-as-the-same-number, finite nonnegative numeric cells."""
    u, e = c.get('userEnteredValue', {}), c.get('effectiveValue', {})
    if 'errorValue' in e:
        return None, 'formula_or_cell_error'
    if 'formulaValue' in u:
        return None, 'formula_not_independently_validated'
    if not occupied(c):
        return None, 'blank_not_zero'
    if 'numberValue' not in u or 'numberValue' not in e:
        return None, 'not_a_direct_numeric_cell'
    v, effective = u['numberValue'], e['numberValue']
    if (isinstance(v, bool) or isinstance(effective, bool) or
            not isinstance(v, (int, float)) or not isinstance(effective, (int, float)) or
            not math.isfinite(v) or v < 0 or v != effective or
            (float(v).is_integer() and abs(v) > 9007199254740991)):
        return None, 'invalid_negative_inexact_or_inconsistent_number'
    # Formatted values permit unambiguous grouping only; formats are not exported.
    # Excludes displayed %, units, dashes, hidden scaling and rounding.
    display = norm(c.get('formattedValue', '')).replace('٬', ',').replace('٫', '.')
    pattern = r'[+\-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?(?:[eE][+\-]?\d+)?'
    if not re.fullmatch(pattern, display):
        return None, 'display_format_not_plain_numeric'
    try:
        if decimal.Decimal(display.replace(',', '')) != decimal.Decimal(str(v)):
            return None, 'display_rounding_or_scaling_ambiguous'
    except decimal.InvalidOperation:
        return None, 'display_format_not_plain_numeric'
    return v, None


def code_rows(g):
    out = collections.defaultdict(list)
    for (r, c), _ in sorted(g.items()):
        if c == 1:
            code = norm(text(g, r, c)).upper()
            if code in CODES:
                out[code].append(r)
    return out


def stray_codes(g):
    """Unexpected code columns make layout ambiguous, not absent."""
    return [(r, c) for (r, c) in sorted(g) if c != 1 and norm(text(g, r, c)).upper() in CODES]


def adjacent_cell_evidence(g, row, end):
    """Kinds and addresses only: adjacency is not an indicator mapping."""
    evidence = []
    for rr in range(row, end):
        for cc in range(3, 11):
            c = cell(g, rr, cc)
            if not occupied(c):
                continue
            u, e = c.get('userEnteredValue', {}), c.get('effectiveValue', {})
            if 'errorValue' in e:
                kind = 'error'
            elif 'formulaValue' in u:
                kind = 'formula'
            elif 'numberValue' in u:
                kind = 'number'
            else:
                kind = 'text_or_other'
            evidence.append({'cell': address(rr, cc), 'kind': kind})
    return evidence


def base_ref(source, sheet):
    return {'filename': source['name'], 'spreadsheet_id': source['id'],
            'sheet_id': sheet['properties']['sheetId'],
            'tab': sheet['properties']['title']}


def unresolved_ref(source, sheet, year=None, code=None, reason=None, row=None, extra=None):
    d = dict(base_ref(source, sheet))
    if year is not None:
        d['year'] = year
    if code:
        d['indicator_code'] = code
    if row is not None:
        d['code_cell'] = address(row, 1)
        d['label_cell'] = address(row, 2)
    d['reason'] = reason
    if extra:
        d.update(extra)
    return d


def field_source(source, sheet, g, code, row, value_row, col, unit, value):
    c = cell(g, value_row, col)
    return {**base_ref(source, sheet), 'indicator_code': code,
            'code_cell': address(row, 1), 'label_cell': address(row, 2),
            'source_label': text(g, row, 2), 'cell': address(value_row, col),
            'unit': unit, 'value': value, 'user_entered': c.get('userEnteredValue'),
            'effective': c.get('effectiveValue'), 'formatted': c.get('formattedValue'),
            'value_column_header_cell': address(0, col), 'value_column_header': text(g, 0, col),
            **({'subcategory_cell': address(value_row, 3),
                'subcategory_label': text(g, value_row, 3)} if code == 'E18' else {})}


def extract_sheet(source, sheet, year, kind):
    """Returns (values, per-field provenance, unresolved). Does not merge sheets."""
    out, provenance, problems = {}, {}, []
    try:
        g = grid(sheet)
    except (TypeError, ValueError):
        return out, provenance, [unresolved_ref(source, sheet, year, reason='invalid_or_overlapping_grid')]
    cr = code_rows(g)
    if stray_codes(g):
        return out, provenance, [unresolved_ref(source, sheet, year, reason='indicator_codes_in_unexpected_column')]
    if not cr:
        return out, provenance, [unresolved_ref(source, sheet, year, reason='no_indicator_codes')]
    if sheet.get('archiveWarnings'):
        return out, provenance, [unresolved_ref(source, sheet, year, reason='worksheet_archive_warning')]
    basic = norm(text(g, 0, 1)) in ('نماد شاخص', 'کد شاخص') and norm(text(g, 0, 2)) == 'عنوان شاخص'
    modern = (basic and kind == 'annual' and norm(text(g, 0, 5)) == 'مقدار' and
              norm(text(g, 0, 6)) == 'مجموع')
    env = (basic and kind == 'environment_year_requires_header' and
           norm(text(g, 0, 4)) == 'سال ' + str(year))
    if not (modern or env):
        return out, provenance, [unresolved_ref(source, sheet, year, reason='unrecognized_header_or_unproven_annual_period')]
    if kind == 'environment_year_requires_header' and not env:
        return out, provenance, [unresolved_ref(source, sheet, year, reason='unproven_environment_tab_annual_period')]
    all_positions = sorted(r for rs in cr.values() for r in rs)
    for code in CODES:
        rows = cr.get(code, [])
        if len(rows) != 1:
            problems.append(unresolved_ref(source, sheet, year, code, 'missing_code' if not rows else 'duplicate_code'))
            continue
        row = rows[0]
        end = next((r for r in all_positions if r > row), row + 1)
        if code in SKIP_CODES:
            problems.append(unresolved_ref(source, sheet, year, code, SKIP_CODES[code], row,
                                           {'adjacent_cells_not_mapped': adjacent_cell_evidence(g, row, end)}))
            continue
        if code == 'E18':
            # Explicit modern two-row structure, one label and one amount per row.
            if not (modern and end == row + 2 and norm(text(g, row, 2)) == 'میزان فضای سبز' and
                    exact_merge(sheet, row, row + 2, 2, 3) and
                    all(exact_merge(sheet, rr, rr + 1, 3, 5) for rr in (row, row + 1))):
                problems.append(unresolved_ref(source, sheet, year, code, 'multi_value_or_unproven_green_space_layout', row))
                continue
            sublabels = [norm(text(g, rr, 3)) for rr in (row, row + 1)]
            if collections.Counter(sublabels) != collections.Counter(['متر مربع', 'درصد']):
                problems.append(unresolved_ref(source, sheet, year, code, 'green_space_units_or_labels_ambiguous', row))
                continue
            for rr in (row, row + 1):
                unit = text(g, rr, 3).strip()
                key = 'E18_area' if norm(unit) == 'متر مربع' else 'E18_percent'
                if occupied(cell(g, rr, 6)):
                    problems.append(unresolved_ref(source, sheet, year, code, 'additional_total_or_value', row, {'cell': address(rr, 6), 'field': key}))
                    continue
                number, reason = numeric(cell(g, rr, 5))
                if reason:
                    problems.append(unresolved_ref(source, sheet, year, code, reason, row, {'cell': address(rr, 5), 'field': key}))
                    continue
                out[key] = number
                provenance[key] = field_source(source, sheet, g, code, row, rr, 5, unit, number)
            continue
        expected, _unit = SAFE_SCALARS[code]
        if norm(text(g, row, 2)) != norm(expected):
            problems.append(unresolved_ref(source, sheet, year, code, 'source_label_or_unit_mismatch', row))
            continue
        unit_match = re.search(r'\(([^()]*)\)\s*$', text(g, row, 2))
        if not unit_match:
            problems.append(unresolved_ref(source, sheet, year, code, 'source_unit_not_explicit', row))
            continue
        unit = unit_match.group(1)
        # In the modern template scalar values are in F; in the environmental
        # 1400 template the explicit annual header is E. Old annual tabs with E
        # under the separate 'breakdown' heading intentionally fail this check.
        if modern:
            col = 5
            shape = exact_merge(sheet, row, row + 1, 2, 5)
            other_cols = (6,)
        else:
            col = 4
            shape = exact_merge(sheet, row, row + 1, 2, 4)
            other_cols = (5, 6)
        if end != row + 1 or not shape:
            problems.append(unresolved_ref(source, sheet, year, code, 'multiple_rows_or_ambiguous_value_column', row))
            continue
        if any(occupied(cell(g, row, c)) for c in other_cols):
            problems.append(unresolved_ref(source, sheet, year, code, 'additional_total_or_value', row, {'cell': address(row, col)}))
            continue
        value, reason = numeric(cell(g, row, col))
        if reason:
            problems.append(unresolved_ref(source, sheet, year, code, reason, row, {'cell': address(row, col)}))
            continue
        out[code] = value
        provenance[code] = field_source(source, sheet, g, code, row, row, col, unit, value)
    return out, provenance, problems


def read_manifest_and_sources():
    with MANIFEST.open(encoding='utf-8') as f:
        manifest = json.load(f)
    if manifest.get('incomplete_search') is not False or not isinstance(manifest.get('files'), list):
        raise ValueError('manifest_incomplete_or_invalid')
    entries = manifest['files']
    if len({m.get('id') for m in entries}) != len(entries):
        raise ValueError('manifest_duplicate_or_missing_ids')
    data = []
    for m in entries:
        sid = m.get('id')
        if not isinstance(sid, str) or not re.fullmatch('[A-Za-z0-9_-]+', sid):
            raise ValueError('invalid_manifest_id')
        p = RAW / (sid + '.json.gz')
        if p.is_symlink() or not p.is_file():
            raise ValueError('archive_missing_or_symlink')
        with gzip.open(p, 'rt', encoding='utf-8') as f:
            x = json.load(f)
        s, response = x.get('source', {}), x.get('response', {})
        if (x.get('format') != 'google-sheets-griddata-selected-v1' or s.get('id') != sid or
                response.get('spreadsheetId') != sid or s.get('name') != m.get('name') or
                s.get('category') != m.get('category') or not isinstance(response.get('sheets'), list)):
            raise ValueError('archive_manifest_inconsistent')
        ids = [sh.get('properties', {}).get('sheetId') for sh in response['sheets']]
        if any(not isinstance(i, int) or isinstance(i, bool) for i in ids) or len(ids) != len(set(ids)):
            raise ValueError('invalid_or_duplicate_sheet_ids')
        data.append(x)
    return manifest, data


def normalize(manifest, archives):
    counts = collections.Counter()
    unresolved, candidates = [], []
    counts['manifest_files'] = len(manifest['files'])
    counts['archives_validated'] = len(archives)
    for x in archives:
        s = x['source']
        if s.get('category') != 'oil_ministry_indicators':
            counts['out_of_scope_files'] += 1
            continue
        counts['indicator_category_files'] += 1
        label = label_from_filename(s['name'])
        if label is None or s.get('warnings'):
            counts['company_files_rejected'] += 1
            unresolved.append({'filename': s['name'], 'spreadsheet_id': s['id'],
                               'reason': 'unproven_or_ambiguous_company_filename_or_source_warning'})
            continue
        candidates.append((x, label))
    names = collections.Counter(company_key(label) for _, label in candidates)
    companies, company_sources, reports = [], {}, []
    seen_ids = set()
    years_seen, field_counts = [], collections.Counter()
    for x, label in sorted(candidates, key=lambda z: (norm(z[1]), z[0]['source']['id'])):
        s = x['source']
        if not company_key(label) or names[company_key(label)] != 1:
            counts['company_files_rejected'] += 1
            unresolved.append({'filename': s['name'], 'spreadsheet_id': s['id'], 'reason': 'ambiguous_duplicate_company_label'})
            continue
        cid = company_id(label)
        if cid in seen_ids:
            raise ValueError('company_identifier_collision')
        seen_ids.add(cid)
        companies.append({'id': cid, 'name': label})
        company_sources[cid] = {'company_label': label, 'filename': s['name'], 'spreadsheet_id': s['id']}
        counts['accepted_company_files'] += 1
        by_year = collections.defaultdict(list)
        for sh in x['response']['sheets']:
            props = sh.get('properties', {})
            if not isinstance(props.get('title'), str):
                raise ValueError('invalid_sheet_title')
            year, kind = tab_period(props['title'])
            if not year:
                counts['tabs_excluded_' + kind] += 1
                if kind in ('nonannual', 'copy_or_summary'):
                    unresolved.append(unresolved_ref(s, sh, reason='excluded_' + kind))
                continue
            counts['year_title_tabs'] += 1
            try:
                g = grid(sh)
                cr = code_rows(g)
                unexpected = stray_codes(g)
            except (TypeError, ValueError):
                counts['invalid_grid_tabs'] += 1
                unresolved.append(unresolved_ref(s, sh, year, reason='invalid_or_overlapping_grid'))
                # Still reserve this year: its content could conflict with another.
                by_year[year].append((sh, kind))
                continue
            if not cr and not unexpected:
                counts['year_title_tabs_without_indicator_codes'] += 1
                unresolved.append(unresolved_ref(s, sh, year, reason='no_indicator_codes'))
                continue
            counts['year_title_tabs_with_indicator_codes'] += 1
            by_year[year].append((sh, kind))
        for year, sheets in sorted(by_year.items()):
            years_seen.append((cid, year))
            counts['candidate_company_years'] += 1
            if len(sheets) != 1:
                counts['conflicted_company_years'] += 1
                for sh, _ in sheets:
                    unresolved.append(unresolved_ref(s, sh, year, reason='multiple_annual_indicator_sheets_no_auto_overwrite'))
                continue
            sh, kind = sheets[0]
            values, provenance, issues = extract_sheet(s, sh, year, kind)
            unresolved.extend(issues)
            if not values:
                counts['candidate_company_years_without_safe_values'] += 1
                continue
            rid = str(uuid.uuid5(NAMESPACE, cid + ':indicators:0:' + str(year)))
            reports.append({'id': rid, 'company_id': cid, 'year': year, 'period': 0,
                            'category': 'indicators', 'values': values, 'status': 'draft',
                            'source_meta': {'normalizer': 'normalize-indicator-history.py/v1',
                                            'archive_retrieved_at': x.get('retrieved_at'),
                                            'period_evidence': {'tab': sh['properties']['title'], 'period': 'annual',
                                                                'year': year, **({'header_cell': 'E1',
                                                                'header_value': text(grid(sh), 0, 4)}
                                                                if kind == 'environment_year_requires_header' else {})},
                                            'company_label': label, 'fields': provenance}})
            field_counts.update(values.keys())
    if len({(r['company_id'], r['year'], r['period'], r['category']) for r in reports}) != len(reports):
        raise ValueError('report_key_collision')
    if len({r['id'] for r in reports}) != len(reports):
        raise ValueError('report_uuid_collision')
    counts['companies'] = len(companies)
    counts['reports'] = len(reports)
    counts['company_years_with_report'] = len(reports)
    counts['accepted_fields'] = sum(field_counts.values())
    counts['accepted_explicit_numeric_zero_fields'] = sum(v == 0 for r in reports for v in r['values'].values())
    counts['accepted_indicator_slots'] = sum(len({k.split('_', 1)[0] for k in r['values']}) for r in reports)
    counts['candidate_indicator_slots'] = 20 * counts['candidate_company_years']
    counts['conflicted_company_years'] += 0
    counts['unresolved_instances'] = len(unresolved)
    reason_counts = collections.Counter(u['reason'] for u in unresolved)
    adjacent_kinds = collections.Counter(c['kind'] for u in unresolved for c in u.get('adjacent_cells_not_mapped', []))
    summary = {'version': 1, 'counts': dict(sorted(counts.items())),
               'accepted_fields_by_key': dict(sorted(field_counts.items())),
               'unresolved_by_reason': dict(sorted(reason_counts.items())),
               'unresolved_adjacent_cell_kinds_not_mapped': dict(sorted(adjacent_kinds.items())),
               'coverage': {'report_company_years_numerator': len(reports),
                            'report_company_years_denominator': counts['candidate_company_years'],
                            'report_company_years_percent': round(100 * len(reports) / counts['candidate_company_years'], 2) if counts['candidate_company_years'] else None,
                            'accepted_indicator_slots_numerator': counts['accepted_indicator_slots'],
                            'candidate_E1_E20_indicator_slots_denominator': 20 * counts['candidate_company_years'],
                            'indicator_slots_percent': round(100 * counts['accepted_indicator_slots'] / counts['candidate_indicator_slots'], 2) if counts['candidate_indicator_slots'] else None,
                            'accepted_frontend_fields': sum(field_counts.values()),
                            'warning': 'E18 counts once as an indicator even if both area and percent are accepted. Annual tabs without any E codes and unobservable years are excluded from the candidate denominator.'},
               'policy': {'scope': 'Company-named oil-ministry indicator workbooks only, not summaries or other categories.',
                          'period': 'Exact annual tab title, or environmental-year title with explicit matching annual E1 header.',
                          'company_identity': 'Exact filename label following the final separator; ID co- plus first 16 SHA-256 hex characters of UTF-8 company key. Key: NFKC, Arabic ي/ك to ی/ک, lowercase, whitespace and ZWNJ to single spaces, trim, remove initial پتروشیمی followed by a space. Source spreadsheet ID/filename are in company_sources.json and source_meta; duplicate keys are rejected and hash collisions stop the run.',
                          'report_conflicts': 'Every candidate sheet of a duplicate company/year is excluded; existing database conflicts are not checked.',
                          'numbers': 'Explicit entered numbers only, effective equals entered, display equals numeric, nonnegative; explicit zero preserved; formulas, errors, text, blanks and uncertain formats skipped.',
                          'status': 'draft; source submission state not inferred',
                          'sheets_snapshot': 'Values reflect a nontransactional live archive; styles and full cell formats not exported.',
                          'editing': 'Application edits do not update source_meta; it records original imported observations, not provenance of later edits.',
                          'supabase': 'Do not upload automatically. Reconcile IDs and keys against existing companies and reports. Insert only approved nonconflicting rows in a transaction; no upsert/update, retain source_meta, enforce existing unique key and use RLS-safe privileged server access.'}}
    return {'companies.json': companies, 'company_sources.json': company_sources,
            'reports.json': reports, 'unresolved.json': unresolved, 'summary.json': summary}


def write_outputs(outputs):
    # Do not follow an output directory symlink or weaken existing permissions.
    if OUT.is_symlink():
        raise ValueError('output_directory_symlink')
    OUT.mkdir(mode=0o700, parents=False, exist_ok=True)
    st = OUT.stat()
    if st.st_uid != os.geteuid() or (st.st_mode & 0o077):
        raise ValueError('output_directory_not_private')
    # Four payload checksums in the last-replaced summary make interrupted
    # multi-file writes detectable. No other file is used as a lock.
    encoded = {name: (json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
               for name, data in outputs.items() if name != 'summary.json'}
    outputs['summary.json']['payload_sha256'] = {name: hashlib.sha256(payload).hexdigest()
                                                for name, payload in sorted(encoded.items())}
    encoded['summary.json'] = (json.dumps(outputs['summary.json'], ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
    directory_fd = os.open(OUT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    staged = []
    try:
        fcntl.flock(directory_fd, fcntl.LOCK_EX)
        for name, payload in encoded.items():
            final = OUT / name
            if final.is_symlink() or (final.exists() and not final.is_file()):
                raise ValueError('unsafe_existing_output')
            fd, tmp = tempfile.mkstemp(prefix='.normalize-', dir=OUT)
            staged.append((tmp, final))
            with os.fdopen(fd, 'wb') as f:
                f.write(payload)
                f.flush()
                os.fsync(f.fileno())
        for tmp, final in staged:
            os.replace(tmp, final)
        os.fsync(directory_fd)
    finally:
        for tmp, _ in staged:
            if os.path.exists(tmp):
                os.unlink(tmp)
        fcntl.flock(directory_fd, fcntl.LOCK_UN)
        os.close(directory_fd)


def self_test():
    checks = []
    def check(v):
        checks.append(bool(v))
        if not v:
            raise AssertionError('self_test_failed')
    check(tab_period('سال ۱۴۰۳') == (1403, 'annual'))
    check(tab_period('Copy of سال 1403')[1] == 'copy_or_summary')
    check(tab_period('شش ماهه اول 1403')[1] == 'nonannual')
    check(tab_period('محيط زيست 1400')[1] == 'environment_year_requires_header')
    check(label_from_filename('شاخص‌های وزارت نفت - شرکت مثال') == 'شرکت مثال')
    check(label_from_filename('شاخص‌های وزارت نفت - فرم مادر') is None)
    check(company_key('  پتروشیمی\u200c  الف  ') == 'الف')
    check(company_id('پتروشیمی الف') == company_id('الف'))
    check(numeric({'userEnteredValue': {'numberValue': 0}, 'effectiveValue': {'numberValue': 0}, 'formattedValue': '0'}) == (0, None))
    check(numeric({})[1] == 'blank_not_zero')
    check(numeric({'userEnteredValue': {'formulaValue': '=0'}, 'effectiveValue': {'numberValue': 0}, 'formattedValue': '0'})[1] == 'formula_not_independently_validated')
    check(numeric({'userEnteredValue': {'numberValue': .1}, 'effectiveValue': {'numberValue': .1}, 'formattedValue': '10%'})[1] == 'display_format_not_plain_numeric')
    check(numeric({'userEnteredValue': {'numberValue': 12.34}, 'effectiveValue': {'numberValue': 12.34}, 'formattedValue': '12.3'})[1] == 'display_rounding_or_scaling_ambiguous')
    check(numeric({'userEnteredValue': {'numberValue': 1234}, 'effectiveValue': {'numberValue': 1234}, 'formattedValue': '1,234'}) == (1234, None))
    check(numeric({'userEnteredValue': {'numberValue': 1}, 'effectiveValue': {'errorValue': {'type': 'DIVIDE_BY_ZERO'}}})[1] == 'formula_or_cell_error')
    check(numeric({'userEnteredValue': {'formulaValue': '=1/0'}, 'effectiveValue': {'errorValue': {'type': 'DIVIDE_BY_ZERO'}}})[1] == 'formula_or_cell_error')
    check(address(9, 26) == 'AA10')
    try:
        grid({'data': [{'rowData': [{'values': [{}]}]}, {'rowData': [{'values': [{}]}]}]})
        check(False)
    except ValueError:
        check(True)
    def s(value):
        return {'userEnteredValue': {'stringValue': value}, 'effectiveValue': {'stringValue': value}, 'formattedValue': value}
    def n(value):
        return {'userEnteredValue': {'numberValue': value}, 'effectiveValue': {'numberValue': value}, 'formattedValue': str(value)}
    def merge(r0, r1, c0, c1):
        return {'startRowIndex': r0, 'endRowIndex': r1, 'startColumnIndex': c0, 'endColumnIndex': c1}
    fixture = {'properties': {'sheetId': 7, 'title': 'سال 1403'}, 'archiveWarnings': [],
               'data': [{'rowData': [
                   {'values': [{}, s('نماد شاخص'), s('عنوان شاخص'), {}, {}, s('مقدار'), s('مجموع')]},
                   {'values': [{}, s('E1'), s(SAFE_SCALARS['E1'][0]), {}, {}, n(0)]},
                   {'values': [{}, s('E2'), s(SAFE_SCALARS['E2'][0]), {}, {}, n(123)]},
                   {'values': [{}, s('E18'), s('میزان فضای سبز'), s('متر مربع'), {}, n(40)]},
                   {'values': [{}, {}, {}, s('درصد'), {}, n(25)]},
                   {'values': [{}, s('E19'), s('میزان عوارض آلایندگی (میلیون ریال)')]},
               ]}],
               'merges': [merge(1, 2, 2, 5), merge(2, 3, 2, 5), merge(3, 5, 2, 3),
                          merge(3, 4, 3, 5), merge(4, 5, 3, 5)]}
    source = {'id': 'fake', 'name': 'شاخص‌های وزارت نفت - شرکت مثال', 'category': 'oil_ministry_indicators'}
    vals, meta, issues = extract_sheet(source, fixture, 1403, 'annual')
    check(vals == {'E1': 0, 'E2': 123, 'E18_area': 40, 'E18_percent': 25})
    check(meta['E1']['cell'] == 'F2' and meta['E18_percent']['subcategory_cell'] == 'D5')
    fixture['data'][0]['rowData'][1]['values'].append(n(4))  # competing G total
    vals, _, issues = extract_sheet(source, fixture, 1403, 'annual')
    check('E1' not in vals and any(i['reason'] == 'additional_total_or_value' for i in issues))
    fixture['data'][0]['rowData'][1]['values'].pop()
    fixture2 = json.loads(json.dumps(fixture))
    fixture2['properties']['sheetId'] = 8
    archive = {'source': source, 'response': {'sheets': [fixture, fixture2]}}
    test_output = normalize({'files': [source]}, [archive])
    check(not test_output['reports.json'] and test_output['summary.json']['counts']['conflicted_company_years'] == 1)
    check(sum(i['reason'] == 'multiple_annual_indicator_sheets_no_auto_overwrite'
              for i in test_output['unresolved.json']) == 2)
    print(json.dumps({'self_tests_passed': len(checks)}))


def main():
    if sys.argv[1:] == ['--self-test']:
        self_test()
        return
    if sys.argv[1:]:
        print('usage: normalize-indicator-history.py [--self-test]', file=sys.stderr)
        raise SystemExit(2)
    os.umask(0o077)
    try:
        manifest, archives = read_manifest_and_sources()
        results = normalize(manifest, archives)
        write_outputs(results)
        print(json.dumps({'counts': results['summary.json']['counts']}, sort_keys=True))
    except Exception as e:
        # Do not print exception messages, filenames, identifiers or source data.
        print(json.dumps({'status': 'stopped', 'error_type': type(e).__name__}), file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
