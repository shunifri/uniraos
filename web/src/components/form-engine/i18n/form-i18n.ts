import { useI18nStore, type TranslationKey } from "../../../i18n";

const builtInZh: Record<string, string> = {
  "validation.required": "此字段为必填项",
  "validation.minLength": "长度不能少于 {min} 个字符",
  "validation.maxLength": "长度不能超过 {max} 个字符",
  "validation.minimum": "数值不能小于 {min}",
  "validation.maximum": "数值不能大于 {max}",
  "validation.pattern": "格式不匹配",
  "validation.format.email": "请输入正确的邮箱格式",
  "validation.format.url": "请输入正确的 URL 格式",
  "validation.format.mobile": "请输入正确的手机号码格式",
  "validation.format.date": "请输入正确的日期格式（YYYY-MM-DD）",
  "validation.format.datetime": "请输入正确的日期时间格式（YYYY-MM-DDTHH:mm:ss）",
  "validation.async": "验证失败",
  "component.loading": "加载组件中...",
  "component.notFound": "未知组件: {name}",
  "placeholder.select": "请选择",
  "placeholder.date": "请选择日期",
  "placeholder.time": "请选择时间",
  "placeholder.user": "请选择用户",
  "placeholder.dept": "请选择部门",
  "uploader.success": "{name} 上传成功",
  "uploader.error": "{name} 上传失败",
  "uploader.maxSize": "文件大小不能超过 {size}MB",
  "array.add": "添加项",
  "table.addRow": "添加行",
};

const builtInEn: Record<string, string> = {
  "validation.required": "This field is required",
  "validation.minLength": "Length must be at least {min} characters",
  "validation.maxLength": "Length must not exceed {max} characters",
  "validation.minimum": "Value must not be less than {min}",
  "validation.maximum": "Value must not exceed {max}",
  "validation.pattern": "Format does not match",
  "validation.format.email": "Please enter a valid email address",
  "validation.format.url": "Please enter a valid URL",
  "validation.format.mobile": "Please enter a valid mobile number",
  "validation.format.date": "Please enter a valid date (YYYY-MM-DD)",
  "validation.format.datetime": "Please enter a valid datetime (YYYY-MM-DDTHH:mm:ss)",
  "validation.async": "Validation failed",
  "component.loading": "Loading component...",
  "component.notFound": "Unknown component: {name}",
  "placeholder.select": "Please select",
  "placeholder.date": "Please select date",
  "placeholder.time": "Please select time",
  "placeholder.user": "Please select user",
  "placeholder.dept": "Please select department",
  "uploader.success": "{name} uploaded successfully",
  "uploader.error": "{name} upload failed",
  "uploader.maxSize": "File size must not exceed {size}MB",
  "array.add": "Add item",
  "table.addRow": "Add row",
};

export function formT(key: string, params?: Record<string, string | number>): string {
  let text: string | undefined;
  try {
    const store = useI18nStore.getState?.();
    if (store) {
      text = store.t(key as TranslationKey);
      if (text !== key) return interpolate(text, params);
    }
  } catch {
    // App i18n not available
  }
  const lang = typeof navigator !== "undefined" && navigator.language.startsWith("zh") ? "zh" : "en";
  const dict = lang === "zh" ? builtInZh : builtInEn;
  text = dict[key] || key;
  return interpolate(text, params);
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? `{${key}}`));
}
