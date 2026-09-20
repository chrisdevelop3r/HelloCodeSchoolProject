/**
 * The smallest CSV reader and writer that is actually correct.
 *
 * Handoffs with a billing team happen in spreadsheets, and a naive `split(',')`
 * corrupts exactly the rows that matter here — the charge model strings contain
 * commas. So: quoted fields, embedded commas, newlines and quotes, and CRLF.
 */

const NEEDS_QUOTING = /[",\r\n]/;

export function toCsv(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map((row) => row.map((f) => (NEEDS_QUOTING.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(','))
    .join('\n');
  return `${body}\n`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // A row of one empty quoted field ("") has no characters to remember it by,
  // so it is tracked explicitly.
  let rowHasContent = false;

  const endField = (): void => {
    row.push(field);
    field = '';
    rowHasContent = true;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
    rowHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch !== '"') {
        field += ch;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      rowHasContent = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n') {
      endRow();
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (inQuotes) throw new Error('The CSV ends inside a quoted field.');
  if (field !== '' || row.length > 0 || rowHasContent) endRow();
  return rows;
}

/**
 * Rows keyed by header name rather than position, so reordering or adding a
 * column in a spreadsheet cannot silently shift every value one to the left.
 */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text).filter((r) => r.some((f) => f.trim() !== ''));
  const header = rows.shift();
  if (!header) return [];
  const names = header.map((h) => h.trim());
  return rows.map((row) => {
    const record: Record<string, string> = {};
    names.forEach((name, i) => {
      record[name] = (row[i] ?? '').trim();
    });
    return record;
  });
}
