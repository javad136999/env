export class EnvError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "EnvError";
  }
}

export const notConfigured = () => new EnvError(
  "SUPABASE_NOT_CONFIGURED",
  "اتصال سرور به پایگاه داده تنظیم نشده است.",
  503
);
export const accessDenied = () => new EnvError(
  "ACCESS_DENIED",
  "این حساب به اطلاعات درخواستی دسترسی ندارد.",
  403
);
export const reportConflict = () => new EnvError(
  "REPORT_CONFLICT",
  "گزارش هم‌زمان تغییر کرده یا گزارش دیگری برای همین شرکت، سال، دوره و دسته وجود دارد؛ اطلاعات را تازه‌سازی کنید.",
  409
);
export const invalidReport = () => new EnvError(
  "REPORT_INVALID",
  "ساختار گزارش یا مقادیر آن معتبر نیست.",
  400
);
