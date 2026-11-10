import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, debug, compileCustom } from '../src/core/filters/profanity.js';
import { normalizeCharLevel, normalizeText, candidates } from '../src/core/filters/normalize.js';
import {
  extractDomains, hasLink, extractInviteLinks, extractMentions,
  countEmojis, capsRatio, scamScore, dupKey,
} from '../src/core/filters/content.js';

const FLAGGED = [
  'fuck you man', 'FUCK', 'f*ck this', 'fu ck', 'f u c k', 'what the fuck',
  'motherfucker', 'you piece of shit', 'sh1t happens', 'bitch please',
  'bullshit', 'asshole', 'cunt', 'wtf bro', 'stfu', 'jackoff', 'handjob',
  'ты гандон', 'хуй', 'нахуй', 'похуй', 'пиздец', 'пизда', 'блядь', 'бля',
  'ёбана', 'заебал', 'наебать', 'мудак', 'пидорас', 'говно', 'шлюха',
  'урод', 'сволочь', 'козел', 'залупа', 'ублюдок', 'мерзавец', 'придурок',
  'IDIOOOT', 'suka', 'suka blyat', 'blya', 'pizdec', 'zaebal', 'govno',
  'xui', 'x u y', "xo'roy", "qonxuy", "modak", "taqir", 'hashrag', "la'nat",
  'ОЛО XUYA PISUN', 'да ты блядишь', 'bljad', 'blyat', 'mraZ',
  'suxur', 'suhur', 'sxur', 'SUXUR SIZ', 'ya suxur', 'qontayir', 'mardixur', 'mardixon',
  "alo'psat", 'allofsat', 'ushshang', 'hurug', 'yalmiz', 'ahmoq', 'qoraboz', "xo'rop",
  'sikaman', "bo'x", 'seni onang', 'seni tanang', 'seni ichkiring', 'seni kasalling',
  'yetimsiz', 'seni eshaging',
];

const CLEAN = [
  'salom qanday topsiz', 'do`st men bilan o`ynaysanmi', 'serverga qoshiling IP 185.233.44.2:25565',
  'mod yuklab olish uchun linkni yuboring', 'rahmat katta rahmat', 'kechirasiz xato ketdi',
  'yaxshi o`yin bo`ldi', 'men hozir kira olmayman', 'kimda version 1.21 bormi',
  'hello guys, how are you doing today', 'the guy with the red hat is my friend',
  'focus on the game please', 'class is starting now', 'pass me the items',
  'that piston mod is great', 'rebirth server updated', 'blink and you miss it',
  'a nice hue of green', 'the hero of the story', 'hermitcraft season 12',
  'dermatology is a medical field', 'sit down and relax', 'I will assess the risk',
  'privet kak dela', 'ya ne ponimayu chto proishodit', 'spasibo bolshoe',
  'doma internt otklyuchili', 'gde naiti almaz v mere', 'davai igraem vmeste',
  'sukunat va tinchlik', 'bu modni kim yaratgan', 'meny rangga bo`yash kerak',
  'hey guys is anybody streaming tonight', 'do you want to join my world',
  'blizzard of items dropped', 'sebum control shampoo', 'gondola in the mall',
  'hashrat bilan ishlaymiz', 'mening taqvimim to`lgan', 'laptop qayta ishga tushdi',
  'moda kiyim sotuvda', 'yigitlar kechqirin keldi', 'bu qanday qilish kerak',
  'taqid qilib chiqdim', 'juma namoziga boraman', 'jigar non yedim',
  'qani endi boshlaymiz', 'daraxt kesish kerak', 'svinka va kubiklar',
  'privet, kak tyi?', 'yaayu, vse normalno', 'spokoynoy nochi',
  'glavnaya kripa eta almazi', 'nu chto poehali', 'davay v main',
  'guys the nether portal is broken', 'do not hit me please', 'ill craft a shield',
  'anyone selling emeralds?', 'lag is killing me', 'my skins got bugged',
  'tuman markazi yo\'li qachon tuzatiladi', 'shukr, hammasi joyida', 'ichki ishlar bo\'limi',
  'tana harorati 36.6', 'sikka yig\'ish boshladik', 'ushlab oling, tushib ketdi',
  'it bizning uyda yuradi', 'mol fermasi qayerda', 'eshak bilan yuk olib bordik',
  'boshqa serverga o\'ting', 'mashq qilish kerak', 'boqimaja bo\'ldi', 'alhamdulillah',
  'bo\'ron yo\'ldan qoldik', 'yolg\'iz o\'ynayman', 'kalta jins kiypdim', 'sifat yaxshi emas',
  'siklopediyadan o\'qiding', 'moda ko\'rgazuviga bordingizmi', 'taqinchilikni yoqtirmayman',
  'gany yo\'qmi kimsa, skyblock play qilamiz', 'serverda lag bor, ping 200',
];

test('normalizer maps leet, cyrillic and repeats', () => {
  assert.equal(normalizeCharLevel('F4CK'), 'fack');
  assert.equal(normalizeCharLevel('ХУЙ'), 'huy');
  assert.equal(normalizeCharLevel('блядь'), 'blyad');
  assert.equal(normalizeCharLevel('fuuuuck'), 'fuuck');
  assert.equal(normalizeText("xo'roy"), 'xoroy');
  assert.deepEqual(candidates('fu  ck').tokens.sort(), ['ck', 'fu']);
  assert.ok(candidates('f u c k').glued.includes('fuck'));
});

test('profanity catches all three languages and evasions', () => {
  const missed = FLAGGED.filter((line) => detect(line).clean);
  assert.deepEqual(missed, [], `missed:\n${missed.join('\n')}`);
});

test('profanity does not fire on ordinary chat', () => {
  const falsePos = CLEAN.filter((line) => !detect(line).clean)
    .map((line) => `${line} -> ${detect(line).hits.map((h) => h.label).join(',')}`);
  assert.deepEqual(falsePos, [], `false positives:\n${falsePos.join('\n')}`);
});

test('severity filter is respected', () => {
  assert.equal(detect('бля', { minSeverity: 3 }).clean, true);
  assert.equal(detect('бля', { minSeverity: 1 }).clean, false);
});

test('language restriction narrows the lists', () => {
  assert.equal(detect('fuck you', { langs: ['ru'] }).clean, true);
  assert.equal(detect('fuck you', { langs: ['en'] }).clean, false);
});

test('custom patterns add admin rules', () => {
  const rules = compileCustom([{ pattern: 'кап(?:уш|уст)', action: 'warn', label: 'noke' }]);
  assert.equal(detect('йўқ капуст', { custom: rules }).clean, false);
});

test('broken custom pattern is skipped not fatal', () => {
  const rules = compileCustom([{ pattern: '([unclosed', action: 'delete' }]);
  assert.equal(rules[0].bad, true);
  assert.equal(detect('salom', { custom: rules }).clean, true);
});

test('debug exposes what the engine sees', () => {
  const d = debug('X U Y');
  assert.ok(d.hits.length > 0);
  assert.ok(d.gluedWindows.length > 0);
});

test('links and invites are extracted', () => {
  assert.deepEqual(extractDomains('join http://Cool-Shop.uz/item and t.me/foo'), ['cool-shop.uz', 't.me']);
  assert.equal(hasLink('no links here 12345'), false);
  assert.deepEqual(extractInviteLinks('keling t.me/+AbC123'), ['AbC123']);
});

test('mentions emoji and caps counters', () => {
  assert.deepEqual(extractMentions('ada @somechannel va @other'), ['somechannel', 'other']);
  assert.equal(countEmojis('😀😁 ok'), 2);
  assert.ok(capsRatio('AAAAAAAAAA') > 0.9);
  assert.equal(capsRatio('AAA'), 0);
});

test('scam detector flags giveaway links and impersonation', () => {
  const a = scamScore('get free nitro at discorcl-gift.ru', { domains: extractDomains('discorcl-gift.ru') });
  assert.ok(a.score >= 2, JSON.stringify(a));
  const b = scamScore('vote for my team', { domains: [] });
  assert.equal(b.score, 0);
  const c = scamScore('admin site mcguarduzbot.com', {
    domains: ['rncguarduzbot.com'],
    adminUsernames: ['MCguarduzbot'],
  });
  assert.ok(c.reasons.some((r) => r.startsWith('impersonation')), JSON.stringify(c));
});

test('duplicate spam key ignores punctuation and case', () => {
  assert.equal(dupKey('BUY  ITEM!!!  here'), dupKey('buy item here'));
});

test('catches real Uzbek slurs and insults', () => {
  const realUzbek = [
    'skay', 'sikay', 'sikey', 'sikaman', 'skaman', 'sik', 'siktir', 'sktir', 'sikish', 'sikvotti', 'sekay', 'skyapti',
    'jalab', 'jalap', 'jallab', 'jallap', 'jalablar', 'jalabsan',
    'qotoq', 'qo\'toq', 'qotog', 'qotogim', 'qotoqsan', 'kotoq',
    'kot', 'ko\'t', 'koting', 'kotingga', 'kotsan', 'kotvachcha',
    'dalbayob', 'dalbayop', 'dolboyob', 'dolbaeb',
    'gandon', 'gandonsan', 'gondon',
    'pidar', 'pidaraz', 'pedik',
    'haromi', 'xaromi', 'haromzoda',
    'chort', 'cho\'rt', 'chortsan',
    'amingga', 'amiga', 'amini', 'amchik', 'amyaloq',
    'onangni', 'onangni skay', 'onangni amini', 'otangni sikay',
    'itvachcha', 'it emgan', 'qanjiq', 'hezalak', 'xunasa',
    'suka', 'blyad', 'blyat', 'naxuy', 'poxuy', 'zaebal', 'pizdec', 'xuy',
    'yebsan', 'yeptur', 'ahmoq', 'tupoy', 'lox'
  ];
  for (const word of realUzbek) {
    const res = detect(word, { langs: ['uz'] });
    assert.equal(res.clean, false, `Expected '${word}' to be detected as profanity`);
  }
});
