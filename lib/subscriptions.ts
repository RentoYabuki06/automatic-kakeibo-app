// サブスクリプション（定期支出）の型と、請求日の計算

export type Cycle = "monthly" | "yearly";

export type Subscription = {
  id: string;
  name: string;
  amount: number;
  cycle: Cycle;
  billing_day: number; // 1〜31。月末より大きければ月末
  billing_month: number | null; // 年払いの請求月（1〜12）。月払いは null
  category: string;
  keyword: string; // 履歴の店名に含まれる文字（大文字小文字は区別しない）
  color: string;
  url: string | null;
  memo: string | null;
  active: boolean;
  created_at: string;
};

export const DEFAULT_SUB_CATEGORY = "サブスクリプション";

// カードの色。登録順に、まだ使っていない色を割り当てる
export const SUB_COLORS = [
  "#e50914", "#1db954", "#0ea5e9", "#7c3aed", "#f59e0b", "#ec4899",
  "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#0f172a", "#a855f7",
];

export const pickSubColor = (used: string[]) =>
  SUB_COLORS.find((c) => !used.includes(c)) ?? SUB_COLORS[used.length % SUB_COLORS.length];

// 毎月いくらに相当するか（年払いは 12 で割って四捨五入）
export const monthlyEquivalent = (s: Pick<Subscription, "amount" | "cycle">) =>
  s.cycle === "monthly" ? s.amount : Math.round(s.amount / 12);

// 年間いくらに相当するか
export const yearlyEquivalent = (s: Pick<Subscription, "amount" | "cycle">) =>
  s.cycle === "monthly" ? s.amount * 12 : s.amount;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

// 年 y・月 m（0 始まり）の請求日。月末より大きい日は月末にする
const billingDateIn = (y: number, m: number, day: number) =>
  new Date(y, m, Math.min(day, daysInMonth(y, m)));

type BillingKey = Pick<Subscription, "cycle" | "billing_day" | "billing_month">;

// 今日以降（今日を含む）で最初に来る請求日
export const nextBilling = (s: BillingKey, today = new Date()): Date => {
  const t = startOfDay(today);
  if (s.cycle === "monthly") {
    const cand = billingDateIn(t.getFullYear(), t.getMonth(), s.billing_day);
    return cand >= t ? cand : billingDateIn(t.getFullYear(), t.getMonth() + 1, s.billing_day);
  }
  const bm = (s.billing_month ?? 1) - 1;
  const cand = billingDateIn(t.getFullYear(), bm, s.billing_day);
  return cand >= t ? cand : billingDateIn(t.getFullYear() + 1, bm, s.billing_day);
};

// 今日より前（今日を含まない）で最後に来た請求日。次の請求日から 1 周期戻す
export const prevBilling = (s: BillingKey, today = new Date()): Date => {
  const n = nextBilling(s, today);
  return s.cycle === "monthly"
    ? billingDateIn(n.getFullYear(), n.getMonth() - 1, s.billing_day)
    : billingDateIn(n.getFullYear() - 1, n.getMonth(), s.billing_day);
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const daysUntil = (d: Date, today = new Date()) =>
  Math.round((startOfDay(d).getTime() - startOfDay(today).getTime()) / DAY_MS);

// 周期のどこまで進んだか（0〜1）。前回の請求日で 0、次の請求日で 1
export const cycleProgress = (s: BillingKey, today = new Date()) => {
  const prev = prevBilling(s, today).getTime();
  const next = nextBilling(s, today).getTime();
  const now = startOfDay(today).getTime();
  if (next <= prev) return 1;
  return Math.min(1, Math.max(0, (now - prev) / (next - prev)));
};

// 店名がこのサブスクのキーワードに一致するか
export const matchesKeyword = (keyword: string, store: string) => {
  const k = keyword.trim().toLowerCase();
  return k.length > 0 && store.toLowerCase().includes(k);
};

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const toDateStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
