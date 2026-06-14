/**
 * 可选依赖的 ambient 类型声明
 * 这些模块是运行时动态加载的可选依赖，未安装时不影响编译
 */

declare module "nodemailer" {
  const content: unknown;
  export = content;
}

declare module "imap" {
  const content: unknown;
  export = content;
}

declare module "ldapjs" {
  const content: unknown;
  export = content;
}

declare module "kafkajs" {
  const content: unknown;
  export = content;
}

declare module "basic-ftp" {
  const content: unknown;
  export = content;
}

declare module "ssh2-sftp-client" {
  const content: unknown;
  export = content;
}

declare module "soap" {
  const content: unknown;
  export = content;
}

declare module "mqtt" {
  const content: unknown;
  export = content;
}

declare module "odbc" {
  const content: unknown;
  export = content;
}

declare module "tesseract.js" {
  const content: unknown;
  export = content;
}

