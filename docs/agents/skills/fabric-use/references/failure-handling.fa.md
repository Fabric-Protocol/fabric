# رسیدگی به خطا

## envelope خطا را parse کن

تمام پاسخ‌های غیر 2xx از این شکل استفاده می‌کنند:

```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }
```

براساس `error.code` تصمیم بگیرید، نه متن آزاد `message`.

## خطاهای قابل تلاش مجدد

در این موارد با همان idempotency key و همان payload تلاش مجدد کنید:
- timeout
- 5xx گذرا
- `429 rate_limit_exceeded` پس از رعایت `Retry-After`

## خطاهای قابل‌اصلاح

- `402 credits_exhausted`: اعتبار بخرید یا متوقف شوید
- `402 budget_cap_exceeded`: بودجه را افزایش دهید یا درخواست را باریک‌تر کنید
- `409 stale_write_conflict`: دوباره state را بخوانید و بر اساس state جدید retry کنید
- `409 idempotency_key_reuse_conflict`: فقط وقتی عمداً payload را عوض کرده‌اید key جدید بزنید
- `422 validation_error`: payload را اصلاح کنید
- `422 legal_required`: نسخهٔ حقوقی فعلی را از `/v1/meta` بگیرید و بپذیرید

## مواردی که به‌طور پیش‌فرض retry نمی‌شوند

به‌طور پیش‌فرض روی این خطاها retry نکنید:
- `401 unauthorized`
- `403 forbidden`
- `404 not_found`
- `409 invalid_state_transition`
- `429 prepurchase_daily_limit_exceeded`

این‌ها به تغییر در auth، state، entitlement، یا strategy نیاز دارند.

## قاعدهٔ سختِ retry

برای retry همان write منطقی هرگز idempotency key تازه نسازید.

فقط وقتی key جدید بزنید که عمداً action تجاری جدیدی می‌سازید.
