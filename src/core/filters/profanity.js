import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidates, normalizeText } from './normalize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();

function readList(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const file = path.join(here, 'wordlists', `${lang}.json`);
  let data = { lang, allow: [], stems: [] };
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const compiled = {
    lang: data.lang ?? lang,
    allow: new Set((data.allow ?? []).map((w) => normalizeText(w))),
    word: (data.stems ?? [])
      .filter((s) => s.mode === 'word')
      .map((s) => ({ ...s, re: new RegExp(s.p, 'i') })),
    core: (data.stems ?? [])
      .filter((s) => s.mode !== 'word')
      .map((s) => ({ ...s, re: new RegExp(`^(?:${s.p})$`, 'i') })),
  };
  cache.set(lang, compiled);
  return compiled;
}

export function availableLangs() {
  return fs
    .readdirSync(path.join(here, 'wordlists'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}

/**
 * Custom admin rules are raw regex sources. A broken pattern must never take
 * the whole pipeline down, so bad ones are reported instead of thrown.
 */
export function compileCustom(list = []) {
  const out = [];
  for (const item of list) {
    const src = typeof item === 'string' ? item : item?.pattern;
    if (!src) continue;
    try {
      out.push({
        re: new RegExp(src, 'i'),
        label: item?.label || src,
        action: item?.action || 'delete',
        severity: item?.severity ?? 2,
        note: item?.note ?? '',
        bad: false,
      });
    } catch {
      out.push({ re: null, label: src, action: item?.action ?? 'delete', bad: true });
    }
  }
  return out;
}

function scan(compiledList, cand, sink) {
  const isTokenLike = !cand.spaced;
  for (const c of compiledList) {
    if (isTokenLike && c.allow.has(cand.value)) continue;
    for (const s of c.word) {
      if (s.re.test(cand.value)) sink.push({ label: s.label, severity: s.severity, lang: c.lang, matched: cand.value });
    }
    if (!isTokenLike) continue;
    for (const s of c.core) {
      if (s.re.test(cand.value)) sink.push({ label: s.label, severity: s.severity, lang: c.lang, matched: cand.value });
    }
  }
}

/**
 * @returns {{hits: Array, worst: number, clean: boolean}}
 */
export function detect(text, opts = {}) {
  const langs = opts.langs?.length ? opts.langs : availableLangs();
  const minSeverity = opts.minSeverity ?? 1;
  const compiled = langs.map(readList);
  const { spaced, tokens, glued } = candidates(text);
  const hits = [];

  scan(compiled, { spaced: true, value: spaced }, hits);
  for (const t of tokens) scan(compiled, { value: t }, hits);
  for (const g of glued) scan(compiled, { value: g }, hits);

  for (const rule of opts.custom ?? []) {
    if (!rule.re) continue;
    // Admin-written patterns are matched against the raw text as well, so a
    // Cyrillic rule still works even though the engine normalizes to latin.
    if (rule.re.test(String(text ?? '')) || rule.re.test(spaced) || tokens.some((t) => rule.re.test(t))) {
      hits.push({ label: rule.label, severity: rule.severity, lang: 'custom', matched: '', action: rule.action, custom: true });
    }
  }

  const kept = hits.filter((h) => h.severity >= minSeverity);
  const uniq = new Map();
  for (const h of kept) {
    const key = `${h.lang}:${h.label}`;
    if (!uniq.has(key)) uniq.set(key, h);
  }
  const list = [...uniq.values()];
  return {
    hits: list,
    worst: list.reduce((m, h) => Math.max(m, h.severity), 0),
    clean: list.length === 0,
  };
}

/** Only used by the panel preview box so admins can test a phrase. */
export function debug(text, opts = {}) {
  const res = detect(text, opts);
  const { spaced, tokens, glued } = candidates(text);
  return { ...res, normalized: spaced, tokens, gluedWindows: glued.slice(0, 24) };
}
