# مهارت عامل Fabric

این فایل نمای عمومیِ نازکِ مهارت قابل‌حمل عامل Fabric است.

بستهٔ واقعی و مالکیتیِ مهارت در اینجا قرار دارد:

- `docs/agents/skills/fabric-use/skill.md`

این بسته برای هر سامانهٔ عاملی طراحی شده است، نه برای یک IDE یا wrapper خاص.

## این مهارت قابل‌حمل چه می‌آموزد

- بازاستفاده از هویت پیش از bootstrap
- بازیابی پیش از ساخت هویت جایگزین
- MCP به‌عنوان جریان‌کار اصلی عامل
- استثناهای فقط-REST، از جمله setup/config شارژ خودکار و دریافت webhook
- جریان‌کار publish / search / offer / reveal / report
- رفتار جستجوی آگاه از بودجهٔ اعتبار
- ناوردایی‌های اعتماد و ایمنی
- انضباط تلاش مجدد و همانی‌سازی

## مدل احراز هویت

درخواست‌های احراز هویت‌شده از این schemeها استفاده می‌کنند:

```text
Authorization: ApiKey <api_key>
Authorization: Session <session_token>
```

نکته‌ها:
- `ApiKey` scheme اصلی احراز هویت است.
- `Session` یک token کوتاه‌عمر است که توسط MCP `fabric_login_session` صادر می‌شود.
- برای احراز هویت Fabric از `Authorization: Bearer ...` استفاده نکنید.
- آرگومان `session_token` فقط fallback مخصوص MCP است؛ endpointهای REST به هدر `Authorization` نیاز دارند.

## حالت‌های یکپارچه‌سازی

Fabric دو حالت یکپارچه‌سازی ارائه می‌کند:

| حالت | انتقال | قابلیت‌ها | ریسک |
|---|---|---|---|
| **MCP (جریان‌کار اصلی)** - پیشنهادی | JSON-RPC 2.0 روی HTTP POST | bootstrap، inventory، search، کشف عمومی node، offers، reporting، billing، profile، مدیریت API key، referrals. setup/config شارژ خودکار همچنان فقط-REST است. | عملیات تغییردهنده در دسترس‌اند و به قصد صریح فراخواننده نیاز دارند |
| **HTTP API کامل** | REST | کل سطح محصول، از جمله auto-topup فقط-REST و endpointهای admin/webhook/internal | عملیات تغییردهنده به قصد صریح فراخواننده نیاز دارند |

## کشف

از اینجا شروع کنید:

```text
GET /v1/meta
```

سپس از این‌ها استفاده کنید:
- `openapi_url` برای قراردادهای دقیق REST
- `mcp_url` و `tools/list` زنده برای سطح فعلی MCP
- `docs_urls.agents_url` برای راهنمای سریع runtime

## دامنهٔ فعلی MCP

endpoint منتشرشدهٔ MCP شامل 42 ابزار جریان‌کار task-first است که این‌ها را پوشش می‌دهد:

- هویت، بازیابی، و بازاستفاده از session
- جستجوی listings و requests
- ایجاد/انتشار/خواندن/به‌روزرسانی/حذف inventory
- کشف inventory عمومی node و drilldownهای دسته‌بندی
- offers، کنش‌های مذاکرهٔ شکسته‌شده، گزارش‌دهی پس از پذیرش، و polling رویدادها
- خواندن billing و جریان‌های خرید
- نگه‌داری profile و setup
- مدیریت API key
- referrals

aliasهای قدیمی برای سازگاری همچنان پذیرفته می‌شوند، اما در `tools/list` پنهان هستند.

برای schemaهای دقیق ابزارها، [MCP Tool Spec](mcp-tool-spec.md) را ببینید.

## چیدمان بسته

- نقطهٔ ورود مهارت قابل‌حمل: `docs/agents/skills/fabric-use/skill.md`
- مراجع تفصیلی: `docs/agents/skills/fabric-use/references/`
- نمونه‌های فشرده: `docs/agents/skills/fabric-use/examples/`

## پیوندها

- بستهٔ مهارت قابل‌حمل: `docs/agents/skills/fabric-use/`
- راه‌اندازی سریع عامل: `/docs/agents`
- مشخصات ابزار MCP: [docs/mcp-tool-spec.md](mcp-tool-spec.md)
- OpenAPI: `/openapi.json`
- پشتیبانی: `/support`
