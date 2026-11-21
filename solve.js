// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answers as the reference, bit for bit, for every input — but instead of
// walking the text one character at a time and building each field a character
// at a time, it jumps between delimiters with native scans:
//
//   - an unquoted field ends at the next of , \r \n, found with one RegExp
//     exec (a native scan that stops at the first of the four); the field is
//     one slice, no per-character loop. A lone CR inside it is the rare cold
//     path (stray_cr) and only then is the field re-scanned in segments.
//   - a quoted field jumps from quote to quote with indexOf('"'); the common
//     quoted field (no doubled quotes, no line breaks inside) is one slice.
//     Doubled quotes and line breaks inside quotes are handled segment by
//     segment, counting lines as the reference does.
//   - nothing is allocated per field except the field strings themselves and
//     the record arrays; the field readers report through module-level slots
//     instead of allocating a result object per field.
//
// Semantics (exactly the reference's, read from vendor/csv-reader/index.js):
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, each CRLF or lone CR inside it is read as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character and the text after it is read again
//     as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded with "" (short_row, with fields: its
//     count) or cut (long_row, with extra: the cut fields) to the first
//     record's width;
//   - each error is {code, line, row}, in the order met; line the 1-based
//     line its record starts on (every LF, CRLF and lone CR inside a quoted
//     field counted), row its record's index in rows (null for the header).

/** The next of , \r \n: one native scan, stopping at the first of the three. */
const DELIM = /[,\r\n]/g;

/** How a field ended: 0 comma, 1 line break, 2 end of text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** The field readers report here (no per-field result object). */
let fVal = '';
let fEnd = COMMA;
let fAdd = 0;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Sets fVal/fEnd/fAdd; `fAdd`
  // counts the characters kept (the initial value's characters not counted).
  function readUnquoted(value) {
    let acc = value;
    let added = 0;
    let start = pos;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        if (start < len) {
          const seg = text.slice(start, len);
          acc = acc === '' ? seg : acc + seg;
          added += len - start;
        }
        pos = len;
        fVal = acc;
        fEnd = END;
        fAdd = added;
        return;
      }
      const d = m.index;
      const c = text.charCodeAt(d);
      if (c === 44) {
        // ','
        if (d > start) {
          const seg = text.slice(start, d);
          acc = acc === '' ? seg : acc + seg;
          added += d - start;
        }
        pos = d + 1;
        fVal = acc;
        fEnd = COMMA;
        fAdd = added;
        return;
      }
      if (c === 10) {
        // '\n'
        if (d > start) {
          const seg = text.slice(start, d);
          acc = acc === '' ? seg : acc + seg;
          added += d - start;
        }
        pos = d + 1;
        line += 1;
        fVal = acc;
        fEnd = LINE_BREAK;
        fAdd = added;
        return;
      }
      // '\r'
      if (text.charCodeAt(d + 1) === 10) {
        if (d > start) {
          const seg = text.slice(start, d);
          acc = acc === '' ? seg : acc + seg;
          added += d - start;
        }
        pos = d + 2;
        line += 1;
        fVal = acc;
        fEnd = LINE_BREAK;
        fAdd = added;
        return;
      }
      // A lone CR: dropped (stray_cr); the field goes on.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (d > start) {
        const seg = text.slice(start, d);
        acc = acc === '' ? seg : acc + seg;
        added += d - start;
      }
      pos = d + 1;
      start = pos;
    }
  }

  // Appends the quoted segment [start, end) to `value`, each CRLF or lone CR
  // inside it read as one LF (and counted as a line), "" already handled by
  // the caller. The common segment holds no line break at all: one slice.
  function appendSegment(value, start, end) {
    if (end === start) return value;
    // Slice first: the slice is needed anyway, and checking the short slice
    // for a line break is bounded, while indexOf on the whole text is not
    // (in an LF file the next CR can sit thousands of characters away).
    const seg = text.slice(start, end);
    if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) {
      return value === '' ? seg : value + seg;
    }
    // A line break sits inside: walk it (rare: only multi-line quoted fields).
    let out = value;
    let s = start;
    let i = s;
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c === 13) {
        if (i > s) {
          const seg = text.slice(s, i);
          out = out === '' ? seg : out + seg;
        }
        out += '\n';
        line += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        s = i;
      } else if (c === 10) {
        if (i > s) {
          const seg = text.slice(s, i);
          out = out === '' ? seg : out + seg;
        }
        out += '\n';
        line += 1;
        i += 1;
        s = i;
      } else {
        i += 1;
      }
    }
    if (end > s) {
      const seg = text.slice(s, end);
      out = out === '' ? seg : out + seg;
    }
    return out;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fVal/fEnd/fAdd.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = '';
    let segStart = pos;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        value = appendSegment(value, segStart, q) + '"';
        pos = q + 2;
        segStart = q + 2;
        continue;
      }
      value = appendSegment(value, segStart, q);
      pos = q + 1;
      break;
    }
    if (pos >= len) {
      fVal = value;
      fEnd = END;
      fAdd = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fVal = value;
      fEnd = COMMA;
      fAdd = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fVal = value;
      fEnd = LINE_BREAK;
      fAdd = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fVal = value;
      fEnd = LINE_BREAK;
      fAdd = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    readUnquoted(value);
    if (fAdd > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fVal);
    } while (fEnd === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
