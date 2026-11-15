#!/usr/bin/env python3
"""Build a private, offline, conservative staging file; never writes a database.

Run: python3 /home/ubuntu/envirohub/scripts/normalize-semiannual-history.py
Input: /home/ubuntu/env-history/{manifest.json,raw/*.json.gz}
Output: /home/ubuntu/env-history/normalized/semiannual.json (directory 0700,
file 0600). Standard output contains counts and rejection/review identifiers and
reason codes only, never normalized rows or cell contents.

The output has companies, reports, review and summary. Each report follows the
client's Report shape, plus source_meta, which is *not* an API input field. A
future, separately authorized importer must handle source_meta as a separate DB
column and resolve company IDs with the destination before import. It must not
pass source_meta in an API report payload. Report IDs are deterministic UUIDv5;
status=draft makes no assertion about historical submission. The current script
performs no import, company reconciliation, or network access.

Only a checked, fixed layout is supported; a changed layout, duplicate company
within the same category, or duplicate report key goes to review. User-entered
numeric literals (including explicit zeros) are supported; formulas are never
calculated or imported, including their cached zeros. Text is retained in the
UI-compatible value with harmless boundary/control-whitespace cleaning; exact
raw cell content is preserved in source_meta. Annual-only water side tables are
not attributed to either six-month period. Unsupported fields, cell errors,
formulas and rejected rows are preserved as evidence in the private review.
No annual totals are split, no source numbers are added, and no category or
company identity is inferred by fuzzy matching.
"""
from __future__ import annotations

import collections
import gzip
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import unicodedata
import uuid
from pathlib import Path

ROOT = Path('/home/ubuntu/env-history')
OUTPUT = ROOT / 'normalized' / 'semiannual.json'
FORMAT = 'semiannual-history-staging-v1'
WASTE_OVERRIDES = {
    '16UMWqgkN9aHYxd1UiNGu7B1tv7grxemTFeBY91J6uMo': 'آریاساسول',
    '1Ho9jxzY3I8XgazsnYB5-IUO0lHWnRJlzNhN92THTBF0': 'پازارگاد',
}
DIGITS = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
REPORT_NAMESPACE = uuid.UUID('552574ec-7c33-54db-9c9e-ec3ea70a55fc')


def normalize(text):
    text = unicodedata.normalize('NFKC', str(text or ''))
    text = text.translate(str.maketrans({'ي': 'ی', 'ك': 'ک', '\u200c': ' '}))
    return re.sub(r'\s+', ' ', text).strip().casefold()


def company_identity(filename):
    # The entire filename is the final component when there is no hyphen.
    component = filename.rsplit('-', 1)[-1].strip()
    canonical = normalize(component)
    canonical = re.sub(r'^پتروشیمی\s*', '', canonical).strip()
    if not canonical:
        raise ValueError('empty_company')
    return component, canonical, 'co-' + hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:16]


def a1(row, column):
    out = ''
    while column:
        column, rem = divmod(column - 1, 26)
        out = chr(65 + rem) + out
    return out + str(row)


def grid(sheet):
    cells = {}
    for block in sheet.get('data', []):
        r0, c0 = block.get('startRow', 0), block.get('startColumn', 0)
        if not isinstance(r0, int) or not isinstance(c0, int) or r0 < 0 or c0 < 0:
            raise ValueError('invalid_grid_offset')
        for i, row in enumerate(block.get('rowData', [])):
            for j, cell in enumerate(row.get('values', [])):
                if not isinstance(cell, dict):
                    raise ValueError('invalid_cell')
                key = (r0 + i + 1, c0 + j + 1)
                if key in cells:
                    raise ValueError('overlapping_grid_blocks')
                if cell:
                    cells[key] = cell
    return cells


def literal_text(cell):
    entered = cell.get('userEnteredValue', {})
    if set(entered) != {'stringValue'}:
        return None
    value = entered['stringValue']
    if not isinstance(value, str) or not value.strip():
        return None
    # The server rejects controls, empty text and boundary whitespace.
    cleaned = re.sub(r'[\x00-\x1f\x7f]', ' ', value).strip()
    return cleaned if 0 < len(cleaned) <= 1000 else None


def header(cells, row, col):
    return normalize(literal_text(cells.get((row, col), {})) or '')


def numeric(cell):
    """Only direct, finite, nonnegative numeric entries are eligible."""
    entered = cell.get('userEnteredValue', {})
    effective = cell.get('effectiveValue', {})
    if set(entered) != {'numberValue'} or set(effective) != {'numberValue'}:
        return None
    x, y = entered['numberValue'], effective['numberValue']
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    if not math.isfinite(x) or not math.isfinite(y) or x != y or x < 0:
        return None
    return x


def evidence(cells, r, c):
    return {'a1': a1(r, c), 'cell': cells.get((r, c), {})}


def is_error(cell):
    ev = cell.get('effectiveValue', {})
    entered = cell.get('userEnteredValue', {})
    if 'errorValue' in ev:
        return True
    return any(isinstance(v, str) and v.strip().upper().startswith(('#REF!', '#DIV/0!', '#VALUE!', '#N/A', '#NAME?', '#NUM!', '#ERROR!'))
               for v in (entered.get('stringValue'), cell.get('formattedValue')))


def meaningful(cell):
    return bool(cell.get('userEnteredValue') or cell.get('effectiveValue'))


def period_from_title(title):
    n = normalize(title).translate(DIGITS)
    match = re.fullmatch(r'شش ماه(?:ه)? (اول|دوم) (1[34]\d\d)', n)
    if not match:
        return None
    return int(match.group(2)), 1 if match.group(1) == 'اول' else 2


def water_year(title):
    n = normalize(title).translate(DIGITS)
    match = re.fullmatch(r'اطلاعات کمی آب و پساب سالیانه (1[34]\d\d)', n)
    return int(match.group(1)) if match else None


def waste_layout(c):
    # Every destination column has its own verified header. The source's
    # separate P, Q, R and S fields are never merged into destination fields.
    tests = {
        (1, 7): ('تولید', 'تن'), (1, 11): ('مدیریت', 'تن'),
        (2, 2): ('واحد', 'تولیدی'), (2, 3): ('محصول', 'تن'),
        (2, 4): ('کد فرم',), (2, 5): ('کد خطر',), (2, 6): ('نام پسماند',),
        (3, 7): ('مانده', 'قبل'), (3, 8): ('ورودی',),
        (3, 9): ('تولید', 'جاری'), (3, 10): ('مجموع دوره',),
        (3, 11): ('استفاده مجدد', 'داخل'), (3, 12): ('فروش',),
        (3, 13): ('سوزاندن', 'مجتمع'), (3, 14): ('دفن', 'مجتمع'),
        (3, 15): ('بازیافت', 'خارج'), (3, 16): ('سوزاندن', 'خارج'),
        (3, 17): ('دفن',), (3, 18): ('تحویل به غیر',),
        (3, 19): ('سایر',), (3, 20): ('مجموع مدیریت',),
        (3, 21): ('موجودی دوره',),
    }
    return all(all(normalize(term) in header(c, *loc) for term in terms)
               for loc, terms in tests.items())


def water_layout(c):
    tests = {
        (1, 1): ('پارامتر',), (1, 5): ('واحد',),
        (1, 6): ('شش', 'اول'), (1, 7): ('شش', 'دوم'),
        (2, 1): ('آب', 'منبع'), (2, 2): ('e1',), (3, 2): ('e2',),
        (4, 2): ('e3',), (5, 2): ('مجموع',),
        (6, 3): ('محل', 'تامین'), (6, 4): ('محل', 'مصرف'),
        (6, 5): ('واحد',), (14, 2): ('مجموع',),
        (15, 1): ('e7', 'پساب'), (21, 2): ('مجموع',),
    }
    return (all(all(normalize(term) in header(c, *loc) for term in terms)
                for loc, terms in tests.items())
            and any('نوع آب' in header(c, r, 1) for r in (6, 7)))


def make_report(company_id, year, period, category, values, source_meta):
    key = f'{company_id}|{year}|{period}|{category}'
    return {'id': str(uuid.uuid5(REPORT_NAMESPACE, key)), 'companyId': company_id,
            'year': year, 'period': period, 'category': category,
            'values': values, 'status': 'draft', 'source_meta': source_meta}


def sheet_meta(file, sheet):
    p = sheet['properties']
    return {'file_id': file['id'], 'file_name': file['name'],
            'sheet_id': p['sheetId'], 'sheet_title': p['title'],
            'hidden': bool(p.get('hidden', False)),
            'company_name_coordinate': 'file_name_after_last_hyphen',
            'field_cells': {}, 'unit_cells': {}, 'omitted_formula_cells': []}


def review_item(file, sheet, reason, **kw):
    out = {'file_id': file['id'], 'reason': reason}
    if sheet is not None:
        props = sheet.get('properties', {})
        out.update({'sheet_id': props.get('sheetId'), 'sheet_title': props.get('title')})
    out.update(kw)
    return out


def reject_row(file, sheet, reason, cells, row, start, end):
    return review_item(file, sheet, reason, row=row,
        cells=[evidence(cells, row, col) for col in range(start, end + 1)
               if meaningful(cells.get((row, col), {}))])


def add_text(row, meta, key, cells, r, col):
    cell = cells.get((r, col), {})
    value = literal_text(cell)
    if value is not None:
        row[key] = value
        meta[key] = evidence(cells, r, col)
        return True
    return False


def add_number(row, meta, key, cells, r, col):
    cell = cells.get((r, col), {})
    value = numeric(cell)
    if value is not None:
        row[key] = value
        meta[key] = evidence(cells, r, col)
        return True
    return False


def process_waste(file, sheet, cells, company_id, year, period):
    review, rows, row_meta, formulas = [], [], [], []
    if not waste_layout(cells):
        return None, [review_item(file, sheet, 'unrecognized_or_changed_waste_layout')]
    mapping = {3: 'product_amount', 7: 'opening_balance', 8: 'incoming',
               9: 'generated', 10: 'period_total', 11: 'reuse', 12: 'sale',
               13: 'incineration', 14: 'landfill', 15: 'external_recycling',
               20: 'management_total', 21: 'closing_balance'}
    maxrow = max((r for r, _ in cells), default=3)
    for r in range(4, maxrow + 1):
        # A numerical sequence number, name and hazard code are essential to
        # distinguish data rows from summary rows and template footnotes.
        number = numeric(cells.get((r, 1), {}))
        name = literal_text(cells.get((r, 6), {}))
        hazard = literal_text(cells.get((r, 5), {}))
        if number is None or number <= 0 or not name or not hazard:
            if number is not None and number > 0 and any(meaningful(cells.get((r, k), {})) for k in (3, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 19)):
                review.append(reject_row(file, sheet, 'waste_row_identity_uncertain', cells, r, 1, 21))
            continue
        errors = [c for c in range(2, 22) if is_error(cells.get((r, c), {}))]
        if errors:
            review.append(reject_row(file, sheet, 'cell_error_in_waste_row', cells, r, 1, 21))
            continue
        # These source columns have no distinct editable destination field.
        # Do not collapse unlike management methods into a single UI field.
        unsupported = [c for c in (16, 17, 19) if meaningful(cells.get((r, c), {})) and
                       'formulaValue' not in cells[(r, c)].get('userEnteredValue', {})]
        if unsupported:
            review.append(reject_row(file, sheet, 'waste_method_has_no_editable_field', cells, r, 1, 21))
            continue
        bad = [c for c in mapping if meaningful(cells.get((r, c), {})) and
               numeric(cells[(r, c)]) is None and 'formulaValue' not in cells[(r, c)].get('userEnteredValue', {})]
        if bad:
            review.append(reject_row(file, sheet, 'waste_non_numeric_or_negative_amount', cells, r, 1, 21))
            continue
        row, meta = {}, {}
        for col, key in ((2, 'production_unit'), (4, 'form_code'), (5, 'hazard_code'), (6, 'waste_name')):
            if meaningful(cells.get((r, col), {})) and not add_text(row, meta, key, cells, r, col):
                # Codes can be entered numerically. Use their display form to
                # retain leading zeroes, with the original cell in metadata.
                cell = cells[(r, col)]
                displayed = cell.get('formattedValue')
                if col in (4, 5) and numeric(cell) is not None and isinstance(displayed, str) and displayed.strip() and len(displayed.strip()) <= 1000 and not re.search(r'[\x00-\x1f\x7f]', displayed):
                    row[key] = displayed.strip(); meta[key] = evidence(cells, r, col)
                else:
                    row = None; break
        if row is None:
            review.append(reject_row(file, sheet, 'waste_text_or_code_not_editable', cells, r, 1, 21))
            continue
        for col, key in mapping.items():
            add_number(row, meta, key, cells, r, col)
        # Do not emit a template-only row whose apparent zeros are formulas.
        if not any(k in row for k in mapping.values()):
            continue
        if 'product_amount' in row:
            row['product_unit'] = 'تن'
            meta['product_unit'] = evidence(cells, 2, 3)
        rows.append(row); row_meta.append(meta)
        for col in (3, *range(7, 22)):
            cell = cells.get((r, col), {})
            if 'formulaValue' in cell.get('userEnteredValue', {}):
                formulas.append(evidence(cells, r, col))
    if not rows:
        review.append(review_item(file, sheet, 'no_importable_waste_rows'))
        return None, review
    encoded = json.dumps(rows, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    if len(rows) > 100 or len(encoded.encode('utf-8')) > 30000:
        review.append(review_item(file, sheet, 'waste_exceeds_editable_limits'))
        return None, review
    meta = sheet_meta(file, sheet)
    meta['field_cells']['waste_streams'] = row_meta
    meta['unit_cells']['waste_mass'] = [evidence(cells, 1, 7), evidence(cells, 1, 11)]
    meta['omitted_formula_cells'] = formulas
    meta['limitations'] = ['Only explicitly entered numeric cells; source formulas omitted.',
                           'The UI has no separate fields for source columns P, Q, R and S; affected literal rows are reviewed.']
    if formulas:
        review.append(review_item(file, sheet, 'formulas_omitted', cells=formulas))
    return make_report(company_id, year, period, 'waste', {'waste_streams': encoded}, meta), review


def process_water(file, sheet, cells, company_id, year):
    if not water_layout(cells):
        return [], [review_item(file, sheet, 'unrecognized_or_changed_water_layout')]
    review, reports = [], []
    # Water management / quality / pond information to the right is annual or
    # has no unambiguous half-year association. Preserve it solely for review.
    auxiliary = [evidence(cells, r, c) for (r, c), value in sorted(cells.items())
                 if 2 <= r <= 21 and 10 <= c <= 18 and meaningful(value)]
    if auxiliary:
        review.append(review_item(file, sheet, 'annual_or_undated_water_side_table', cells=auxiliary))
    for period, col in ((1, 6), (2, 7)):
        sections = {'water_sources': [], 'water_effluents': []}
        provenance = {'water_sources': [], 'water_effluents': []}
        for r in list(range(2, 5)) + list(range(7, 14)) + list(range(15, 21)):
            cell = cells.get((r, col), {})
            if not meaningful(cell):
                continue
            if is_error(cell):
                review.append(reject_row(file, sheet, 'water_period_cell_error', cells, r, 1, 8))
                continue
            if 'formulaValue' in cell.get('userEnteredValue', {}):
                review.append(review_item(file, sheet, 'water_period_formula_omitted', period=period,
                                          cells=[evidence(cells, r, col)]))
                continue
            if numeric(cell) is None:
                review.append(reject_row(file, sheet, 'water_period_amount_not_numeric', cells, r, 1, 8))
                continue
            unit = literal_text(cells.get((r, 5), {}))
            label = literal_text(cells.get((r, 2), {}))
            if not unit or not label or any(is_error(cells.get((r, c), {})) for c in (2, 3, 4, 5)):
                review.append(reject_row(file, sheet, 'water_label_or_unit_uncertain', cells, r, 1, 8))
                continue
            row, meta = {}, {}
            if r <= 4:
                section = 'water_sources'; add_text(row, meta, 'source', cells, r, 2)
            elif r <= 13:
                section = 'water_sources'; add_text(row, meta, 'water_type', cells, r, 2)
                for c, key in ((3, 'supply_location'), (4, 'consumption_location')):
                    if meaningful(cells.get((r, c), {})) and not add_text(row, meta, key, cells, r, c):
                        row = None; break
                if row is None:
                    review.append(reject_row(file, sheet, 'water_location_uncertain', cells, r, 1, 8)); continue
            else:
                section = 'water_effluents'; add_text(row, meta, 'stream_type', cells, r, 2)
            # Effluent UI declares volume to be m3 and has no per-row volume unit.
            # A different unit cannot safely be displayed as m3.
            if section == 'water_effluents' and normalize(unit).replace(' ', '') not in ('مترمکعب',):
                review.append(reject_row(file, sheet, 'effluent_unit_not_m3', cells, r, 1, 8)); continue
            if section == 'water_sources':
                add_text(row, meta, 'unit', cells, r, 5)
                add_number(row, meta, 'amount', cells, r, col)
            else:
                add_number(row, meta, 'volume', cells, r, col)
                meta['volume_unit'] = evidence(cells, r, 5)
            sections[section].append(row); provenance[section].append(meta)
        values = {k: json.dumps(v, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
                  for k, v in sections.items() if v}
        if not values:
            review.append(review_item(file, sheet, 'no_importable_water_rows', period=period))
            continue
        if any(len(sections[k]) > 100 or len(v.encode('utf-8')) > 30000 for k, v in values.items()):
            review.append(review_item(file, sheet, 'water_exceeds_editable_limits', period=period)); continue
        meta = sheet_meta(file, sheet)
        meta['field_cells'] = {k: v for k, v in provenance.items() if v}
        meta['period_header'] = evidence(cells, 1, col)
        meta['year_source'] = 'sheet_title'
        meta['limitations'] = ['Annual/undated water side tables are in review, not attributed to a half year.',
                               'Only direct numeric literals in the period column are imported.']
        reports.append(make_report(company_id, year, period, 'water', values, meta))
    return reports, review


def classify(file):
    fid, name = file.get('id', ''), file.get('name', '')
    if not isinstance(fid, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', fid) or not isinstance(name, str):
        return None, 'invalid_manifest_identity'
    n = normalize(name)
    if re.search(r'\bcopy\b|کپی|نسخه\s*برداری', n) or any(w.get('type') == 'filename_indicates_copy' for w in file.get('warnings', []) if isinstance(w, dict)):
        return None, 'copy_requires_review'
    if fid in WASTE_OVERRIDES:
        if normalize(name) != normalize(WASTE_OVERRIDES[fid]):
            return None, 'allowlist_name_mismatch'
        return 'waste', None
    if 'جمع بندی' in n or 'جمع بند' in n or 'تجمیع' in n or 'فرم مادر' in n:
        return None, 'summary_or_template'
    if re.fullmatch(r'گزارش پسماند\s*-\s*[^-]+', n):
        return 'waste', None
    if re.fullmatch(r'گزارش آب و پساب\s*-\s*[^-]+', n):
        return 'water', None
    return None, 'outside_explicit_water_waste_scope'


def run():
    with open(ROOT / 'manifest.json', encoding='utf-8') as stream:
        manifest = json.load(stream)
    files = manifest.get('files')
    if manifest.get('format') != 1 or manifest.get('incomplete_search') or not isinstance(files, list) or not files:
        raise ValueError('invalid_or_incomplete_manifest')
    ids = [x.get('id') for x in files if isinstance(x, dict)]
    if len(ids) != len(files) or len(set(ids)) != len(ids):
        raise ValueError('invalid_or_duplicate_manifest_file_id')
    review, candidates, duplicate_groups = [], [], collections.defaultdict(list)
    for file in files:
        cat, err = classify(file)
        if err:
            review.append(review_item(file, None, err)); continue
        try:
            name, canonical, cid = company_identity(file['name'])
        except ValueError:
            review.append(review_item(file, None, 'invalid_company_name')); continue
        if not re.search(r'[\w\u0600-\u06ff]', canonical) or len(canonical) > 200:
            review.append(review_item(file, None, 'invalid_company_name')); continue
        candidate = (file, cat, name, canonical, cid)
        candidates.append(candidate); duplicate_groups[(cat, cid)].append(file['id'])
    reports, company_names = [], {}
    for file, cat, company_name, canonical, cid in candidates:
        if len(duplicate_groups[(cat, cid)]) > 1:
            review.append(review_item(file, None, 'duplicate_company_category_files',
                                      conflicting_file_ids=duplicate_groups[(cat, cid)]))
            continue
        path = ROOT / 'raw' / (file['id'] + '.json.gz')
        try:
            with gzip.open(path, 'rt', encoding='utf-8') as stream:
                data = json.load(stream)
            response = data['response']
            if (data.get('format') != 'google-sheets-griddata-selected-v1' or
                data.get('source', {}).get('id') != file['id'] or
                data.get('source', {}).get('name') != file['name'] or
                response.get('spreadsheetId') != file['id'] or
                not isinstance(response.get('sheets'), list)):
                raise ValueError('source_identity_or_format_mismatch')
            sheets = response['sheets']
            sheet_ids = [s.get('properties', {}).get('sheetId') for s in sheets]
            if None in sheet_ids or len(set(sheet_ids)) != len(sheet_ids):
                raise ValueError('sheet_identity_invalid')
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            review.append(review_item(file, None, 'raw_missing_corrupt_or_identity_mismatch')); continue
        # Reserve all repeated keys before extraction: neither colliding sheet
        # is silently favored, even if one later fails a layout test.
        keyed = collections.defaultdict(list)
        for sheet in sheets:
            p = sheet.get('properties', {})
            title = p.get('title', '')
            if not isinstance(title, str):
                review.append(review_item(file, sheet, 'invalid_sheet_title')); continue
            if re.search(r'\bcopy\b|کپی|نسخه\s*برداری', normalize(title)):
                review.append(review_item(file, sheet, 'copy_sheet_requires_review')); continue
            if p.get('sheetType', 'GRID') != 'GRID':
                review.append(review_item(file, sheet, 'non_grid_sheet')); continue
            if cat == 'waste':
                yp = period_from_title(title)
                if not yp:
                    review.append(review_item(file, sheet, 'waste_period_or_year_not_explicit')); continue
                keyed[yp].append(sheet)
            else:
                year = water_year(title)
                if not year:
                    review.append(review_item(file, sheet, 'water_annual_title_not_explicit')); continue
                keyed[(year, 0)].append(sheet)
        for key, group in keyed.items():
            if len(group) > 1:
                for sheet in group:
                    review.append(review_item(file, sheet, 'duplicate_report_key'))
                continue
            sheet = group[0]
            try:
                cells = grid(sheet)
                if cat == 'waste':
                    report, issues = process_waste(file, sheet, cells, cid, *key)
                    extracted = [report] if report else []
                else:
                    extracted, issues = process_water(file, sheet, cells, cid, key[0])
                reports.extend(extracted); review.extend(issues)
                if extracted:
                    company_names[cid] = company_name
            except (ValueError, TypeError, KeyError, OverflowError):
                review.append(review_item(file, sheet, 'sheet_parse_failure'))
    report_keys = [(r['companyId'], r['year'], r['period'], r['category']) for r in reports]
    collisions = {k for k, count in collections.Counter(report_keys).items() if count > 1}
    if collisions:
        filtered = []
        for report in reports:
            key = (report['companyId'], report['year'], report['period'], report['category'])
            if key in collisions:
                src = report['source_meta']
                review.append({'file_id': src['file_id'], 'sheet_id': src['sheet_id'], 'reason': 'duplicate_output_report_key'})
            else:
                filtered.append(report)
        reports = filtered
    used = {r['companyId'] for r in reports}
    companies = [{'id': cid, 'name': company_names[cid]} for cid in sorted(used)]
    reports.sort(key=lambda r: (r['companyId'], r['year'], r['period'], r['category']))
    counts = collections.Counter(item['reason'] for item in review)
    summary = {'files_in_manifest': len(files), 'candidate_files': len(candidates),
               'importable_companies': len(companies), 'importable_reports': len(reports),
               'importable_reports_by_category': dict(sorted(collections.Counter(r['category'] for r in reports).items())),
               'review_items': len(review), 'review_reasons': dict(sorted(counts.items()))}
    return {'format': FORMAT, 'companies': companies, 'reports': reports, 'review': review, 'summary': summary}


def write_private(obj):
    OUTPUT.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(OUTPUT.parent, 0o700)
    fd, tmp = tempfile.mkstemp(prefix='.semiannual-', dir=OUTPUT.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(obj, stream, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
            stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(tmp, OUTPUT)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def main():
    if len(sys.argv) > 1:
        print('Usage: python3 normalize-semiannual-history.py', file=sys.stderr)
        return 2
    try:
        result = run()
        write_private(result)
    except (OSError, ValueError, KeyError, TypeError, OverflowError):
        # Never print exception text: it can contain a source cell or filename.
        print('normalization_failed; no database writes', file=sys.stderr)
        return 1
    summary = result['summary']
    print('importable_reports=' + str(summary['importable_reports']) +
          ' importable_companies=' + str(summary['importable_companies']) +
          ' review_items=' + str(summary['review_items']))
    print('reports_by_category=' + json.dumps(summary['importable_reports_by_category'], sort_keys=True))
    # Distinct file/sheet/reason combinations only; no cell contents, names or rows.
    reasons = sorted({(str(x.get('file_id', '')), str(x.get('sheet_id', '-')), x['reason']) for x in result['review']})
    for file_id, sheet_id, reason in reasons:
        print(f'review file_id={file_id} sheet_id={sheet_id} reason={reason}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
