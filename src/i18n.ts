export type AppLocale = 'en' | 'zh-Hans' | 'fa';

type TranslatedLocale = Exclude<AppLocale, 'en'>;

const SIMPLIFIED_CHINESE_TOKENS = new Set(['zh', 'zh-cn', 'zh-hans']);
const FARSI_TOKENS = new Set(['fa', 'fa-ir']);

type ErrorTranslationEntry = {
  default?: string;
  messages?: Record<string, string>;
};

const ERROR_TRANSLATIONS_ZH_HANS: Record<string, ErrorTranslationEntry> = {
  unauthorized: {
    default: '未授权',
    messages: {
      'Invalid admin key': '管理员密钥无效',
      'Missing or invalid API key': '缺少 API 密钥或 API 密钥无效',
      'Invalid API key': 'API 密钥无效',
      'Missing or invalid session token': '缺少会话令牌或会话令牌无效',
      'Invalid session token': '会话令牌无效',
      'Session token expired or revoked': '会话令牌已过期或已撤销',
      'Missing or invalid authentication token': '缺少认证令牌或认证令牌无效',
    },
  },
  forbidden: {
    default: '已禁止',
    messages: {
      'API key is revoked': 'API 密钥已撤销',
      'Node is suspended': '节点已被暂停',
      'Not allowed': '不允许',
      'Cannot create checkout session for another node': '不能为其他节点创建结账会话',
      'Cannot create Credit Pack checkout session for another node': '不能为其他节点创建点数包结账会话',
    },
  },
  validation_error: {
    default: '请求无效',
    messages: {
      'Invalid payload': '请求体无效',
      'Invalid filters': '筛选条件无效',
      'Invalid search request': '搜索请求无效',
      'Invalid search cursor': '搜索游标无效',
      'Invalid bootstrap request': '引导注册请求无效',
      'Invalid profile update': '资料更新无效',
      'Invalid email verification request': '邮箱验证请求无效',
      'Invalid verification code': '验证码无效',
      'Verification failed': '验证失败',
      'Unable to start recovery': '无法启动恢复流程',
      'Invalid recovery completion request': '恢复完成请求无效',
      'Recovery challenge expired': '恢复挑战已过期',
      'Recovery validation failed': '恢复验证失败',
      'Publish requirements not met': '未满足发布要求',
      'Redirect URL not allowed': '重定向 URL 不被允许',
      'Unable to create checkout session': '无法创建结账会话',
      'Unable to create Credit Pack checkout session': '无法创建点数包结账会话',
      'Invalid pagination params': '分页参数无效',
      'Invalid category filter': '分类筛选无效',
      'If-Match required': '必须提供 If-Match',
      'Idempotency-Key required': '必须提供 Idempotency-Key',
      'Email recovery is not supported in MVP; use pubkey recovery.': 'MVP 暂不支持邮箱恢复；请使用公钥恢复。',
    },
  },
  legal_required: {
    default: '需要接受法律条款',
    messages: {
      'Legal assent is required': '需要接受法律条款',
    },
  },
  legal_version_mismatch: {
    default: '法律条款版本不匹配',
    messages: {
      'Legal version mismatch': '法律条款版本不匹配',
    },
  },
  not_found: {
    default: '未找到资源',
    messages: {
      'Key not found': '未找到密钥',
      'Node not found': '未找到节点',
      'Verification challenge not found': '未找到验证挑战',
      'Recovery challenge not found': '未找到恢复挑战',
      'Unit not found': '未找到单元',
      'Request not found': '未找到请求',
      'Offer not found': '未找到报价',
    },
  },
  rate_limit_exceeded: {
    default: '已超过速率限制',
    messages: {
      'Rate limit exceeded': '已超过速率限制',
      'Too many verification attempts': '验证尝试次数过多',
      'Too many recovery attempts': '恢复尝试次数过多',
      'Pre-purchase daily limit exceeded': '已超过预购每日限制',
    },
  },
  idempotency_key_reuse_conflict: {
    default: '幂等键复用冲突',
    messages: {
      'Idempotency key used with different payload': '幂等键已与不同请求体一起使用',
    },
  },
  budget_cap_exceeded: {
    default: '搜索预算上限已超出',
    messages: {
      'Search budget cap exceeded': '搜索预算上限已超出',
      'Budget cap exceeded': '预算上限已超出',
    },
  },
  content_contact_info_disallowed: {
    default: '不允许包含联系信息',
    messages: {
      'Contact information is not allowed in item content': '项目内容中不允许包含联系信息',
      'Contact information is not allowed in offer notes': '报价备注中不允许包含联系信息',
    },
  },
  conflict: {
    default: '存在冲突',
    messages: {
      'Offer conflict': '报价存在冲突',
    },
  },
  invalid_state_transition: {
    default: '状态转换无效',
    messages: {
      'Invalid transition': '状态转换无效',
      'Recovery challenge already used': '恢复挑战已被使用',
      'Offer cannot be rejected in its current state': '报价当前状态下无法拒绝',
      'Offer cannot be cancelled in its current state': '报价当前状态下无法取消',
      'Counterparty contact is not ready': '对方联系信息尚未就绪',
    },
  },
  offer_not_mutually_accepted: {
    default: '报价尚未双方接受',
    messages: {
      'Offer not mutually accepted': '报价尚未双方接受',
    },
  },
  email_delivery_failed: {
    default: '无法发送邮件',
    messages: {
      'Unable to send verification email': '无法发送验证邮件',
      'Unable to send recovery email': '无法发送恢复邮件',
    },
  },
  stripe_signature_invalid: {
    default: 'Stripe 签名无效',
  },
  nowpayments_signature_invalid: {
    default: 'NOWPayments 签名无效',
  },
  internal_error: {
    default: '服务器内部错误',
    messages: {
      'Internal server error': '服务器内部错误',
      'Internal error processing webhook': '处理 webhook 时发生内部错误',
    },
  },
};

const ERROR_TRANSLATIONS_FA: Record<string, ErrorTranslationEntry> = {
  unauthorized: {
    default: 'غیرمجاز',
    messages: {
      'Invalid admin key': 'کلید مدیر نامعتبر است',
      'Missing or invalid API key': 'کلید API وجود ندارد یا نامعتبر است',
      'Invalid API key': 'کلید API نامعتبر است',
      'Missing or invalid session token': 'توکن نشست وجود ندارد یا نامعتبر است',
      'Invalid session token': 'توکن نشست نامعتبر است',
      'Session token expired or revoked': 'توکن نشست منقضی شده یا لغو شده است',
      'Missing or invalid authentication token': 'توکن احراز هویت وجود ندارد یا نامعتبر است',
    },
  },
  forbidden: {
    default: 'دسترسی ممنوع است',
    messages: {
      'API key is revoked': 'کلید API لغو شده است',
      'Node is suspended': 'گره معلق شده است',
      'Not allowed': 'مجاز نیست',
      'Cannot create checkout session for another node': 'نمی‌توان برای گره دیگری نشست پرداخت ایجاد کرد',
      'Cannot create Credit Pack checkout session for another node': 'نمی‌توان برای گره دیگری نشست پرداخت بسته اعتباری ایجاد کرد',
    },
  },
  validation_error: {
    default: 'درخواست نامعتبر است',
    messages: {
      'Invalid payload': 'بدنه درخواست نامعتبر است',
      'Invalid filters': 'فیلترها نامعتبر هستند',
      'Invalid search request': 'درخواست جستجو نامعتبر است',
      'Invalid search cursor': 'نشانگر جستجو نامعتبر است',
      'Invalid bootstrap request': 'درخواست بوت‌استرپ نامعتبر است',
      'Invalid profile update': 'به‌روزرسانی پروفایل نامعتبر است',
      'Invalid email verification request': 'درخواست تایید ایمیل نامعتبر است',
      'Invalid verification code': 'کد تایید نامعتبر است',
      'Verification failed': 'تایید ناموفق بود',
      'Unable to start recovery': 'شروع فرایند بازیابی ممکن نشد',
      'Invalid recovery completion request': 'درخواست تکمیل بازیابی نامعتبر است',
      'Recovery challenge expired': 'چالش بازیابی منقضی شده است',
      'Recovery validation failed': 'اعتبارسنجی بازیابی ناموفق بود',
      'Publish requirements not met': 'شرایط انتشار برآورده نشده است',
      'Redirect URL not allowed': 'نشانی بازگردانی مجاز نیست',
      'Unable to create checkout session': 'ایجاد نشست پرداخت ممکن نشد',
      'Unable to create Credit Pack checkout session': 'ایجاد نشست پرداخت بسته اعتباری ممکن نشد',
      'Invalid pagination params': 'پارامترهای صفحه‌بندی نامعتبر هستند',
      'Invalid category filter': 'فیلتر دسته‌بندی نامعتبر است',
      'If-Match required': 'سرآیند If-Match الزامی است',
      'Idempotency-Key required': 'سرآیند Idempotency-Key الزامی است',
      'Email recovery is not supported in MVP; use pubkey recovery.': 'بازیابی ایمیل در MVP پشتیبانی نمی‌شود؛ از بازیابی با کلید عمومی استفاده کنید.',
    },
  },
  legal_required: {
    default: 'پذیرش شرایط حقوقی الزامی است',
    messages: {
      'Legal assent is required': 'پذیرش شرایط حقوقی الزامی است',
    },
  },
  legal_version_mismatch: {
    default: 'نسخه شرایط حقوقی مطابقت ندارد',
    messages: {
      'Legal version mismatch': 'نسخه شرایط حقوقی مطابقت ندارد',
    },
  },
  not_found: {
    default: 'منبع پیدا نشد',
    messages: {
      'Key not found': 'کلید پیدا نشد',
      'Node not found': 'گره پیدا نشد',
      'Verification challenge not found': 'چالش تایید پیدا نشد',
      'Recovery challenge not found': 'چالش بازیابی پیدا نشد',
      'Unit not found': 'واحد پیدا نشد',
      'Request not found': 'درخواست پیدا نشد',
      'Offer not found': 'پیشنهاد پیدا نشد',
    },
  },
  rate_limit_exceeded: {
    default: 'از محدودیت نرخ عبور شده است',
    messages: {
      'Rate limit exceeded': 'از محدودیت نرخ عبور شده است',
      'Too many verification attempts': 'تلاش‌های تایید بیش از حد مجاز است',
      'Too many recovery attempts': 'تلاش‌های بازیابی بیش از حد مجاز است',
      'Pre-purchase daily limit exceeded': 'از سقف روزانه پیش از خرید عبور شده است',
    },
  },
  idempotency_key_reuse_conflict: {
    default: 'تعارض در استفاده مجدد از کلید همسانی',
    messages: {
      'Idempotency key used with different payload': 'کلید همسانی با بدنه متفاوتی استفاده شده است',
    },
  },
  budget_cap_exceeded: {
    default: 'سقف بودجه جستجو رد شده است',
    messages: {
      'Search budget cap exceeded': 'سقف بودجه جستجو رد شده است',
      'Budget cap exceeded': 'سقف بودجه رد شده است',
    },
  },
  content_contact_info_disallowed: {
    default: 'اطلاعات تماس مجاز نیست',
    messages: {
      'Contact information is not allowed in item content': 'اطلاعات تماس در محتوای آیتم مجاز نیست',
      'Contact information is not allowed in offer notes': 'اطلاعات تماس در یادداشت‌های پیشنهاد مجاز نیست',
    },
  },
  conflict: {
    default: 'تعارض وجود دارد',
    messages: {
      'Offer conflict': 'تعارض در پیشنهاد',
    },
  },
  invalid_state_transition: {
    default: 'تغییر وضعیت نامعتبر است',
    messages: {
      'Invalid transition': 'تغییر وضعیت نامعتبر است',
      'Recovery challenge already used': 'چالش بازیابی قبلا استفاده شده است',
      'Offer cannot be rejected in its current state': 'پیشنهاد در وضعیت فعلی قابل رد نیست',
      'Offer cannot be cancelled in its current state': 'پیشنهاد در وضعیت فعلی قابل لغو نیست',
      'Counterparty contact is not ready': 'اطلاعات تماس طرف مقابل آماده نیست',
    },
  },
  offer_not_mutually_accepted: {
    default: 'پیشنهاد هنوز به‌صورت دوطرفه پذیرفته نشده است',
    messages: {
      'Offer not mutually accepted': 'پیشنهاد هنوز به‌صورت دوطرفه پذیرفته نشده است',
    },
  },
  email_delivery_failed: {
    default: 'ارسال ایمیل ممکن نشد',
    messages: {
      'Unable to send verification email': 'ارسال ایمیل تایید ممکن نشد',
      'Unable to send recovery email': 'ارسال ایمیل بازیابی ممکن نشد',
    },
  },
  stripe_signature_invalid: {
    default: 'امضای Stripe نامعتبر است',
  },
  nowpayments_signature_invalid: {
    default: 'امضای NOWPayments نامعتبر است',
  },
  internal_error: {
    default: 'خطای داخلی سرور',
    messages: {
      'Internal server error': 'خطای داخلی سرور',
      'Internal error processing webhook': 'در پردازش وب‌هوک خطای داخلی رخ داد',
    },
  },
};

const ERROR_TRANSLATIONS: Record<TranslatedLocale, Record<string, ErrorTranslationEntry>> = {
  'zh-Hans': ERROR_TRANSLATIONS_ZH_HANS,
  fa: ERROR_TRANSLATIONS_FA,
};

export function resolveLocale(rawHeader: string | string[] | undefined): AppLocale {
  const raw = Array.isArray(rawHeader) ? rawHeader.join(',') : (rawHeader ?? '');
  for (const part of raw.split(',')) {
    const token = part.split(';', 1)[0]?.trim().toLowerCase();
    if (!token) continue;
    if (SIMPLIFIED_CHINESE_TOKENS.has(token)) return 'zh-Hans';
    if (FARSI_TOKENS.has(token)) return 'fa';
  }
  return 'en';
}

export function localizeErrorMessage(locale: AppLocale, code: string, message: string): string {
  if (locale === 'en') return message;
  const entry = ERROR_TRANSLATIONS[locale][code];
  if (!entry) return message;
  return entry.messages?.[message] ?? entry.default ?? message;
}

function isErrorEnvelopePayload(value: unknown): value is { error: { code: string; message: string; details?: unknown } } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
  return typeof (error as { code?: unknown }).code === 'string'
    && typeof (error as { message?: unknown }).message === 'string';
}

export function localizeErrorPayload(payload: unknown, locale: AppLocale): unknown {
  if (locale === 'en') return payload;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      const localized = localizeErrorPayload(parsed, locale);
      return localized === parsed ? payload : JSON.stringify(localized);
    } catch {
      return payload;
    }
  }
  if (!isErrorEnvelopePayload(payload)) return payload;
  const localizedMessage = localizeErrorMessage(locale, payload.error.code, payload.error.message);
  if (localizedMessage === payload.error.message) return payload;
  return {
    ...payload,
    error: {
      ...payload.error,
      message: localizedMessage,
    },
  };
}
