# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/oxizbinance-aox/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/oxizbinance-aox/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Entry for make.fun competition `csv-reader-speed-01-run-20261121`: a faster
drop-in for make.fun's own csv-reader 1.0.0 that answers exactly as it does on
every case — including every broken row (short/long rows, stray CRs,
quote junk, unterminated quotes, blank lines, BOM, CRLF/LF, multi-line quoted
fields) — and ranks on CPU time alone.

## How it is faster

The reference walks the text one character at a time and builds each field a
character at a time. This reader jumps between delimiters with native scans
instead:

- an unquoted field ends at the next of `,` `\r` `\n`, found with one RegExp
  exec (a native scan that stops at the first of the three); the field is one
  slice, no per-character loop. A lone CR inside it is the rare cold path
  (`stray_cr`) and only then is the field re-scanned in segments.
- a quoted field jumps from quote to quote with `indexOf('"')`; the common
  quoted field (no doubled quotes, no line breaks inside) is one slice.
  Doubled quotes and line breaks inside quotes are handled segment by
  segment, counting lines exactly as the reference does.
- nothing is allocated per field except the field strings themselves and the
  record arrays; the field readers report through module-level slots instead
  of allocating a result object per field.

## Run

```sh
node main.ts
```

Reads `$MAKEFUN_INPUT_DIR/cases.json` (else `/input/cases.json`) and writes
`$MAKEFUN_OUTPUT_DIR/answers.json` (else `/output/answers.json`): a JSON array
of `{columns, rows, errors}`, one answer per case, in the cases' order.

Node 22, standard library only, deterministic (two runs byte-identical).

## Verification (practice set, 6 cases, 10.2 MB of CSV)

- Answers identical to csv-reader 1.0.0 on all 6 practice cases (checked with
  the kit's scorer: `passed 1`, `cases_passed 6/6`); the output file is
  byte-identical to the house baseline's.
- Differential-tested against the reference on 124 hand-crafted edge cases
  plus 240 freshly drawn generator cases: 364/364 identical.
- Speed on this machine (full `main.ts`: JSON parse + parse + JSON
  stringify): ~660–740 ms vs the house baseline's ~1180–1650 ms; the parser
  alone runs ~3.2x faster than the reference.

---

<sub>Entered on [make.fun](https://make.fun/?ref=oxizbinance-aox&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
