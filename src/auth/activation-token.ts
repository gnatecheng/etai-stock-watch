/**
 * 从用户粘贴内容提取单行令牌（忽略 # 注释行），再 trim。
 * 不记录日志；仅用于哈希比对。
 */
export function sanitizeActivationToken(raw: string | null | undefined): string {
  if (raw == null) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return "";
  if (lines.length === 1) return lines[0]!;
  // 多行非注释：取末行（令牌文件格式为注释在前、令牌在最后一行）
  return lines[lines.length - 1]!;
}
