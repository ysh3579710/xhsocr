const BEIJING_TIMEZONE = "Asia/Shanghai";

function parseServerDate(input: string): Date {
  const raw = (input || "").trim();
  if (!raw) return new Date(NaN);
  const m = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:([zZ])|([+\-])(\d{2}):?(\d{2}))?$/
  );
  if (!m) return new Date(raw);

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const micro = m[7] || "0";
  const ms = Number((micro + "000").slice(0, 3));
  const z = m[8];
  const sign = m[9];
  const tzHour = Number(m[10] || "0");
  const tzMinute = Number(m[11] || "0");

  if (z) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  }

  if (sign) {
    const offsetMinutes = tzHour * 60 + tzMinute;
    const signed = sign === "+" ? offsetMinutes : -offsetMinutes;
    const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second, ms) - signed * 60 * 1000;
    return new Date(utcMillis);
  }

  // No timezone in payload: treat server datetime as UTC.
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
}

export function formatBeijingDateTime(input: string): string {
  const d = parseServerDate(input);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(d);
}
