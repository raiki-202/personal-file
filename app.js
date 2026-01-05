// Personal File - Vanilla SPA (no build)
// Bundle JSON (GitHub) + Firestore hybrid
// iPhone: prevent zoom (handled in CSS) + table scroll

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs,
  setDoc, addDoc, deleteDoc, updateDoc,
  query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* =========================
   Config
========================= */
const firebaseConfig = window.firebaseConfig;
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const $ = (q, el=document)=> el.querySelector(q);
const $$ = (q, el=document)=> [...el.querySelectorAll(q)];
const fmtJPY = (n)=> new Intl.NumberFormat("ja-JP",{style:"currency",currency:"JPY",maximumFractionDigits:0}).format(Number(n||0));
const fmtDate = (d)=> d ? new Date(d).toLocaleDateString("ja-JP") : "-";
const toYmd = (v)=>{
  if(!v) return "";
  if(typeof v === "string") return v;
  const dt = v instanceof Date ? v : new Date(v);
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,"0");
  const dd = String(dt.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
};

function escapeHtml(str){
  return (str ?? "")
    .toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function toast(msg){
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 2200);
}

/* =========================
   State
========================= */
const state = {
  user: null,
  uid: "",
  monthKey: "",

  // masters (bundled)
  masters: {
    accounts: [],
    fixedCostTypes: [],
    insuranceTypes: [],
    paymentMethods: [],
    creditCards: []
  },

  // firestore data
  entries: [],
  balances: [],
  fixedCosts: [],
  insurances: [],
  homes: [],
  homeLoans: [],
  homeEquipments: [],
  cars: [],
  events: [],

  // family (legacy + new)
  family: [],
  peoplePersons: [],
  peopleHealth: [],

  // ui
  tab: "home",
  moneySubTab: "money",
  showInactiveFamily: false
};

/* =========================
   Modal (shared)
========================= */
const modalOverlay = $("#modalOverlay");
function openModal(title, bodyHtml, footerHtml=""){
  modalOverlay.innerHTML = `
    <div class="modal">
      <div class="modalHeader">
        <strong>${escapeHtml(title)}</strong>
        <div class="spacer"></div>
        <button class="btn secondary" id="modalClose">閉じる</button>
      </div>
      <div class="modalBody">${bodyHtml}</div>
      ${footerHtml ? `<div class="modalFooter">${footerHtml}</div>` : ``}
    </div>
  `;
  modalOverlay.style.display = "flex";
  $("#modalClose").onclick = closeModal;
}
function closeModal(){
  modalOverlay.style.display = "none";
  modalOverlay.innerHTML = "";
}

/* =========================
   Auth
========================= */
onAuthStateChanged(auth, async (user)=>{
  const isLoginPage =
    location.pathname.endsWith("/login.html") ||
    location.pathname.endsWith("login.html");

  // 未ログイン
  if(!user){
    if(!isLoginPage) location.href = "login.html";
    return;
  }

  // ログイン済みで login.html にいる場合
  if(isLoginPage){
    location.href = "index.html";
    return;
  }

  state.user = user;
  state.uid = user.uid;
  await boot();
});

$("#btnLogout")?.addEventListener("click", async ()=>{
  await signOut(auth);
  location.href = "login.html";
});

/* =========================
   Boot
========================= */
async function boot(){
  // month key: YYYY-MM (from URL or today)
  const urlMonth = new URLSearchParams(location.search).get("m");
  const now = new Date();
  const mk = urlMonth || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  state.monthKey = mk;

  const ml = $("#monthLabel");
　　if(ml) ml.textContent = mk;

  await loadMasters();
  await reloadAll();
  bindTabs();
}

/* =========================
   Masters (bundle json)
========================= */
async function loadJson(path){
  const res = await fetch(path, { cache:"no-store" });
  if(!res.ok) throw new Error(`failed ${path}`);
  return await res.json();
}
async function loadMasters(){
  // master.json must exist in /data/
  const master = await loadJson("./data/master.json");
  // normalize
  state.masters.accounts = master.accounts || [];
  state.masters.fixedCostTypes = master.fixedCostTypes || [];
  state.masters.insuranceTypes = master.insuranceTypes || [];
  state.masters.paymentMethods = master.paymentMethods || [];
  state.masters.creditCards = master.creditCards || [];
}

/* =========================
   Firestore loads
========================= */
async function reloadAll(){
  await Promise.all([
    loadEntries(),
    loadBalances(),
    loadFixedCosts(),
    loadInsurances(),
    loadHomes(),
    loadHomeLoans(),
    loadHomeEquipments(),
    loadCars(),
    loadEvents(),
    loadLegacyFamily(),
    loadPeoplePersons(),
    loadPeopleHealth()
  ]);
  mount();
}

async function loadEntries(){
  state.entries = [];
  const snaps = await getDocs(query(collection(db,"months",state.monthKey,"entries"), orderBy("createdAt","desc")));
  snaps.forEach(s=> state.entries.push({id:s.id, ...s.data()}));
}

async function loadBalances(){
  state.balances = [];
  const snaps = await getDocs(collection(db,"months",state.monthKey,"balances"));
  snaps.forEach(s=> state.balances.push({id:s.id, ...s.data()}));
}

async function loadFixedCosts(){
  state.fixedCosts = [];
  const snaps = await getDocs(collection(db,"fixedCosts"));
  snaps.forEach(s=> state.fixedCosts.push({id:s.id, ...s.data()}));
}

async function loadInsurances(){
  state.insurances = [];
  const snaps = await getDocs(collection(db,"insurances"));
  snaps.forEach(s=> state.insurances.push({id:s.id, ...s.data()}));
}

async function loadHomes(){
  state.homes = [];
  const snaps = await getDocs(collection(db,"homes"));
  snaps.forEach(s=> state.homes.push({id:s.id, ...s.data()}));
}

async function loadHomeLoans(){
  state.homeLoans = [];
  const snaps = await getDocs(collection(db,"homeLoans"));
  snaps.forEach(s=> state.homeLoans.push({id:s.id, ...s.data()}));
}

async function loadHomeEquipments(){
  state.homeEquipments = [];
  const snaps = await getDocs(collection(db,"homeEquipments"));
  snaps.forEach(s=> state.homeEquipments.push({id:s.id, ...s.data()}));
}

async function loadCars(){
  state.cars = [];
  const snaps = await getDocs(collection(db,"cars"));
  snaps.forEach(s=> state.cars.push({id:s.id, ...s.data()}));
}

async function loadEvents(){
  state.events = [];
  const snaps = await getDocs(query(collection(db,"events"), orderBy("date","asc")));
  snaps.forEach(s=> state.events.push({id:s.id, ...s.data()}));
}

// legacy family (compat)
async function loadLegacyFamily(){
  state.family = [];
  const snaps = await getDocs(collection(db,"family"));
  snaps.forEach(s=> state.family.push({id:s.id, ...s.data()}));
}

// new people_persons
async function loadPeoplePersons(){
  state.peoplePersons = [];
  const snaps = await getDocs(collection(db,"people_persons"));
  snaps.forEach(s=> state.peoplePersons.push({id:s.id, ...s.data()}));
}

// new people_health
async function loadPeopleHealth(){
  state.peopleHealth = [];
  const snaps = await getDocs(collection(db,"people_health"));
  snaps.forEach(s=> state.peopleHealth.push({id:s.id, ...s.data()}));
}
/* =========================
   Tabs
========================= */
function bindTabs(){
  $$("[data-tab]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      state.tab = btn.dataset.tab;
      $$("[data-tab]").forEach(b=> b.classList.toggle("active", b.dataset.tab===state.tab));
      mount();
    });
  });

  // money subtabs
  $$("[data-money-tab]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      state.moneySubTab = btn.dataset.moneyTab;
      $$("[data-money-tab]").forEach(b=> b.classList.toggle("active", b.dataset.moneyTab===state.moneySubTab));
      mount();
    });
  });
}

/* =========================
   Mount
========================= */
function mount(){
  $("#tab_home").style.display = (state.tab==="home") ? "" : "none";
  $("#tab_money").style.display = (state.tab==="money") ? "" : "none";
  $("#tab_insurance").style.display = (state.tab==="insurance") ? "" : "none";
  $("#tab_family").style.display = (state.tab==="family") ? "" : "none";
  $("#tab_house").style.display = (state.tab==="house") ? "" : "none";
  $("#tab_car").style.display = (state.tab==="car") ? "" : "none";
  $("#tab_events").style.display = (state.tab==="events") ? "" : "none";
  $("#tab_settings").style.display = (state.tab==="settings") ? "" : "none";

  renderHome();
  renderMoney();
  renderInsurance();
  renderFamily();
  renderHouse();
  renderCar();
  renderEvents();
  renderSettings();

  bindPageActions();
}

/* =========================
   Home
========================= */
function renderHome(){
  const el = $("#homeContent");
  if(!el) return;

  // simple dashboard counts
  const cIns = state.insurances.length;
  const cFam = (state.peoplePersons.length || state.family.length);
  const cCar = state.cars.length;
  const cHome = state.homes.length;

  el.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="t">保険</div><div class="v">${cIns}</div></div>
      <div class="kpi"><div class="t">家族</div><div class="v">${cFam}</div></div>
      <div class="kpi"><div class="t">車</div><div class="v">${cCar}</div></div>
      <div class="kpi"><div class="t">住宅</div><div class="v">${cHome}</div></div>
    </div>
  `;
}

/* =========================
   Money (subtabs)
========================= */
function renderMoney(){
  const wrap = $("#moneyContent");
  if(!wrap) return;

  // show sub panels
  $("#moneySub_money").style.display = (state.moneySubTab==="money") ? "" : "none";
  $("#moneySub_accounts").style.display = (state.moneySubTab==="accounts") ? "" : "none";
  $("#moneySub_fixed").style.display = (state.moneySubTab==="fixed") ? "" : "none";
  $("#moneySub_cards").style.display = (state.moneySubTab==="cards") ? "" : "none";

  renderMoneyEntries();
  renderAccounts();
  renderFixedCosts();
  renderCards();
}

function renderMoneyEntries(){
  const el = $("#moneyEntries");
  if(!el) return;

  const rows = state.entries.map(e=>`
    <tr>
      <td>${escapeHtml(e.type||"-")}</td>
      <td>${escapeHtml(e.name||"-")}</td>
      <td>${fmtJPY(e.amount||0)}</td>
      <td>${escapeHtml(e.fromAccountName||"-")}${e.toAccountName ? ` → ${escapeHtml(e.toAccountName)}` : ""}</td>
      <td>${escapeHtml(e.memo||"")}</td>
      <td><button class="btn secondary" data-edit-entry="${e.id}">編集</button></td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div class="row" style="margin-bottom:10px;">
      <h2 style="margin:0;">入出金</h2>
      <div class="spacer"></div>
      <button class="btn" id="btnAddEntry">＋追加</button>
    </div>

    <div class="tableWrap">
      <table class="table">
        <thead>
          <tr>
            <th>種別</th>
            <th>内容</th>
            <th>金額</th>
            <th>口座</th>
            <th>メモ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6"><small>データなし</small></td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderAccounts(){
  const el = $("#accountsContent");
  if(!el) return;

  // compute balances snapshot + delta entries
  const base = new Map();
  state.masters.accounts.forEach(a=> base.set(a.id, Number(a.balance||0)));

  // apply monthly balances snapshot if exists
  state.balances.forEach(b=>{
    base.set(b.id, Number(b.amount||0));
  });

  // apply entries delta
  state.entries.forEach(e=>{
    const amt = Number(e.amount||0);
    if(e.type==="income" && e.toAccountId){
      base.set(e.toAccountId, (base.get(e.toAccountId)||0) + amt);
    }
    if(e.type==="expense" && e.fromAccountId){
      base.set(e.fromAccountId, (base.get(e.fromAccountId)||0) - amt);
    }
    if(e.type==="transfer"){
      if(e.fromAccountId) base.set(e.fromAccountId, (base.get(e.fromAccountId)||0) - amt);
      if(e.toAccountId) base.set(e.toAccountId, (base.get(e.toAccountId)||0) + amt);
    }
  });

  const rows = state.masters.accounts.map(a=>{
    const v = base.get(a.id) || 0;
    return `
      <tr>
        <td>${escapeHtml(a.name||"-")}</td>
        <td>${escapeHtml(a.type||"-")}</td>
        <td>${fmtJPY(v)}</td>
      </tr>
    `;
  }).join("");

  el.innerHTML = `
    <div class="row" style="margin-bottom:10px;">
      <h2 style="margin:0;">口座管理</h2>
      <div class="spacer"></div>
      <span class="badge">推定残高：当月差分反映</span>
    </div>
    <div class="tableWrap">
      <table class="table">
        <thead><tr><th>口座</th><th>種別</th><th>残高</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="3"><small>口座がありません</small></td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderFixedCosts(){
  const el = $("#fixedCostsContent");
  if(!el) return;

  const rows = state.fixedCosts.map(x=>`
    <tr>
      <td>${escapeHtml(x.name||"-")}</td>
      <td>${escapeHtml(x.type||"-")}</td>
      <td>${fmtJPY(x.amount||0)}</td>
      <td>${escapeHtml(x.nextPayDate||"-")}</td>
      <td><button class="btn secondary" data-edit-fixed="${x.id}">編集</button></td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div class="row" style="margin-bottom:10px;">
      <h2 style="margin:0;">固定費管理</h2>
      <div class="spacer"></div>
      <button class="btn" id="btnAddFixed">＋追加</button>
    </div>
    <div class="tableWrap">
      <table class="table">
        <thead><tr><th>名称</th><th>種別</th><th>金額</th><th>次回支払日</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5"><small>データなし</small></td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderCards(){
  const el = $("#cardsContent");
  if(!el) return;

  const rows = state.creditCards.map(x=>`
    <tr>
      <td>${escapeHtml(x.name||"-")}</td>
      <td>${escapeHtml(x.brand||"-")}</td>
      <td>${escapeHtml(x.last4||"-")}</td>
      <td>${escapeHtml(x.memo||"")}</td>
      <td><button class="btn secondary" data-edit-card="${x.id}">編集</button></td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div class="row" style="margin-bottom:10px;">
      <h2 style="margin:0;">クレカ情報</h2>
      <div class="spacer"></div>
      <button class="btn" id="btnAddCard">＋追加</button>
    </div>
    <div class="tableWrap">
      <table class="table">
        <thead><tr><th>名称</th><th>ブランド</th><th>下4桁</th><th>メモ</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5"><small>データなし</small></td></tr>`}</tbody>
      </table>
    </div>
  `;
}

/* =========================
   House
========================= */
function renderHouse(){
  const el = $("#houseContent");
  if(!el) return;

  const rowsHomes = state.homes.map(h=>`
    <tr>
      <td>${escapeHtml(h.name||"-")}</td>
      <td>${escapeHtml(h.address||"-")}</td>
      <td>${escapeHtml(h.acquiredDate||"-")}</td>
      <td>${h.docsUrl ? `<a href="${escapeHtml(h.docsUrl)}" target="_blank">PDF</a>` : "-"}</td>
      <td><button class="btn secondary" data-edit-home="${h.id}">編集</button></td>
    </tr>
  `).join("");

  const rowsLoans = state.homeLoans.map(l=>`
    <tr>
      <td>${escapeHtml(l.loanName||"-")}</td>
      <td>${escapeHtml(l.bank||"-")}</td>
      <td>${fmtJPY(l.balance||0)}</td>
      <td>${escapeHtml(l.interest||"-")}</td>
      <td>${escapeHtml(l.monthlyPaymentFixedCostId||"-")}</td>
      <td><button class="btn secondary" data-edit-loan="${l.id}">編集</button></td>
    </tr>
  `).join("");

  const rowsEq = state.homeEquipments.map(eq=>`
    <tr>
      <td>
        <button class="btn secondary" data-eq-pop="${eq.id}">${escapeHtml(eq.name||"-")}</button>
      </td>
      <td>${escapeHtml(eq.category||"-")}</td>
      <td>${escapeHtml(eq.homeId||"-")}</td>
      <td>${escapeHtml(eq.installDate||"-")}</td>
      <td>${escapeHtml(eq.lifeYears||"-")}</td>
      <td>${escapeHtml(eq.renewYear||"-")}</td>
      <td>${escapeHtml(eq.warrantyUntil||"-")}</td>
      <td><button class="btn secondary" data-edit-eq="${eq.id}">編集</button></td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div class="card">
      <div class="row" style="margin-bottom:10px;">
        <h2 style="margin:0;">住宅 基本情報</h2>
        <div class="spacer"></div>
        <button class="btn" id="btnAddHome">＋追加</button>
      </div>
      <div class="tableWrap">
        <table class="table">
          <thead><tr><th>住宅名</th><th>所在地</th><th>取得日</th><th>重要書類</th><th></th></tr></thead>
          <tbody>${rowsHomes || `<tr><td colspan="5"><small>データなし</small></td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <div class="hr"></div>

    <div class="card">
      <div class="row" style="margin-bottom:10px;">
        <h2 style="margin:0;">ローン</h2>
        <div class="spacer"></div>
        <button class="btn" id="btnAddLoan">＋追加</button>
      </div>
      <div class="tableWrap">
        <table class="table">
          <thead><tr><th>ローン名</th><th>金融機関</th><th>残高</th><th>金利</th><th>月額返済(固定費ID)</th><th></th></tr></thead>
          <tbody>${rowsLoans || `<tr><td colspan="6"><small>データなし</small></td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <div class="hr"></div>

    <div class="card">
      <div class="row" style="margin-bottom:10px;">
        <h2 style="margin:0;">設備</h2>
        <div class="spacer"></div>
        <button class="btn" id="btnAddEq">＋追加</button>
      </div>
      <div class="tableWrap">
        <table class="table">
          <thead>
            <tr>
              <th>設備名</th>
              <th>種類</th>
              <th>対象住宅</th>
              <th>設置日</th>
              <th>耐用年数</th>
              <th>想定更新年</th>
              <th>保証期限</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rowsEq || `<tr><td colspan="8"><small>データなし</small></td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}/* =========================
   Family
========================= */
function renderFamily(){
  const el = $("#familyContent");
  if(!el) return;

  const usePeople = state.peoplePersons.length > 0;
  const list = usePeople ? state.peoplePersons : state.family;

  const rows = list
    .filter(p => state.showInactiveFamily ? true : p.active !== false)
    .map(p=>{
      const health = state.peopleHealth.find(h=>h.person_id === p.id);
      return `
        <tr>
          <td>${escapeHtml(p.name || "-")}</td>
          <td>${escapeHtml(p.relation || "-")}</td>
          <td>${escapeHtml(p.birth_date || "-")}</td>
          <td>${p.is_living_with === false ? "別居" : "同居"}</td>
          <td>
            <button class="btn secondary" data-edit-person="${p.id}">編集</button>
            ${usePeople ? `<button class="btn secondary" data-edit-health="${p.id}">健康</button>` : ``}
          </td>
        </tr>
      `;
    }).join("");

  el.innerHTML = `
    <div class="row" style="margin-bottom:10px;">
      <h2 style="margin:0;">家族</h2>
      <div class="spacer"></div>
      <label class="pill">
        <input type="checkbox" id="toggleInactiveFamily" ${state.showInactiveFamily?"checked":""}>
        非表示含める
      </label>
      <button class="btn" id="btnAddFamily">＋追加</button>
    </div>

    <div class="tableWrap">
      <table class="table">
        <thead>
          <tr>
            <th>名前</th>
            <th>続柄</th>
            <th>誕生日</th>
            <th>同居</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="5"><small>データなし</small></td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  $("#btnAddFamily").onclick = ()=>{
    if(usePeople){
      openPersonModal("add");
    }else{
      openLegacyFamilyModal("add");
    }
  };

  $("#toggleInactiveFamily").onchange = (e)=>{
    state.showInactiveFamily = e.target.checked;
    renderFamily();
  };
}

/* =========================
   Family modals
========================= */
function openPersonModal(mode, v=null){
  const d = v || {};
  openModal(
    mode==="add" ? "家族 追加" : "家族 編集",
    `
    <div class="grid cols2">
      <div>
        <label>名前</label>
        <input id="p_name" class="input" value="${escapeHtml(d.name||"")}">
      </div>
      <div>
        <label>ふりがな</label>
        <input id="p_kana" class="input" value="${escapeHtml(d.name_kana||"")}">
      </div>
      <div>
        <label>続柄</label>
        <select id="p_relation" class="input">
          ${["self","spouse","child","other"].map(r=>`
            <option value="${r}" ${d.relation===r?"selected":""}>${r}</option>
          `).join("")}
        </select>
      </div>
      <div>
        <label>誕生日</label>
        <input id="p_birth" type="date" class="input" value="${d.birth_date||""}">
      </div>
      <div>
        <label>同居</label>
        <select id="p_live" class="input">
          <option value="true" ${d.is_living_with!==false?"selected":""}>同居</option>
          <option value="false" ${d.is_living_with===false?"selected":""}>別居</option>
        </select>
      </div>
      <div>
        <label>電話</label>
        <input id="p_phone" class="input" value="${escapeHtml(d.phone_number||"")}">
      </div>
      <div>
        <label>メール</label>
        <input id="p_email" class="input" value="${escapeHtml(d.email||"")}">
      </div>
      <div class="grid-span">
        <label>メモ</label>
        <textarea id="p_notes" class="input">${escapeHtml(d.notes||"")}</textarea>
      </div>
    </div>
    `,
    `<button class="btn" id="savePerson">保存</button>`
  );

  $("#savePerson").onclick = async ()=>{
    const payload = {
      name: $("#p_name").value.trim(),
      name_kana: $("#p_kana").value.trim(),
      relation: $("#p_relation").value,
      birth_date: $("#p_birth").value,
      is_living_with: $("#p_live").value === "true",
      phone_number: $("#p_phone").value.trim(),
      email: $("#p_email").value.trim(),
      notes: $("#p_notes").value.trim(),
      active: true
    };
    if(!payload.name){ alert("名前は必須"); return; }

    if(mode==="add"){
      const ref = await addDoc(collection(db,"people_persons"), payload);
      // create empty health doc
      await setDoc(doc(db,"people_health", ref.id), {
        person_id: ref.id
      });
    }else{
      await updateDoc(doc(db,"people_persons", d.id), payload);
    }
    closeModal();
    reloadAll();
  };
}

/* =========================
   Health modal
========================= */
function openHealthModal(personId){
  const person = state.peoplePersons.find(p=>p.id===personId);
  const h = state.peopleHealth.find(x=>x.person_id===personId) || {};

  openModal(
    `健康情報：${escapeHtml(person?.name||"")}`,
    `
    <div class="grid cols2">
      <div><label>血液型</label><input id="h_blood" class="input" value="${escapeHtml(h.blood_type||"")}"></div>
      <div><label>身長(cm)</label><input id="h_height" class="input" value="${escapeHtml(h.height||"")}"></div>
      <div><label>体重(kg)</label><input id="h_weight" class="input" value="${escapeHtml(h.weight||"")}"></div>
      <div><label>最終健診日</label><input id="h_check" type="date" class="input" value="${h.last_checkup||""}"></div>
      <div class="grid-span"><label>アレルギー</label><textarea id="h_allergy" class="input">${escapeHtml(h.allergies||"")}</textarea></div>
      <div class="grid-span"><label>持病</label><textarea id="h_chronic" class="input">${escapeHtml(h.chronic_diseases||"")}</textarea></div>
      <div class="grid-span"><label>常用薬</label><textarea id="h_med" class="input">${escapeHtml(h.regular_medicine||"")}</textarea></div>
      <div><label>病院</label><input id="h_hospital" class="input" value="${escapeHtml(h.hospital_name||"")}"></div>
      <div><label>定期通院</label><input id="h_visit" class="input" value="${escapeHtml(h.regular_visit_plan||"")}"></div>
      <div class="grid-span"><label>通院・手術歴</label><textarea id="h_history" class="input">${escapeHtml(h.medical_history||"")}</textarea></div>
      <div class="grid-span"><label>ワクチン履歴</label><textarea id="h_vaccine" class="input">${escapeHtml(h.vaccination_history||"")}</textarea></div>
      <div class="grid-span"><label>メモ</label><textarea id="h_notes" class="input">${escapeHtml(h.notes||"")}</textarea></div>
    </div>
    `,
    `<button class="btn" id="saveHealth">保存</button>`
  );

  $("#saveHealth").onclick = async ()=>{
    const payload = {
      person_id: personId,
      blood_type: $("#h_blood").value.trim(),
      height: $("#h_height").value.trim(),
      weight: $("#h_weight").value.trim(),
      allergies: $("#h_allergy").value.trim(),
      chronic_diseases: $("#h_chronic").value.trim(),
      regular_medicine: $("#h_med").value.trim(),
      hospital_name: $("#h_hospital").value.trim(),
      last_checkup: $("#h_check").value,
      regular_visit_plan: $("#h_visit").value.trim(),
      medical_history: $("#h_history").value.trim(),
      vaccination_history: $("#h_vaccine").value.trim(),
      notes: $("#h_notes").value.trim()
    };

    const ref = doc(db,"people_health", personId);
    await setDoc(ref, payload, { merge:true });
    closeModal();
    reloadAll();
  };
}

/* =========================
   Bind page actions
========================= */
function bindPageActions(){
  // family
  $$("[data-edit-person]").forEach(b=>{
    b.onclick = ()=>{
      const id = b.dataset.editPerson;
      openPersonModal("edit", state.peoplePersons.find(p=>p.id===id));
    };
  });
  $$("[data-edit-health]").forEach(b=>{
    b.onclick = ()=> openHealthModal(b.dataset.editHealth);
  });
}/* =========================
   Insurance
========================= */
function renderInsurance(){
  const el = $("#insuranceContent");
  if(!el) return;

  const rows = state.insurances.map(x=>{
    const cardName = state.creditCards.find(c=>c.id===x.payCardId)?.name || "-";
    return `
      <tr>
        <td>${escapeHtml(x.name||"-")}</td>
        <td>${escapeHtml(x.insuredPerson||"-")}</td>
        <td>${escapeHtml(x.type||"-")}</td>
        <td>${escapeHtml(x.company||"-")}</td>
        <td>${escapeHtml(x.contractNo||"-")}</td>
        <td>${escapeHtml(x.payMethod||"-")}</td>
        <td>${escapeHtml(cardName)}</td>
        <td>${fmtJPY(x.amount||0)}</td>
        <td>${escapeHtml(x.startDate||"-")}</td>
        <td>${escapeHtml(x.renewDate||"-")}</td>
        <td>${x.pdfUrl ? `<a href="${escapeHtml(x.pdfUrl)}" target="_blank">PDF</a>` : "-"}</td>
        <td><button class="btn secondary" data-edit-ins="${x.id}">編集</button></td>
      </tr>
    `;
  }).join("");

  el.innerHTML = `
    <div class="row" style="margin-bottom:10px;">
      <h2 style="margin:0;">保険</h2>
      <div class="spacer"></div>
      <button class="btn" id="btnAddIns">＋追加</button>
    </div>

    <div class="tableWrap">
      <table class="table">
        <thead>
          <tr>
            <th>保険名</th><th>被保険者</th><th>種別</th><th>会社</th><th>契約番号</th>
            <th>支払方法</th><th>支払カード</th><th>金額</th>
            <th>開始日</th><th>更新日</th><th>PDF</th><th></th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="12"><small>データなし</small></td></tr>`}</tbody>
      </table>
    </div>
  `;

  $("#btnAddIns").onclick = ()=> openInsuranceModal("add");
}

function openInsuranceModal(mode, v=null){
  const d = v || {};
  const cardOptions = [`<option value="">-</option>`]
    .concat(state.creditCards.map(c=>`<option value="${c.id}" ${d.payCardId===c.id?"selected":""}>${escapeHtml(c.name||c.id)}</option>`))
    .join("");

  openModal(
    mode==="add" ? "保険 追加" : "保険 編集",
    `
    <div class="grid cols2">
      <div><label>保険名</label><input id="ins_name" class="input" value="${escapeHtml(d.name||"")}"></div>
      <div><label>被保険者</label><input id="ins_person" class="input" value="${escapeHtml(d.insuredPerson||"")}"></div>

      <div><label>保険種別</label><input id="ins_type" class="input" value="${escapeHtml(d.type||"")}"></div>
      <div><label>保険会社</label><input id="ins_company" class="input" value="${escapeHtml(d.company||"")}"></div>

      <div><label>契約番号</label><input id="ins_no" class="input" value="${escapeHtml(d.contractNo||"")}"></div>
      <div><label>支払方法</label><input id="ins_paymethod" class="input" value="${escapeHtml(d.payMethod||"")}"></div>

      <div><label>支払カード</label>
        <select id="ins_card" class="input">${cardOptions}</select>
      </div>
      <div><label>金額</label><input id="ins_amount" class="input" inputmode="numeric" value="${escapeHtml(d.amount||"")}"></div>

      <div><label>契約開始日</label><input id="ins_start" type="date" class="input" value="${d.startDate||""}"></div>
      <div><label>更新日</label><input id="ins_renew" type="date" class="input" value="${d.renewDate||""}"></div>

      <div class="grid-span"><label>PDFリンク（OneDrive）</label><input id="ins_pdf" class="input" value="${escapeHtml(d.pdfUrl||"")}"></div>
      <div class="grid-span"><label>GPT要約</label><textarea id="ins_sum" class="input">${escapeHtml(d.gptSummary||"")}</textarea></div>
      <div class="grid-span"><label>メモ</label><textarea id="ins_notes" class="input">${escapeHtml(d.notes||"")}</textarea></div>
    </div>
    `,
    `
      ${mode==="edit" ? `<button class="btn danger" id="delIns">削除</button>` : ``}
      <button class="btn" id="saveIns">保存</button>
    `
  );

  $("#saveIns").onclick = async ()=>{
    const payload = {
      name: $("#ins_name").value.trim(),
      insuredPerson: $("#ins_person").value.trim(),
      type: $("#ins_type").value.trim(),
      company: $("#ins_company").value.trim(),
      contractNo: $("#ins_no").value.trim(),
      payMethod: $("#ins_paymethod").value.trim(),
      payCardId: $("#ins_card").value,
      amount: Number($("#ins_amount").value || 0),
      startDate: $("#ins_start").value,
      renewDate: $("#ins_renew").value,
      pdfUrl: $("#ins_pdf").value.trim(),
      gptSummary: $("#ins_sum").value.trim(),
      notes: $("#ins_notes").value.trim()
    };
    if(!payload.name){ alert("保険名は必須"); return; }

    if(mode==="add"){
      await addDoc(collection(db,"insurances"), payload);
    }else{
      await updateDoc(doc(db,"insurances", d.id), payload);
    }
    closeModal();
    reloadAll();
  };

  $("#delIns")?.addEventListener("click", async ()=>{
    if(!confirm("削除しますか？")) return;
    await deleteDoc(doc(db,"insurances", d.id));
    closeModal();
    reloadAll();
  });
}

/* =========================
   Car
========================= */
function renderCar(){
  const el = $("#carContent");
  if(!el) return;

  const people = (state.peoplePersons.length ? state.peoplePersons : state.family);
  const personName = (id)=> people.find(p=>p.id===id)?.name || (id||"-");

  const rows = state.cars.map(x=>`
    <tr>
      <td>${escapeHtml(x.name||"-")}</td>
      <td>${escapeHtml(personName(x.ownerPersonId))}</td>
      <td>${escapeHtml(x.insuranceEventId||"-")}</td>
      <td>${escapeHtml(x.checkEventId||"-")}</td>
      <td>${x.paperPdfUrl ? `<a href="${escapeHtml(x.paperPdfUrl)}" target="_blank">PDF</a>` : "-"}</td>
      <td>${escapeHtml(x.memo||"")}</td>
      <td><button class="btn secondary" data-edit-car="${x.id}">編集</button></td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div class="row" style="margin-bottom:10px;">
      <h2 style="margin:0;">車</h2>
      <div class="spacer"></div>
      <button class="btn" id="btnAddCar">＋追加</button>
    </div>

    <div class="tableWrap">
      <table class="table">
        <thead>
          <tr>
            <th>車名</th><th>名義</th><th>任意保険(イベントID)</th><th>点検期限(イベントID)</th>
            <th>車検証PDF</th><th>メモ</th><th></th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="7"><small>データなし</small></td></tr>`}</tbody>
      </table>
    </div>
  `;

  $("#btnAddCar").onclick = ()=> openCarModal("add");
}

function openCarModal(mode, v=null){
  const d = v || {};
  const people = (state.peoplePersons.length ? state.peoplePersons : state.family);
  const ownerOptions = [`<option value="">-</option>`]
    .concat(people.map(p=>`<option value="${p.id}" ${d.ownerPersonId===p.id?"selected":""}>${escapeHtml(p.name||p.id)}</option>`))
    .join("");

  openModal(
    mode==="add" ? "車 追加" : "車 編集",
    `
    <div class="grid cols2">
      <div><label>車名</label><input id="car_name" class="input" value="${escapeHtml(d.name||"")}"></div>
      <div><label>名義（家族）</label><select id="car_owner" class="input">${ownerOptions}</select></div>

      <div><label>任意保険（イベントID）</label><input id="car_ins_event" class="input" value="${escapeHtml(d.insuranceEventId||"")}"></div>
      <div><label>点検期限（イベントID）</label><input id="car_chk_event" class="input" value="${escapeHtml(d.checkEventId||"")}"></div>

      <div class="grid-span"><label>車検証PDF（OneDrive）</label><input id="car_pdf" class="input" value="${escapeHtml(d.paperPdfUrl||"")}"></div>
      <div class="grid-span"><label>メモ</label><textarea id="car_memo" class="input">${escapeHtml(d.memo||"")}</textarea></div>
    </div>
    `,
    `
      ${mode==="edit" ? `<button class="btn danger" id="delCar">削除</button>` : ``}
      <button class="btn" id="saveCar">保存</button>
    `
  );

  $("#saveCar").onclick = async ()=>{
    const payload = {
      name: $("#car_name").value.trim(),
      ownerPersonId: $("#car_owner").value,
      insuranceEventId: $("#car_ins_event").value.trim(),
      checkEventId: $("#car_chk_event").value.trim(),
      paperPdfUrl: $("#car_pdf").value.trim(),
      memo: $("#car_memo").value.trim()
    };
    if(!payload.name){ alert("車名は必須"); return; }

    if(mode==="add"){
      await addDoc(collection(db,"cars"), payload);
    }else{
      await updateDoc(doc(db,"cars", d.id), payload);
    }
    closeModal();
    reloadAll();
  };

  $("#delCar")?.addEventListener("click", async ()=>{
    if(!confirm("削除しますか？")) return;
    await deleteDoc(doc(db,"cars", d.id));
    closeModal();
    reloadAll();
  });
}

/* =========================
   Events
========================= */
function renderEvents(){
  const el = $("#eventsContent");
  if(!el) return;

  const rows = state.events.map(ev=>`
    <tr>
      <td>${escapeHtml(ev.title||"-")}</td>
      <td>${escapeHtml(ev.date||"-")}</td>
      <td>${escapeHtml(ev.category||"-")}</td>
      <td>${escapeHtml(ev.personId||"-")}</td>
      <td>${escapeHtml(ev.memo||"")}</td>
      <td><button class="btn secondary" data-edit-ev="${ev.id}">編集</button></td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div class="row" style="margin-bottom:10px;">
      <h2 style="margin:0;">定期イベント</h2>
      <div class="spacer"></div>
      <button class="btn" id="btnAddEv">＋追加</button>
    </div>

    <div class="tableWrap">
      <table class="table">
        <thead><tr><th>予定名</th><th>日付</th><th>種別</th><th>personId</th><th>メモ</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6"><small>データなし</small></td></tr>`}</tbody>
      </table>
    </div>
  `;

  $("#btnAddEv").onclick = ()=> openEventModal("add");
}

function openEventModal(mode, v=null){
  const d = v || {};
  openModal(
    mode==="add" ? "イベント 追加" : "イベント 編集",
    `
    <div class="grid cols2">
      <div><label>予定名</label><input id="ev_title" class="input" value="${escapeHtml(d.title||"")}"></div>
      <div><label>日付</label><input id="ev_date" type="date" class="input" value="${d.date||""}"></div>
      <div><label>種別</label><input id="ev_cat" class="input" value="${escapeHtml(d.category||"")}"></div>
      <div><label>personId（任意）</label><input id="ev_pid" class="input" value="${escapeHtml(d.personId||"")}"></div>
      <div class="grid-span"><label>メモ</label><textarea id="ev_memo" class="input">${escapeHtml(d.memo||"")}</textarea></div>
    </div>
    `,
    `
      ${mode==="edit" ? `<button class="btn danger" id="delEv">削除</button>` : ``}
      <button class="btn" id="saveEv">保存</button>
    `
  );

  $("#saveEv").onclick = async ()=>{
    const payload = {
      title: $("#ev_title").value.trim(),
      date: $("#ev_date").value,
      category: $("#ev_cat").value.trim(),
      personId: $("#ev_pid").value.trim(),
      memo: $("#ev_memo").value.trim()
    };
    if(!payload.title){ alert("予定名は必須"); return; }

    if(mode==="add"){
      await addDoc(collection(db,"events"), payload);
    }else{
      await updateDoc(doc(db,"events", d.id), payload);
    }
    closeModal();
    reloadAll();
  };

  $("#delEv")?.addEventListener("click", async ()=>{
    if(!confirm("削除しますか？")) return;
    await deleteDoc(doc(db,"events", d.id));
    closeModal();
    reloadAll();
  });
}

/* =========================
   Settings
========================= */
function renderSettings(){
  const el = $("#settingsContent");
  if(!el) return;

  el.innerHTML = `
    <div class="card">
      <h2>設定</h2>
      <div class="hr"></div>
      <div class="row">
        <span class="badge">Month: ${escapeHtml(state.monthKey)}</span>
        <span class="badge">UID: ${escapeHtml(state.uid)}</span>
      </div>
      <div class="hr"></div>
      <small>※ bundle（./data/master.json）を更新するとマスタが反映されます。</small>
    </div>
  `;
}

/* =========================
   Legacy family modal (compat)
========================= */
function openLegacyFamilyModal(mode, v=null){
  const d = v || {};
  openModal(
    mode==="add" ? "家族（旧）追加" : "家族（旧）編集",
    `
    <div class="grid cols2">
      <div><label>名前</label><input id="lf_name" class="input" value="${escapeHtml(d.name||"")}"></div>
      <div><label>続柄</label><input id="lf_relation" class="input" value="${escapeHtml(d.relation||"")}"></div>
      <div><label>誕生日</label><input id="lf_birth" type="date" class="input" value="${d.birth_date||""}"></div>
      <div><label>同居</label>
        <select id="lf_live" class="input">
          <option value="true" ${d.is_living_with!==false?"selected":""}>同居</option>
          <option value="false" ${d.is_living_with===false?"selected":""}>別居</option>
        </select>
      </div>
      <div class="grid-span"><label>メモ</label><textarea id="lf_notes" class="input">${escapeHtml(d.notes||"")}</textarea></div>
    </div>
    `,
    `
      ${mode==="edit" ? `<button class="btn danger" id="delLf">削除</button>` : ``}
      <button class="btn" id="saveLf">保存</button>
    `
  );

  $("#saveLf").onclick = async ()=>{
    const payload = {
      name: $("#lf_name").value.trim(),
      relation: $("#lf_relation").value.trim(),
      birth_date: $("#lf_birth").value,
      is_living_with: $("#lf_live").value==="true",
      notes: $("#lf_notes").value.trim(),
      active: true
    };
    if(!payload.name){ alert("名前は必須"); return; }

    if(mode==="add"){
      await addDoc(collection(db,"family"), payload);
    }else{
      await updateDoc(doc(db,"family", d.id), payload);
    }
    closeModal();
    reloadAll();
  };

  $("#delLf")?.addEventListener("click", async ()=>{
    if(!confirm("削除しますか？")) return;
    await deleteDoc(doc(db,"family", d.id));
    closeModal();
    reloadAll();
  });
}

/* =========================
   Extend bind actions (insurance / car / event / equipment pop)
========================= */
function bindPageActions(){
  // family
  $$("[data-edit-person]").forEach(b=>{
    b.onclick = ()=>{
      const id = b.dataset.editPerson;
      openPersonModal("edit", state.peoplePersons.find(p=>p.id===id));
    };
  });
  $$("[data-edit-health]").forEach(b=>{
    b.onclick = ()=> openHealthModal(b.dataset.editHealth);
  });

  // insurance
  $$("[data-edit-ins]").forEach(b=>{
    b.onclick = ()=>{
      const id = b.dataset.editIns;
      openInsuranceModal("edit", state.insurances.find(x=>x.id===id));
    };
  });
  $("#btnAddIns")?.addEventListener("click", ()=> openInsuranceModal("add"));

  // car
  $$("[data-edit-car]").forEach(b=>{
    b.onclick = ()=>{
      const id = b.dataset.editCar;
      openCarModal("edit", state.cars.find(x=>x.id===id));
    };
  });
  $("#btnAddCar")?.addEventListener("click", ()=> openCarModal("add"));

  // events
  $$("[data-edit-ev]").forEach(b=>{
    b.onclick = ()=>{
      const id = b.dataset.editEv;
      openEventModal("edit", state.events.find(x=>x.id===id));
    };
  });
  $("#btnAddEv")?.addEventListener("click", ()=> openEventModal("add"));

  // equipment popover (simple)
  $$("[data-eq-pop]").forEach(b=>{
    b.onclick = ()=>{
      const id = b.dataset.eqPop;
      const eq = state.homeEquipments.find(x=>x.id===id);
      if(!eq) return;
      openModal(
        `説明書：${escapeHtml(eq.name||"")}`,
        `
          <div class="card">
            <div class="row">
              <div class="spacer"></div>
              <button class="btn secondary" id="editEqFromPop">✎ 編集</button>
            </div>
            <div class="hr"></div>
            <div>
              <div class="pill">説明書リンク</div>
              <div style="margin-top:8px;">
                ${eq.manualUrl ? `<a href="${escapeHtml(eq.manualUrl)}" target="_blank">${escapeHtml(eq.manualUrl)}</a>` : "-"}
              </div>
            </div>
          </div>
        `
      );
      $("#editEqFromPop")?.addEventListener("click", ()=>{
        closeModal();
        // 既存の設備編集がある場合はここに繋ぐ（今はデータ編集ボタンだけ先に用意）
        toast("設備編集は次の改善でつなぎます（今のままでもOK）");
      });
    };
  });

  // add buttons for house
  $("#btnAddHome")?.addEventListener("click", ()=> toast("住宅追加：次の改善でフォーム接続します"));
  $("#btnAddLoan")?.addEventListener("click", ()=> toast("ローン追加：次の改善でフォーム接続します"));
  $("#btnAddEq")?.addEventListener("click", ()=> toast("設備追加：次の改善でフォーム接続します"));
}

/* =========================
   Missing render stubs (safe)
   ※ index.html に存在しない場合も落ちないように
========================= */
function renderInsurance(){ /* overridden above if exists */ }
function renderCar(){ /* overridden above if exists */ }
function renderEvents(){ /* overridden above if exists */ }
function renderSettings(){ /* overridden above if exists */ }
