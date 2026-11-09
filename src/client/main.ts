import {
  buildConditionsFromForm,
  defaultScreenerForm,
  type ScreenerFormState,
} from "./screener-ui";

type Tab = "screener" | "signals" | "watchlist" | "notifications" | "paper" | "account";

let csrfToken = "";
let currentTab: Tab = "screener";
let screenerForm: ScreenerFormState = defaultScreenerForm();
let screenerLastResult: Record<string, unknown> | null = null;

function showToast(msg: string) {
  const el = document.getElementById("toast")!;
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 2500);
}

async function api(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (csrfToken && init?.method && init.method !== "GET") {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const res = await fetch(path, { ...init, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function el(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function setTab(tab: Tab) {
  currentTab = tab;
  document.querySelectorAll(".tabs button").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tab);
  });
  render();
}

async function renderLogin(root: HTMLElement) {
  root.replaceChildren(
    el(`
    <section class="card">
      <h3>邀请制登录</h3>
      <p class="muted">无公开注册。请使用受邀邮箱登录，或通过邀请链接注册。</p>
      <form class="form" id="loginForm">
        <input name="email" type="email" placeholder="邮箱" required />
        <input name="password" type="password" placeholder="密码" required />
        <button class="btn" type="submit">登录</button>
      </form>
    </section>
  `),
  );
  const loginForm = root.querySelector("#loginForm") as HTMLFormElement;
  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(loginForm);
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
        }),
      });
      csrfToken = data.csrfToken;
      render();
    } catch (err) {
      showToast(String(err));
    }
  };
}

async function renderScreener(root: HTMLElement) {
  const caps = await api("/api/screener/capabilities");
  root.replaceChildren();

  root.appendChild(
    el(`
    <section class="card" data-screener-intro>
      <h3>条件筛选（自定义 · 非固定列表）</h3>
      <p class="muted">${caps.disclaimer}</p>
      <p class="muted">${caps.signalDisclaimer}</p>
      ${caps.demo ? `<p class="pill" style="background:#7c2d12;color:#ffedd5">DEMO · ${caps.demoWatermark}</p>` : ""}
    </section>
  `),
  );

  const formWrap = el(`
    <section class="card form screener-form">
      <h3>设置条件（同时满足 AND）</h3>
      <label class="check-row"><input type="checkbox" data-f="priceEnabled" /> 收盘价区间（${caps.units.price}）</label>
      <div class="cond-fields" data-price-fields>
        <input data-f="priceMin" inputmode="decimal" placeholder="最低价 HKD（可选）" value="${screenerForm.priceMin}" />
        <input data-f="priceMax" inputmode="decimal" placeholder="最高价 HKD（可选）" value="${screenerForm.priceMax}" />
      </div>
      <label class="check-row"><input type="checkbox" data-f="changeEnabled" /> 涨跌幅区间（${caps.units.changePct}）</label>
      <div class="cond-fields" data-change-fields>
        <input data-f="changeMin" inputmode="decimal" placeholder="最低 %（可选）" value="${screenerForm.changeMin}" />
        <input data-f="changeMax" inputmode="decimal" placeholder="最高 %（可选）" value="${screenerForm.changeMax}" />
      </div>
      <label class="check-row"><input type="checkbox" data-f="maEnabled" /> 均线关系（${caps.units.ma}）</label>
      <div class="cond-fields" data-ma-fields>
        <input data-f="maPeriod" inputmode="numeric" placeholder="周期" value="${screenerForm.maPeriod}" />
        <select data-f="maRelation">
          <option value="above" ${screenerForm.maRelation === "above" ? "selected" : ""}>收盘价高于均线</option>
          <option value="below" ${screenerForm.maRelation === "below" ? "selected" : ""}>收盘价低于均线</option>
        </select>
      </div>
      <div class="card" style="opacity:${caps.turnoverSupported ? 1 : 0.55}">
        <p><strong>成交额</strong>（${caps.units.turnover}）</p>
        ${
          caps.turnoverSupported
            ? `<p class="muted">当前环境支持成交额条件，请在 API 请求中添加 turnover 类型（Web 表单后续可勾选）。</p>`
            : `<p class="muted">${caps.turnoverUnsupportedReason ?? "成交额不可用"}</p>`
        }
      </div>
      <div class="row screener-actions">
        <button class="btn" type="button" data-screener-run>执行筛选</button>
        <button class="btn secondary" type="button" data-screener-reset>重置</button>
      </div>
    </section>
  `);

  const syncFormFromDom = () => {
    for (const key of Object.keys(screenerForm) as (keyof ScreenerFormState)[]) {
      const input = formWrap.querySelector(`[data-f="${key}"]`) as HTMLInputElement | HTMLSelectElement | null;
      if (!input) continue;
      if (input.type === "checkbox") {
        (screenerForm[key] as boolean) = (input as HTMLInputElement).checked;
      } else {
        (screenerForm[key] as string) = input.value;
      }
    }
  };

  for (const cb of ["priceEnabled", "changeEnabled", "maEnabled"] as const) {
    const box = formWrap.querySelector(`[data-f="${cb}"]`) as HTMLInputElement;
    box.checked = screenerForm[cb];
    box.onchange = () => {
      screenerForm[cb] = box.checked;
    };
  }

  const run = async () => {
    syncFormFromDom();
    const conditions = buildConditionsFromForm(screenerForm);
    if (!conditions.length) {
      showToast("请勾选并填写至少一项条件");
      return;
    }
    try {
      screenerLastResult = await api("/api/screener/run", {
        method: "POST",
        body: JSON.stringify({ conditions }),
      });
      render();
    } catch (err) {
      showToast(String(err));
    }
  };

  formWrap.querySelector("[data-screener-run]")!.addEventListener("click", run);
  formWrap.querySelector("[data-screener-reset]")!.addEventListener("click", () => {
    screenerForm = defaultScreenerForm();
    screenerLastResult = null;
    render();
  });

  root.appendChild(formWrap);

  if (screenerLastResult) {
    const r = screenerLastResult;
    const hits = (r.hits as Record<string, unknown>[]) ?? [];
    root.appendChild(
      el(`
      <section class="card" data-screener-results>
        <h3>筛选结果</h3>
        <p class="muted">数据日期 ${r.asOfDate} · ${r.dataLabel}</p>
        ${r.message ? `<p class="empty-state">${r.message}</p>` : ""}
        <p class="muted">命中 ${hits.length} / 评估 ${r.evaluatedCount} 只</p>
      </section>
    `),
    );
    if (!hits.length) {
      return;
    }
    for (const item of hits) {
      const reasons = (item.summaryReasons as string[] ?? []).join("；");
      const detail = (item.conditionResults as { type: string; reason: string }[])
        ?.map((c) => `<li>${c.type}: ${c.reason}</li>`)
        .join("");
      const card = el(`
        <article class="card" data-screener-hit>
          <div class="row">
            <h3>${item.symbol} · ${item.nameZh}</h3>
            <span class="pill">命中</span>
          </div>
          <p class="muted">每手 ${item.boardLot} · ${item.tradeDate}</p>
          <p class="muted">${reasons}</p>
          <ul class="muted hit-detail">${detail}</ul>
          <button class="btn secondary" data-watch>加入自选</button>
        </article>
      `);
      card.querySelector("[data-watch]")!.addEventListener("click", async () => {
        await api("/api/watchlists", {
          method: "POST",
          body: JSON.stringify({ instrumentId: item.instrumentId }),
        });
        showToast(`已加入自选：${item.symbol}`);
      });
      root.appendChild(card);
    }
  }
}

async function renderSignals(root: HTMLElement) {
  const data = await api("/api/signals");
  root.replaceChildren();
  root.appendChild(
    el(`<p class="card muted">可解释理由仅供工程演示，不构成投资建议。</p>`),
  );
  const actionable = (data.items ?? []).filter(
    (s: { direction: string }) => s.direction === "buy" || s.direction === "sell",
  );
  if (!data.items?.length) {
    root.appendChild(el(`<p class="empty-state">暂无信号。请确认已运行 EOD 且日历/行情就绪。</p>`));
    return;
  }
  for (const s of data.items) {
    const card = el(`
      <article class="card" data-signal-id="${s.id}">
        <div class="row">
          <h3>${s.symbol} <span class="pill ${s.direction === "sell" ? "sell" : ""}">${s.direction}</span></h3>
          <span class="muted">${s.trade_date}</span>
        </div>
        <p class="muted">${(s.reasons ?? []).join("；")}</p>
        ${
          s.direction === "buy" || s.direction === "sell"
            ? `<button class="btn" data-confirm data-side="${s.direction}">确认模拟${s.direction === "buy" ? "买入" : "卖出"}（PAPER）</button>
               <p class="muted" data-confirm-status></p>`
            : ""
        }
      </article>
    `);
    const btn = card.querySelector("[data-confirm]") as HTMLButtonElement | null;
    const statusEl = card.querySelector("[data-confirm-status]") as HTMLElement | null;
    if (btn && statusEl) {
      btn.onclick = async () => {
        try {
          const res = await api("/api/paper/confirm", {
            method: "POST",
            body: JSON.stringify({
              instrumentId: s.instrument_id,
              side: s.direction,
              quantity: 100,
              signalTradeDate: s.trade_date,
              idempotencyKey: `${s.id}-${s.trade_date}`,
            }),
          });
          statusEl.textContent = `订单 ${res.orderId} · 状态 ${res.status} · 幂等键 ${s.id}-${s.trade_date}`;
          statusEl.className = res.status === "pending" ? "status-pending" : "status-filled";
          showToast(`模拟单：${res.status}`);
        } catch (err) {
          showToast(String(err));
        }
      };
    }
    root.appendChild(card);
  }
  if (!actionable.length) {
    root.appendChild(el(`<p class="muted">当前仅有观察(watch)信号；买入/卖出信号需等均线交叉触发。</p>`));
  }
}

async function renderWatchlist(root: HTMLElement) {
  const data = await api("/api/watchlists");
  root.replaceChildren();
  if (!data.items?.length) {
    root.appendChild(
      el(`
      <section class="card empty-state" data-empty-watchlist>
        <p>尚未添加自选</p>
        <p class="muted">在「筛选」页点击「加入自选」</p>
      </section>
    `),
    );
    return;
  }
  for (const w of data.items) {
    const card = el(`
      <article class="card row">
        <div>
        <strong>${w.symbol}</strong>
        <div class="muted">${w.name_zh}</div>
        </div>
        <button class="btn danger">移除</button>
      </article>
    `);
    card.querySelector("button")!.onclick = async () => {
      await api(`/api/watchlists/${w.instrument_id}`, { method: "DELETE" });
      renderWatchlist(root);
    };
    root.appendChild(card);
  }
}

async function renderNotifications(root: HTMLElement) {
  const notes = await api("/api/notifications");
  root.replaceChildren(
    el(`<h2 class="card">站内提醒 <span class="muted">（EOD 去重）</span></h2>`),
  );
  if (!notes.items?.length) {
    root.appendChild(el(`<p class="empty-state">暂无提醒</p>`));
    return;
  }
  for (const n of notes.items) {
    root.appendChild(
      el(`
      <article class="card" data-notification-id="${n.id}">
        <strong>${n.title}</strong>
        <p class="muted">${n.body}</p>
        <p class="muted">${n.created_at}</p>
      </article>
    `),
    );
  }
}

async function renderPaper(root: HTMLElement) {
  const data = await api("/api/paper/positions");
  const orders = await api("/api/paper/orders");
  root.replaceChildren(
    el(`<p class="card"><span class="badge-paper">PAPER 模拟盘</span> · 现金 ${((data.account?.cash_cents ?? 0) / 100).toLocaleString("zh-Hans")} HKD</p>`),
  );
  root.appendChild(el(`<h4 class="muted">模拟订单</h4>`));
  for (const o of orders.items ?? []) {
    const fill =
      o.status === "filled" && o.fill_trade_date
        ? `成交日 ${o.fill_trade_date} · 开盘价 ${((o.fill_price_cents ?? 0) / 100).toFixed(2)}`
        : "待下一可交易 session 行情";
    root.appendChild(
      el(`
      <article class="card" data-order-id="${o.id}">
        <div class="row">
          <strong>${o.symbol} ${o.side}</strong>
          <span class="${o.status === "pending" ? "status-pending" : "status-filled"}">${o.status}</span>
        </div>
        <p class="muted">信号日 ${o.signalDate ?? "—"} · ${fill}</p>
        <p class="muted">幂等键 ${o.idempotency_key}</p>
      </article>
    `),
    );
  }
  for (const p of data.positions ?? []) {
    root.appendChild(
      el(`
      <article class="card">
        <h3>${p.symbol} 持仓</h3>
        <p class="muted">${p.quantity} 股 · 均价 ${(p.avg_cost_cents / 100).toFixed(2)}</p>
      </article>
    `),
    );
  }
}

async function renderAccount(root: HTMLElement) {
  const me = await api("/api/me");
  const rootEl = document.getElementById("app")!;
  rootEl.replaceChildren(
    el(`
    <section class="card">
      <h3>${me.display_name}</h3>
      <p class="muted">${me.email} · ${me.role}</p>
      <button class="btn secondary" id="logout">退出登录</button>
    </section>
  `),
  );
  rootEl.querySelector("#logout")!.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    csrfToken = "";
    render();
  });
}

async function render() {
  const root = document.getElementById("app")!;
  try {
    const meta = await api("/api/meta");
    const wm = document.getElementById("demoWatermark")!;
    if (meta.demoWatermark) {
      wm.hidden = false;
      wm.textContent = meta.demoWatermark;
    }
  } catch {
    /* ignore */
  }

  try {
    const me = await api("/api/me");
    csrfToken = me.csrfToken;
    if (currentTab === "screener") await renderScreener(root);
    else if (currentTab === "signals") await renderSignals(root);
    else if (currentTab === "watchlist") await renderWatchlist(root);
    else if (currentTab === "notifications") await renderNotifications(root);
    else if (currentTab === "paper") await renderPaper(root);
    else await renderAccount(root);
  } catch {
    currentTab = "screener";
    await renderLogin(root);
  }
}

document.getElementById("tabs")!.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest("button");
  if (!t) return;
  setTab(t.getAttribute("data-tab") as Tab);
});

render();
