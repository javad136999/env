#!/usr/bin/env python3
"""Read-only Google Sheets history extraction; optional, explicitly confirmed later upload.

No cell values are printed. The local archive stores the selected Google Sheets API
CellData fields and grid offsets without inferring indicators, periods or units.
Run `python3 scripts/import-google-history.py --help` for commands.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import gzip
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

DEFAULT_DIR = Path('/home/ubuntu/env-history')
FIELDS = ('spreadsheetId,properties,sheets(properties,merges,data('
          'startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,'
          'formattedValue,note,hyperlink,textFormatRuns))))')
FORMAT_VERSION = 'google-sheets-griddata-selected-v1'
REQUEST_GAP_SECONDS = 1.5  # 40/minute across all threads; leave headroom for shared quotas.
BATCH_MAX_ROWS = 20
BATCH_MAX_BYTES = 2_000_000  # Normal batches are strictly below 2 MB of UTF-8 JSON.
_rate_lock = threading.Lock()
_next_request_at = 0.0
UPLOAD_CATEGORIES = frozenset({
    'waste', 'summary_review', 'oil_ministry_indicators', 'water_wastewater',
    'air', 'combined_water_air', 'waste_summary',
})
# Parent-reviewed exact source IDs: sheets contain half-year waste records despite
# filenames consisting only of a company name. Never modify archived source data.
UPLOAD_ID_CATEGORY_OVERRIDES = {
    '16UMWqgkN9aHYxd1UiNGu7B1tv7grxemTFeBY91J6uMo': 'waste',
    '1Ho9jxzY3I8XgazsnYB5-IUO0lHWnRJlzNhN92THTBF0': 'waste',
}
LIMITATIONS = [
    'Selected cell fields only: user-entered and effective values, display text, notes, hyperlinks, and text format runs. Full cell formats, validations, row/column styling, charts and drawings are not exported.',
    'GridData arrays and offsets are preserved exactly as returned; missing cells/rows within grid dimensions are blank under the Sheets API representation, not zero.',
    'Sheets API values and calculated results are a live read, not a transactional historical revision or cross-file snapshot.',
    'Annual, semiannual, quarterly and copy sheets are independent source records and must not be automatically combined.',
    'Categories are heuristic file-name labels; company_label remains null pending human review.',
    'Only explicit environmental upload categories and two individually reviewed spreadsheet IDs are eligible for later upload; other_review and unrecognized categories remain local unless specifically reviewed and authorized.',
    'Discovery covers the accessible non-trashed Google Sheets returned by the configured Drive account, not inaccessible accounts or drives.',
]


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def private_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)


def atomic_bytes(path: Path, data: bytes):
    private_dir(path.parent)
    fd, temp = tempfile.mkstemp(prefix='.tmp-', dir=str(path.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def json_bytes(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def atomic_json(path, obj):
    atomic_bytes(path, json_bytes(obj))


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def norm(text):
    text = unicodedata.normalize('NFKC', text or '').translate(str.maketrans({'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', '\u200c': ' '}))
    return re.sub(r'\s+', ' ', text).strip().casefold()


def category(name):
    n = norm(name)
    water = any(s in n for s in ('اب و پساب', 'اب وپساب', 'پساب'))
    air = 'هوا' in n
    waste = 'پسماند' in n
    if water and air:
        return 'combined_water_air'
    if waste and ('تجمیع' in n or 'جمع بندی' in n or 'جمع بندي' in n):
        return 'waste_summary'
    if waste:
        return 'waste'
    if water:
        return 'water_wastewater'
    if air:
        return 'air'
    if 'جمع بندی' in n or 'جمع بندي' in n or 'جمع بند' in n:
        return 'summary_review'
    if 'شاخص' in n:
        return 'oil_ministry_indicators'
    return 'other_review'


def upload_category(source):
    """Transfer policy only: never change the original archived source category."""
    return UPLOAD_ID_CATEGORY_OVERRIDES.get(source.get('id')) or (
        source.get('category') if source.get('category') in UPLOAD_CATEGORIES else None)


class SafeError(Exception):
    pass


def wait_for_rate_slot():
    global _next_request_at
    with _rate_lock:
        current = time.monotonic()
        slot = max(current, _next_request_at)
        _next_request_at = slot + REQUEST_GAP_SECONDS
    if slot > current:
        time.sleep(slot - current)


def gws_json(command, params, attempts=5, timeout=240):
    args = ['gws'] + command + ['--params', json.dumps(params, ensure_ascii=False)]
    last = 'unknown_error'
    for n in range(attempts):
        try:
            wait_for_rate_slot()
            # Both streams are captured: an API error or sheet content is never printed.
            p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
            if p.returncode == 0:
                try:
                    obj = json.loads(p.stdout)
                except (UnicodeDecodeError, json.JSONDecodeError):
                    last = 'invalid_json'
                else:
                    if isinstance(obj, dict) and 'error' not in obj:
                        return obj
                    last = 'api_error'
            else:
                # Deliberately do not include untrusted response/error text.
                last = f'gws_exit_{p.returncode}'
                try:
                    for stream in (p.stdout, p.stderr):
                        err = json.loads(stream)
                        code = (err.get('error') or {}).get('code') if isinstance(err, dict) else None
                        if isinstance(code, int):
                            last = f'http_{code}'
                            break
                except (ValueError, AttributeError, TypeError):
                    pass
                if last in ('http_400', 'http_401', 'http_404') or p.returncode in (2, 3):
                    break
        except subprocess.TimeoutExpired:
            last = 'timeout'
        except OSError:
            last = 'gws_execution_error'
            break
        if n + 1 < attempts:
            time.sleep(min(45, 1.5 * (2 ** n)) + random.random())
    raise SafeError(last)


def inventory(root: Path, refresh=False):
    file = root / 'manifest.json'
    if file.exists() and not refresh:
        m = load_json(file)
        if m.get('format') != 1 or m.get('incomplete_search') or not m.get('files'):
            raise SafeError('invalid_or_incomplete_manifest')
        return m
    files = []
    page = None
    seen_pages = set()
    incomplete = False
    pages = 0
    while True:
        params = {
            'q': "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
            'pageSize': 100,
            'fields': 'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,parents,driveId,webViewLink)',
            'supportsAllDrives': True,
            'includeItemsFromAllDrives': True,
        }
        if page:
            params['pageToken'] = page
        obj = gws_json(['drive', 'files', 'list'], params)
        pages += 1
        incomplete = incomplete or obj.get('incompleteSearch', False)
        files.extend(obj.get('files', []))
        page = obj.get('nextPageToken')
        print(f'discovery pages={pages} files={len(files)}', flush=True)
        if not page:
            break
        if page in seen_pages:
            raise SafeError('repeated_page_token')
        seen_pages.add(page)
    if incomplete:
        raise SafeError('drive_incomplete_search')
    ids = [x.get('id') for x in files]
    if not files or len(set(ids)) != len(ids) or None in ids:
        raise SafeError('empty_or_duplicate_inventory_ids')
    groups = defaultdict(list)
    for f in files:
        groups[norm(f.get('name', ''))].append(f['id'])
    for f in files:
        f['category'] = category(f.get('name', ''))
        f['company_label'] = None
        f['warnings'] = []
        same = groups[norm(f.get('name', ''))]
        if len(same) > 1:
            f['warnings'].append({'type': 'same_normalized_filename', 'spreadsheet_ids': sorted(same)})
        if re.search(r'\bcopy\b|کپی|كپي', f.get('name', ''), re.I):
            f['warnings'].append({'type': 'filename_indicates_copy'})
        if f['category'] in ('other_review', 'summary_review'):
            f['warnings'].append({'type': 'category_requires_human_review'})
    files.sort(key=lambda x: x['id'])
    m = {'format': 1, 'discovered_at': now(), 'pages': pages, 'incomplete_search': incomplete,
         'query': 'all accessible, non-trashed Google Sheets; no name-based exclusion',
         'limitations': LIMITATIONS, 'files': files}
    atomic_json(file, m)
    return m


def archive_path(root, spreadsheet_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', spreadsheet_id):
        raise SafeError('invalid_spreadsheet_id')
    return root / 'raw' / (spreadsheet_id + '.json.gz')


def load_archive(path):
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        a = json.load(f)
    if a.get('format') != FORMAT_VERSION or not isinstance(a.get('response', {}).get('sheets'), list):
        raise SafeError('invalid_archive')
    sid = a.get('source', {}).get('id')
    if not sid or a['response'].get('spreadsheetId') != sid:
        raise SafeError('archive_source_mismatch')
    keys = [s.get('properties', {}).get('sheetId') for s in a['response']['sheets']]
    if any(not isinstance(x, int) for x in keys) or len(set(keys)) != len(keys):
        raise SafeError('missing_or_duplicate_sheet_id')
    return a


def extract_one(root, source, force=False):
    sid = source['id']
    path = archive_path(root, sid)
    failpath = root / 'failures' / (sid + '.json')
    if path.exists() and not force:
        try:
            archive = load_archive(path)
            if archive['source']['id'] != sid:
                raise SafeError('archive_filename_source_mismatch')
            if failpath.exists():
                failpath.unlink()
            return ('cached', len(archive['response']['sheets']))
        except Exception:
            pass
    try:
        obj = gws_json(['sheets', 'spreadsheets', 'get'], {'spreadsheetId': sid, 'fields': FIELDS})
        if obj.get('spreadsheetId') != sid or not isinstance(obj.get('sheets'), list):
            raise SafeError('invalid_spreadsheet_response')
        for s in obj['sheets']:
            props = s.get('properties', {})
            if not isinstance(props.get('sheetId'), int) or not isinstance(props.get('title'), str):
                raise SafeError('invalid_sheet_properties')
            s['archiveWarnings'] = []
            if re.search(r'\bcopy\b|کپی|كپي', props['title'], re.I):
                s['archiveWarnings'].append('sheet_title_indicates_copy')
            if props.get('sheetType', 'GRID') != 'GRID':
                s['archiveWarnings'].append('non_grid_sheet_verify_readability')
        archive = {'format': FORMAT_VERSION, 'retrieved_at': now(), 'source': source,
                   'field_mask': FIELDS, 'limitations': LIMITATIONS, 'response': obj}
        content = gzip.compress(json_bytes(archive), compresslevel=6)
        atomic_bytes(path, content)
        load_archive(path)  # Validate before declaring success.
        if failpath.exists():
            failpath.unlink()
        return ('read', len(obj['sheets']))
    except Exception as exc:
        reason = str(exc) if isinstance(exc, SafeError) else type(exc).__name__
        atomic_json(failpath, {'spreadsheet_id': sid, 'spreadsheet_name': source.get('name'),
                               'reason': reason, 'at': now()})
        return ('failed', 0)


def inspect(root, manifest, save=True):
    result = {'as_of': now(), 'manifest_files': len(manifest['files']), 'manifest_pages': manifest['pages'],
              'incomplete_search': manifest['incomplete_search'], 'readable_files': 0,
              'failed_files': [], 'not_attempted_files': [], 'readable_sheets': 0,
              'hidden_sheets': 0, 'non_grid_sheets': 0, 'sheets_without_row_data': 0, 'copy_marked_sheets': 0,
              'formula_cells': 0, 'error_cells': 0, 'zero_effective_cells': 0,
              'duplicate_name_files': 0, 'categories': {}, 'limitations': LIMITATIONS}
    scope = {'allowed_categories': sorted(UPLOAD_CATEGORIES), 'eligible_files': 0,
             'eligible_readable_files': 0, 'eligible_sheets': 0,
             'eligible_failed_files': 0, 'eligible_pending_files': 0,
             'reviewed_id_overrides': [], 'excluded_files': [], 'excluded_sheets': 0}
    result['upload_scope'] = scope
    counts = Counter()
    keys = set()
    for source in manifest['files']:
        sid = source['id']
        counts[source['category']] += 1
        destination_category = upload_category(source)
        eligible = destination_category is not None
        excluded = None
        if eligible:
            scope['eligible_files'] += 1
            if source['id'] in UPLOAD_ID_CATEGORY_OVERRIDES:
                scope['reviewed_id_overrides'].append({
                    'spreadsheet_id': sid, 'spreadsheet_name': source.get('name'),
                    'source_category': source['category'], 'upload_category': destination_category,
                    'reason': 'individually_reviewed_exact_spreadsheet_id',
                })
        else:
            excluded = {'spreadsheet_id': sid, 'spreadsheet_name': source.get('name'),
                        'category': source['category'], 'reason': 'outside_explicit_upload_categories',
                        'readable_sheets': None, 'returned_cells_with_selected_fields': None}
            scope['excluded_files'].append(excluded)
        if any(w.get('type') == 'same_normalized_filename' for w in source['warnings']):
            result['duplicate_name_files'] += 1
        path = archive_path(root, sid)
        failpath = root / 'failures' / (sid + '.json')
        # A failed forced refresh must not be masked by an older successful archive.
        if failpath.exists():
            result['failed_files'].append(load_json(failpath))
            scope['eligible_failed_files'] += eligible
            continue
        if not path.exists():
            result['not_attempted_files'].append({'spreadsheet_id': sid, 'spreadsheet_name': source.get('name')})
            scope['eligible_pending_files'] += eligible
            continue
        try:
            a = load_archive(path)
            if a['source']['id'] != sid:
                raise SafeError('archive_filename_source_mismatch')
            if a['source'].get('category') != source['category']:
                raise SafeError('archive_manifest_category_mismatch')
            selected_cells = 0
            for sheet in a['response']['sheets']:
                prop = sheet['properties']
                key = (sid, prop['sheetId'])
                if key in keys:
                    raise SafeError('duplicate_primary_key')
                keys.add(key)
                result['readable_sheets'] += 1
                result['hidden_sheets'] += bool(prop.get('hidden', False))
                result['non_grid_sheets'] += prop.get('sheetType', 'GRID') != 'GRID'
                result['sheets_without_row_data'] += not any(g.get('rowData') for g in sheet.get('data', []))
                result['copy_marked_sheets'] += 'sheet_title_indicates_copy' in sheet.get('archiveWarnings', [])
                for grid in sheet.get('data', []):
                    for row in grid.get('rowData', []):
                        for cell in row.get('values', []):
                            selected_cells += bool(cell)
                            u = cell.get('userEnteredValue', {})
                            e = cell.get('effectiveValue', {})
                            result['formula_cells'] += 'formulaValue' in u
                            result['error_cells'] += 'errorValue' in e
                            result['zero_effective_cells'] += 'numberValue' in e and e['numberValue'] == 0
            result['readable_files'] += 1
            if eligible:
                scope['eligible_readable_files'] += 1
                scope['eligible_sheets'] += len(a['response']['sheets'])
            else:
                excluded['readable_sheets'] = len(a['response']['sheets'])
                excluded['returned_cells_with_selected_fields'] = selected_cells
                scope['excluded_sheets'] += len(a['response']['sheets'])
        except Exception as exc:
            reason = str(exc) if isinstance(exc, SafeError) else type(exc).__name__
            result['failed_files'].append({'spreadsheet_id': sid, 'spreadsheet_name': source.get('name'), 'reason': reason})
            scope['eligible_failed_files'] += eligible
    result['categories'] = dict(counts)
    if save:
        atomic_json(root / 'summary.json', result)
    return result


def print_summary(s):
    print('files={manifest_files} read={readable_files} failed={failed} pending={pending} sheets={readable_sheets} hidden={hidden_sheets} non_grid={non_grid_sheets} no_row_data={sheets_without_row_data}'.format(
        **s, failed=len(s['failed_files']), pending=len(s['not_attempted_files'])), flush=True)
    print('formula_cells={formula_cells} error_cells={error_cells} numeric_zero_cells={zero_effective_cells} duplicate_name_files={duplicate_name_files} copy_marked_sheets={copy_marked_sheets}'.format(**s), flush=True)
    scope = s['upload_scope']
    print('upload_scope eligible_files={eligible_files} eligible_sheets={eligible_sheets} excluded_files={excluded_files} excluded_sheets={excluded_sheets}'.format(
        eligible_files=scope['eligible_files'], eligible_sheets=scope['eligible_sheets'],
        excluded_files=len(scope['excluded_files']), excluded_sheets=scope['excluded_sheets']), flush=True)
    if s['failed_files'] or s['not_attempted_files']:
        print('Details are recorded privately in summary.json; no cell content printed.', flush=True)


def do_extract(args, root):
    m = inventory(root, args.refresh_inventory)
    print(f'extract start files={len(m["files"])} workers={args.workers}', flush=True)
    results = Counter()
    sheet_count = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(extract_one, root, source, args.force) for source in m['files']]
        for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
            state, sheets = future.result()
            results[state] += 1
            sheet_count += sheets
            if i % 5 == 0 or i == len(futures):
                print(f'progress files={i}/{len(futures)} read={results["read"]} cached={results["cached"]} failed={results["failed"]} sheets={sheet_count}', flush=True)
    summary = inspect(root, m)
    print_summary(summary)
    return 1 if summary['failed_files'] or summary['not_attempted_files'] else 0


def sheet_payload(a, sheet, destination_category=None):
    source = a['source']
    prop = sheet['properties']
    target_category = destination_category or source['category']
    return {
        'spreadsheet_id': source['id'],
        'spreadsheet_name': source.get('name', ''),
        'sheet_id': prop['sheetId'],
        'sheet_name': prop['title'],
        'category': target_category,
        'company_label': source.get('company_label'),
        'cells': {
            'format': FORMAT_VERSION,
            'source': source,
            'classification': {'source_category': source['category'], 'upload_category': target_category,
                               'basis': 'reviewed_exact_spreadsheet_id' if source['id'] in UPLOAD_ID_CATEGORY_OVERRIDES and target_category != source['category'] else 'filename_heuristic'},
            'retrieved_at': a['retrieved_at'],
            'field_mask': a['field_mask'],
            'spreadsheet_properties': a['response'].get('properties', {}),
            'sheet_properties': prop,
            'merges': sheet.get('merges', []),
            'grid_data': sheet.get('data', []),
            'warnings': sheet.get('archiveWarnings', []),
            'limitations': a['limitations'],
        },
    }


def do_upload(args, root):
    if not args.confirm_upload:
        raise SafeError('upload_requires_explicit_--confirm-upload_and_user_authorization')
    if not (root / 'manifest.json').is_file():
        raise SafeError('manifest_missing_run_extract_first')
    m = inventory(root)
    summary = inspect(root, m)
    scope = summary['upload_scope']
    if scope['eligible_failed_files'] or scope['eligible_pending_files']:
        raise SafeError('incomplete_eligible_archive_upload_blocked')
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise SafeError('SUPABASE_URL_must_be_an_https_origin')
    if not key:
        raise SafeError('SUPABASE_SERVICE_ROLE_KEY_missing')
    endpoint = url + '/rest/v1/env_raw_worksheets?on_conflict=spreadsheet_id%2Csheet_id'
    statefile = root / 'upload-state.json'
    state = load_json(statefile) if statefile.exists() else {'format': 1, 'destination': parsed.netloc, 'uploaded': {}}
    if state.get('destination') != parsed.netloc:
        raise SafeError('upload_checkpoint_destination_mismatch')
    sent = skipped = batches = oversized_singletons = 0
    total = scope['eligible_sheets']
    print(f'upload scope eligible_files={scope["eligible_files"]} eligible_sheets={total} excluded_files={len(scope["excluded_files"])} excluded_sheets={scope["excluded_sheets"]}', flush=True)
    headers = {'apikey': key, 'Authorization': 'Bearer ' + key,
               'Content-Type': 'application/json',
               'Prefer': 'resolution=merge-duplicates,return=minimal'}
    batch = []
    batch_size = 2  # JSON array brackets.

    def flush_batch():
        nonlocal sent, batches, batch, batch_size, oversized_singletons
        if not batch:
            return True
        body = b'[' + b','.join(item['body'] for item in batch) + b']'
        assert len(body) == batch_size and len(batch) <= BATCH_MAX_ROWS
        oversized = len(body) >= BATCH_MAX_BYTES
        if oversized:
            # A single large worksheet cannot be split without changing the schema.
            assert len(batch) == 1
            oversized_singletons += 1
        status = 'unknown_error'
        for n in range(5):
            try:
                request = urllib.request.Request(endpoint, data=body, headers=headers, method='POST')
                with urllib.request.urlopen(request, timeout=180) as response:
                    code = response.status
                status = 'ok' if 200 <= code < 300 else f'http_{code}'
                if status == 'ok':
                    break
                if code not in (408, 425, 429, 500, 502, 503, 504):
                    break
            except urllib.error.HTTPError as exc:
                status = f'http_{exc.code}'  # Never print response bodies or headers.
                if exc.code not in (408, 425, 429, 500, 502, 503, 504):
                    break
            except (urllib.error.URLError, TimeoutError, OSError):
                status = 'network_error'
            if n < 4:
                time.sleep(min(45, 1.5 * (2 ** n)) + random.random())
        if status != 'ok':
            atomic_json(root / 'upload-failure.json', {
                'reason': status, 'at': now(), 'batch_rows': len(batch), 'batch_bytes': len(body),
                'members': [{'spreadsheet_id': item['spreadsheet_id'], 'sheet_id': item['sheet_id']} for item in batch],
            })
            print(f'upload stopped after error={status}; uploaded={sent} skipped={skipped} failed_batch_rows={len(batch)}', flush=True)
            return False
        # PostgREST upsert is idempotent by the table PK. Only checkpoint after 2xx.
        for item in batch:
            state['uploaded'][item['identity']] = item['digest']
        atomic_json(statefile, state)
        sent += len(batch)
        batches += 1
        print(f'upload progress processed={sent + skipped}/{total} uploaded={sent} skipped={skipped} batches={batches}', flush=True)
        batch = []
        batch_size = 2
        return True

    for source in m['files']:
        destination_category = upload_category(source)
        if destination_category is None:
            continue
        archive = load_archive(archive_path(root, source['id']))
        if archive['source']['id'] != source['id'] or archive['source']['category'] != source['category']:
            raise SafeError('manifest_archive_source_or_category_mismatch')
        for sheet in archive['response']['sheets']:
            payload = sheet_payload(archive, sheet, destination_category)
            identity = f'{payload["spreadsheet_id"]}:{payload["sheet_id"]}'
            digest = hashlib.sha256(json_bytes(payload)).hexdigest()
            if state['uploaded'].get(identity) == digest and not args.force_upload:
                skipped += 1
                continue
            payload['imported_at'] = now()
            row = json_bytes(payload)
            next_size = batch_size + len(row) + (1 if batch else 0)
            if batch and (len(batch) >= BATCH_MAX_ROWS or next_size >= BATCH_MAX_BYTES):
                if not flush_batch():
                    return 1
            batch_size += len(row) + (1 if batch else 0)
            batch.append({'body': row, 'identity': identity, 'digest': digest,
                          'spreadsheet_id': payload['spreadsheet_id'], 'sheet_id': payload['sheet_id']})
            if batch_size >= BATCH_MAX_BYTES:
                if not flush_batch():
                    return 1
    if not flush_batch():
        return 1
    failure_path = root / 'upload-failure.json'
    if failure_path.exists():
        failure_path.unlink()
    print(f'upload complete uploaded={sent} skipped={skipped} batches={batches} oversized_singletons={oversized_singletons} total={total}', flush=True)
    return 0


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=DEFAULT_DIR, help='private data directory (default: /home/ubuntu/env-history)')
    commands = parser.add_subparsers(dest='command', required=True)
    ex = commands.add_parser('extract', help='read Drive and Sheets only, save private archive; resumable')
    ex.add_argument('--workers', type=int, default=4, choices=range(1, 9), help='bounded Google API concurrency: 1–8')
    ex.add_argument('--refresh-inventory', action='store_true', help='re-list accessible files (cached archives remain unless --force)')
    ex.add_argument('--force', action='store_true', help='re-read all files; otherwise validated archives are resumed')
    commands.add_parser('report', help='validate private archive and show aggregate statistics; no network')
    up = commands.add_parser('upload', help='later upload to existing public.env_raw_worksheets')
    up.add_argument('--confirm-upload', action='store_true', help='required; only run after user authorizes database writes')
    up.add_argument('--force-upload', action='store_true', help='re-upsert even if the checkpoint matches')
    args = parser.parse_args()
    root = args.data_dir.expanduser().resolve()
    project = Path('/home/ubuntu/envirohub').resolve()
    if root == Path('/') or root == Path('/home/ubuntu') or root == project or project in root.parents:
        print('operation stopped: data_directory_must_be_private_and_outside_project', file=sys.stderr)
        return 1
    private_dir(root)
    try:
        if args.command == 'extract':
            return do_extract(args, root)
        if args.command == 'report':
            if not (root / 'manifest.json').is_file():
                raise SafeError('manifest_missing_run_extract_first')
            m = inventory(root)  # Existing manifest only; report never does network I/O.
            summary = inspect(root, m)
            print_summary(summary)
            return 1 if summary['failed_files'] or summary['not_attempted_files'] else 0
        return do_upload(args, root)
    except SafeError as exc:
        print(f'operation stopped: {exc}', file=sys.stderr)
        return 1
    except Exception as exc:
        print(f'operation stopped: {type(exc).__name__}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
