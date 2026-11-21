"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ExternalLink,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { yen } from "@/lib/format";
import {
  DEFAULT_SUB_CATEGORY,
  SUB_COLORS,
  cycleProgress,
  daysUntil,
  matchesKeyword,
  monthlyEquivalent,
  nextBilling,
  pickSubColor,
  prevBilling,
  toDateStr,
  yearlyEquivalent,
  type Cycle,
  type Subscription,
} from "@/lib/subscriptions";

type Props = { categoryNames: string[] };

// 照合に使う履歴の行（直近 13 か月ぶん）
type Row = { id: string; store: string; amount: number; used_at: string; category: string | null };

const FETCH_MONTHS = 13;
// 直近の請求日の何日前までの決済を「今回分」とみなすか（カードの通知が請求日より少し早いことがある）
const PAID_GRACE_DAYS = 3;
// 候補として提案する条件: 「サブスクリプション」カテゴリの同じ店名が、何か月以上あるか
const SUGGEST_MIN_MONTHS = 2;

const fmtMD = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
const fmtISO = (iso: string) => fmtMD(new Date(iso));

const dueText = (days: number) => (days === 0 ? "今日" : days === 1 ? "明日" : `あと${days}日`);

async function fetchRows(from: Date): Promise<{ rows: Row[]; error: string | null }> {
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let i = 0; ; i += PAGE) {
    const { data, error } = await supabase
      .from("expenses")
      .select("id,store,amount,used_at,category")
      .gte("used_at", from.toISOString())
      .order("used_at")
      .order("id")
      .range(i, i + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }
  return { rows, error: null };
}

type FormState = {
  id: string | null; // null なら新規
  name: string;
  amount: string;
  cycle: Cycle;
  billingDay: number;
  billingMonth: number;
  category: string;
  keyword: string;
  color: string;
  url: string;
  memo: string;
};

const emptyForm = (category: string, color: string, today: Date): FormState => ({
  id: null,
  name: "",
  amount: "",
  cycle: "monthly",
  billingDay: today.getDate(),
  billingMonth: today.getMonth() + 1,
  category,
  keyword: "",
  color,
  url: "",
  memo: "",
});

export default function SubscriptionTab({ categoryNames }: Props) {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const defaultCategory = categoryNames.includes(DEFAULT_SUB_CATEGORY)
    ? DEFAULT_SUB_CATEGORY
    : categoryNames[0] ?? DEFAULT_SUB_CATEGORY;

  const load = useCallback(async () => {
    const from = new Date(today.getFullYear(), today.getMonth() - (FETCH_MONTHS - 1), 1);
    const [s, r] = await Promise.all([
      supabase.from("subscriptions").select("*").order("created_at"),
      fetchRows(from),
    ]);
    if (s.error) setError(s.error.message);
    else if (r.error) setError(r.error);
    else {
      setError(null);
      setSubs(s.data as Subscription[]);
      setRows(r.rows);
    }
    setLoading(false);
  }, [today]);

  useEffect(() => {
    load();
  }, [load]);

  // 各サブスクの、キーワードに一致する最新の決済
  const lastPaidOf = useMemo(() => {
    const m = new Map<string, Row>();
    for (const s of subs) {
      let best: Row | null = null;
      for (const r of rows) {
        if (r.amount > 0 && matchesKeyword(s.keyword, r.store) && (!best || r.used_at > best.used_at)) best = r;
      }
      if (best) m.set(s.id, best);
    }
    return m;
  }, [subs, rows]);

  const active = useMemo(
    () =>
      subs
        .filter((s) => s.active)
        .sort((a, b) => nextBilling(a, today).getTime() - nextBilling(b, today).getTime()),
    [subs, today]
  );
  const paused = useMemo(() => subs.filter((s) => !s.active), [subs]);

  const monthlyTotal = active.reduce((sum, s) => sum + monthlyEquivalent(s), 0);
  const yearlyTotal = active.reduce((sum, s) => sum + yearlyEquivalent(s), 0);
  const upcoming = active[0];

  // 未登録の候補: 「サブスクリプション」カテゴリで、同じ店名が複数の月にある履歴
  const suggestions = useMemo(() => {
    const byStore = new Map<string, { months: Set<string>; latest: Row }>();
    for (const r of rows) {
      if (r.category !== DEFAULT_SUB_CATEGORY || r.amount <= 0) continue;
      if (subs.some((s) => matchesKeyword(s.keyword, r.store))) continue;
      const d = new Date(r.used_at);
      const cur = byStore.get(r.store) ?? { months: new Set<string>(), latest: r };
      cur.months.add(`${d.getFullYear()}-${d.getMonth()}`);
      if (r.used_at > cur.latest.used_at) cur.latest = r;
      byStore.set(r.store, cur);
    }
    return [...byStore.entries()]
      .filter(([store, v]) => v.months.size >= SUGGEST_MIN_MONTHS && !dismissed.has(store))
      .map(([store, v]) => ({ store, months: v.months.size, latest: v.latest }))
      .sort((a, b) => b.months - a.months);
  }, [rows, subs, dismissed]);

  const openNew = (preset?: Partial<FormState>) => {
    setFormError(null);
    setForm({ ...emptyForm(defaultCategory, pickSubColor(subs.map((s) => s.color)), today), ...preset });
  };

  const openEdit = (s: Subscription) => {
    setFormError(null);
    setForm({
      id: s.id,
      name: s.name,
      amount: String(s.amount),
      cycle: s.cycle,
      billingDay: s.billing_day,
      billingMonth: s.billing_month ?? today.getMonth() + 1,
      category: s.category,
      keyword: s.keyword,
      color: s.color,
      url: s.url ?? "",
      memo: s.memo ?? "",
    });
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form) return;
    const name = form.name.trim();
    const amount = parseInt(form.amount, 10);
    if (!name) return setFormError("サービス名を入力してください");
    if (!amount || amount <= 0) return setFormError("金額を入力してください");
    const url = form.url.trim();
    if (url && !/^https?:\/\//.test(url)) return setFormError("URL は http:// か https:// で始めてください");
    setSaving(true);
    const payload = {
      name,
      amount,
      cycle: form.cycle,
      billing_day: form.billingDay,
      billing_month: form.cycle === "yearly" ? form.billingMonth : null,
      category: form.category,
      keyword: form.keyword.trim() || name,
      color: form.color,
      url: url || null,
      memo: form.memo.trim() || null,
    };
    const q = form.id
      ? supabase.from("subscriptions").update(payload).eq("id", form.id)
      : supabase.from("subscriptions").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) return setFormError(error.message);
    setForm(null);
    await load();
  };

  const toggleActive = async (s: Subscription) => {
    const { error } = await supabase.from("subscriptions").update({ active: !s.active }).eq("id", s.id);
    if (error) return setError(error.message);
    setSubs((prev) => prev.map((x) => (x.id === s.id ? { ...x, active: !s.active } : x)));
  };

  const remove = async (s: Subscription) => {
    if (!confirm(`「${s.name}」を削除しますか？\n履歴の支出は消えません。`)) return;
    const { error } = await supabase.from("subscriptions").delete().eq("id", s.id);
    if (error) return setError(error.message);
    setSubs((prev) => prev.filter((x) => x.id !== s.id));
    if (expanded === s.id) setExpanded(null);
  };

  // 自動取り込みされない支払いのために、今回分の請求を支出として登録する
  const recordCharge = async (s: Subscription, date: Date) => {
    setRecording(s.id);
    const { error } = await supabase.from("expenses").insert({
      used_at: new Date(`${toDateStr(date)}T12:00:00`).toISOString(),
      store: s.name,
      amount: s.amount,
      category: s.category,
      payment_method: "その他",
      source: "manual",
    });
    setRecording(null);
    if (error) return setError(error.message);
    await load();
  };

  if (loading) return <p className="p-4 text-center text-sm text-slate-400">読み込み中…</p>;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {/* まとめ */}
      <section className="relative overflow-hidden rounded-3xl bg-slate-900 p-5 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-emerald-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="relative">
          <p className="text-xs text-slate-400">毎月の固定費（年払いは 12 で割った額）</p>
          <p className="mt-1 text-4xl font-bold tracking-tight">{yen(monthlyTotal)}</p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-xl bg-white/10 p-2.5">
              <p className="text-slate-400">年間</p>
              <p className="mt-0.5 font-semibold">{yen(yearlyTotal)}</p>
            </div>
            <div className="rounded-xl bg-white/10 p-2.5">
              <p className="text-slate-400">利用中</p>
              <p className="mt-0.5 font-semibold">{active.length}件</p>
            </div>
            <div className="rounded-xl bg-white/10 p-2.5">
              <p className="text-slate-400">次の請求</p>
              <p className="mt-0.5 truncate font-semibold">
                {upcoming ? `${fmtMD(nextBilling(upcoming, today))} ${upcoming.name}` : "—"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 追加・編集フォーム */}
      {form ? (
        <form onSubmit={save} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm" data-no-swipe>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-500">{form.id ? "サブスクを編集" : "サブスクを追加"}</h2>
            <button type="button" onClick={() => setForm(null)} aria-label="閉じる" className="p-1 text-slate-400">
              <X size={18} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white"
              style={{ background: form.color }}
            >
              {form.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
            <input
              type="text"
              placeholder="サービス名（例: Netflix）"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={40}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2.5 outline-none focus:border-emerald-500"
            />
          </div>
          <div className="flex gap-1.5" aria-label="色">
            {SUB_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setForm({ ...form, color: c })}
                aria-label={`色 ${c}`}
                aria-pressed={form.color === c}
                className={`h-6 w-6 shrink-0 rounded-full ${form.color === c ? "ring-2 ring-slate-800 ring-offset-1" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="金額"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-lg outline-none focus:border-emerald-500"
            />
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200 text-sm">
              {(
                [
                  ["monthly", "月払い"],
                  ["yearly", "年払い"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setForm({ ...form, cycle: v })}
                  className={`px-3 ${form.cycle === v ? "bg-slate-800 text-white" : "text-slate-500"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-slate-500">請求日</span>
            {form.cycle === "yearly" && (
              <select
                value={form.billingMonth}
                onChange={(e) => setForm({ ...form, billingMonth: Number(e.target.value) })}
                aria-label="請求月"
                className="rounded-lg border border-slate-200 bg-white px-2 py-2"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}月
                  </option>
                ))}
              </select>
            )}
            <select
              value={form.billingDay}
              onChange={(e) => setForm({ ...form, billingDay: Number(e.target.value) })}
              aria-label="請求日"
              className="rounded-lg border border-slate-200 bg-white px-2 py-2"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}日
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-400">月末より大きい日は月末</span>
          </div>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            aria-label="カテゴリ"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-emerald-500"
          >
            {categoryNames.map((c) => (
              <option key={c}>{c}</option>
            ))}
            {!categoryNames.includes(form.category) && <option>{form.category}</option>}
          </select>
          <div>
            <input
              type="text"
              placeholder={`履歴と結び付ける店名の文字（空なら「${form.name.trim() || "サービス名"}」）`}
              value={form.keyword}
              onChange={(e) => setForm({ ...form, keyword: e.target.value })}
              maxLength={40}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
            />
            <p className="mt-1 px-1 text-xs text-slate-400">
              履歴の店名にこの文字が含まれていれば、このサブスクの決済とみなします（例: NETFLIX）。大文字小文字は区別しません。
            </p>
          </div>
          <input
            type="url"
            placeholder="管理ページの URL（任意。解約・プラン変更に使う）"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
          <input
            type="text"
            placeholder="メモ（任意）"
            value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
            maxLength={100}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
          {formError && <p className="text-xs text-red-600">{formError}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white active:bg-emerald-700 disabled:opacity-50"
          >
            {form.id ? "保存" : "追加"}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => openNew()}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 py-3 text-sm font-semibold text-slate-500 active:bg-white"
        >
          <Plus size={18} /> サブスクを追加
        </button>
      )}

      {/* 候補 */}
      {suggestions.length > 0 && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
            <Sparkles size={16} /> 登録されていない定期支出
          </h2>
          <p className="mt-1 text-xs text-emerald-700">
            「{DEFAULT_SUB_CATEGORY}」カテゴリの履歴で、{SUGGEST_MIN_MONTHS} か月以上ある店名です。タップすると入力欄に埋めます。
          </p>
          <ul className="mt-2 space-y-1.5">
            {suggestions.map((sg) => (
              <li key={sg.store} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    openNew({
                      name: sg.store,
                      keyword: sg.store,
                      amount: String(sg.latest.amount),
                      billingDay: new Date(sg.latest.used_at).getDate(),
                    })
                  }
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-left text-sm shadow-sm active:bg-emerald-100"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{sg.store}</span>
                    <span className="block text-xs text-slate-400">
                      {sg.months}か月 ・ 最終 {fmtISO(sg.latest.used_at)}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold">{yen(sg.latest.amount)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed((prev) => new Set(prev).add(sg.store))}
                  aria-label="この候補を隠す"
                  className="shrink-0 p-1 text-emerald-700/60"
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 一覧 */}
      {active.length === 0 && paused.length === 0 ? (
        <p className="p-4 text-center text-sm text-slate-400">
          サブスクはまだ登録されていません。Netflix や Spotify などの定期支出を登録すると、毎月の固定費と次の請求日が分かります。
        </p>
      ) : (
        <ul className="space-y-2.5">
          {[...active, ...paused].map((s) => {
            const next = nextBilling(s, today);
            const days = daysUntil(next, today);
            const progress = cycleProgress(s, today);
            const last = lastPaidOf.get(s.id);
            const prev = prevBilling(s, today);
            // 今回分の請求日: 今日が請求日なら今日、そうでなければ直近の請求日
            const due = days === 0 ? next : prev;
            const graceFrom = new Date(due.getFullYear(), due.getMonth(), due.getDate() - PAID_GRACE_DAYS);
            const paid = !!last && new Date(last.used_at) >= graceFrom;
            const isOpen = expanded === s.id;
            return (
              <li
                key={s.id}
                className={`overflow-hidden rounded-2xl bg-white shadow-sm ${s.active ? "" : "opacity-60"}`}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : s.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 p-4 text-left active:bg-slate-50"
                >
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white"
                    style={{ background: s.color }}
                  >
                    {s.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{s.name}</span>
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                        {s.cycle === "monthly" ? "月払い" : "年払い"}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                      {s.active ? (
                        <>
                          <CalendarClock size={12} />
                          次回 {fmtMD(next)} ・ <span className={days <= 3 ? "font-semibold text-amber-600" : ""}>{dueText(days)}</span>
                        </>
                      ) : (
                        <>一時停止中</>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-bold">{yen(s.amount)}</span>
                    <span className="block text-[10px] text-slate-400">{s.cycle === "monthly" ? "/月" : "/年"}</span>
                  </span>
                  <ChevronDown
                    size={16}
                    className={`shrink-0 text-slate-300 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {s.active && (
                  <div className="h-1 bg-slate-100" aria-hidden>
                    <div className="h-full" style={{ width: `${Math.round(progress * 100)}%`, background: s.color }} />
                  </div>
                )}

                {isOpen && (
                  <div className="space-y-3 border-t border-slate-100 p-4 text-sm">
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div>
                        <dt className="text-slate-400">カテゴリ</dt>
                        <dd className="font-medium text-slate-700">{s.category}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">毎月換算</dt>
                        <dd className="font-medium text-slate-700">{yen(monthlyEquivalent(s))}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">最終決済（履歴から照合）</dt>
                        <dd className="font-medium text-slate-700">
                          {last ? `${fmtISO(last.used_at)} ${yen(last.amount)}` : "見つかりません"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">今回分（{fmtMD(due)}）</dt>
                        <dd className={`font-medium ${paid ? "text-emerald-600" : "text-slate-700"}`}>
                          {paid ? "履歴にあります" : "履歴にありません"}
                        </dd>
                      </div>
                      {s.memo && (
                        <div className="col-span-2">
                          <dt className="text-slate-400">メモ</dt>
                          <dd className="text-slate-700">{s.memo}</dd>
                        </div>
                      )}
                    </dl>
                    <p className="text-xs text-slate-400">
                      照合のキーワード: <span className="font-mono">{s.keyword}</span>
                    </p>

                    {s.active && !paid && (
                      <button
                        type="button"
                        onClick={() => recordCharge(s, due)}
                        disabled={recording === s.id}
                        className="w-full rounded-lg border border-emerald-600 py-2 text-sm font-semibold text-emerald-700 active:bg-emerald-50 disabled:opacity-50"
                      >
                        {fmtMD(due)} 分を支出として記録
                      </button>
                    )}
                    {s.active && !paid && (
                      <p className="-mt-1 text-[11px] text-slate-400">
                        カード・銀行から自動で取り込まれる支払いなら、二重になるので記録しないでください。
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(s)}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 py-2 text-xs font-semibold text-slate-700 active:bg-slate-200"
                      >
                        <Pencil size={14} /> 編集
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(s)}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 py-2 text-xs font-semibold text-slate-700 active:bg-slate-200"
                      >
                        {s.active ? (
                          <>
                            <Pause size={14} /> 一時停止
                          </>
                        ) : (
                          <>
                            <Play size={14} /> 再開
                          </>
                        )}
                      </button>
                      {s.url && (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 py-2 text-xs font-semibold text-slate-700 active:bg-slate-200"
                        >
                          <ExternalLink size={14} /> 管理
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(s)}
                        aria-label="削除"
                        className="flex items-center justify-center rounded-lg bg-red-50 px-3 py-2 text-red-500 active:bg-red-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {active.length > 0 && (
        <p className="px-1 text-[11px] text-slate-400">
          カードの下の線は、前回の請求日から次の請求日までの進み具合です。年払いは請求月の請求日を次回とします。
        </p>
      )}
    </div>
  );
}
