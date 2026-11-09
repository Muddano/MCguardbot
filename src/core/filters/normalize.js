const CYR = new Map([
  ['а', 'a'], ['б', 'b'], ['в', 'v'], ['г', 'g'], ['д', 'd'], ['е', 'e'], ['ё', 'e'],
  ['ж', 'zh'], ['з', 'z'], ['и', 'i'], ['й', 'y'], ['к', 'k'], ['л', 'l'], ['м', 'm'],
  ['н', 'n'], ['о', 'o'], ['п', 'p'], ['р', 'r'], ['с', 's'], ['т', 't'], ['у', 'u'],
  ['ф', 'f'], ['х', 'h'], ['ц', 'c'], ['ч', 'ch'], ['ш', 'sh'], ['щ', 'sch'],
  ['ъ', ''], ['ы', 'y'], ['ь', ''], ['э', 'e'], ['ю', 'yu'], ['я', 'ya'],
  // Uzbek / Kazakh / Kyrgyz extras
  ['ў', 'o'], ['ғ', 'g'], ['қ', 'k'], ['ҳ', 'h'], ['ҷ', 'j'], ['і', 'i'], ['ӣ', 'i'],
  ['ң', 'n'], ['ү', 'u'], ['ӯ', 'o'], ['һ', 'h'],
]);

const LEET = new Map([
  ['0', 'o'], ['1', 'i'], ['3', 'e'], ['4', 'a'], ['5', 's'], ['7', 't'],
  ['6', 'g'], ['9', 'g'], ['@', 'a'], ['$', 's'], ['!', 'i'], ['+', 't'], ['|', 'i'],
]);

// Latin look-alikes used in “clitan” style spam.
const DIACRITICS = new Map([
  ['à', 'a'], ['á', 'a'], ['â', 'a'], ['ã', 'a'], ['å', 'a'], ['æ', 'ae'],
  ['ç', 'c'], ['è', 'e'], ['é', 'e'], ['ê', 'e'], ['ë', 'e'], ['ì', 'i'], ['í', 'i'],
  ['î', 'i'], ['ï', 'i'], ['ñ', 'n'], ['ò', 'o'], ['ó', 'o'], ['ô', 'o'], ['õ', 'o'],
  ['ø', 'o'], ['ù', 'u'], ['ú', 'u'], ['û', 'u'], ['ý', 'y'], ['þ', 'th'], ['ß', 'ss'],
  ['đ', 'd'], ['ð', 'd'], ['ŋ', 'n'], ['ı', 'i'],
]);

const ZERO_WIDTH = /[​-‏‪-‮⁠⁡­﻿]/g;
const INWORD_NOISE = /['’`ʼʻ´,.:;\-_~"'*•·^=\/\\<>{}\[\]()#&%?]/g;

export function translit(text) {
  let out = '';
  for (const ch of text) out += CYR.get(ch) ?? ch;
  return out;
}

/** Lowercase + strip decoration so every wordlist can be written once, in plain a-z. */
export function normalizeCharLevel(text) {
  // Cyrillic first: NFKD would split й into и+breve and ё into е+diaeresis,
  // which then get stripped into the wrong latin letters.
  let s = translit(String(text ?? '').toLowerCase());
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(ZERO_WIDTH, '');
  let out = '';
  for (const ch of s) {
    if (LEET.has(ch)) out += LEET.get(ch);
    else if (DIACRITICS.has(ch)) out += DIACRITICS.get(ch);
    else out += ch;
  }
  // A doubled letter is the oldest trick in the book; cap runs at two.
  out = out.replace(/([a-z])\1{2,}/g, '$1$1');
  return out;
}

export function normalizeText(text) {
  return toWords(normalizeCharLevel(text));
}

/** Uzbek and Russian apostrophes glue a word together, so drop them first. */
function toWords(lowered) {
  const joined = lowered.replace(/[ʼʻ'`´ˈ]/g, '');
  return joined.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Candidate strings a rule is matched against:
 *  - the spaced text (word-boundary matching)
 *  - each token with intra-word punctuation removed (f.u.c.k, sh!t)
 *  - glued 2..4-token windows (fu ck, x u y)
 */
export function candidates(text) {
  const lowered = normalizeCharLevel(text);
  const spaced = toWords(lowered);
  const rawTokens = spaced.split(' ').filter(Boolean);

  const tokens = rawTokens
    .map((t) => t.replace(INWORD_NOISE, ''))
    .filter((t) => t.length > 1);

  const glued = [];
  // Letter-splitting evasion ("f u c k", "fu ck", "x u y") is the only reason
  // to join neighbouring words, so short-token windows only: joining "hue of"
  // into "hueof" would invent matches that are not there.
  for (let size = 2; size <= 4; size++) {
    for (let i = 0; i + size <= rawTokens.length; i++) {
      const window = rawTokens.slice(i, i + size);
      if (window.some((t) => t.length > 2)) continue;
      glued.push(window.map((t) => t.replace(INWORD_NOISE, '')).join(''));
    }
  }

  return { spaced, tokens: [...new Set(tokens)], glued: [...new Set(glued)].filter((g) => g.length > 2) };
}
