// Personal File - Vanilla SPA (no build)
// Bundle JSON (GitHub Pages) prioritized, Firestore used for monthly input + editable data.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
  query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/** =========================
 *  1) Firebase Config (EDIT ME)
 * ========================= */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBkp9ENDP_M_xXwLwqDCrk0KsRr8b4IXKM",
  authDomain: "kawaharafamilydeta.firebaseapp.com",
  projectId:"kawaharafamilydeta",
};

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

/** =========================
 *  2) State
 * ========================= */
const state = {
  user: null,
  role: null,
  master: null,
  month: null,
  bundle: null,
  entries: [],
  balances: [],
  fixedCosts: [],
  events: [],
  family: [],
  creditCards: [],
  cars: [],
  homes: [],
  insurances: [],
  homeLoans: [],
  homeEquipments: [],
  route:"home"
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function yen(n){
  const x = Number(n || 0);
  return x.toLocaleString("ja-JP");
}
function monthKey(d=new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  return `${y}-${m}`;
}
function withinDays(ms, days){
  const now = Date.now();
  const diff = ms - now;
  return diff >= 0 && diff <= days*24*60*60*1000;
}
function escapeHtml(str=""){
  return str.replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/** =========================
 *  3) Bundle fetch helpers
 * ========================= */
async function fetchJson(url){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
  return await res.json();
}
async function loadMaster(){
  // GitHub Pages / Hosting root relative
  return await fetchJson("./data/master.json");
}
async function loadBundle(month){
  // bundle is optional
  try{
    return await fetchJson(`./data/bundles/${month}.json`);
  }catch(e){
    return null;
  }
}

/** =========================
 *  4) Firestore reads
 * ========================= */
async function loadUserRole(uid){
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if(!snap.exists()) throw new Error("users/{uid} がありません。Firestoreに users ドキュメントを作成してください。");
  const d = snap.data();
  if(!d.active) throw new Error("このユーザーは active=false です。");
  return d.role || "viewer";
}

async function loadMonthData(month){
  // entries
  const entriesRef = collection(db, "months", month, "entries");
  const q1 = query(entriesRef, orderBy("occurredAt","asc"));
  const s1 = await getDocs(q1);
  state.entries = s1.docs.map(d=>({id:d.id, ...d.data()}));

  // balances
  const balancesRef = collection(db, "months", month, "balances");
  const s2 = await getDocs(balancesRef);
  state.balances = s2.docs.map(d=>({id:d.id, ...d.data()}));

  // fixedCosts / events
  const s3 = await getDocs(collection(db, "fixedCosts"));
  state.fixedCosts = s3.docs.map(d=>({id:d.id, ...d.data()}));

  const s4 = await getDocs(query(collection(db, "events"), orderBy("date","asc")));
  state.events = s4.docs.map(d=>({id:d.id, ...d.data()}));
  // family / others (for event suggestions)
  const s5 = await getDocs(query(collection(db, "family"), orderBy("name","asc")));
  state.family = s5.docs.map(d=>({id:d.id, ...d.data()}));

  const s6 = await getDocs(query(collection(db, "creditCards"), orderBy("cardName","asc")));
  state.creditCards = s6.docs.map(d=>({id:d.id, ...d.data()}));

  const s7 = await getDocs(query(collection(db, "cars"), orderBy("carName","asc")));
  state.cars = s7.docs.map(d=>({id:d.id, ...d.data()}));

  const s8 = await getDocs(query(collection(db, "homes"), orderBy("name","asc")));
  state.homes = s8.docs.map(d=>({id:d.id, ...d.data()}));

  const s9 = await getDocs(query(collection(db, "insurances"), orderBy("insuranceName","asc")));
  state.insurances = s9.docs.map(d=>({id:d.id, ...d.data()}));

  const s10 = await getDocs(query(collection(db, "homeLoans"), orderBy("loanName","asc")));
  state.homeLoans = s10.docs.map(d=>({id:d.id, ...d.data()}));

  const s11 = await getDocs(query(collection(db, "homeEquipments"), orderBy("equipmentName","asc")));
  state.homeEquipments = s11.docs.map(d=>({id:d.id, ...d.data()}));

}

/** =========================
 *  5) Merge logic (bundle + diff)
 * ========================= */
function getAllAccountsFromMaster(){
  const banks = (state.master?.banks || []).filter(x=>x.active!==false);
  const other = (state.master?.otherAccounts || []).filter(x=>x.active!==false);
  const list = [...banks, ...other];
  return list;
}

function accountName(id){
  const all = getAllAccountsFromMaster();
  const hit = all.find(a=>a.id===id);
  return hit?.name || id || "-";
}

function entryAccountLabel(e){
  if(!e) return "-";
  if(e.type==="income") return accountName(e.toAccountId||"-");
  if(e.type==="expense") return accountName(e.fromAccountId||"-");
  if(e.type==="transfer"){
    const f = accountName(e.fromAccountId||"-");
    const t = accountName(e.toAccountId||"-");
    return `${f} → ${t}`;
  }
  return "-";
}

function accountDeltasFromEntries(){
  const m = new Map();
  for(const e of (state.entries||[])){
    const amt = Number(e.amount||0);
    if(e.type==="income"){
      const to = e.toAccountId;
      if(to){ m.set(to, (m.get(to)||0) + amt); }
    }else if(e.type==="expense"){
      const from = e.fromAccountId;
      if(from){ m.set(from, (m.get(from)||0) - amt); }
    }else if(e.type==="transfer"){
      const from = e.fromAccountId;
      const to = e.toAccountId;
      if(from){ m.set(from, (m.get(from)||0) - amt); }
      if(to){ m.set(to, (m.get(to)||0) + amt); }
    }
  }
  return m;
}

function mergedBalances(){
  // base from bundle
  const base = new Map();
  const b = state.bundle?.accounts || [];
  for(const a of b){
    base.set(a.id, {
      id: a.id,
      balance: Number(a.balance||0),
      purposeBalances: a.purposeBalances || []
    });
  }
  // overlay from Firestore balances (per accountId)
  for(const s of state.balances){
    const id = s.accountId || s.id;
    base.set(id, {
      id,
      balance: Number(s.balance||0),
      purposeBalances: s.purposeBalances || []
    });
  }

  // ensure all accounts exist
  const all = getAllAccountsFromMaster();
  for(const a of all){
    if(!base.has(a.id)) base.set(a.id, {id:a.id, balance:0, purposeBalances:[]});
  }

  return [...base.values()];
}

function sumsByType(){
  let income=0, expense=0, transfer=0;
  for(const e of state.entries){
    const amt = Number(e.amount||0);
    if(e.type==="income") income += amt;
    else if(e.type==="expense") expense += amt;
    else if(e.type==="transfer") transfer += amt;
  }
  return {income, expense, transfer, net: income-expense};
}

/** =========================
 *  6) UI Rendering
 * ========================= */
function setActiveTab(route){
  $$("#tabs .tab").forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.route===route);
  });
}

function mount(){
  const view = $("#appView");
  if(state.route==="home") view.innerHTML = renderHome();
  else if(state.route==="money") view.innerHTML = renderMoney();
  else if(state.route==="insurance") view.innerHTML = renderInsurance();
  else if(state.route==="family") view.innerHTML = renderFamily();
  else if(state.route==="housing") view.innerHTML = renderHousing();
  else if(state.route==="car") view.innerHTML = renderCar();
  else if(state.route==="events") view.innerHTML = renderEvents();
  else if(state.route==="settings") view.innerHTML = renderSettings();
  else view.innerHTML = renderHome();
  wireViewEvents();
}


function renderHome(){
  const {income, expense, transfer, net} = sumsByType();
  const mb = mergedBalances();
  const accounts = getAllAccountsFromMaster();
  const nameOf = (id)=> (accounts.find(a=>a.id===id)?.name || id);

  const totalCash = mb.reduce((s,x)=> s + Number(x.balance||0), 0);
  const soon = state.events.filter(e=> e.active!==false && withinDays(Number(e.date||0), 90));

  return `
    <div class="grid cols3">
      <div class="card">
        <div class="h2">今月の収入</div>
        <div class="kpi">¥${yen(income)}</div>
        <div class="small">カテゴリ：${(state.master.incomeCategories||[]).length}件</div>
      </div>
      <div class="card">
        <div class="h2">今月の支出</div>
        <div class="kpi">¥${yen(expense)}</div>
        <div class="small">カテゴリ：${(state.master.expenseCategories||[]).length}件</div>
      </div>
      <div class="card">
        <div class="h2">今月の収支</div>
        <div class="kpi">¥${yen(net)}</div>
        <div class="small">資金移動：¥${yen(transfer)}</div>
      </div>
    </div>

    <div class="grid cols2" style="margin-top:12px;">
      <div class="card">
        <div class="row">
          <h2 class="h1">口座合計（入力/差分反映後）</h2>
          <div class="spacer"></div>
          <span class="badge">合計 ¥${yen(totalCash)}</span>
        </div>
        <div class="sep"></div>
        <table class="table">
          <thead><tr><th>口座</th><th class="right">残高</th></tr></thead>
          <tbody>
            ${mb.map(a=>`
              <tr>
                <td>${escapeHtml(nameOf(a.id))}${a.id==="sbi_net" ? "（目的別あり）":""}</td>
                <td class="right">¥${yen(a.balance)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="small" style="margin-top:10px;">※表示は bundle（あれば）→ Firestore月末入力で上書き</div>
      </div>

      <div class="card">
        <div class="row">
          <h2 class="h1">90日以内の期限</h2>
          <div class="spacer"></div>
          <span class="badge">${soon.length}件</span>
          <button class="btn secondary" data-go="events">定期イベントへ</button>
        </div>
        <div class="sep"></div>
        ${soon.length===0 ? `<div class="small">期限90日以内のイベントはありません。</div>` : `
          <table class="table">
            <thead><tr><th>日付</th><th>タイトル</th><th>種別</th></tr></thead>
            <tbody>
              ${soon.slice(0,8).map(e=>`
                <tr>
                  <td>${new Date(Number(e.date||0)).toLocaleDateString("ja-JP")}</td>
                  <td>${escapeHtml(e.title||"")}</td>
                  <td>${escapeHtml(e.kind||"")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
        <div class="small" style="margin-top:10px;">※家族/カード/住宅/車/カスタムをここで一括管理</div>
      </div>
    </div>
  `;
}


function renderFamily(){
  const list = (state.family||[]);
  const showInactive = !!state._showInactiveFamily;
  const rows = list
    .filter(x=> showInactive ? true : (x.active!==false))
    .map(x=>{
      const bd = x.birthDate ? escapeHtml(x.birthDate) : "-";
      const rel = x.relation ? escapeHtml(x.relation) : "-";
      const memo = x.memo ? escapeHtml(x.memo) : "";
      const inactive = (x.active===false);
      return `
        <tr class="${inactive?'dim':''}">
          <td>${escapeHtml(x.name||"")}${inactive?` <span class="pill">無効</span>`:""}</td>
          <td>${rel}</td>
          <td>${bd}</td>
          <td class="muted">${memo}</td>
          <td class="right">
            <button class="btn mini" data-edit-family="${x.id}">編集</button>
            <button class="btn mini danger" data-del-family="${x.id}">削除</button>
          </td>
        </tr>
      `;
    }).join("");

  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">家族</h2>
        <div class="spacer"></div>
        <label class="chip">
          <input id="toggleFamilyInactive" type="checkbox" ${showInactive?"checked":""}/>
          <span>無効も表示</span>
        </label>
        <button class="btn" id="btnAddFamily">＋追加</button>
      </div>
      <div class="sep"></div>

      <div class="tableWrap">
        <table class="table">
          <thead>
            <tr>
              <th>名前</th>
              <th>続柄</th>
              <th>生年月日</th>
              <th>メモ</th>
              <th class="right">操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="5" class="muted">まだありません。</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="muted small" style="margin-top:10px;">
        ・家族の誕生日などは「定期イベント（90日以内）」に自動で拾います（実装済み/準備中）。
      </div>
    </div>
  `;
}



function renderCar(){
  const list = (state.cars||[]).slice().sort((a,b)=> (a.carName||"").localeCompare(b.carName||""));
  const owners = (state.family||[]).filter(f=>f.active!==false);
  const ownerName = (id)=> owners.find(o=>o.id===id)?.name || id || "-";

  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">車</h2>
        <div class="spacer"></div>
        <button class="btn" id="btnAddCar">＋追加</button>
      </div>
      <div class="sep"></div>
      <div class="tableWrap">
        <table class="table">
          <thead>
            <tr>
              <th>車名</th>
              <th>名義</th>
              <th>任意保険</th>
              <th>点検期限</th>
              <th>車検証PDF</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${list.length===0 ? `<tr><td colspan="6" class="small">まだありません。</td></tr>` : list.map(c=>`
              <tr>
                <td>${escapeHtml(c.carName||"")}</td>
                <td>${escapeHtml(ownerName(c.ownerId))}</td>
                <td>${escapeHtml(c.voluntaryInsuranceEventId ? (state.events.find(e=>e.id===c.voluntaryInsuranceEventId)?.title||"") : (c.voluntaryInsurance||"-"))}</td>
                <td>${escapeHtml(c.inspectionEventId ? (state.events.find(e=>e.id===c.inspectionEventId)?.title||"") : "-")}</td>
                <td>${c.registrationPdfLink ? `<a href="${escapeHtml(c.registrationPdfLink)}" target="_blank" rel="noopener">PDF</a>` : "-"}</td>
                <td class="right">
                  <button class="btn secondary" data-edit-car="${c.id}">編集</button>
                  <button class="btn danger" data-del-car="${c.id}">削除</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="sep"></div>
      <div class="small">・任意保険/点検期限は「定期イベント」からリンクできます（車側で保存します）。</div>
    </div>
  `;
}



function renderHousing(){
  const section = state._housingSection || "home";
  const tabs = [
    {key:"home", label:"基本情報"},
    {key:"loan", label:"ローン"},
    {key:"equip", label:"設備"},
  ];
  const body = section==="home" ? renderHomes() : (section==="loan" ? renderHomeLoans() : renderHomeEquipments());
  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">住宅</h2>
        <div class="spacer"></div>
        <span class="badge">${escapeHtml(state.month||"")}</span>
      </div>
      <div class="sep"></div>
      <div class="tabs">
        ${tabs.map(t=>`<button class="tab ${t.key===section?"active":""}" data-housingsection="${t.key}">${t.label}</button>`).join("")}
      </div>
    </div>
    <div style="margin-top:12px;">${body}</div>
  `;
}



function renderInsurance(){
  const list = (state.insurances||[]).slice().sort((a,b)=> (a.insuranceName||"").localeCompare(b.insuranceName||""));
  const pay = state.master.paymentMethods || [];
  const cards = state.creditCards || [];

  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">保険</h2>
        <div class="spacer"></div>
        <button class="btn" id="btnAddInsurance">＋追加</button>
      </div>
      <div class="sep"></div>
      <div class="tableWrap">
        <table class="table">
          <thead>
            <tr>
              <th>保険名</th>
              <th>被保険者</th>
              <th>保険種別</th>
              <th>保険会社</th>
              <th>支払方法</th>
              <th>支払カード</th>
              <th class="right">金額</th>
              <th>更新日</th>
              <th>PDF</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${list.length===0 ? `<tr><td colspan="10" class="small">まだありません。</td></tr>` : list.map(x=>{
              const cardName = cards.find(c=>c.id===x.paymentCardId)?.cardName || "-";
              return `
                <tr>
                  <td>${escapeHtml(x.insuranceName||"")}</td>
                  <td>${escapeHtml(x.insuredPerson||"")}</td>
                  <td>${escapeHtml(x.insuranceType||"")}</td>
                  <td>${escapeHtml(x.company||"")}</td>
                  <td>${escapeHtml(x.paymentMethod||"")}</td>
                  <td>${escapeHtml(cardName)}</td>
                  <td class="right">¥${yen(x.amount||0)}</td>
                  <td>${x.renewalDate ? new Date(Number(x.renewalDate)).toLocaleDateString("ja-JP") : "-"}</td>
                  <td>${x.pdfLink ? `<a href="${escapeHtml(x.pdfLink)}" target="_blank" rel="noopener">PDF</a>` : "-"}</td>
                  <td class="right">
                    <button class="btn secondary" data-edit-insurance="${x.id}">編集</button>
                    <button class="btn danger" data-del-insurance="${x.id}">削除</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="sep"></div>
      <div class="small">
        ・金額/更新日は「固定費管理」にも反映できます（保険編集でリンクON）。<br/>
        ・GPT要約は現状は手入力（次の段階で生成ボタンを追加できます）。
      </div>
    </div>
  `;
}

function renderHomes(){
  const list = (state.homes||[]).slice().sort((a,b)=> (a.name||"").localeCompare(b.name||""));
  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">住宅 基本情報</h2>
        <div class="spacer"></div>
        <button class="btn" id="btnAddHome">＋追加</button>
      </div>
      <div class="sep"></div>
      <div class="tableWrap">
        <table class="table">
          <thead>
            <tr>
              <th>住宅名</th>
              <th>所在地</th>
              <th>取得日</th>
              <th>重要書類</th>
              <th>メモ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${list.length===0 ? `<tr><td colspan="6" class="small">まだありません。</td></tr>` : list.map(h=>`
              <tr>
                <td>${escapeHtml(h.name||"")}</td>
                <td>${escapeHtml(h.location||"")}</td>
                <td>${h.acquiredDate ? new Date(Number(h.acquiredDate)).toLocaleDateString("ja-JP") : "-"}</td>
                <td>${h.docsLink ? `<a href="${escapeHtml(h.docsLink)}" target="_blank" rel="noopener">PDF</a>` : "-"}</td>
                <td>${escapeHtml(h.memo||"")}</td>
                <td class="right">
                  <button class="btn secondary" data-edit-home="${h.id}">編集</button>
                  <button class="btn danger" data-del-home="${h.id}">削除</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="sep"></div>
      <div class="small">・住宅に紐づくローン/設備は、このタブ内の「ローン」「設備」で管理します。</div>
    </div>
  `;
}

function renderHomeLoans(){
  const homes = state.homes||[];
  const homeName = (id)=> homes.find(h=>h.id===id)?.name || id || "-";
  const fixed = state.fixedCosts||[];
  const fixedName = (id)=> fixed.find(f=>f.id===id)?.name || id || "-";
  const list = (state.homeLoans||[]).slice().sort((a,b)=> (a.loanName||"").localeCompare(b.loanName||""));
  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">ローン</h2>
        <div class="spacer"></div>
        <button class="btn" id="btnAddLoan">＋追加</button>
      </div>
      <div class="sep"></div>
      <div class="tableWrap">
        <table class="table">
          <thead>
            <tr>
              <th>ローン名</th>
              <th>対象住宅</th>
              <th>金融機関</th>
              <th class="right">残高</th>
              <th>金利</th>
              <th>月額返済（固定費）</th>
              <th>完済予定日</th>
              <th>減税終了日</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${list.length===0 ? `<tr><td colspan="9" class="small">まだありません。</td></tr>` : list.map(l=>`
              <tr>
                <td>${escapeHtml(l.loanName||"")}</td>
                <td>${escapeHtml(homeName(l.homeId))}</td>
                <td>${escapeHtml(l.bank||"")}</td>
                <td class="right">¥${yen(l.balance||0)}</td>
                <td>${escapeHtml(l.interestRate||"")}</td>
                <td>${l.fixedCostId ? escapeHtml(fixedName(l.fixedCostId)) : "-"}</td>
                <td>${l.finishDate ? new Date(Number(l.finishDate)).toLocaleDateString("ja-JP") : "-"}</td>
                <td>${l.taxDeductionEndDate ? new Date(Number(l.taxDeductionEndDate)).toLocaleDateString("ja-JP") : "-"}</td>
                <td class="right">
                  <button class="btn secondary" data-edit-loan="${l.id}">編集</button>
                  <button class="btn danger" data-del-loan="${l.id}">削除</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="sep"></div>
      <div class="small">・月額返済は固定費管理の項目とリンクできます。・完済予定日/減税終了日は定期イベント候補に拾います。</div>
    </div>
  `;
}

function renderHomeEquipments(){
  const homes = state.homes||[];
  const homeName = (id)=> homes.find(h=>h.id===id)?.name || id || "-";
  const list = (state.homeEquipments||[]).slice().sort((a,b)=> (a.equipmentName||"").localeCompare(b.equipmentName||""));
  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">設備</h2>
        <div class="spacer"></div>
        <button class="btn" id="btnAddEquip">＋追加</button>
      </div>
      <div class="sep"></div>
      <div class="tableWrap">
        <table class="table">
          <thead>
            <tr>
              <th>設備名</th>
              <th>種類</th>
              <th>対象住宅</th>
              <th>設置日</th>
              <th class="right">耐用年数</th>
              <th class="right">想定更新年</th>
              <th>保証期限</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${list.length===0 ? `<tr><td colspan="8" class="small">まだありません。</td></tr>` : list.map(e=>`
              <tr>
                <td><button class="linkBtn" data-equip-pop="${e.id}">${escapeHtml(e.equipmentName||"")}</button></td>
                <td>${escapeHtml(e.type||"")}</td>
                <td>${escapeHtml(homeName(e.homeId))}</td>
                <td>${e.installedDate ? new Date(Number(e.installedDate)).toLocaleDateString("ja-JP") : "-"}</td>
                <td class="right">${e.lifeYears!=null ? `${Number(e.lifeYears)}年` : "-"}</td>
                <td class="right">${e.expectedRenewYear||"-"}</td>
                <td>${e.warrantyEndDate ? new Date(Number(e.warrantyEndDate)).toLocaleDateString("ja-JP") : "-"}</td>
                <td class="right">
                  <button class="btn secondary" data-edit-equip="${e.id}">編集</button>
                  <button class="btn danger" data-del-equip="${e.id}">削除</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="sep"></div>
      <div class="small">・設備名タップで「説明書リンク」の吹き出し（編集✎付き）を表示します。・保証期限は定期イベント候補に拾います。</div>
    </div>
  `;
}


function renderMoney(){
  const section = state._moneySection || "entries";
  const tabs2 = [
    {key:"entries", label:"入出金"},
    {key:"accounts", label:"口座管理"},
    {key:"fixed", label:"固定費管理"},
    {key:"cards", label:"クレカ情報"},
  ];

  const body = (
    section==="entries" ? renderMoneyEntries() :
    section==="accounts" ? renderAccounts(true) :
    section==="fixed" ? renderFixed(true) :
    renderCreditCards()
  );

  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">お金</h2>
        <div class="spacer"></div>
        <span class="badge">month: ${escapeHtml(state.month||"")}</span>
      </div>
      <div class="sep"></div>
      <div class="tabs">
        ${tabs2.map(t=>`<button class="tab ${t.key===section?"active":""}" data-moneysection="${t.key}">${t.label}</button>`).join("")}
      </div>
    </div>

    <div style="margin-top:12px;">${body}</div>
  `;
}

function renderMoneyEntries(){
  const tabs = [
    {key:"income", label:"入金"},
    {key:"expense", label:"出金"},
    {key:"transfer", label:"資金移動"},
  ];
  const active = state._moneyTab || "income";
  const eList = state.entries.filter(e=> e.type===active);
  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">月次入力（入出金 / 移動）</h2>
        <div class="spacer"></div>
        <span class="badge">role: ${escapeHtml(state.role||"")}</span>
        <button class="btn" id="btnAddEntry">＋追加</button>
      </div>
      <div class="sep"></div>

      <div class="tabs">
        ${tabs.map(t=>`<button class="tab ${t.key===active?"active":""}" data-moneytab="${t.key}">${t.label}</button>`).join("")}
      </div>

      <div class="sep"></div>
      <table class="table">
        <thead>
          <tr>
            <th>日付</th>
            <th>カテゴリ</th>
            <th>口座</th>
            <th class="right">金額</th>
            <th>メモ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${eList.length===0 ? `<tr><td colspan="6" class="small">まだありません。</td></tr>` : eList.map(e=>`
            <tr>
              <td>${new Date(Number(e.occurredAt||0)).toLocaleDateString("ja-JP")}</td>
              <td>${escapeHtml(e.category||"")}</td>
              <td>${escapeHtml(entryAccountLabel(e))}</td>
              <td class="right">¥${yen(e.amount)}</td>
              <td>${escapeHtml(e.note||"")}</td>
              <td class="right">
                <button class="btn secondary" data-edit-entry="${e.id}">編集</button>
                <button class="btn danger" data-del-entry="${e.id}">削除</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="sep"></div>
      <div class="small">
        ・入金：入金先銀行 / 出金：出金元銀行 / 資金移動：出金元→出金先 を保存します。<br/>
        ・口座管理では、月末残高（手入力）＋ 今月の入出金/移動の差分で「推定残高」を表示します。
      </div>
    </div>
  `;
}

function renderAccounts(){
  const accounts = getAllAccountsFromMaster();
  const mb = mergedBalances();
  const deltas = accountDeltasFromEntries();
  const sbi = mb.find(x=>x.id==="sbi_net");
  const sbiPurpose = (state.master.sbiPurposeAccounts||[]).filter(x=>x.active!==false);

  const nisa = state.bundle?.nisa || null;

  return `
    <div class="grid cols2">
      <div class="card">
        <div class="row">
          <h2 class="h1">銀行口座・現金</h2>
          <div class="spacer"></div>
          <button class="btn" id="btnEditBalances">残高を入力/更新</button>
        </div>
        <div class="sep"></div>
        <table class="table">
          <thead>
            <tr>
              <th>口座</th>
              <th class="right">月末残高</th>
              <th class="right">今月差分</th>
              <th class="right">推定残高</th>
            </tr>
          </thead>
          <tbody>
            ${mb.filter(x=>x.id!=="nisa").map(a=>{
              const d = Number(deltas.get(a.id)||0);
              const est = Number(a.balance||0) + d;
              return `
                <tr>
                  <td>${escapeHtml(accountName(a.id))}</td>
                  <td class="right">¥${yen(a.balance)}</td>
                  <td class="right">${d===0?"-":`¥${yen(d)}`}</td>
                  <td class="right"><b>¥${yen(est)}</b></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>

        <div class="small" style="margin-top:10px;">※月末残高は bundle（あれば）→ Firestore月末入力で上書き。今月差分は「入出金/移動」の口座指定から集計。</div>

        ${sbi ? `
          <div class="sep"></div>
          <div class="h2">住信SBIネット銀行 目的別口座</div>
          <div class="small" style="margin-top:6px;">目的別口座は増減OK（master.json更新で追従）</div>
          <div class="sep"></div>
          <table class="table">
            <thead><tr><th>口座</th><th class="right">残高</th></tr></thead>
            <tbody>
              ${sbiPurpose.map(p=>{
                const hit = (sbi.purposeBalances||[]).find(x=>x.id===p.id);
                return `<tr><td>${escapeHtml(p.name)}</td><td class="right">¥${yen(hit?.balance||0)}</td></tr>`;
              }).join("")}
            </tbody>
          </table>
        `: ""}
      </div>

      <div class="card">
        <div class="row">
          <h2 class="h1">SBI証券 NISA</h2>
          <div class="spacer"></div>
          <span class="badge">bundle表示</span>
        </div>
        <div class="sep"></div>
        ${nisa ? `
          <div class="grid cols2">
            <div class="card" style="box-shadow:none;">
              <div class="h2">元本</div>
              <div class="kpi">¥${yen(nisa.principal)}</div>
            </div>
            <div class="card" style="box-shadow:none;">
              <div class="h2">現状</div>
              <div class="kpi">¥${yen(nisa.current)}</div>
            </div>
          </div>
          <div class="sep"></div>
          <table class="table">
            <thead><tr><th>種別</th><th class="right">割合（整数%）</th></tr></thead>
            <tbody>
              ${(nisa.allocations||[]).map(a=>`
                <tr><td>${escapeHtml(a.label||a.id)}</td><td class="right">${Number(a.percentInt||0)}%</td></tr>
              `).join("")}
            </tbody>
          </table>
          <div class="small" style="margin-top:10px;">
            ※ここは要件どおり「資金移動履歴から元本割合」を将来算出できます。<br/>
            最短は：NISA用の移動入力を events/entries とは別コレクションで持つ or transferカテゴリに増設。
          </div>
        ` : `
          <div class="small">この月の bundle に nisa がありません（./data/bundles/${state.month}.json）。</div>
        `}
      </div>
    </div>
  `;
}

function renderFixed(){
  const list = state.fixedCosts.slice().sort((a,b)=> (a.name||"").localeCompare(b.name||""));
  const visible = state._fixedShowHidden ? list : list.filter(x=>x.visible!==false);

  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">固定費まとめ</h2>
        <div class="spacer"></div>
        <button class="btn secondary" id="btnToggleHidden">${state._fixedShowHidden ? "非表示を隠す" : "非表示も表示"}</button>
        <button class="btn" id="btnAddFixed">＋追加</button>
      </div>
      <div class="sep"></div>
      <table class="table">
        <thead>
          <tr><th>支払名</th><th>カテゴリ</th><th>支払方法</th><th class="right">金額</th><th>次回支払</th><th></th></tr>
        </thead>
        <tbody>
          ${visible.length===0 ? `<tr><td colspan="6" class="small">まだありません。</td></tr>` : visible.map(x=>`
            <tr>
              <td>${escapeHtml(x.name||"")}${x.visible===false ? ` <span class="badge">非表示</span>`:""}</td>
              <td>${escapeHtml(x.category||"")}</td>
              <td>${escapeHtml(x.paymentMethod||"")}</td>
              <td class="right">¥${yen(x.amount||0)}</td>
              <td>${x.nextPayDate ? new Date(Number(x.nextPayDate)).toLocaleDateString("ja-JP") : "-"}</td>
              <td class="right">
                <button class="btn secondary" data-edit-fixed="${x.id}">編集</button>
                <button class="btn danger" data-del-fixed="${x.id}">削除</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="sep"></div>
      <div class="small">
        ・カテゴリ/支払方法は master.json をベースにしつつ、固定費側は自由入力でもOKにしてあります。<br/>
        ・“対象情報（保険/ローン）”のリンクは次の段階で付け足せます（targetRef）。
      </div>
    </div>
  `;
}

function renderCreditCards(){
  const list = (state.creditCards||[]).slice().sort((a,b)=> (a.cardName||"").localeCompare(b.cardName||""));
  const visible = state._cardShowStopped ? list : list.filter(x=> (x.active!==false) && (x.status!=="stopped"));

  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">クレカ情報</h2>
        <div class="spacer"></div>
        <label class="chip">
          <input id="toggleCardStopped" type="checkbox" ${state._cardShowStopped?"checked":""}/>
          <span>停止/無効も表示</span>
        </label>
        <button class="btn" id="btnAddCard">＋追加</button>
      </div>
      <div class="sep"></div>

      <div class="tableWrap">
        <table class="table">
          <thead>
            <tr>
              <th>カード名</th>
              <th>会社</th>
              <th>下4桁</th>
              <th>有効期限</th>
              <th>状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${visible.length===0 ? `<tr><td colspan="6" class="small">まだありません。</td></tr>` : visible.map(c=>`
              <tr class="${(c.active===false||c.status==="stopped")?'dim':''}">
                <td>${escapeHtml(c.cardName||"")}</td>
                <td>${escapeHtml(c.issuer||c.company||"-")}</td>
                <td>${escapeHtml(c.last4||"-")}</td>
                <td>${escapeHtml(c.expiryDate||c.expireDate||"-")}</td>
                <td>${escapeHtml(c.status|| (c.active===false?"inactive":"active"))}</td>
                <td class="right">
                  <button class="btn secondary" data-edit-card="${c.id}">編集</button>
                  <button class="btn danger" data-del-card="${c.id}">削除</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="sep"></div>
      <div class="small">
        ・保険の「支払カード」はここから選択します。<br/>
        ・有効期限は「定期イベント > 候補（90日以内）」にも自動で拾います。
      </div>
    </div>
  `;
}


function renderEvents(){
  const list = (state.events||[]).filter(e=>e.active!==false);
  const soon = list.filter(e=>withinDays(Number(e.date||0), 90));

  const today0 = new Date(); today0.setHours(0,0,0,0);
  const exists = new Set(list.map(e=>`${e.sourceType||""}:${e.sourceId||""}:${e.type||""}:${Number(e.date||0)}`));

  function parseYmd(s){
    if(!s) return null;
    // YYYY-MM-DD
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if(m) return {y:+m[1], mo:+m[2], d:+m[3]};
    // YYYY-MM
    const m2 = /^(\d{4})-(\d{2})$/.exec(s);
    if(m2) return {y:+m2[1], mo:+m2[2], d:1};
    return null;
  }

  function nextBirthdayMs(birthDate){
    const p = parseYmd(birthDate);
    if(!p) return null;
    const now = new Date();
    let y = now.getFullYear();
    let dt = new Date(y, p.mo-1, p.d, 12, 0, 0, 0).getTime();
    if(dt < today0.getTime()) dt = new Date(y+1, p.mo-1, p.d, 12, 0, 0, 0).getTime();
    return dt;
  }

  function lastDayOfMonth(y, mo){
    return new Date(y, mo, 0).getDate();
  }

  function expiryMs(exp){
    const p = parseYmd(exp);
    if(!p) return null;
    // if only YYYY-MM, p.d=1 but we treat as end of month
    const d = (exp.length===7) ? lastDayOfMonth(p.y, p.mo) : p.d;
    const dt = new Date(p.y, p.mo-1, d, 12, 0, 0, 0).getTime();
    return dt;
  }

  const suggested = [];

  // family birthdays
  (state.family||[]).filter(f=>f.active!==false).forEach(f=>{
    const ms = nextBirthdayMs(f.birthDate);
    if(ms && withinDays(ms, 90)){
      const key = `family:${f.id}:birthday:${ms}`;
      if(!exists.has(key)){
        suggested.push({
          title: `${f.name||"家族"} 誕生日`,
          type: "birthday",
          date: ms,
          sourceType: "family",
          sourceId: f.id
        });
      }
    }
  });

  // credit card expiry
  (state.creditCards||[]).filter(c=>c.active!==false && (c.status!=="stopped")).forEach(c=>{
    const exp = c.expiryDate || c.expireDate || c.expiry || c.expiration || "";
    const ms = expiryMs(exp);
    if(ms && withinDays(ms, 90)){
      const key = `creditCards:${c.id}:card_expiry:${ms}`;
      if(!exists.has(key)){
        suggested.push({
          title: `${c.cardName||"カード"} 有効期限`,
          type: "card_expiry",
          date: ms,
          sourceType: "creditCards",
          sourceId: c.id
        });
      }
    }
  });

  // car inspection / insurance (if data exists)
  (state.cars||[]).filter(x=>x.active!==false).forEach(c=>{
    const fields = [
      {k:"inspectionDueDate", label:"点検期限", type:"car_check"},
      {k:"insuranceDueDate", label:"任意保険", type:"car_insurance"},
      {k:"shakenDueDate", label:"車検", type:"car_shaken"},
    ];
    fields.forEach(fld=>{
      const v = c[fld.k] || "";
      const ms = expiryMs(v) || (typeof v==="number"?v:null);
      if(ms && withinDays(ms, 90)){
        const key = `cars:${c.id}:${fld.type}:${ms}`;
        if(!exists.has(key)){
          suggested.push({
            title: `${c.carName||"車"} ${fld.label}`,
            type: fld.type,
            date: ms,
            sourceType: "cars",
            sourceId: c.id
          });
        }
      }
    });
  });

  suggested.sort((a,b)=>a.date-b.date);

  const suggestHtml = suggested.length===0 ? `
    <div class="small muted">候補なし（家族の生年月日やカード有効期限などを登録するとここに出ます）</div>
  ` : `
    <table class="table" style="margin-top:8px;">
      <thead><tr><th>日付</th><th>タイトル</th><th></th></tr></thead>
      <tbody>
        ${suggested.map(s=>`
          <tr>
            <td style="white-space:nowrap;">${new Date(Number(s.date)).toLocaleDateString("ja-JP")}</td>
            <td>${escapeHtml(s.title)}</td>
            <td style="white-space:nowrap; text-align:right;">
              <button class="btn sm" 
                data-add-suggest="1"
                data-s-title="${escapeHtml(s.title)}"
                data-s-type="${escapeHtml(s.type)}"
                data-s-date="${String(s.date)}"
                data-s-source-type="${escapeHtml(s.sourceType)}"
                data-s-source-id="${escapeHtml(s.sourceId)}"
              >イベントに追加</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  return `
    <div class="grid cols2">
      <div class="card">
        <div class="row">
          <h2 class="h1">定期イベント</h2>
          <div class="spacer"></div>
          <button class="btn" id="btnAddEvent">＋追加</button>
        </div>

        <div class="sep"></div>

        <div class="h2" style="margin-top:8px;">候補（90日以内）</div>
        ${suggestHtml}

        <div class="sep" style="margin-top:12px;"></div>

        <div class="row">
          <h2 class="h2">90日以内</h2>
          <div class="spacer"></div>
          <span class="badge">${soon.length}件</span>
        </div>
        <table class="table">
          <thead><tr><th>日付</th><th>タイトル</th><th>種別</th><th></th></tr></thead>
          <tbody>
            ${soon.length===0 ? `<tr><td colspan="4" class="small">なし</td></tr>` : soon.map(e=>`
              <tr>
                <td style="white-space:nowrap;">${new Date(Number(e.date||0)).toLocaleDateString("ja-JP")}</td>
                <td>${escapeHtml(e.title||"")}</td>
                <td class="muted">${escapeHtml(e.type||"-")}</td>
                <td style="white-space:nowrap; text-align:right;">
                  <button class="btn sm" data-edit-event="${e.id}">編集</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="row">
          <h2 class="h1">全イベント</h2>
          <div class="spacer"></div>
          <span class="badge">${list.length}件</span>
        </div>
        <div class="sep"></div>
        <table class="table">
          <thead><tr><th>日付</th><th>タイトル</th><th>種別</th><th></th></tr></thead>
          <tbody>
            ${list.length===0 ? `<tr><td colspan="4" class="small">なし</td></tr>` : list.map(e=>`
              <tr>
                <td style="white-space:nowrap;">${new Date(Number(e.date||0)).toLocaleDateString("ja-JP")}</td>
                <td>${escapeHtml(e.title||"")}</td>
                <td class="muted">${escapeHtml(e.type||"-")}</td>
                <td style="white-space:nowrap; text-align:right;">
                  <button class="btn sm" data-edit-event="${e.id}">編集</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderSettings(){
  return `
    <div class="card">
      <h2 class="h1">設定</h2>
      <div class="sep"></div>

      <div class="grid cols2">
        <div class="card" style="box-shadow:none;">
          <div class="h2">データソース</div>
          <div class="sep"></div>
          <div class="small">
            ・マスタ：<code>./data/master.json</code><br/>
            ・月次bundle：<code>./data/bundles/YYYY-MM.json</code>（任意）<br/>
            ・差分入力：Firestore（months/{month}/...）
          </div>
        </div>

        <div class="card" style="box-shadow:none;">
          <div class="h2">初期セットアップ（超重要）</div>
          <div class="sep"></div>
          <ol class="small">
            <li>Firebase Auth でユーザー作成（Email/Password）</li>
            <li>Firestore に <code>users/{uid}</code> を作成：<code>{ role:"admin", active:true }</code></li>
            <li>Firestore Rules を <code>firestore.rules</code> をコピペして反映</li>
            <li><code>app.js</code> の <code>FIREBASE_CONFIG</code> を差し替え</li>
            <li>GitHub Pages（or Hosting）へアップ</li>
          </ol>
        </div>
      </div>

      <div class="sep"></div>
      <div class="row">
        <button class="btn secondary" id="btnOpenMaster">master.json を開く</button>
        <button class="btn secondary" id="btnOpenRules">firestore.rules を開く</button>
      </div>

      <div class="sep"></div>
      <div class="small">
        次の段階で、保険/カード/車/家/家族ページを追加して、固定費と targetRef でリンクします。<br/>
        まずはこのDL版で「月末入力」「口座残高」「固定費」「90日期限」を動かせます。
      </div>
    </div>
  `;
}

function wireViewEvents(){
  // internal nav buttons
  $$("[data-go]").forEach(b=>{
    b.addEventListener("click", ()=>{
      navigate(b.dataset.go);
    });
  });

  // money section switching
  $$('[data-moneysection]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state._moneySection = btn.dataset.moneysection;
      mount();
    });
  });

  // money tab switching
  $$("[data-moneytab]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      state._moneyTab = btn.dataset.moneytab;
      mount();
    });
  });

  // housing section switching
  $$('[data-housingsection]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state._housingSection = btn.dataset.housingsection;
      mount();
    });
  });

  // Add entry
  const btnAddEntry = $("#btnAddEntry");
  if(btnAddEntry){
    btnAddEntry.addEventListener("click", ()=> openEntryModal("add"));
  }

  // edit/delete entry
  $$("[data-edit-entry]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.editEntry;
      const e = state.entries.find(x=>x.id===id);
      openEntryModal("edit", e);
    });
  });
  $$("[data-del-entry]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
      const id = btn.dataset.delEntry;
      if(!confirm("削除しますか？")) return;
      await deleteDoc(doc(db, "months", state.month, "entries", id));
      await reloadAll();
    });
  });

  // balances
  const btnEditBalances = $("#btnEditBalances");
  if(btnEditBalances){
    btnEditBalances.addEventListener("click", ()=> openBalancesModal());
  }

  // fixed
  const btnToggleHidden = $("#btnToggleHidden");
  if(btnToggleHidden){
    btnToggleHidden.addEventListener("click", ()=>{
      state._fixedShowHidden = !state._fixedShowHidden;
      mount();
    });
  }
  const btnAddFixed = $("#btnAddFixed");
  if(btnAddFixed){
    btnAddFixed.addEventListener("click", ()=> openFixedModal("add"));
  }
  $$("[data-edit-fixed]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.editFixed;
      openFixedModal("edit", state.fixedCosts.find(x=>x.id===id));
    });
  });
  $$("[data-del-fixed]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
      const id = btn.dataset.delFixed;
      if(!confirm("削除しますか？")) return;
      await deleteDoc(doc(db, "fixedCosts", id));
      await reloadAll();
    });
  });

  // credit cards
  const toggleCardStopped = $("#toggleCardStopped");
  if(toggleCardStopped){
    toggleCardStopped.addEventListener("change", ()=>{
      state._cardShowStopped = toggleCardStopped.checked;
      mount();
    });
  }
  const btnAddCard = $("#btnAddCard");
  if(btnAddCard){
    btnAddCard.addEventListener("click", ()=> openCardModal("add"));
  }
  $$('[data-edit-card]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.editCard;
      openCardModal('edit', state.creditCards.find(x=>x.id===id));
    });
  });
  $$('[data-del-card]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(state.role==='viewer'){ alert('viewer は編集できません'); return; }
      const id = btn.dataset.delCard;
      if(!confirm('削除しますか？')) return;
      await deleteDoc(doc(db, 'creditCards', id));
      await reloadAll();
    });
  });

  // events
  const btnAddEvent = $("#btnAddEvent");
  if(btnAddEvent){
    btnAddEvent.addEventListener("click", ()=> openEventModal("add"));
  }
  $$("[data-edit-event]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.editEvent;
      openEventModal("edit", state.events.find(x=>x.id===id));
    });
  });
  $$("[data-del-event]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
      const id = btn.dataset.delEvent;
      if(!confirm("削除しますか？")) return;
      await deleteDoc(doc(db, "events", id));
      await reloadAll();
    });
  });

  // settings open files
  const btnOpenMaster = $("#btnOpenMaster");
  if(btnOpenMaster) btnOpenMaster.addEventListener("click", ()=> window.open("./data/master.json","_blank"));
  const btnOpenRules = $("#btnOpenRules");
  if(btnOpenRules) btnOpenRules.addEventListener("click", ()=> window.open("./firestore.rules","_blank"));

  // family
  const btnAddFamily = $("#btnAddFamily");
  if(btnAddFamily){
    btnAddFamily.addEventListener("click", ()=> openFamilyModal("add"));
  }
  const toggleFamilyInactive = $("#toggleFamilyInactive");
  if(toggleFamilyInactive){
    toggleFamilyInactive.addEventListener("change", ()=>{
      state._showInactiveFamily = toggleFamilyInactive.checked;
      mount();
    });
  }
  $$("[data-edit-family]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.editFamily;
      openFamilyModal("edit", state.family.find(x=>x.id===id));
    });
  });
  $$("[data-del-family]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
      const id = btn.dataset.delFamily;
      if(!confirm("削除しますか？")) return;
      await deleteDoc(doc(db, "family", id));
      await reloadAll();
    });
  });

  // insurance
  const btnAddInsurance = $("#btnAddInsurance");
  if(btnAddInsurance){
    btnAddInsurance.addEventListener("click", ()=> openInsuranceModal("add"));
  }
  $$('[data-edit-insurance]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.editInsurance;
      openInsuranceModal('edit', state.insurances.find(x=>x.id===id));
    });
  });
  $$('[data-del-insurance]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(state.role==='viewer'){ alert('viewer は編集できません'); return; }
      const id = btn.dataset.delInsurance;
      if(!confirm('削除しますか？')) return;
      await deleteDoc(doc(db, 'insurances', id));
      await reloadAll();
    });
  });

  // car
  const btnAddCar = $("#btnAddCar");
  if(btnAddCar){
    btnAddCar.addEventListener('click', ()=> openCarModal('add'));
  }
  $$('[data-edit-car]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.editCar;
      openCarModal('edit', state.cars.find(x=>x.id===id));
    });
  });
  $$('[data-del-car]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(state.role==='viewer'){ alert('viewer は編集できません'); return; }
      const id = btn.dataset.delCar;
      if(!confirm('削除しますか？')) return;
      await deleteDoc(doc(db, 'cars', id));
      await reloadAll();
    });
  });

  // housing - home/loan/equipment
  const btnAddHome = $("#btnAddHome");
  if(btnAddHome){
    btnAddHome.addEventListener('click', ()=> openHomeModal('add'));
  }
  $$('[data-edit-home]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.editHome;
      openHomeModal('edit', state.homes.find(x=>x.id===id));
    });
  });
  $$('[data-del-home]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(state.role==='viewer'){ alert('viewer は編集できません'); return; }
      const id = btn.dataset.delHome;
      if(!confirm('削除しますか？')) return;
      await deleteDoc(doc(db, 'homes', id));
      await reloadAll();
    });
  });

  const btnAddLoan = $("#btnAddLoan");
  if(btnAddLoan){
    btnAddLoan.addEventListener('click', ()=> openLoanModal('add'));
  }
  $$('[data-edit-loan]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.editLoan;
      openLoanModal('edit', state.homeLoans.find(x=>x.id===id));
    });
  });
  $$('[data-del-loan]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(state.role==='viewer'){ alert('viewer は編集できません'); return; }
      const id = btn.dataset.delLoan;
      if(!confirm('削除しますか？')) return;
      await deleteDoc(doc(db, 'homeLoans', id));
      await reloadAll();
    });
  });

  const btnAddEquip = $("#btnAddEquip");
  if(btnAddEquip){
    btnAddEquip.addEventListener('click', ()=> openEquipModal('add'));
  }
  $$('[data-edit-equip]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.editEquip;
      openEquipModal('edit', state.homeEquipments.find(x=>x.id===id));
    });
  });
  $$('[data-del-equip]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(state.role==='viewer'){ alert('viewer は編集できません'); return; }
      const id = btn.dataset.delEquip;
      if(!confirm('削除しますか？')) return;
      await deleteDoc(doc(db, 'homeEquipments', id));
      await reloadAll();
    });
  });

  $$('[data-equip-pop]').forEach(btn=>{
    btn.addEventListener('click', (ev)=>{
      const id = btn.dataset.equipPop;
      const item = state.homeEquipments.find(x=>x.id===id);
      openEquipPopover(ev.currentTarget, item);
    });
  });

  // event suggestions
  $$("[data-add-suggest]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
      const payload = {
        title: btn.dataset.sTitle || "",
        type: btn.dataset.sType || "",
        date: Number(btn.dataset.sDate||0),
        sourceType: btn.dataset.sSourceType || "",
        sourceId: btn.dataset.sSourceId || "",
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        note: ""
      };
      await addDoc(collection(db, "events"), payload);
      await reloadAll();
    });
  });

}

/** =========================
 *  7) Modal helpers
 * ========================= */
function showModal(title, html){
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modalOverlay").style.display = "flex";
  $("#modalOverlay").setAttribute("aria-hidden","false");
}
function hideModal(){
  $("#modalOverlay").style.display = "none";
  $("#modalOverlay").setAttribute("aria-hidden","true");
  $("#modalBody").innerHTML = "";
}

function closeModal(){
  hideModal();
}
$("#modalClose").addEventListener("click", hideModal);
$("#modalOverlay").addEventListener("click", (e)=>{
  if(e.target.id==="modalOverlay") hideModal();
});

function openEntryModal(mode, entry=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
  const type = state._moneyTab || "income";
  const cats = type==="income" ? state.master.incomeCategories : (type==="expense" ? state.master.expenseCategories : state.master.transferCategories);
  const accounts = getAllAccountsFromMaster();
  const opts = (selectedId)=> accounts.map(a=>`<option value="${escapeHtml(a.id)}" ${a.id===selectedId?"selected":""}>${escapeHtml(a.name)}</option>`).join("");

  const occurred = entry?.occurredAt ? new Date(Number(entry.occurredAt)) : new Date();
  const yyyy = occurred.getFullYear();
  const mm = String(occurred.getMonth()+1).padStart(2,"0");
  const dd = String(occurred.getDate()).padStart(2,"0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const accountFields = (()=>{
    if(type==="income"){
      const sel = entry?.toAccountId || accounts[0]?.id || "";
      return `
        <div>
          <div class="small">入金先銀行</div>
          <select id="m_toAccount" class="input">${opts(sel)}</select>
        </div>
      `;
    }
    if(type==="expense"){
      const sel = entry?.fromAccountId || accounts[0]?.id || "";
      return `
        <div>
          <div class="small">出金元銀行</div>
          <select id="m_fromAccount" class="input">${opts(sel)}</select>
        </div>
      `;
    }
    // transfer
    const selF = entry?.fromAccountId || accounts[0]?.id || "";
    const selT = entry?.toAccountId || accounts[1]?.id || accounts[0]?.id || "";
    return `
      <div>
        <div class="small">出金元銀行</div>
        <select id="m_fromAccount" class="input">${opts(selF)}</select>
      </div>
      <div>
        <div class="small">出金先銀行</div>
        <select id="m_toAccount" class="input">${opts(selT)}</select>
      </div>
    `;
  })();

  showModal(mode==="add" ? "入力を追加" : "入力を編集", `
    <div class="formGrid">
      <div>
        <div class="small">カテゴリ</div>
        <select id="m_category" class="input">
          ${cats.map(c=>`<option ${c===(entry?.category||cats[0])?"selected":""}>${escapeHtml(c)}</option>`).join("")}
        </select>
      </div>
      ${accountFields}
      <div>
        <div class="small">金額</div>
        <input id="m_amount" class="input" type="number" inputmode="numeric" value="${Number(entry?.amount||0)}" />
      </div>
      <div>
        <div class="small">日付</div>
        <input id="m_date" class="input" type="date" value="${dateStr}" />
      </div>
      <div>
        <div class="small">メモ</div>
        <input id="m_note" class="input" value="${escapeHtml(entry?.note||"")}" />
      </div>
    </div>
    <div class="row" style="margin-top:12px;">
      <button class="btn" id="m_save">保存</button>
      <div class="spacer"></div>
      <span class="small">type: ${escapeHtml(type)}</span>
    </div>
  `);

  $("#m_save").addEventListener("click", async ()=>{
    const category = $("#m_category").value;
    const amount = Number($("#m_amount").value||0);
    const date = $("#m_date").value;
    const note = $("#m_note").value || "";
    const occurredAt = new Date(`${date}T00:00:00+09:00`).getTime();

    const fromAccountId = $("#m_fromAccount") ? $("#m_fromAccount").value : null;
    const toAccountId = $("#m_toAccount") ? $("#m_toAccount").value : null;

    const payload = {
      type, category, amount, note, occurredAt,
      fromAccountId: fromAccountId || null,
      toAccountId: toAccountId || null,
      updatedAt: Date.now()
    };

    if(mode==="add"){
      payload.createdAt = Date.now();
      payload.createdBy = state.user.uid;
      await addDoc(collection(db, "months", state.month, "entries"), payload);
    }else{
      await updateDoc(doc(db, "months", state.month, "entries", entry.id), payload);
    }
    hideModal();
    await reloadAll();
  }, { once:true });
}

function openBalancesModal(){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
  const accounts = getAllAccountsFromMaster();
  const mb = mergedBalances();
  const get = (id)=> mb.find(x=>x.id===id)?.balance || 0;

  showModal("残高を入力/更新（当月）", `
    <div class="small">※ここで入れた値が当月表示に反映（bundleより優先）</div>
    <div class="sep"></div>
    <div class="grid cols2">
      ${accounts.map(a=>`
        <div>
          <div class="small">${escapeHtml(a.name)}</div>
          <input class="input" type="number" data-bal="${escapeHtml(a.id)}" value="${Number(get(a.id))}" />
        </div>
      `).join("")}
    </div>
    <div class="sep"></div>
    <div class="row">
      <button class="btn" id="bal_save">保存</button>
      <div class="spacer"></div>
      <span class="small">month: ${escapeHtml(state.month)}</span>
    </div>
  `);

  $("#bal_save").addEventListener("click", async ()=>{
    const inputs = $$("[data-bal]");
    for(const inp of inputs){
      const accountId = inp.dataset.bal;
      const balance = Number(inp.value||0);
      // doc id = accountId
      await setDoc(doc(db, "months", state.month, "balances", accountId), {
        accountId, balance,
        updatedAt: Date.now(),
        updatedBy: state.user.uid
      }, { merge:true });
    }
    hideModal();
    await reloadAll();
  }, { once:true });
}

function openFixedModal(mode, item=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
  const cats = state.master.fixedCostCategories || [];
  const pay = state.master.paymentMethods || [];

  showModal(mode==="add" ? "固定費を追加" : "固定費を編集", `
    <div class="formGrid">
      <div>
        <div class="small">支払名</div>
        <input id="f_name" class="input" value="${escapeHtml(item?.name||"")}" />
      </div>
      <div>
        <div class="small">カテゴリ</div>
        <input id="f_cat" class="input" list="fixedCatList" value="${escapeHtml(item?.category||cats[0]||"")}" />
        <datalist id="fixedCatList">
          ${cats.map(c=>`<option value="${escapeHtml(c)}"></option>`).join("")}
        </datalist>
      </div>
      <div>
        <div class="small">支払方法</div>
        <select id="f_pay" class="input">
          ${pay.map(p=>`<option ${p===(item?.paymentMethod||pay[0])?"selected":""}>${escapeHtml(p)}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">金額（今は手入力）</div>
        <input id="f_amount" class="input" type="number" value="${Number(item?.amount||0)}" />
      </div>
      <div>
        <div class="small">支払周期（自由記入）</div>
        <input id="f_cycle" class="input" value="${escapeHtml(item?.cycleText||"毎月")}" />
      </div>
      <div>
        <div class="small">次回支払日</div>
        <input id="f_next" class="input" type="date" value="${item?.nextPayDate ? new Date(Number(item.nextPayDate)).toISOString().slice(0,10) : ""}" />
      </div>
      <div>
        <div class="small">表示</div>
        <select id="f_visible" class="input">
          <option value="true" ${item?.visible!==false?"selected":""}>表示</option>
          <option value="false" ${item?.visible===false?"selected":""}>非表示</option>
        </select>
      </div>
      <div>
        <div class="small">メモ</div>
        <input id="f_memo" class="input" value="${escapeHtml(item?.memo||"")}" />
      </div>
    </div>
    <div class="row" style="margin-top:12px;">
      <button class="btn" id="f_save">保存</button>
    </div>
  `);

  $("#f_save").addEventListener("click", async ()=>{
    const payload = {
      name: $("#f_name").value || "",
      category: $("#f_cat").value || "",
      paymentMethod: $("#f_pay").value || "",
      amount: Number($("#f_amount").value||0),
      cycleText: $("#f_cycle").value || "",
      nextPayDate: $("#f_next").value ? new Date(`${$("#f_next").value}T00:00:00+09:00`).getTime() : null,
      visible: $("#f_visible").value === "true",
      memo: $("#f_memo").value || "",
      updatedAt: Date.now()
    };
    if(mode==="add"){
      await addDoc(collection(db, "fixedCosts"), payload);
    }else{
      await updateDoc(doc(db, "fixedCosts", item.id), payload);
    }
    hideModal();
    await reloadAll();
  }, { once:true });
}

function openCardModal(mode, item=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }

  showModal(mode==="add" ? "クレカを追加" : "クレカを編集", `
    <div class="formGrid">
      <div>
        <div class="small">カード名</div>
        <input id="c_name" class="input" value="${escapeHtml(item?.cardName||"")}" />
      </div>
      <div>
        <div class="small">会社（VISA/JCB等でもOK）</div>
        <input id="c_issuer" class="input" value="${escapeHtml(item?.issuer||item?.company||"")}" />
      </div>
      <div>
        <div class="small">下4桁</div>
        <input id="c_last4" class="input" inputmode="numeric" value="${escapeHtml(item?.last4||"")}" />
      </div>
      <div>
        <div class="small">有効期限（YYYY-MM）</div>
        <input id="c_exp" class="input" placeholder="2026-12" value="${escapeHtml(item?.expiryDate||item?.expireDate||"")}" />
      </div>
      <div>
        <div class="small">状態</div>
        <select id="c_status" class="input">
          ${["active","stopped","inactive"].map(s=>`<option value="${s}" ${(item?.status||"active")===s?"selected":""}>${s}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">メモ</div>
        <input id="c_memo" class="input" value="${escapeHtml(item?.memo||"")}" />
      </div>
    </div>
    <div class="row" style="margin-top:12px;">
      <button class="btn" id="c_save">保存</button>
    </div>
  `);

  $("#c_save").addEventListener("click", async ()=>{
    const payload = {
      cardName: $("#c_name").value || "",
      issuer: $("#c_issuer").value || "",
      last4: $("#c_last4").value || "",
      expiryDate: $("#c_exp").value || "",
      status: $("#c_status").value || "active",
      memo: $("#c_memo").value || "",
      active: ( $("#c_status").value || "active" ) === "active",
      updatedAt: Date.now(),
    };
    if(mode==="add"){
      await addDoc(collection(db, "creditCards"), payload);
    }else{
      await updateDoc(doc(db, "creditCards", item.id), payload);
    }
    hideModal();
    await reloadAll();
  }, { once:true });
}

function openInsuranceModal(mode, item=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
  const pay = state.master.paymentMethods || [];
  const cards = (state.creditCards||[]).filter(c=>c.status!=="stopped" && c.active!==false);

  const startStr = item?.startDate ? new Date(Number(item.startDate)).toISOString().slice(0,10) : "";
  const renewStr = item?.renewalDate ? new Date(Number(item.renewalDate)).toISOString().slice(0,10) : "";

  showModal(mode==="add" ? "保険を追加" : "保険を編集", `
    <div class="formGrid">
      <div>
        <div class="small">保険名</div>
        <input id="ins_name" class="input" value="${escapeHtml(item?.insuranceName||"")}" />
      </div>
      <div>
        <div class="small">被保険者</div>
        <input id="ins_person" class="input" value="${escapeHtml(item?.insuredPerson||"")}" />
      </div>
      <div>
        <div class="small">保険種別</div>
        <input id="ins_type" class="input" value="${escapeHtml(item?.insuranceType||"")}" placeholder="生命/医療/自動車/火災..." />
      </div>
      <div>
        <div class="small">保険会社</div>
        <input id="ins_company" class="input" value="${escapeHtml(item?.company||"")}" />
      </div>
      <div>
        <div class="small">契約番号</div>
        <input id="ins_contract" class="input" value="${escapeHtml(item?.contractNumber||"")}" />
      </div>
      <div>
        <div class="small">支払方法</div>
        <select id="ins_pay" class="input">
          ${pay.map(p=>`<option ${p===(item?.paymentMethod||pay[0])?"selected":""}>${escapeHtml(p)}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">支払カード</div>
        <select id="ins_card" class="input">
          <option value="">-</option>
          ${cards.map(c=>`<option value="${escapeHtml(c.id)}" ${c.id===(item?.paymentCardId||"")?"selected":""}>${escapeHtml(c.cardName||"")}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">金額</div>
        <input id="ins_amount" class="input" type="number" value="${Number(item?.amount||0)}" />
      </div>
      <div>
        <div class="small">契約開始日</div>
        <input id="ins_start" class="input" type="date" value="${startStr}" />
      </div>
      <div>
        <div class="small">更新日</div>
        <input id="ins_renew" class="input" type="date" value="${renewStr}" />
      </div>
      <div>
        <div class="small">PDFリンク（OneDrive）</div>
        <input id="ins_pdf" class="input" value="${escapeHtml(item?.pdfLink||"")}" placeholder="https://..." />
      </div>
      <div>
        <div class="small">GPT要約</div>
        <input id="ins_sum" class="input" value="${escapeHtml(item?.gptSummary||"")}" placeholder="要点メモ" />
      </div>
      <div>
        <div class="small">固定費に反映</div>
        <select id="ins_link" class="input">
          <option value="false" ${item?.linkToFixedCost?"":"selected"}>OFF</option>
          <option value="true" ${item?.linkToFixedCost?"selected":""}>ON</option>
        </select>
      </div>
      <div>
        <div class="small">メモ</div>
        <input id="ins_memo" class="input" value="${escapeHtml(item?.memo||"")}" />
      </div>
    </div>
    <div class="row" style="margin-top:12px;">
      <button class="btn" id="ins_save">保存</button>
    </div>
  `);

  $("#ins_save").addEventListener("click", async ()=>{
    const payload = {
      insuranceName: $("#ins_name").value || "",
      insuredPerson: $("#ins_person").value || "",
      insuranceType: $("#ins_type").value || "",
      company: $("#ins_company").value || "",
      contractNumber: $("#ins_contract").value || "",
      paymentMethod: $("#ins_pay").value || "",
      paymentCardId: $("#ins_card").value || "",
      amount: Number($("#ins_amount").value||0),
      startDate: $("#ins_start").value ? new Date(`${$("#ins_start").value}T00:00:00+09:00`).getTime() : null,
      renewalDate: $("#ins_renew").value ? new Date(`${$("#ins_renew").value}T00:00:00+09:00`).getTime() : null,
      pdfLink: $("#ins_pdf").value || "",
      gptSummary: $("#ins_sum").value || "",
      memo: $("#ins_memo").value || "",
      linkToFixedCost: $("#ins_link").value === "true",
      updatedAt: Date.now(),
    };

    let docRef;
    if(mode==="add"){
      docRef = await addDoc(collection(db, "insurances"), payload);
    }else{
      docRef = doc(db, "insurances", item.id);
      await updateDoc(docRef, payload);
    }

    // optional fixed cost link
    if(payload.linkToFixedCost){
      const fc = {
        name: payload.insuranceName || "保険",
        category: "保険",
        paymentMethod: payload.paymentMethod || "",
        amount: payload.amount || 0,
        nextPayDate: payload.renewalDate || null,
        memo: "(保険から自動反映)",
        visible: true,
        updatedAt: Date.now(),
      };
      if(item?.fixedCostId){
        await setDoc(doc(db, "fixedCosts", item.fixedCostId), fc, { merge:true });
        await setDoc(docRef, { fixedCostId: item.fixedCostId }, { merge:true });
      }else{
        const newFc = await addDoc(collection(db, "fixedCosts"), fc);
        await setDoc(docRef, { fixedCostId: newFc.id }, { merge:true });
      }
    }

    hideModal();
    await reloadAll();
  }, { once:true });
}

function openCarModal(mode, item=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
  const owners = (state.family||[]).filter(f=>f.active!==false);
  showModal(mode==="add" ? "車を追加" : "車を編集", `
    <div class="formGrid">
      <div>
        <div class="small">車名</div>
        <input id="car_name" class="input" value="${escapeHtml(item?.carName||"")}" />
      </div>
      <div>
        <div class="small">名義</div>
        <select id="car_owner" class="input">
          <option value="">-</option>
          ${owners.map(o=>`<option value="${escapeHtml(o.id)}" ${o.id===(item?.ownerId||"")?"selected":""}>${escapeHtml(o.name||"")}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">任意保険（イベントID任意）</div>
        <input id="car_ins_ev" class="input" value="${escapeHtml(item?.voluntaryInsuranceEventId||"")}" placeholder="eventsのid（任意）" />
      </div>
      <div>
        <div class="small">点検期限（イベントID）</div>
        <input id="car_ck_ev" class="input" value="${escapeHtml(item?.inspectionEventId||"")}" placeholder="eventsのid（任意）" />
      </div>
      <div>
        <div class="small">車検証PDF（OneDrive）</div>
        <input id="car_pdf" class="input" value="${escapeHtml(item?.registrationPdfLink||"")}" />
      </div>
      <div>
        <div class="small">メモ</div>
        <input id="car_memo" class="input" value="${escapeHtml(item?.memo||"")}" />
      </div>
    </div>
    <div class="row" style="margin-top:12px;"><button class="btn" id="car_save">保存</button></div>
  `);

  $("#car_save").addEventListener("click", async ()=>{
    const payload = {
      carName: $("#car_name").value || "",
      ownerId: $("#car_owner").value || "",
      voluntaryInsuranceEventId: $("#car_ins_ev").value || "",
      inspectionEventId: $("#car_ck_ev").value || "",
      registrationPdfLink: $("#car_pdf").value || "",
      memo: $("#car_memo").value || "",
      updatedAt: Date.now(),
    };
    if(mode==="add"){
      await addDoc(collection(db, "cars"), payload);
    }else{
      await updateDoc(doc(db, "cars", item.id), payload);
    }
    hideModal();
    await reloadAll();
  }, { once:true });
}

function openHomeModal(mode, item=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
  const acquiredStr = item?.acquiredDate ? new Date(Number(item.acquiredDate)).toISOString().slice(0,10) : "";
  showModal(mode==="add" ? "住宅を追加" : "住宅を編集", `
    <div class="formGrid">
      <div>
        <div class="small">住宅名</div>
        <input id="home_name" class="input" value="${escapeHtml(item?.name||"")}" />
      </div>
      <div>
        <div class="small">所在地</div>
        <input id="home_loc" class="input" value="${escapeHtml(item?.location||"")}" placeholder="住所" />
      </div>
      <div>
        <div class="small">取得日</div>
        <input id="home_acq" class="input" type="date" value="${acquiredStr}" />
      </div>
      <div>
        <div class="small">重要書類PDFリンク（OneDrive）</div>
        <input id="home_docs" class="input" value="${escapeHtml(item?.docsLink||"")}" />
      </div>
      <div>
        <div class="small">メモ</div>
        <input id="home_memo" class="input" value="${escapeHtml(item?.memo||"")}" />
      </div>
    </div>
    <div class="row" style="margin-top:12px;"><button class="btn" id="home_save">保存</button></div>
  `);
  $("#home_save").addEventListener("click", async ()=>{
    const payload = {
      name: $("#home_name").value || "",
      location: $("#home_loc").value || "",
      acquiredDate: $("#home_acq").value ? new Date(`${$("#home_acq").value}T00:00:00+09:00`).getTime() : null,
      docsLink: $("#home_docs").value || "",
      memo: $("#home_memo").value || "",
      updatedAt: Date.now(),
    };
    if(mode==="add"){
      await addDoc(collection(db, "homes"), payload);
    }else{
      await updateDoc(doc(db, "homes", item.id), payload);
    }
    hideModal();
    await reloadAll();
  }, { once:true });
}

async function upsertEventBySource({sourceType, sourceId, type, title, date}){
  if(!date) return null;
  const qy = query(collection(db, "events"), where("sourceType","==",sourceType), where("sourceId","==",sourceId), where("type","==",type));
  const snap = await getDocs(qy);
  const payload = { title, kind:"home", type, sourceType, sourceId, date:Number(date), active:true, updatedAt: Date.now() };
  if(snap.docs.length>0){
    await updateDoc(doc(db, "events", snap.docs[0].id), payload);
    return snap.docs[0].id;
  }
  const newDoc = await addDoc(collection(db, "events"), {...payload, createdAt: Date.now(), note:""});
  return newDoc.id;
}

function openLoanModal(mode, item=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
  const homes = state.homes||[];
  const fixed = state.fixedCosts||[];
  const startStr = item?.startDate ? new Date(Number(item.startDate)).toISOString().slice(0,10) : "";
  const finishStr = item?.finishDate ? new Date(Number(item.finishDate)).toISOString().slice(0,10) : "";
  const taxStr = item?.taxDeductionEndDate ? new Date(Number(item.taxDeductionEndDate)).toISOString().slice(0,10) : "";

  showModal(mode==="add" ? "ローンを追加" : "ローンを編集", `
    <div class="formGrid">
      <div>
        <div class="small">ローン名</div>
        <input id="loan_name" class="input" value="${escapeHtml(item?.loanName||"")}" />
      </div>
      <div>
        <div class="small">対象住宅</div>
        <select id="loan_home" class="input">
          <option value="">-</option>
          ${homes.map(h=>`<option value="${escapeHtml(h.id)}" ${h.id===(item?.homeId||"")?"selected":""}>${escapeHtml(h.name||"")}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">金融機関</div>
        <input id="loan_bank" class="input" value="${escapeHtml(item?.bank||"")}" />
      </div>
      <div>
        <div class="small">残高</div>
        <input id="loan_bal" class="input" type="number" value="${Number(item?.balance||0)}" />
      </div>
      <div>
        <div class="small">金利</div>
        <input id="loan_rate" class="input" value="${escapeHtml(item?.interestRate||"")}" placeholder="0.5%" />
      </div>
      <div>
        <div class="small">月額返済（固定費とリンク）</div>
        <select id="loan_fc" class="input">
          <option value="">-</option>
          ${fixed.map(f=>`<option value="${escapeHtml(f.id)}" ${f.id===(item?.fixedCostId||"")?"selected":""}>${escapeHtml(f.name||"")}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">開始日</div>
        <input id="loan_start" class="input" type="date" value="${startStr}" />
      </div>
      <div>
        <div class="small">完済予定日</div>
        <input id="loan_finish" class="input" type="date" value="${finishStr}" />
      </div>
      <div>
        <div class="small">減税終了日</div>
        <input id="loan_tax" class="input" type="date" value="${taxStr}" />
      </div>
      <div>
        <div class="small">メモ</div>
        <input id="loan_memo" class="input" value="${escapeHtml(item?.memo||"")}" />
      </div>
    </div>
    <div class="row" style="margin-top:12px;"><button class="btn" id="loan_save">保存</button></div>
  `);

  $("#loan_save").addEventListener("click", async ()=>{
    const payload = {
      loanName: $("#loan_name").value || "",
      homeId: $("#loan_home").value || "",
      bank: $("#loan_bank").value || "",
      balance: Number($("#loan_bal").value||0),
      interestRate: $("#loan_rate").value || "",
      fixedCostId: $("#loan_fc").value || "",
      startDate: $("#loan_start").value ? new Date(`${$("#loan_start").value}T00:00:00+09:00`).getTime() : null,
      finishDate: $("#loan_finish").value ? new Date(`${$("#loan_finish").value}T00:00:00+09:00`).getTime() : null,
      taxDeductionEndDate: $("#loan_tax").value ? new Date(`${$("#loan_tax").value}T00:00:00+09:00`).getTime() : null,
      memo: $("#loan_memo").value || "",
      updatedAt: Date.now(),
    };

    let id;
    if(mode==="add"){
      const d = await addDoc(collection(db, "homeLoans"), payload);
      id = d.id;
    }else{
      id = item.id;
      await updateDoc(doc(db, "homeLoans", id), payload);
    }

    // upsert events
    if(payload.finishDate){
      await upsertEventBySource({sourceType:"homeLoans", sourceId:id, type:"loan_finish", title:`${payload.loanName||"ローン"} 完済予定日`, date: payload.finishDate});
    }
    if(payload.taxDeductionEndDate){
      await upsertEventBySource({sourceType:"homeLoans", sourceId:id, type:"loan_tax_end", title:`${payload.loanName||"ローン"} 減税終了`, date: payload.taxDeductionEndDate});
    }

    hideModal();
    await reloadAll();
  }, { once:true });
}

function calcExpectedRenewYear(installedDateMs, lifeYears){
  if(!installedDateMs || lifeYears==null || lifeYears==="") return "";
  const dt = new Date(Number(installedDateMs));
  return dt.getFullYear() + Number(lifeYears||0);
}

function openEquipModal(mode, item=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
  const homes = state.homes||[];
  const types = state.master.homeEquipmentTypes || ["電気","水回り","換気","空調","給湯","その他"];
  const instStr = item?.installedDate ? new Date(Number(item.installedDate)).toISOString().slice(0,10) : "";
  const warrantyStr = item?.warrantyEndDate ? new Date(Number(item.warrantyEndDate)).toISOString().slice(0,10) : "";

  showModal(mode==="add" ? "設備を追加" : "設備を編集", `
    <div class="formGrid">
      <div>
        <div class="small">設備名</div>
        <input id="eq_name" class="input" value="${escapeHtml(item?.equipmentName||"")}" />
      </div>
      <div>
        <div class="small">種類</div>
        <select id="eq_type" class="input">
          ${types.map(t=>`<option ${t===(item?.type||types[0])?"selected":""}>${escapeHtml(t)}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">対象住宅</div>
        <select id="eq_home" class="input">
          <option value="">-</option>
          ${homes.map(h=>`<option value="${escapeHtml(h.id)}" ${h.id===(item?.homeId||"")?"selected":""}>${escapeHtml(h.name||"")}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">設置日</div>
        <input id="eq_inst" class="input" type="date" value="${instStr}" />
      </div>
      <div>
        <div class="small">耐用年数</div>
        <input id="eq_life" class="input" type="number" value="${item?.lifeYears!=null?Number(item.lifeYears):""}" placeholder="年" />
      </div>
      <div>
        <div class="small">保証期限</div>
        <input id="eq_warranty" class="input" type="date" value="${warrantyStr}" />
      </div>
      <div>
        <div class="small">説明書リンク</div>
        <input id="eq_manual" class="input" value="${escapeHtml(item?.manualLink||"")}" placeholder="https://..." />
      </div>
      <div>
        <div class="small">メモ</div>
        <input id="eq_memo" class="input" value="${escapeHtml(item?.memo||"")}" />
      </div>
    </div>
    <div class="row" style="margin-top:12px;"><button class="btn" id="eq_save">保存</button></div>
  `);

  $("#eq_save").addEventListener("click", async ()=>{
    const installedDate = $("#eq_inst").value ? new Date(`${$("#eq_inst").value}T00:00:00+09:00`).getTime() : null;
    const lifeYears = $("#eq_life").value==="" ? null : Number($("#eq_life").value||0);
    const expected = calcExpectedRenewYear(installedDate, lifeYears);
    const warrantyEndDate = $("#eq_warranty").value ? new Date(`${$("#eq_warranty").value}T00:00:00+09:00`).getTime() : null;

    const payload = {
      equipmentName: $("#eq_name").value || "",
      type: $("#eq_type").value || "",
      homeId: $("#eq_home").value || "",
      installedDate,
      lifeYears,
      expectedRenewYear: expected || "",
      warrantyEndDate,
      manualLink: $("#eq_manual").value || "",
      memo: $("#eq_memo").value || "",
      updatedAt: Date.now(),
    };

    let id;
    if(mode==="add"){
      const d = await addDoc(collection(db, "homeEquipments"), payload);
      id = d.id;
    }else{
      id = item.id;
      await updateDoc(doc(db, "homeEquipments", id), payload);
    }

    if(payload.warrantyEndDate){
      await upsertEventBySource({sourceType:"homeEquipments", sourceId:id, type:"warranty_end", title:`${payload.equipmentName||"設備"} 保証期限`, date: payload.warrantyEndDate});
    }

    hideModal();
    await reloadAll();
  }, { once:true });
}

function openEquipPopover(anchorEl, item){
  const pop = document.createElement('div');
  pop.className = 'popover';
  const link = item?.manualLink || '';
  pop.innerHTML = `
    <div class="row">
      <div class="h2">${escapeHtml(item?.equipmentName||"設備")}</div>
      <div class="spacer"></div>
      <button class="btn mini secondary" data-pop-edit>✎</button>
      <button class="btn mini" data-pop-close>×</button>
    </div>
    <div class="sep"></div>
    <div class="small">説明書リンク</div>
    ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link)}</a>` : `<div class="muted small">-</div>`}
  `;
  document.body.appendChild(pop);

  const r = anchorEl.getBoundingClientRect();
  const top = Math.min(window.innerHeight-20, r.bottom + 8);
  const left = Math.max(10, Math.min(window.innerWidth-330, r.left));
  pop.style.top = `${top + window.scrollY}px`;
  pop.style.left = `${left + window.scrollX}px`;

  const cleanup = ()=>{ try{ pop.remove(); }catch(_){}; document.removeEventListener('mousedown', onDoc); };
  const onDoc = (ev)=>{ if(!pop.contains(ev.target) && ev.target!==anchorEl) cleanup(); };
  document.addEventListener('mousedown', onDoc);

  pop.querySelector('[data-pop-close]').addEventListener('click', cleanup);
  pop.querySelector('[data-pop-edit]').addEventListener('click', ()=>{ cleanup(); openEquipModal('edit', item); });
}

function openEventModal(mode, item=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }

  const dt = item?.date ? new Date(Number(item.date)) : new Date();
  const dateStr = dt.toISOString().slice(0,10);

  showModal(mode==="add" ? "イベントを追加" : "イベントを編集", `
    <div class="formGrid">
      <div>
        <div class="small">タイトル</div>
        <input id="e_title" class="input" value="${escapeHtml(item?.title||"")}" />
      </div>
      <div>
        <div class="small">種別</div>
        <select id="e_kind" class="input">
          ${["family","card","home","car","custom"].map(k=>`<option ${k===(item?.kind||"custom")?"selected":""}>${k}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">日付</div>
        <input id="e_date" class="input" type="date" value="${dateStr}" />
      </div>
      <div>
        <div class="small">メモ</div>
        <input id="e_note" class="input" value="${escapeHtml(item?.note||"")}" />
      </div>
      <div>
        <div class="small">有効</div>
        <select id="e_active" class="input">
          <option value="true" ${(item?.active!==false)?"selected":""}>有効</option>
          <option value="false" ${(item?.active===false)?"selected":""}>無効</option>
        </select>
      </div>
    </div>
    <div class="row" style="margin-top:12px;">
      <button class="btn" id="e_save">保存</button>
    </div>
  `);

  $("#e_save").addEventListener("click", async ()=>{
    const payload = {
      title: $("#e_title").value || "",
      kind: $("#e_kind").value || "custom",
      date: new Date(`${$("#e_date").value}T00:00:00+09:00`).getTime(),
      note: $("#e_note").value || "",
      active: $("#e_active").value === "true",
      updatedAt: Date.now()
    };
    if(mode==="add"){
      payload.createdAt = Date.now();
      await addDoc(collection(db, "events"), payload);
    }else{
      await updateDoc(doc(db, "events", item.id), payload);
    }
    hideModal();
    await reloadAll();
  }, { once:true });
}


function openFamilyModal(mode, item=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }

  const v = item || {};
  const title = (mode==="add") ? "家族を追加" : "家族を編集";
  const html = `
    <div class="grid2">
      <div>
        <label class="label">名前</label>
        <input id="f_name" class="input" value="${escapeHtml(v.name||"")}" placeholder="例：萌奈" />
      </div>
      <div>
        <label class="label">続柄</label>
        <input id="f_relation" class="input" value="${escapeHtml(v.relation||"")}" placeholder="例：妻 / 子 / 夫" />
      </div>
    </div>

    <div class="grid2" style="margin-top:10px;">
      <div>
        <label class="label">生年月日</label>
        <input id="f_birth" class="input" type="date" value="${escapeHtml(v.birthDate||"")}" />
      </div>
      <div>
        <label class="label">有効</label>
        <div class="row center gap8" style="height:44px;">
          <input id="f_active" type="checkbox" ${v.active===false?"":"checked"} />
          <span class="muted">無効にすると各選択肢から外れます</span>
        </div>
      </div>
    </div>

    <div style="margin-top:10px;">
      <label class="label">メモ</label>
      <input id="f_memo" class="input" value="${escapeHtml(v.memo||"")}" placeholder="自由記入" />
    </div>

    <div class="row gap8 end" style="margin-top:14px;">
      ${mode==="edit" ? `<button class="btn danger" id="btnDelFamily">削除</button>` : ``}
      <button class="btn" id="btnSaveFamily">保存</button>
    </div>
  `;
  showModal(title, html);

  $("#btnSaveFamily").addEventListener("click", async ()=>{
    const name = $("#f_name").value.trim();
    if(!name){ alert("名前は必須です"); return; }
    const payload = {
      name,
      relation: $("#f_relation").value.trim(),
      birthDate: $("#f_birth").value || "",
      memo: $("#f_memo").value.trim(),
      active: $("#f_active").checked,
      updatedAt: Date.now()
    };
    if(mode==="add"){
      payload.createdAt = Date.now();
      await addDoc(collection(db, "family"), payload);
    }else{
      await updateDoc(doc(db, "family", v.id), payload);
    }
    closeModal();
    await reloadAll();
  });

  const delBtn = $("#btnDelFamily");
  if(delBtn){
    delBtn.addEventListener("click", async ()=>{
      if(!confirm("削除しますか？")) return;
      await deleteDoc(doc(db, "family", v.id));
      closeModal();
      await reloadAll();
    });
  }
}


/** =========================
 *  8) Routing + App Lifecycle
 * ========================= */
function navigate(route){
  state.route = route;
  setActiveTab(route);
  mount();
}

async function reloadAll(){
  $("#btnReload").disabled = true;
  try{
    state.master = await loadMaster();
    state.bundle = await loadBundle(state.month);
    await loadMonthData(state.month);
    mount();
  }finally{
    $("#btnReload").disabled = false;
  }
}

function initMonthPicker(){
  const mp = $("#monthPicker");
  mp.innerHTML = "";
  const now = new Date();
  // last 18 months + next 3 months
  const months = [];
  for(let i=18;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push(monthKey(d));
  }
  for(let i=1;i<=3;i++){
    const d = new Date(now.getFullYear(), now.getMonth()+i, 1);
    months.push(monthKey(d));
  }
  for(const m of months){
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    mp.appendChild(opt);
  }
  mp.value = state.month;
  mp.addEventListener("change", async ()=>{
    state.month = mp.value;
    await reloadAll();
  });
}

$("#btnReload").addEventListener("click", reloadAll);
$("#btnLogout").addEventListener("click", async ()=>{ await signOut(auth); });

$$("#tabs .tab").forEach(btn=>{
  btn.addEventListener("click", ()=> navigate(btn.dataset.route));
});

// login
$("#btnLogin").addEventListener("click", async ()=>{
  const email = $("#email").value.trim();
  const password = $("#password").value;
  $("#loginMsg").textContent = "";
  try{
    await signInWithEmailAndPassword(auth, email, password);
  }catch(e){
    $("#loginMsg").textContent = `ログイン失敗: ${e.message}`;
  }
});

onAuthStateChanged(auth, async (user)=>{
  state.user = user;
  if(!user){
    $("#loginView").style.display = "block";
    $("#appView").style.display = "none";
    $("#tabs").style.display = "none";
    $("#monthPicker").style.display = "none";
    $("#btnReload").style.display = "none";
    $("#btnLogout").style.display = "none";
    return;
  }

  // logged in
  $("#loginView").style.display = "none";
  $("#appView").style.display = "block";
  $("#tabs").style.display = "flex";
  $("#monthPicker").style.display = "block";
  $("#btnReload").style.display = "inline-block";
  $("#btnLogout").style.display = "inline-block";

  try{
    state.role = await loadUserRole(user.uid);
  }catch(e){
    alert(e.message);
    await signOut(auth);
    return;
  }

  state.month = state.month || monthKey();
  initMonthPicker();

  try{
    await reloadAll();
  }catch(e){
    console.error(e);
    alert(`読み込みエラー: ${e.message}`);
  }
});