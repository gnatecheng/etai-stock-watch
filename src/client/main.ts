type Tab = "screener" | "signals" | "watchlist" | "paper" | "account";

let csrfToken = "";
let currentTab: Tab = "screener";

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
      <hr style="border-color:#334155;margin:1rem 0" />
      <h3>接受邀请</h3>
      <form class="form" id="inviteForm">
        <input name="inviteToken" placeholder="邀请令牌" required />
        <input name="email" type="email" placeholder="邮箱" required />
        <input name="displayName" placeholder="显示名" required />
        <input name="password" type="password" placeholder="设置密码" required />
        <button class="btn secondary" type="submit">注册并登录</button>
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
      alert(String(err));
    }
  };
  const inviteForm = root.querySelector("#inviteForm") as HTMLFormElement;
  inviteForm.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(inviteForm);
    try {
      const data = await api("/api/auth/invite", {
        method: "POST",
        body: JSON.stringify({
          inviteToken: fd.get("inviteToken"),
          email: fd.get("email"),
          displayName: fd.get("displayName"),
          password: fd.get("password"),
        }),
      });
      csrfToken = data.csrfToken;
      render();
    } catch (err) {
      alert(String(err));
    }
  };
}

async function renderScreener(root: HTMLElement) {
  const data = await api("/api/screener");
  root.replaceChildren();
  for (const item of data.items) {
    const card = el(`
      <article class="card">
        <div class="row">
          <h3>${item.symbol} · ${item.name_zh}</h3>
          <span class="pill">${item.last_signal ?? "—"}</span>
        </div>
        <p class="muted">每手 ${item.board_lot} · 收盘 ${item.close_cents ? (item.close_cents / 100).toFixed(2) : "—"} ${item.currency ?? "HKD"}</p>
        <p class="muted">${(item.inclusionReasons ?? []).join("；")}</p>
        <button class="btn secondary" data-watch="${item.id}">加入自选</button>
      </article>
    `);
    card.querySelector("button")!.onclick = async () => {
      await api("/api/watchlists", {
        method: "POST",
        body: JSON.stringify({ instrumentId: item.id }),
      });
      alert("已加入自选");
    };
    root.appendChild(card);
  }
}

async function renderSignals(root: HTMLElement) {
  const data = await api("/api/signals");
  root.replaceChildren();
  for (const s of data.items) {
    root.appendChild(
      el(`
      <article class="card">
        <div class="row">
          <h3>${s.symbol} <span class="pill ${s.direction === "sell" ? "sell" : ""}">${s.direction}</span></h3>
          <span class="muted">${s.trade_date}</span>
        </div>
        <p class="muted">${(s.reasons ?? []).join("；")}</p>
      </article>
    `),
    );
  }
}

async function renderWatchlist(root: HTMLElement) {
  const data = await api("/api/watchlists");
  root.replaceChildren();
  for (const w of data.items) {
    const card = el(`
      <article class="card row">
        <div>
        <strong>${w.symbol}</strong>
        <div class="muted">${w.name_zh}</div>
        </div>
        <button class="btn danger" data-id="${w.instrument_id}">移除</button>
      </article>
    `);
    card.querySelector("button")!.onclick = async () => {
      await api(`/api/watchlists/${w.instrument_id}`, { method: "DELETE" });
      renderWatchlist(root);
    };
    root.appendChild(card);
  }
}

async function renderPaper(root: HTMLElement) {
  const data = await api("/api/paper/positions");
  root.replaceChildren(
    el(`<p class="card"><span class="badge-paper">PAPER 模拟盘</span> · 现金 ${((data.account?.cash_cents ?? 0) / 100).toLocaleString("zh-Hans")} HKD</p>`),
  );
  for (const p of data.positions) {
    root.appendChild(
      el(`
      <article class="card">
        <h3>${p.symbol}</h3>
        <p class="muted">持仓 ${p.quantity} 股 · 均价 ${(p.avg_cost_cents / 100).toFixed(2)}</p>
      </article>
    `),
    );
  }
}

async function renderAccount(root: HTMLElement) {
  const me = await api("/api/me");
  const notes = await api("/api/notifications");
  root.replaceChildren(
    el(`
    <section class="card">
      <h3>${me.display_name}</h3>
      <p class="muted">${me.email} · ${me.role}</p>
      <button class="btn secondary" id="logout">退出登录</button>
    </section>
  `),
  );
  root.querySelector("#logout")!.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    csrfToken = "";
    render();
  });
  for (const n of notes.items ?? []) {
    root.appendChild(
      el(`
      <article class="card">
        <strong>${n.title}</strong>
        <p class="muted">${n.body}</p>
      </article>
    `),
    );
  }
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
