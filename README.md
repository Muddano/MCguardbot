# MC Guard UzBot — @MCguarduzbot

Telegram guruhini boshqaruvchi bot + veb-boshqaruv paneli (GuardBot / @qoravulibot kabi).
Bot + панель + веб-панель управления. Bot + admin web panel. **Hammasi bepul rejaga mos.**

---

## 1. Nima qiladi / Features

| Funksiya | Holat |
|---|---|
| So'kinish va haqoratni aniqlash (uz / ru / en; matn, caption, o'yin va poll savoli) | ✅ |
| Bitta qoida buzish → xabar o'chiriladi + 1 ogohlantirish | ✅ |
| 3 ta ogohlantirish → avtomatik ban (limit panelden o'zgartiriladi) | ✅ |
| Havola/faqat link filtri + oq ro'yxat (whitelist) | ✅ |
| Reklama: t.me/invit havolalari va boshqa kanal @nomlari | ✅ |
| Kanalga majburiy obuna (obuna bo'lmasa → pinhol; obuna bo'lgach → o'zi ochiladi) | ✅ |
| Captcha / su'roq ("5 + 3 = ?") — klaviatura orqali javob | ✅ |
| Antiflood (tez-tez yozsa — pinhol), raid rejim (bir daqiqada ko'p kirsa — cheklash) | ✅ |
| Soxta administrator / usernamesiz / bot akkauntlar | ✅ |
| Firibgar (skam) havolalar — "bepul rank/hold" tipidagi saytlar | ✅ |
| Foydalanuvchi shikoyati (`/report` yoki `!report`) — 3 marta topsa chora | ✅ |
| Buyruqlar **`/` va `!`** ikkala bilan yoziladi: `warn mute kick ban unban unmute lock unlock purge filter rules lang settings` | ✅ |
| Qoida muharriri: maxsus regex so'zlar + tanlangan chora | ✅ |
| Log kanali (har bir chora kanalga yoziladi) | ✅ |
| Veb-panel: 7 bo'lim, 70+ sozlamalar, azolar, ogohlantirishlar, log, tekshiruv, eksport/import | ✅ |
| 3 til: o'zbek / rus / ingliz (bot va sayt) | ✅ |

---

## 2. MAJBURIY: BotFather (2 daqiqa)

Agar shu 2-qadam bo'lmasa — **bot hech qanday xabarni ko'rmaydi, filtr ishlamaydi.**

1. Telegramda **@BotFather** ni oching.
2. `/mybots` → `@MCguarduzbot` → **API Token**.
3. **Eski tokenni bekor qiling**: `/revoke` → `@MCguarduzbot` → **Revoke current token** → yangi token chiqadi.
   *(Eski token suhbatga yozilgan edi — u endi "ochiq" hisoblanadi, shuning uchun almashtirish shart.)*
4. Yangi tokenni **faqat Render Environment Variables** ga yozing. Hech qaysi faylga, `.env` ga yoki chatga yozmang.
5. `/mybots` → `@MCguarduzbot` → **Bot Settings** → **Group Privacy** → **Disable**.
   BotFather: `Current privacy settings: Disabled` deb javob berishi kerak.
   *(Bu `can_read_all_group_messages: false` holatini `true` qiladi — barcha filtrlar shunga bog'liq.)*
6. (Panel uchun, ixtiyoriy lekin tavsiya) `/mybots` → `@MCguarduzbot` → **Bot Settings** → **Domain** → saytingiz manzilini yozing, masalan `mcguarduzbot.onrender.com`. Shundan keyin paneldagi **"Telegram orqali kirish"** tugmasi ishlaydi.
7. `/setuserpic`, `/setdescription`, `/setabout` — ixtiyoriy.

## 3. Guruhga qo'shish

1. O'z guruhingizni oching → **Guruh sozlamalari** → **Administratorlar** → **Add Admin**.
2. `@MCguarduzbot` ni qidiring va tanlang.
3. Ruxsatlarni yoqing: **Delete messages**, **Ban users** (Restrict members), **Manage group**. Bot "admin" bo'lishi kerak — oddiy a'zo bo'lsa hech narsa qila olmaydi.
4. Guruhda `!settings` yozing — bot panel havolasini qaytaradi. Chorani faqat guruh adminlari va bot egasi (`ADMIN_IDS`) qila oladi.
5. Guruhda birinchi marta yozilgan xabar botga ko'rinadimi tekshiring: sinov uchun haqorat yozib ko'ring → xabar o'chib, `⚠ 1/3 ogohlantirish` chiqishi kerak.

## 4. Kanalga majburiy obuna

1. Kanalingizni oching → **Administrators** → `@MCguarduzbot` ni admin qiling (kanalda ham xabar yubora olishi kerak).
2. Kanalning `-100...` bilan boshlanadigan ID sini oling — eng oson yo'l: paneldagi **Sozlamalar → Majburiy obuna** bo'limiga kanal `@nomi` ni yozish (bot o'zi ID sini topadi), yoki kanalga bir xabar yuborib, bot logidan ID sini ko'rish.
3. Panel: **Sozlamalar → Obuna → yoqish (on)** va kanal ro'yxatini to'ldiring → **Saqlash**.
4. Bot @qoravulibot kabi ishlaydi: obuna bo'lmagan odamga "Obuna bo'lish" tugmasi chiqadi, obuna bo'lgach **o'zi pinholni ochadi**.

## 5. Kompyuterda ishga tushirish (test uchun)

Node.js **22.5+** kerak. PowerShell da:

```powershell
cd C:\Users\service_dz\Desktop\my\MCguarduzbot
npm install
$env:BOT_TOKEN="yangi_token_bu_yerga"
$env:ADMIN_IDS="7667103099"
$env:PANEL_SECRET="icdamizdan_bir_kod"
$env:WEBHOOK_SECRET="boshqa_bir_kod"
$env:PUBLIC_URL=""
npm start
```

`PUBLIC_URL` bo'sh bo'lsa bot **long-polling** da ishlaydi (internetga ulanib test qilish mumkin, Render shart emas). Panel: `http://localhost:10000/login`, `PANEL_SECRET` kod bilan kirasiz.

Sinovlar (token sizni ishlatmaydi, hammasi fake Telegram bilan):

```powershell
npm test
```

## 6. Render.com — bepul joylash (Deploy)

Render bepul Web Service bepul. GitHub kerak bo'ladi (bepul).

**A) GitHub ga yuklash**
1. github.com → **Sign up** (bo'lmasa) → **+** → **New repository** → name: `mcguarduzbot` → **Private** emas, **Public** → **Create repository**.
2. Repo sahifasida **uploading an existing file** linkini bosing → `C:\Users\service_dz\Desktop\my\MCguarduzbot` ichidagi **fayllarni** tortib tashlang (`node_modules` va `data` papkalarini tashlamang!).
3. **Commit changes**.

**B) Render**
1. render.com → **Sign Up with GitHub** → GitHub ruxsat bering.
2. Dashboards → **New +** → **Web Service**.
3. Ro'yxatdan `mcguarduzbot` ni toping → **Create**.
4. Sozlamalar:
   - **Runtime**: Node
   - **Build command**: `npm ci --omit=dev`
   - **Start command**: `node src/index.js`
   - **Instance type**: **Free**
   - **Health check path**: `/healthz`
5. **Advanced** → **Environment Variables** — quyidagilarni qo'shing:

| KEY | VALUE |
|---|---|
| `BOT_TOKEN` | BotFather yangi tokeni |
| `ADMIN_IDS` | `7667103099` (vergula bilan bir nechta admin ID) |
| `PUBLIC_URL` | `https://<service-nomi>.onrender.com` |
| `WEBHOOK_SECRET` | ixtiyoriy uzun tasodifiy kod |
| `PANEL_SECRET` | paneldagi parolingiz |
| `DATABASE_URL` | *(bo'sh qoldiring — 7-qadamda qo'shasiz)* |

6. **Create Web Service** → build tugagach logda `webhook set: https://...` chiqishi kerak.
7. Saytni oching: `https://<service>.onrender.com/login` → `PANEL_SECRET` kod → panel.

## 6b. Render'da ko'p uchraydigan 3 narsa

| Logda ko'rinadi | Ma'nosi | Yechim |
|---|---|---|
| `Node vXX has no built-in sqlite` | Render eski Node tanlagan | **Environment** → `NODE_VERSION` = `22.20.0` → Save Changes, **yoki** 7-bobdagi Postgres `DATABASE_URL` ni to'ldiring |
| `setWebhook failed` | `PUBLIC_URL` xato/bo'sh | `PUBLIC_URL` ga Render bergan `https://…onrender.com` manzilini kiriting |
| Webhookda `403` va bot hech narsa qilmaydi | Bot xabarlarni ko'rmayapti | BotFather → **Group Privacy → Disable** (2-bob, 5-qadam) |

## 7. Ma'lumotlar saqlanishi uchun bepul Postgres (tavsiya)
Render bepul rejada **disk o'chib turadi** (har bir redeploy / restart da `data/mcguard.sqlite` yo'qoladi). Shuning uchun:

1. **Neon** (neon.tech) → **Sign up with GitHub** → **New project** → name `mcguard` → region **Singapore** → **Create**.
2. **Connection string** ni copy qiling (`postgres://...?sslmode=require`).
3. Render → `mcguarduzbot` → **Environment** → `DATABASE_URL` ga shu string ni yozing → **Save Changes** (qayta deploy bo'ladi).
4. Bot o'zi 12 ta jadvalni yaratadi — boshqa hech narsa qilish shart emas.

> Render ning o'z bepul Postgresi ham bor, lekin **30 kundan keyin o'chadi**. Neon bepul rejasi 0.5 GB bilan uzoqroq yashaydi. Supabase ham bepul, lekin 1 hafta jimjit bo'lsa bazani **to'xtatib qo'yadi**.

## 8. Panel (sayt) bo'limlari

- **Sozlamalar** — 7 bo'lim: Asosiy, So'kinish/filtr, Chora (warn limit), Antiflood/Raid, Obuna/Captcha, Azolar/Qoidalar, Log/Mediya. Har bir tugma botdagi bilan bir xil ishlaydi. **Saqlash** — Ctrl+S.
- **Azolar** — har azoga ⚠ 🔇 🚪 🔨 ✔ 🔒 🔓 tugmalari + qator: ID / amal / sabab / muddat.
- **Ogohlantirishlar** — kimda qancha warn, qaysi chora qilingan, kim `!lock` langan.
- **Maxsus so'zlar** — o'zingiz regex/so'z qo'shib, chorani tanlaysiz (delete/warn/mute/kick/ban).
- **Log** — oxirgi amallar (vaqt, amal, ID, sabab).
- **Tekshirish** — matn yozing, bot uni qanday ko'rishini ko'rsatadi (qaysi so'z, qaysi qoida, qanday chora).
- **Eksport / Import** — butun sozlamani JSON faylga saqlash yoki boshqa guruhga yuklash.

## 9. Halol cheklar (yashirmayman)

1. **Uzbekcha so'kinish ro'yxati kichik boshlangan edi, hozir 30+ asosiy so'z/ildiz.** Bitta ro'yxat hamma so'kinishni qamrab bera olmaydi — shuning uchun **Maxsus so'zlar** bo'limi bor: o'zingiz bitta so'zni qo'shib, chorani tanlaysiz. Ro'yxat `src/core/filters/wordlists/uz.json` da (ochiq matn, o'zingiz ham to'ldirishingiz mumkin).
2. **Render free 15 daqiqadan keyin uxlaysa**, keyingi xabar kelganda bot 30–60 soniya sekin javob beradi (Telegram webhook xabarlarni qatorlab saqlaydi — yo'qolmaydi, kechikadi).
3. Bepul rejada **512 MB RAM** va bir instansiya. Katta guruhlar (10k+ a'zo, faol chat) uchun yetarli, lekin eng og'ir yukda pinhol/raid hisobi vaqtincha chalkashishi mumkin.
4. **Token xavfsizligi**: eski token suhbatda ko'rsatilgan — `/revoke` qilib yangisini oling. Tokenni faylga yozmang.
5. Bot faqat **admin qo'shilgan** guruhda ishlaydi va hech qachon shaxsiy xabarlarni saqlab qo'ymaydi (DB da faqat ID, warn, log va sozlama).

---

## 10. На русском (кратко)

**Обязательно:** BotFather → `/mybots` → **Revoke current token** (старый засвечен) → новый токен только в Render. Затем **Bot Settings → Group Privacy → Disable** — без этого бот не видит сообщения и фильтры не работают.
Добавьте бота **админом** группы с правами *Delete messages* и *Ban users*.
Запуск локально: `npm install`, затем переменные окружения `BOT_TOKEN`, `ADMIN_IDS`, `PANEL_SECRET`, `WEBHOOK_SECRET` и `npm start` (без `PUBLIC_URL` — long polling).
Deploy: GitHub → Render **Web Service** (Free), Build `npm ci --omit=dev`, Start `node src/index.js`, Health check `/healthz`, env-переменные как в таблице выше.
Для сохранения настроек после рестартов — бесплатная Postgres (Neon) в `DATABASE_URL`.
Панель: 7 разделов, 70+ настроек, кнопки действий над участниками, свои regex-слова, проверка текста, экспорт/импорт. Ограничение: список узбекских матов покрывает основные слова, недостающие добавляются в разделе «Maxsus so'zlar».

## 11. In English (brief)

**Required:** BotFather → revoke the leaked token, then **Group Privacy → Disable** (otherwise the bot cannot read group messages and no filter runs). Add the bot as an **admin** with delete + ban rights.
Run locally: `npm install`, set `BOT_TOKEN` / `ADMIN_IDS` / `PANEL_SECRET` / `WEBHOOK_SECRET`, `npm start`. Deploy free on Render (Node, `npm ci --omit=dev`, `node src/index.js`, health check `/healthz`); add a free Neon Postgres in `DATABASE_URL` so settings survive restarts.
The web panel mirrors every bot feature: 7 sections / 70+ toggles, member action buttons, warns, custom regex words with per-word action, audit log, live rule tester, export/import. Known limit: the Uzbek profanity list covers the common roots only — extend it in **Maxsus so'zlar** or edit `src/core/filters/wordlists/uz.json`.
