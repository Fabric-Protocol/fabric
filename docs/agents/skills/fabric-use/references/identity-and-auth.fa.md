# هویت و احراز هویت

## قاعدهٔ هویت

Nodeهای Fabric هویت‌های پایدار مشارکت‌کننده هستند. برای unitها، requestها، offerها، اقدام‌های billing، و reporting آینده از همان node بازاستفاده کنید.

برای هر کار یک node تازه bootstrap نکنید.

## schemeهای احراز هویت

- `Authorization: ApiKey <api_key>`
- `Authorization: Session <session_token>`

`ApiKey` scheme اصلی است.

`Session` یک token کوتاه‌عمر برای MCP clientهایی است که نمی‌توانند هدرها را پایدار تنظیم کنند. این token از طریق `fabric_login_session` ساخته می‌شود.

## ترتیب امن عملیات هویتی

1. بررسی کنید آیا `node.id` و API key از قبل ذخیره شده‌اند.
2. اگر بله، همان‌ها را بازاستفاده کنید.
3. اگر runtime بومیِ MCP است و تنظیم هدر ضعیف است، یک session token بسازید و از آن استفاده کنید.
4. اگر API key گم شده است، بازیابی کنید.
5. فقط وقتی هیچ هویت Fabricای وجود ندارد bootstrap کنید.

## راهنمای bootstrap

Bootstrap ایجاد یک‌بارهٔ هویت برای یک مشارکت‌کننده است.

فکت‌های فعلی Fabric:
- bootstrap، 500 اعتبار ثبت‌نامی می‌دهد
- اگر ممکن است `recovery_public_key` را هنگام bootstrap بفرستید
- اگر مسیر بازیابی پشتیبانِ انسان‌دوستانه می‌خواهید، ایمیل را هم verify کنید

بعد از bootstrap:
- `node.id` را ذخیره کنید
- `api_key.api_key` را ذخیره کنید
- اگر بازیابی تنظیم نشده است، آن را پیکربندی کنید
- قبل از اتکا به node، webhook یا polling را پیکربندی کنید

## MCP در برابر REST

MCP جریان‌کار اصلی عامل است.

در این موارد از REST استفاده کنید:
- به مسیر فقط-REST نیاز دارید
- webhook ingress را مدیریت می‌کنید
- از endpointهای setup/config شارژ خودکار Stripe استفاده می‌کنید

## قاعدهٔ بازیابی-اول روی خطای auth

اگر مسئله credentials گمشده یا مفقود است، هویت فعلی را بازیابی کنید و فقط بعد به هویت جایگزین فکر کنید.

`401 unauthorized` را دلیلی برای bootstrap کردن node جدید ندانید.
