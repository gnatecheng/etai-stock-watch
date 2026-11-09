import { parseTradeDate as parseYmd } from "../lib/time";

export type SessionType = "full" | "half" | "closed";

export interface CalendarDay {
  trade_date: string;
  session_type: SessionType;
  note?: string;
}

const BUILTIN: CalendarDay[] = [
  { trade_date: "2024-01-01", session_type: "closed", note: "元旦" },
  { trade_date: "2024-02-09", session_type: "half", note: "农历除夕半日市" },
  { trade_date: "2024-12-25", session_type: "closed", note: "圣诞节" },
  { trade_date: "2024-12-26", session_type: "closed", note: "圣诞节翌日" },
];

/** 仅用于开发种子写入，不作为运行时交易日推断 */
export function weekdaySessionForSeed(dateStr: string): SessionType {
  const d = new Date(dateStr + "T12:00:00+08:00");
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return "closed";
  return "full";
}

export async function getSessionType(
  db: D1Database,
  tradeDate: string,
): Promise<{ session: SessionType; source: "db" | "missing" }> {
  const row = await db
    .prepare("SELECT session_type FROM calendar_hk WHERE trade_date = ?")
    .bind(tradeDate)
    .first<{ session_type: SessionType }>();
  if (row) return { session: row.session_type, source: "db" };
  return { session: "closed", source: "missing" };
}

export async function seedBuiltinCalendar(db: D1Database): Promise<void> {
  for (const day of BUILTIN) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO calendar_hk (trade_date, session_type, note) VALUES (?, ?, ?)",
      )
      .bind(day.trade_date, day.session_type, day.note ?? null)
      .run();
  }
}

export async function seedCalendarRange(
  db: D1Database,
  from: string,
  to: string,
): Promise<void> {
  let d = parseYmd(from);
  const end = parseYmd(to);
  const stmts: D1PreparedStatement[] = [];
  while (d <= end) {
    const dateStr = d.toISOString().slice(0, 10);
    const override = BUILTIN.find((x) => x.trade_date === dateStr);
    const session = override?.session_type ?? weekdaySessionForSeed(dateStr);
    stmts.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO calendar_hk (trade_date, session_type, note) VALUES (?, ?, ?)",
        )
        .bind(dateStr, session, override?.note ?? "seed"),
    );
    d.setUTCDate(d.getUTCDate() + 1);
  }
  if (stmts.length) await db.batch(stmts);
}

export function assertCalendarCoverage(
  tradeDate: string,
  source: "db" | "missing",
): { ok: boolean; reason?: string } {
  if (source === "missing") {
    return {
      ok: false,
      reason: `交易日 ${tradeDate} 未在 calendar_hk 中显式配置，已 fail-closed`,
    };
  }
  return { ok: true };
}

export async function isTradableSession(db: D1Database, tradeDate: string): Promise<boolean> {
  const { session, source } = await getSessionType(db, tradeDate);
  if (source !== "db") return false;
  return session === "full" || session === "half";
}
