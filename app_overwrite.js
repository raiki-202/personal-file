// Personal File - Vanilla SPA (no build)
// Bundle JSON (GitHub Pages) prioritized, Firestore used for monthly input + editable data.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
  query, where, orderBy
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
  peoplePersons: [],
  peopleHealthByPersonId: {},
  creditCards: [],
  prepaidCards: [],
  cars: [],
  cardEntries: [],
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

  // For credit-card payment schedule, we need cross-month purchases.
  // Keep UI lists as state.entries (selected month only), but build schedules from state.cardEntries.
  state.cardEntries = (state.entries || []).map(e=>({ ...e, __srcMonth: month }));
  try{
    const backMonths = 2; // include previous 2 months to handle payments crossing months
    for(let i=1;i<=backMonths;i++){
      const mKey = addMonthsKey(month, -i);
      const ref = collection(db, "months", mKey, "entries");
      const qx = query(ref, orderBy("occurredAt","asc"));
      const sx = await getDocs(qx);
      const extra = sx.docs.map(d=>({ id:d.id, ...d.data(), __srcMonth: mKey }));
      state.cardEntries.push(...extra);
    }
  }catch(e){
    console.warn("[cards] extra month entries load skipped:", e?.message||e);
  }


  // balances
  const balancesRef = collection(db, "months", month, "balances");
  const s2 = await getDocs(balancesRef);
  state.balances = s2.docs.map(d=>({id:d.id, ...d.data()}));

  // fixedCosts / events
  const s3 = await getDocs(collection(db, "fixedCosts"));
  state.fixedCosts = s3.docs.map(d=>({id:d.id, ...d.data()}));

  // Auto-post fixed costs due in this month (idempotent). Requires editor/admin.
  await ensureFixedCostPosts(month);


  const s4 = await getDocs(query(collection(db, "events"), orderBy("date","asc")));
  state.events = s4.docs.map(d=>({id:d.id, ...d.data()}));
// people (family) - new schema
const sP = await getDocs(query(collection(db, "people_persons"), orderBy("name","asc")));
state.peoplePersons = sP.docs.map(d=>({id:d.id, ...d.data()}));

const sH = await getDocs(collection(db, "people_health"));
const healthMap = {};
sH.docs.forEach(d=>{
  const v = {id:d.id, ...d.data()};
  const pid = v.person_id || d.id;
  healthMap[pid] = v;
});
state.peopleHealthByPersonId = healthMap;

// legacy family (fallback / compatibility; some tabs may still reference it)
const s5 = await getDocs(query(collection(db, "family"), orderBy("name","asc")));
state.family = s5.docs.map(d=>({id:d.id, ...d.data()}));

// Auto-sync birthdays to events (idempotent). Requires editor/admin.
await syncBirthdayEvents();


  const s6 = await getDocs(query(collection(db, "creditCards"), orderBy("cardName","asc")));
  // Normalize: ensure each card has its own payable account id
  state.creditCards = s6.docs.map(d=>{
    const raw = {id:d.id, ...d.data()};
    return {
      ...raw,
      payableAccountId: payableAccountIdForCardId(d.id)
    };
  });

  const s6b = await getDocs(query(collection(db, "prepaidCards"), orderBy("cardName","asc")));
  state.prepaidCards = s6b.docs.map(d=>({id:d.id, ...d.data()}));


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

  // Normalize entries: if credit card expense, post to that card's payable account (display + delta calc)
  const normalizeEntryForAccounts = (e)=>{
    if(e?.type==="expense" && e?.paymentMethod==="クレカ" && e?.creditCardId){
      return { ...e, fromAccountId: payableAccountIdForCardId(e.creditCardId) };
    }
    return e;
  };
  if(Array.isArray(state.entries)) state.entries = state.entries.map(normalizeEntryForAccounts);
  if(Array.isArray(state.cardEntries)) state.cardEntries = state.cardEntries.map(normalizeEntryForAccounts);


}
async function ensureFixedCostPosts(month){
  try{
    if(state.role==="viewer") return;
    const fixed = state.fixedCosts || [];
    if(!fixed.length) return;

    const monthStart = new Date(`${month}-01T00:00:00+09:00`).getTime();
    const [yy,mm] = month.split("-").map(n=>Number(n));
    const monthEnd = new Date(yy, mm, 0, 23,59,59,999).getTime(); // end of month

    const existing = (state.entries||[]).filter(e=>e.meta && e.meta.fixedCostId);

    for(const fc of fixed){
      const cycleType = fc.cycleType || (fc.cycleText ? (fc.cycleText.includes("年") ? "yearly" : (fc.cycleText.includes("4") ? "quarterly" : "monthly")) : "monthly");
      const payDay = Number(fc.payDay||0) || null;
      const payMonth = Number(fc.payMonth||0) || null;

      // determine nextPayDate
      let nextMs = parseDateLikeToMs(fc.nextPayDate);
      if(!nextMs){
        nextMs = nextFixedCostDateFromSettings(cycleType, payDay, payMonth, Date.now());
        // persist the computed schedule base
        await updateDoc(doc(db, "fixedCosts", fc.id), { cycleType, payDay, payMonth, nextPayDate: nextMs, updatedAt: Date.now() });
        fc.nextPayDate = nextMs;
        fc.cycleType = cycleType; fc.payDay = payDay; fc.payMonth = payMonth;
      }

      // keep generating posts while due within this month
      let safety=0;
      while(nextMs>=monthStart && nextMs<=monthEnd && safety<24){
        const key = `${fc.id}_${nextMs}`;
        const already = existing.some(e=> (e.meta?.fixedCostId===fc.id) && (e.meta?.fixedCostAt===nextMs));
        if(!already){
          const paymentMethod = fc.paymentMethod || "現金";
          const creditCardId = (paymentMethod==="クレカ") ? (fc.creditCardId||null) : null;
          const fromAccountId = (paymentMethod==="クレカ")
            ? (creditCardId ? payableAccountIdForCardId(creditCardId) : null)
            : (fc.payAccountId || null);

          const payload = {
            type: "expense",
            category: fc.category || "固定費",
            amount: Number(fc.amount||0),
            note: fc.memo || "",
            occurredAt: nextMs,
            paymentMethod,
            creditCardId,
            creditChannel: null,
            fromAccountId,
            toAccountId: null,
            meta: {
              fixedCostId: fc.id,
              fixedCostAt: nextMs,
              fixedCostName: fc.name || ""
            },
            createdAt: Date.now(),
            createdBy: state.user.uid,
            updatedAt: Date.now()
          };
          await addDoc(collection(db, "months", month, "entries"), payload);
          // keep local state in sync (so UI immediately reflects)
          state.entries.push({ id: "__tmp__"+Math.random().toString(36).slice(2), ...payload });
          existing.push(payload);
        }

        // advance schedule and persist
        nextMs = advanceFixedCostDate(nextMs, cycleType, payDay, payMonth);
        safety++;
        await updateDoc(doc(db, "fixedCosts", fc.id), { nextPayDate: nextMs, cycleType, payDay, payMonth, updatedAt: Date.now() });
      }
    }
  }catch(e){
    console.warn("[fixedCosts] auto post skipped:", e?.message||e);
  }
}


/** =========================
 *  5) Merge logic (bundle + diff)
 * ========================= */
function getAllAccountsFromMaster(){
  const banks = (state.master?.banks || []).filter(x=>x.active!==false);
  const other = (state.master?.otherAccounts || []).filter(x=>x.active!==false);
  const list = [...banks, ...other];

  // Prepaid cards are treated as accounts (asset)
  for(const p of (state.prepaidCards||[])){
    if(!p || !p.id) continue;
    const id = prepaidAccountIdForCardId(p.id);
    if(list.some(a=>a.id===id)) continue;
    list.push({ id, name: p.cardName||p.id, type:"asset", system:false, active:(p.active!==false) });
  }

  // Auto-generated payable accounts per credit card (system)
  // id: ccpay_<cardId>, name: "<cardName>（支払予定）"
  for(const c of (state.creditCards||[])){
    if(!c || !c.id) continue;
    const id = payableAccountIdForCardId(c.id);
    // Avoid duplicates (in case master.otherAccounts already contains it)
    if(list.some(a=>a.id===id)) continue;
    list.push({ id, name: `${c.cardName||c.id}（支払予定）`, type:"liability", system:true, active:true });
  }

  return list;
}

function payableAccountIdForCardId(cardId){
  return `ccpay_${cardId}`;
}

function prepaidAccountIdForCardId(cardId){
  return `pp_${cardId}`;
}

function prepaidCardName(id){
  const c = (state.prepaidCards||[]).find(x=>x.id===id);
  return c?.cardName || id || "-";
}

function getPrepaidCardById(id){
  return (state.prepaidCards||[]).find(x=>x.id===id) || null;
}

function accountName(id){
  const all = getAllAccountsFromMaster();
  const hit = all.find(a=>a.id===id);
  return hit?.name || id || "-";
}

function creditCardName(id){
  const c = (state.creditCards||[]).find(x=>x.id===id);
  return c?.cardName || id || "-";
}
function getCreditCardById(id){
  return (state.creditCards||[]).find(x=>x.id===id) || null;
}
function ymKey(y,m){ return `${y}-${String(m).padStart(2,"0")}`; }
function addMonthsKey(key, delta){
  const [y0,m0]=key.split("-").map(n=>Number(n));
  let y=y0, m=m0+delta;
  while(m>12){ y+=1; m-=12; }
  while(m<1){ y-=1; m+=12; }
  return ymKey(y,m);
}
function lastDayOf(y,m){ return new Date(y, m, 0).getDate(); } // m=1..12

function clampDay(y,m,day){
  const ld = lastDayOf(y,m);
  return Math.min(Math.max(Number(day||1),1), ld);
}
function nextFixedCostDateFromSettings(cycleType, payDay, payMonth, baseMs){
  // baseMs: starting point (usually Date.now())
  const base = new Date(baseMs||Date.now());
  const y = base.getFullYear(), m = base.getMonth()+1;
  const d = Number(payDay||base.getDate()||1);

  if(cycleType==="yearly"){
    const mm = Number(payMonth||m);
    let yy = y;
    let dd = clampDay(yy, mm, d);
    let cand = new Date(yy, mm-1, dd, 0,0,0,0).getTime();
    if(cand < new Date(y, m-1, base.getDate(),0,0,0,0).getTime()){
      yy += 1;
      dd = clampDay(yy, mm, d);
      cand = new Date(yy, mm-1, dd, 0,0,0,0).getTime();
    }
    return cand;
  }

  const step = (cycleType==="quarterly") ? 3 : 1; // monthly default
  // try current month
  let yy = y, mm = m;
  let dd = clampDay(yy, mm, d);
  let cand = new Date(yy, mm-1, dd, 0,0,0,0).getTime();
  const today0 = new Date(y, m-1, base.getDate(),0,0,0,0).getTime();
  if(cand < today0){
    // move to next cycle month
    let key = addMonthsKey(ymKey(y,m), step);
    const [y2,m2] = key.split("-").map(n=>Number(n));
    yy=y2; mm=m2;
    dd = clampDay(yy, mm, d);
    cand = new Date(yy, mm-1, dd, 0,0,0,0).getTime();
  }
  return cand;
}
function advanceFixedCostDate(prevMs, cycleType, payDay, payMonth){
  const prev = new Date(prevMs);
  const y = prev.getFullYear(), m = prev.getMonth()+1;
  const d = Number(payDay||prev.getDate()||1);
  if(cycleType==="yearly"){
    const mm = Number(payMonth||m);
    const yy = y + 1;
    const dd = clampDay(yy, mm, d);
    return new Date(yy, mm-1, dd, 0,0,0,0).getTime();
  }
  const step = (cycleType==="quarterly") ? 3 : 1;
  const key = addMonthsKey(ymKey(y,m), step);
  const [y2,m2] = key.split("-").map(n=>Number(n));
  const dd = clampDay(y2, m2, d);
  return new Date(y2, m2-1, dd, 0,0,0,0).getTime();
}
function ymd(ms){
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${y}/${m}/${dd}`;
}

function parseDateLikeToMs(v){
  // Accept: ms(number), Firestore Timestamp-like, Date, ISO string, "YYYY/MM/DD", "YYYY-MM-DD"
  if(v==null) return null;

  // Firestore Timestamp {seconds, nanoseconds} or Date
  if(typeof v==="object"){
    if(v instanceof Date) return v.getTime();
    if(("seconds" in v) && typeof v.seconds==="number"){
      const ns = ("nanoseconds" in v && typeof v.nanoseconds==="number") ? v.nanoseconds : 0;
      return v.seconds*1000 + Math.floor(ns/1e6);
    }
  }

  if(typeof v==="number" && isFinite(v)) return v;

  if(typeof v==="string"){
    const s = v.trim();
    if(!s) return null;
    const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if(m){
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      if(y && mo && d) return new Date(y, mo-1, d, 0,0,0,0).getTime();
    }
    const t = Date.parse(s);
    if(!Number.isNaN(t)) return t;
  }
  return null;
}

function paymentDateMsForMonth(card, payMonthKey){
  const [y,m]=payMonthKey.split("-").map(n=>Number(n));
  const pd = Number(card?.paymentDay||27) || 27;
  const d = Math.min(Math.max(pd,1), lastDayOf(y,m));
  return new Date(y, m-1, d, 0,0,0,0).getTime();
}
function statementMonthForEntry(card, entry){
  const t = Number(entry?.occurredAt||0);
  if(!t) return null;
  const d = new Date(t);
  const y=d.getFullYear(), m=d.getMonth()+1, day=d.getDate();
  // base closing day
  const cdRaw = (card?.closingDay ?? "EOM");
  let cd = (cdRaw==="EOM") ? lastDayOf(y,m) : Number(cdRaw||0);
  if(!cd || cd<1 || cd>31) cd = lastDayOf(y,m);

  // optional exception by channel (e.g., 楽天市場:25日締め)
  const ch = (entry?.creditChannel || entry?.channel || "").trim();
  if(card?.exceptionChannel && ch && ch===card.exceptionChannel){
    const ex = Number(card.exceptionClosingDay||0);
    if(ex>=1 && ex<=31) cd = ex;
  }

  // statement month key
  if(day<=cd) return ymKey(y,m);
  return addMonthsKey(ymKey(y,m), 1);
}
function buildCardPaymentSchedule(){
  const cards = (state.creditCards||[]).filter(c=>c.active!==false && c.status!=="stopped");
  const fixedMap = new Map((state.fixedCosts||[]).map(f=>[f.id,f]));
  const entries = (state.cardEntries||state.entries||[]).filter(e=>e.type==="expense" && e.paymentMethod==="クレカ").map(e=>{
    if(e && !e.creditCardId && e.meta?.fixedCostId){
      const fc = fixedMap.get(e.meta.fixedCostId);
      if(fc?.creditCardId) return { ...e, creditCardId: fc.creditCardId };
    }
    return e;
  }).filter(e=>e.creditCardId);
  const items = [];
  for(const c of cards){
    const es = entries.filter(e=>e.creditCardId===c.id);
    const byPayMonth = new Map(); // payMonthKey -> amount
    for(const e of es){
      const st = statementMonthForEntry(c, e);
      if(!st) continue;
      const off = Number(c?.paymentMonthOffset||1) || 1;
      const payMonth = addMonthsKey(st, off);
      const amt = Number(e.amount||0);
      if(!amt) continue;
      byPayMonth.set(payMonth, (byPayMonth.get(payMonth)||0) + amt);
    }
    for(const [payMonth, amount] of byPayMonth.entries()){
      const payDateMs = paymentDateMsForMonth(c, payMonth);
      items.push({ cardId:c.id, cardName:c.cardName||c.id, payMonth, payDateMs, amount });
    }
  }
  return items;
}
function computeNextCardPayment(){
  // nearest upcoming payment date (today or later), aggregated across cards
  const schedule = buildCardPaymentSchedule().filter(x=>x.amount!==0);
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0,0).getTime();
  const upcoming = schedule.filter(x=>x.payDateMs>=today0).sort((a,b)=>a.payDateMs-b.payDateMs);
  if(!upcoming.length) return null;
  const nextDate = upcoming[0].payDateMs;
  const sameDay = upcoming.filter(x=>x.payDateMs===nextDate);
  const byCard = sameDay.map(x=>({cardId:x.cardId, cardName:x.cardName, amount:x.amount}));
  const total = byCard.reduce((s,x)=>s+Number(x.amount||0),0);
  const dateStr = new Date(nextDate).toLocaleDateString("ja-JP");
  return { total, dateStr, byCard, payDateMs: nextDate };
}
function autoCardPaymentDeltasForMonth(monthKey){
  // On/after payment day: reflect automatic debit from payment account and clearing payable account (display-only)
  const deltas = new Map();
  const schedule = buildCardPaymentSchedule();
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0,0).getTime();
  for(const s of schedule){
    if(s.payDateMs>today0) continue; // not yet debited
    const card = getCreditCardById(s.cardId);
    const payAcc = card?.paymentAccountId || "rakuten";
    const payable = payableAccountIdForCardId(s.cardId);
    const amt = Number(s.amount||0);
    if(!amt) continue;
    deltas.set(payAcc, (deltas.get(payAcc)||0) - amt);
    deltas.set(payable, (deltas.get(payable)||0) + amt); // reduce liability (toward 0)
  }
  return deltas;
}

function entryAccountLabel(e){
  if(!e) return "-";
  if(e.type==="income") return accountName(e.toAccountId||"-");
  if(e.type==="expense"){
    if(e.paymentMethod==="クレカ" && e.creditCardId) return creditCardName(e.creditCardId);
    if(e.paymentMethod==="プリペイド" && e.prepaidCardId) return prepaidCardName(e.prepaidCardId);
    return accountName(e.fromAccountId||"-");
  }
  if(e.type==="transfer"){
    const f = accountName(e.fromAccountId||"-");
    const t = accountName(e.toAccountId||"-");
    return `${f} → ${t}`;
  }
  if(e.type==="charge"){
    const t = e.prepaidCardId ? prepaidCardName(e.prepaidCardId) : accountName(e.toAccountId||"-");
    if(e.chargeMethod==="クレカ" && e.creditCardId) return `${creditCardName(e.creditCardId)} → ${t}`;
    const f = accountName(e.fromAccountId||"-");
    return `${f} → ${t}`;
  }
  return "-";
}

function accountDeltasFromEntries(){
  const m = new Map();
  const fixedMap = new Map((state.fixedCosts||[]).map(f=>[f.id,f]));
  for(const e of (state.entries||[])){
    const amt = Number(e.amount||0);
    if(e.type==="income"){
      const to = e.toAccountId;
      if(to){ m.set(to, (m.get(to)||0) + amt); }
    }else if(e.type==="expense"){
      let from = e.fromAccountId;
      // For credit-card expenses, if fromAccountId is not set, attribute to the card's payable account
      if(!from && e.paymentMethod==="クレカ"){
        let cardId = e.creditCardId;
        if(!cardId && e.meta?.fixedCostId){
          const fc = fixedMap.get(e.meta.fixedCostId);
          if(fc?.creditCardId) cardId = fc.creditCardId;
        }
        if(cardId) from = payableAccountIdForCardId(cardId);
      }
      // For prepaid expenses, if fromAccountId is not set, attribute to the prepaid account
      if(!from && e.paymentMethod==="プリペイド" && e.prepaidCardId){
        from = prepaidAccountIdForCardId(e.prepaidCardId);
      }
      if(from){ m.set(from, (m.get(from)||0) - amt); }
    }else if(e.type==="transfer"){
      const from = e.fromAccountId;
      const to = e.toAccountId;
      if(from){ m.set(from, (m.get(from)||0) - amt); }
      if(to){ m.set(to, (m.get(to)||0) + amt); }
    }else if(e.type==="charge"){
      let from = e.fromAccountId;
      const to = e.toAccountId;
      // credit-card charge: attribute to payable account
      if(!from && e.chargeMethod==="クレカ" && e.creditCardId){
        from = payableAccountIdForCardId(e.creditCardId);
      }
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

  const deltas = accountDeltasFromEntries();
  const autoDeltas = autoCardPaymentDeltasForMonth(state.month);
  const deltaOf = (id)=> Number(deltas.get(id)||0) + Number(autoDeltas.get(id)||0);

  const activeCards = (state.creditCards||[]).filter(c=>c.active!==false && c.status!=="stopped");
  const payableRows = activeCards.map(c=>{
    const payableId = payableAccountIdForCardId(c.id);
    const baseBal = Number(mb.find(x=>x.id===payableId)?.balance||0);
    const estBal = baseBal + deltaOf(payableId);
    return { cardId:c.id, cardName:c.cardName||c.name||"(no name)", id:payableId, baseBal, delta: deltaOf(payableId), estBal };
  });

  const bankRows = mb
    .filter(a=> !String(a.id||"").startsWith("ccpay_") && (accounts.find(x=>x.id===a.id)?.type||"")!=="liability")
    .map(a=>{
      const baseBal = Number(a.balance||0);
      const d = deltaOf(a.id);
      return { id:a.id, name:nameOf(a.id), baseBal, delta:d, estBal: baseBal + d };
    });

  const totalBankEst = bankRows.reduce((s,r)=> s + r.estBal, 0);
  const totalCardOutstanding = payableRows.reduce((s,r)=> s + (r.estBal<0 ? -r.estBal : 0), 0);
  const totalNetEst = totalBankEst - totalCardOutstanding;
  const soon = state.events.filter(e=> e.active!==false && withinDays(Number(e.date||0), 90));

  return `
	    <div class="card" style="margin-bottom:12px;">
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
    ${(()=>{
      const np = computeNextCardPayment();
      if(!np || !np.total) return "";
      return `
        <div class="grid cols3" style="margin-top:12px;">
          <div class="card">
            <div class="h2">次回クレカ支払予定</div>
            <div class="kpi">¥${yen(np.total)}</div>
            <div class="small">支払日（目安）：${escapeHtml(np.dateStr)}</div>
            ${np.byCard.length<=1 ? "" : `<div class="small" style="margin-top:6px;">内訳：${np.byCard.map(x=>`${escapeHtml(x.cardName)} ¥${yen(x.amount)}`).join(" / ")}</div>`}
          </div>
        </div>
      `;
    })()}



    <div class="card" style="margin-top:12px;">
      <div class="row">
        <h2 class="h1">口座合計（入力/差分反映後）</h2>
        <div class="spacer"></div>
        <span class="badge">銀行・現金 ¥${yen(totalBankEst)}</span>
        <span class="badge" style="margin-left:8px;">クレカ支払予定 ¥${yen(totalCardOutstanding)}</span>
        <span class="badge" style="margin-left:8px;">実質 ¥${yen(totalNetEst)}</span>
      </div>
      <div class="small" style="margin-top:10px;opacity:.8;">
        ※推定残高＝（月末残高 or 入力残高）＋今月差分（入出金/資金移動/固定費自動反映）＋クレカ引落（支払日到来分）
      </div>
    </div>

    <div class="grid cols2" style="margin-top:12px;">
      <div class="card">
        <div class="row">
          <h2 class="h1">銀行口座・現金</h2>
          <div class="spacer"></div>
          <span class="badge">合計 ¥${yen(totalBankEst)}</span>
        </div>
        <div class="sep"></div>
        <table class="table">
          <thead><tr><th>口座</th><th class="right">推定残高</th></tr></thead>
          <tbody>
            ${bankRows.map(r=>`
              <tr>
                <td>${escapeHtml(r.name)}${r.id==="sbi_net" ? "（目的別あり）":""}</td>
                <td class="right">¥${yen(r.estBal)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="row">
          <h2 class="h1">クレカ支払予定</h2>
          <div class="spacer"></div>
          <span class="badge">合計 ¥${yen(totalCardOutstanding)}</span>
        </div>
        <div class="sep"></div>
        <table class="table">
          <thead><tr><th>カード</th><th class="right">推定残高</th></tr></thead>
          <tbody>
            ${payableRows.map(r=>`
              <tr>
                <td>${escapeHtml(r.cardName)}（支払予定）</td>
                <td class="right">¥${yen(r.estBal)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

	    </div>
  `;
}


function calcAge(birth){
  // birth: "YYYY/MM/DD" or "YYYY-MM-DD"
  if(!birth) return "";
  const s = String(birth).trim().replace(/\//g,"-");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if(!m) return "";
  const y = +m[1], mo=+m[2], d=+m[3];
  const today = new Date();
  let age = today.getFullYear() - y;
  const mNow = today.getMonth()+1;
  const dNow = today.getDate();
  if(mNow < mo || (mNow===mo && dNow < d)) age--;
  return age>=0 ? String(age) : "";
}

function renderFamily(){
  const list = (state.peoplePersons && state.peoplePersons.length) ? state.peoplePersons : (state.family||[]);
  const showInactive = !!state._showInactiveFamily;

  const relLabel = (v)=>{
    const map = {self:"本人", spouse:"配偶者", child:"子", other:"その他"};
    return map[v] || (v||"-");
  };
  const genderLabel = (v)=>{
    const map = {male:"男", female:"女", other:"その他"};
    return map[v] || (v||"-");
  };

  const rows = list
    .filter(x=> showInactive ? true : (x.active!==false))
    .map(x=>{
      const bd = (x.birth_date || x.birthDate || "") ? escapeHtml(String(x.birth_date || x.birthDate).replace(/\//g,"-")) : "-";
      const age = bd!=="-" ? calcAge(bd) : "";
      const rel = relLabel(x.relation);
      const kana = x.name_kana || x.kana || "";
      const phone = x.phone_number || x.phone || "";
      const email = x.email || "";
      const blood = state.peopleHealthByPersonId?.[x.id]?.blood_type || "-";
      const allergy = state.peopleHealthByPersonId?.[x.id]?.allergies || "-";
      const inactive = (x.active===false);
      return `
        <tr class="${inactive?'dim':''}">
          <td>${escapeHtml(x.name||"")}${inactive?` <span class="pill">無効</span>`:""}</td>
          <td>${escapeHtml(rel)}</td>
          <td>${bd}</td>
          <td>${age?escapeHtml(age):"-"}</td>
          <td>${escapeHtml(genderLabel(x.gender||""))}</td>
          <td>${escapeHtml(kana||"-")}</td>
          <td>${escapeHtml(phone||"-")}</td>
          <td>${escapeHtml(email||"-")}</td>
          <td class="muted">${escapeHtml((x.notes||x.memo||"")||"-")}</td>
          <td>${escapeHtml(blood||"-")}</td>
          <td>${escapeHtml(allergy||"-")}</td>
          <td class="right">
            <button class="btn mini" data-edit-person="${x.id}">基本情報</button>
            <button class="btn mini secondary" data-edit-health="${x.id}">健康</button>
            <button class="btn mini danger" data-del-person="${x.id}">削除</button>
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
        <button class="btn" id="btnAddPerson">＋追加</button>
      </div>
      <div class="sep"></div>

      <div class="tableWrap">
        <table class="table">
          <thead>
            <tr>
              <th>名前</th>
              <th>続柄</th>
              <th>誕生日</th>
              <th>年齢</th>
              <th>性別</th>
              <th>ふりがな</th>
              <th>電話</th>
              <th>メール</th>
              <th>メモ</th>
              <th>血液型</th>
              <th>アレルギー</th>
              <th class="right">操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="12" class="muted">まだありません。</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="muted small" style="margin-top:10px;">
        ・基本情報は <code>people_persons</code>、健康情報は <code>people_health</code> に保存します。<br/>
        ・誕生日は「定期イベント」に自動反映します（次回の誕生日日付を登録）。
      </div>
    </div>
  `;
}



function renderCar(){
  const list = (state.cars||[]).slice().sort((a,b)=> (a.carName||"").localeCompare(b.carName||""));
  const owners = ((state.peoplePersons && state.peoplePersons.length) ? state.peoplePersons : (state.family||[])).filter(f=>f.active!==false);
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
    {key:"prepaid", label:"プリペイド"},
  ];

  const body = (
    section==="entries" ? renderMoneyEntries() :
    section==="accounts" ? renderAccounts(true) :
    section==="fixed" ? renderFixed(true) :
    section==="cards" ? renderCreditCards() :
    renderPrepaidCards()
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
    {key:"charge", label:"チャージ"},
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

      ${""}



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
        ・入金：入金先 / 出金：出金元 / 資金移動：出金元→出金先 / チャージ：チャージ元→プリペイド を保存します。<br/>
        ・口座管理では、月末残高（手入力）＋ 今月の入出金/移動の差分で「推定残高」を表示します。
      </div>
    </div>
  `;
}

function renderAccounts(){
  const accounts = getAllAccountsFromMaster();
  const mb = mergedBalances();
  const deltas = accountDeltasFromEntries();
  const autoDeltas = autoCardPaymentDeltasForMonth(state.month);
  const deltaOf = (id)=> Number(deltas.get(id)||0) + Number(autoDeltas.get(id)||0);
  const activeCards = (state.creditCards||[]).filter(c=>c.active!==false && c.status!=="stopped");
  const outstandingByPayAcc = new Map();
  for(const c of activeCards){
    const payAcc = c.paymentAccountId || "rakuten";
    const payableId = payableAccountIdForCardId(c.id);
    const pb = (mb.find(x=>x.id===payableId)?.balance||0);
    const est = Number(pb) + deltaOf(payableId);
    const out = est<0 ? (-est) : 0;
    outstandingByPayAcc.set(payAcc, (outstandingByPayAcc.get(payAcc)||0) + out);
  }
  const nextPay = computeNextCardPayment();

// per-card next payment (today or later) - same logic as クレカ情報タブ
const schedule = buildCardPaymentSchedule().filter(x=>x.amount!==0);
const now = new Date();
const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0,0).getTime();
const nextByCard = new Map();
schedule
  .filter(x=>x.payDateMs>=today0)
  .sort((a,b)=>a.payDateMs-b.payDateMs)
  .forEach(x=>{ if(!nextByCard.has(x.cardId)) nextByCard.set(x.cardId, x); });


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
              <th class="right">先月末残高</th>
              <th class="right">今月差分</th>
              <th class="right">推定残高</th>
            </tr>
          </thead>
          <tbody>
            ${(()=>{
              const isPayableId = (id)=>{
                const sid = String(id||"");
                if(sid.startsWith("ccpay_")) return true;
                const a = accounts.find(x=>x.id===id);
                return a?.type==="liability" || a?.system===true;
              };
              const bankRows = mb.filter(x=>x.id!=="nisa" && !isPayableId(x.id));
              return bankRows.map(a=>{
                const d = deltaOf(a.id);
                const est = Number(a.balance||0) + d;
                const out = Number(outstandingByPayAcc.get(a.id)||0);
                const due = (nextPay && nextPay.paymentAccountId===a.id)
                  ? `（次回 ${escapeHtml(nextPay.payMonth||"")}/${String(nextPay.payDay||"").padStart(2,"0")}）`
                  : "";
                const extra = out>0 ? `<div class="small">支払予定：▲¥${yen(out)}${due}</div>` : "";
                return `
                  <tr>
                    <td>${escapeHtml(accountName(a.id))}${extra}</td>
                    <td class="right">¥${yen(a.balance)}</td>
                    <td class="right">${d===0?"-":`¥${yen(d)}`}</td>
                    <td class="right"><b>¥${yen(est)}</b></td>
                  </tr>
                `;
              }).join("");
            })()}
          </tbody>
        </table>

        
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


<div class="sep" style="margin:14px 0;"></div>
<div class="h2">カード別：次回支払い予定</div>
<div class="small muted" style="margin-top:6px;">※今日以降で一番近い支払日をカードごとに表示</div>
<div class="sep" style="margin:10px 0;"></div>
<table class="table">
  <thead><tr><th>カード</th><th>支払日</th><th class="right">金額</th></tr></thead>
  <tbody>
    ${(activeCards.length===0) ? `<tr><td colspan="3" class="small">-</td></tr>` : activeCards.map(c=>{
      const nx = nextByCard.get(c.id);
      const d = nx ? new Date(nx.payDateMs).toLocaleDateString("ja-JP") : "-";
      const a = nx ? `¥${yen(nx.amount)}` : "-";
      return `<tr><td>${escapeHtml(c.cardName||"")}</td><td>${escapeHtml(d)}</td><td class="right" style="white-space:nowrap;">${escapeHtml(a)}</td></tr>`;
    }).join("")}
  </tbody>
</table>

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

  // per-card next payment (today or later)
  const schedule = buildCardPaymentSchedule().filter(x=>x.amount!==0);
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0,0).getTime();
  const nextByCard = new Map();
  schedule
    .filter(x=>x.payDateMs>=today0)
    .sort((a,b)=>a.payDateMs-b.payDateMs)
    .forEach(x=>{ if(!nextByCard.has(x.cardId)) nextByCard.set(x.cardId, x); });

  function ruleLine(c){
    const close = (c?.closingDay==="EOM" || c?.closingDay==null) ? "末日" : `${c.closingDay}日`;
    const off = Number(c?.paymentMonthOffset||1)||1;
    const offTxt = off===2 ? "翌々月" : "翌月";
    const pd = Number(c?.paymentDay||27)||27;
    return `締め:${close} / 支払:${offTxt}${pd}日`;
  }

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
              <th>次回支払</th>
              <th>状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${visible.length===0 ? `<tr><td colspan="7" class="small">まだありません。</td></tr>` : visible.map(c=>{
              const nx = nextByCard.get(c.id);
              const nxStr = nx ? `${new Date(nx.payDateMs).toLocaleDateString("ja-JP")} / ¥${yen(nx.amount)}` : "-";
              return `
              <tr class="${(c.active===false||c.status==="stopped")?'dim':''}">
                <td>
                  ${escapeHtml(c.cardName||"")}
                  <div class="small muted">${escapeHtml(ruleLine(c))}</div>
                </td>
                <td>${escapeHtml(c.issuer||c.company||"-")}</td>
                <td>${escapeHtml(c.last4||"-")}</td>
                <td>${escapeHtml(c.expiryDate||c.expireDate||"-")}</td>
                <td>${escapeHtml(nxStr)}</td>
                <td>${escapeHtml(c.status|| (c.active===false?"inactive":"active"))}</td>
                <td class="right">
                  <button class="btn secondary" data-edit-card="${c.id}">編集</button>
                  <button class="btn danger" data-del-card="${c.id}">削除</button>
                </td>
              </tr>
            `;
            }).join("")}
          </tbody>
        </table>
      </div>

      <div class="sep"></div>
      <div class="card" style="box-shadow:none;">
        <div class="h2">カード別：次回支払予定</div>
        <div class="small muted" style="margin-top:6px;">※今日以降で一番近い支払日をカードごとに表示</div>
        <div class="sep" style="margin:10px 0;"></div>
        <table class="table">
          <thead><tr><th>カード</th><th>支払日</th><th class="right">金額</th></tr></thead>
          <tbody>
            ${(visible.length===0) ? `<tr><td colspan="3" class="small">-</td></tr>` : visible.map(c=>{
              const nx = nextByCard.get(c.id);
              const d = nx ? new Date(nx.payDateMs).toLocaleDateString("ja-JP") : "-";
              const a = nx ? `¥${yen(nx.amount)}` : "-";
              return `<tr><td>${escapeHtml(c.cardName||"")}</td><td style="white-space:nowrap;">${escapeHtml(d)}</td><td class="right" style="white-space:nowrap;">${escapeHtml(a)}</td></tr>`;
            }).join("")}
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
    btnAddEntry.addEventListener("click", ()=>{
      // Resolve active money sub-tab from DOM to avoid state desync
      const activeBtn = document.querySelector('[data-moneytab].active') || document.querySelector('.tab.active[data-moneytab]');
      const key = activeBtn ? activeBtn.dataset.moneytab : null;
      if(key) state._moneyTab = key;
      openEntryModal("add");
    });
  }


// entry detail (read-only)
$$("[data-entrydetail]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const id = btn.dataset.entrydetail;
    const e = state.entries.find(x=>x.id===id);
    if(!e) return;
    const typeLabel = ({income:"入金", expense:"出金", transfer:"資金移動", charge:"チャージ"})[e.type] || (e.type||"-");
    const html = `
      <div class="kv">
        <div class="kvRow"><div class="kvKey">日付</div><div class="kvVal">${e.occurredAt ? new Date(Number(e.occurredAt)).toLocaleDateString("ja-JP") : "-"}</div></div>
        <div class="kvRow"><div class="kvKey">種別</div><div class="kvVal">${escapeHtml(typeLabel)}</div></div>
        <div class="kvRow"><div class="kvKey">カテゴリ</div><div class="kvVal">${escapeHtml(e.category||"-")}</div></div>
        <div class="kvRow"><div class="kvKey">金額</div><div class="kvVal">¥${yen(e.amount||0)}</div></div>
        ${e.fromAccountId ? `<div class="kvRow"><div class="kvKey">出金元</div><div class="kvVal">${escapeHtml(accountName(e.fromAccountId))}</div></div>` : ``}
        ${e.toAccountId ? `<div class="kvRow"><div class="kvKey">入金先</div><div class="kvVal">${escapeHtml(accountName(e.toAccountId))}</div></div>` : ``}
        ${e.memo ? `<div class="kvRow"><div class="kvKey">メモ</div><div class="kvVal">${escapeHtml(e.memo)}</div></div>` : ``}
      </div>
      <div class="sep"></div>
      <div class="row" style="gap:10px;justify-content:flex-end;">
        <button class="btn" id="btnDetailEdit">編集</button>
        <button class="btn danger" id="btnDetailDel">削除</button>
      </div>
    `;
    showModal("詳細", html);
    const be = $("#btnDetailEdit");
    const bd = $("#btnDetailDel");
    if(be) be.addEventListener("click", ()=>{
      closeModal();
      openEntryModal("edit", e);
    });
    if(bd) bd.addEventListener("click", async ()=>{
      if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
      closeModal();
      if(!confirm("削除しますか？")) return;
      await deleteDoc(doc(db, "months", state.month, "entries", id));
      await reloadAll();
    });
  });
});

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


  // prepaid cards
  const btnAddPrepaid = $("#btnAddPrepaid");
  if(btnAddPrepaid){
    btnAddPrepaid.addEventListener("click", ()=> openPrepaidModal("add"));
  }
  $$('[data-edit-prepaid]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.editPrepaid;
      openPrepaidModal('edit', (state.prepaidCards||[]).find(x=>x.id===id));
    });
  });
  $$('[data-del-prepaid]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(state.role==='viewer'){ alert('viewer は編集できません'); return; }
      const id = btn.dataset.delPrepaid;
      if(!confirm('削除しますか？')) return;
      await deleteDoc(doc(db, 'prepaidCards', id));
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
  // family (people_persons / people_health)
const btnAddPerson = $("#btnAddPerson");
if(btnAddPerson){
  btnAddPerson.addEventListener("click", ()=> openPersonModal("add"));
}
const toggleFamilyInactive = $("#toggleFamilyInactive");
if(toggleFamilyInactive){
  toggleFamilyInactive.addEventListener("change", ()=>{
    state._showInactiveFamily = toggleFamilyInactive.checked;
    mount();
  });
}
$$("[data-edit-person]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const id = btn.dataset.editPerson;
    const p = (state.peoplePersons||[]).find(x=>x.id===id);
    openPersonModal("edit", p);
  });
});
$$("[data-edit-health]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const id = btn.dataset.editHealth;
    const p = (state.peoplePersons||[]).find(x=>x.id===id);
    openHealthModal(p);
  });
});
$$("[data-del-person]").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
    const id = btn.dataset.delPerson;
    if(!confirm("削除しますか？（健康情報も削除）")) return;
    await deleteDoc(doc(db, "people_persons", id)).catch(()=>{});
    await deleteDoc(doc(db, "people_health", id)).catch(()=>{});
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

// alias for compatibility
const openModal = showModal;
// NOTE: closeModal() is defined below as a function. Do not redeclare as const.

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
  const type = (entry && entry.type) ? entry.type : (state._moneyTab || "income");
  const cats = (type==="charge") ? [] : (type==="income" ? state.master.incomeCategories : (type==="expense" ? state.master.expenseCategories : state.master.transferCategories));
  // In entry forms, hide system-generated payable accounts (they are chosen automatically when paymentMethod is クレカ)
  const accounts = getAllAccountsFromMaster().filter(a=>!a.system);
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
      const payMethods = (state.master.paymentMethods||["現金","振込","口座引落","クレカ"]);
      const paySel = entry?.paymentMethod || payMethods[0] || "現金";
      const sel = entry?.fromAccountId || accounts[0]?.id || "";
      const cardSel = entry?.creditCardId || (state.creditCards?.[0]?.id||"");
      const cardOpts = (state.creditCards||[]).filter(c=>c.active!==false && c.status!=="stopped")
        .map(c=>`<option value="${escapeHtml(c.id)}" ${c.id===cardSel?"selected":""}>${escapeHtml(c.cardName||c.id)}</option>`).join("");
      const ppSel = entry?.prepaidCardId || (state.prepaidCards?.[0]?.id||"");
      const ppOpts = (state.prepaidCards||[]).filter(p=>p.active!==false)
        .map(p=>`<option value="${escapeHtml(p.id)}" ${p.id===ppSel?"selected":""}>${escapeHtml(p.cardName||p.id)}</option>`).join("");

      return `
        <div>
          <div class="small">支払い方法</div>
          <select id="m_payMethod" class="input">
            ${payMethods.map(p=>`<option ${p===paySel?"selected":""}>${escapeHtml(p)}</option>`).join("")}
          </select>
        </div>

        <div id="m_fromWrap">
          <div class="small">出金元銀行</div>
          <select id="m_fromAccount" class="input">${opts(sel)}</select>
        </div>

        <div id="m_prepaidWrap" style="display:none;">
          <div class="small">プリペイド</div>
          <select id="m_prepaid" class="input">${ppOpts}</select>
        </div>

        <div id="m_cardWrap" style="display:none;">
          <div class="small">クレカ</div>
          <select id="m_card" class="input">${cardOpts}</select>
          <div class="small" style="margin-top:10px;">利用先（任意）</div>
          <select id="m_cardChannel" class="input">
            ${["通常","楽天市場"].map(x=>`<option ${((entry?.creditChannel||"通常")===x)?"selected":""}>${escapeHtml(x)}</option>`).join("")}
          </select>
          <div class="small" style="margin-top:6px;">※クレカ利用分は「支払予定」に積み上げ、引落日に口座から減ります。</div>
        </div>
      `;
    }

    if(type==="charge"){
      const payMethods = (state.master.paymentMethods||["現金","振込","口座引落","クレカ"]);
      const methodSel = entry?.chargeMethod || entry?.paymentMethod || payMethods[0] || "現金";
      const fromSel = entry?.fromAccountId || accounts[0]?.id || "";
      const cardSel = entry?.creditCardId || (state.creditCards?.[0]?.id||"");
      const toP = entry?.prepaidCardId || (state.prepaidCards?.[0]?.id||"");
      const cardOpts = (state.creditCards||[]).filter(c=>c.active!==false && c.status!=="stopped")
        .map(c=>`<option value="${escapeHtml(c.id)}" ${c.id===cardSel?"selected":""}>${escapeHtml(c.cardName||c.id)}</option>`).join("");
      const ppOpts = (state.prepaidCards||[]).filter(p=>p.active!==false)
        .map(p=>`<option value="${escapeHtml(p.id)}" ${p.id===toP?"selected":""}>${escapeHtml(p.cardName||p.id)}</option>`).join("");

      return `
        <div>
          <div class="small">チャージ方法</div>
          <select id="m_payMethod" class="input">
            ${payMethods.map(p=>`<option ${p===methodSel?"selected":""}>${escapeHtml(p)}</option>`).join("")}
          </select>
        </div>

        <div id="m_fromWrap">
          <div class="small">チャージ元</div>
          <select id="m_fromAccount" class="input">${opts(fromSel)}</select>
        </div>

        <div id="m_cardWrap" style="display:none;">
          <div class="small">クレカ</div>
          <select id="m_card" class="input">${cardOpts}</select>
        </div>

        <div>
          <div class="small">チャージ先（プリペイド）</div>
          <select id="m_toPrepaid" class="input">${ppOpts}</select>
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
      <div style="display:${type==="charge" ? "none" : ""};">
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

  
  // expense: toggle payment UI
  const syncPayUi = ()=>{
    if(type!=="expense" && type!=="charge") return;
    const pm = $("#m_payMethod") ? $("#m_payMethod").value : "";
    const isCard = (pm==="クレカ");
    const isPrepaid = (pm==="プリペイド");
    if($("#m_cardWrap")) $("#m_cardWrap").style.display = isCard ? "" : "none";
    if($("#m_prepaidWrap")) $("#m_prepaidWrap").style.display = isPrepaid ? "" : "none";
    if($("#m_fromWrap")) {
      const wrap = $("#m_fromWrap");
      const sel = $("#m_fromAccount");
      const cashId = state.master?.cashAccountId || "cash";
      wrap.style.display = (isCard || isPrepaid) ? "none" : "";
      if(type==="charge" && sel){
        // For cash charge: show "----" (no charge-from selection), but internally treat it as cash account.
        if(!sel.dataset.orig) sel.dataset.orig = sel.innerHTML;
        if(pm==="現金"){
          sel.innerHTML = `<option value="${cashId}">----</option>`;
          sel.value = cashId;
          sel.disabled = true;
        }else{
          // restore original options
          if(sel.dataset.orig) sel.innerHTML = sel.dataset.orig;
          sel.disabled = false;
        }
      }
    }
  };
  if($("#m_payMethod")) $("#m_payMethod").addEventListener("change", syncPayUi);
  syncPayUi();

$("#m_save").addEventListener("click", async ()=>{
    const category = $("#m_category").value;
    const amount = Number($("#m_amount").value||0);
    const date = $("#m_date").value;
    const note = $("#m_note").value || "";
    const occurredAt = new Date(`${date}T00:00:00+09:00`).getTime();

    const fromAccountId = $("#m_fromAccount") ? $("#m_fromAccount").value : null;
    const toAccountId = $("#m_toAccount") ? $("#m_toAccount").value : null;
    const paymentMethod = $("#m_payMethod") ? $("#m_payMethod").value : null;
    const creditCardId = $("#m_card") ? $("#m_card").value : null;
    const prepaidCardId = $("#m_prepaid") ? $("#m_prepaid").value : null;
    const creditChannel = $("#m_cardChannel") ? $("#m_cardChannel").value : null;

    // Effective accounts (system rules)
    let effectiveFrom = fromAccountId;
    let effectiveTo = toAccountId;
    let effectiveCardId = null;
    let effectivePrepaidId = prepaidCardId || null;

    if(type==="expense" && paymentMethod==="クレカ"){
      effectiveCardId = creditCardId || null;
      // Always post to this card's payable account (auto-generated)
      effectiveFrom = effectiveCardId ? payableAccountIdForCardId(effectiveCardId) : null;
    }

    if(type==="expense" && paymentMethod==="プリペイド"){
      // Expense paid by prepaid: subtract from prepaid balance
      effectiveFrom = effectivePrepaidId ? prepaidAccountIdForCardId(effectivePrepaidId) : null;
    }

    if(type==="charge"){
      // Charge: from source -> prepaid
      const chMethod = paymentMethod || "現金";
      const toP = $("#m_toPrepaid") ? $("#m_toPrepaid").value : (effectivePrepaidId||"");
      effectivePrepaidId = toP || null;
      effectiveTo = effectivePrepaidId ? prepaidAccountIdForCardId(effectivePrepaidId) : null;

      if(chMethod==="クレカ"){
        effectiveCardId = creditCardId || null;
        effectiveFrom = effectiveCardId ? payableAccountIdForCardId(effectiveCardId) : null;
      }else{
        effectiveCardId = null;
        effectiveFrom = fromAccountId || null;
      }
    }

    const payload = {
      type,
      category: (type==="charge") ? "チャージ" : (category||""),
      amount, note, occurredAt,
      paymentMethod: paymentMethod || null,
      chargeMethod: (type==="charge") ? (paymentMethod||null) : null,
      creditCardId: effectiveCardId,
      prepaidCardId: (type==="expense" && paymentMethod==="プリペイド") ? (effectivePrepaidId||null) : ((type==="charge") ? (effectivePrepaidId||null) : null),
      creditChannel: (paymentMethod==="クレカ") ? (creditChannel||null) : null,
      fromAccountId: effectiveFrom || null,
      toAccountId: effectiveTo || null,
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
  // Do not ask for manual month-end balances for system-generated payable accounts
  const accounts = getAllAccountsFromMaster().filter(a=>!a.system);
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
      <div id="f_payAccountWrap">
        <div class="small">支払口座</div>
        <select id="f_payAccount" class="input">
          ${getAllAccountsFromMaster().filter(a=>!a.system).map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("")}
        </select>
      </div>
      <div id="f_cardWrap">
        <div class="small">支払カード（クレカ時）</div>
        <select id="f_creditCard" class="input">
          ${(state.creditCards||[]).filter(c=>c.active!==false && c.status!=="stopped").map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.cardName||c.name||c.id)}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">支払周期</div>
        <select id="f_cycleType" class="input">
          <option value="monthly">月1</option>
          <option value="quarterly">年4</option>
          <option value="yearly">年1</option>
        </select>
      </div>
      <div>
        <div class="small">支払日</div>
        <select id="f_payDay" class="input">
          ${Array.from({length:31},(_,i)=>i+1).map(d=>`<option value="${d}">${d}</option>`).join("")}
        </select>
      </div>
      <div id="f_payMonthWrap">
        <div class="small">支払月（年1のみ）</div>
        <select id="f_payMonth" class="input">
          ${Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${m}">${m}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">次回支払日（自動）</div>
        <input id="f_next" class="input" type="date" readonly />
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

  // init fixed-cost controls (select-based)
  const inferCycle = ()=>{
    if(item?.cycleType) return item.cycleType;
    const t = (item?.cycleText||"").trim();
    if(t.includes("年4")) return "quarterly";
    if(t.includes("年1") || t.includes("年")) return "yearly";
    return "monthly";
  };
  const setSelect = (id, val)=>{
    const el = $(id); if(!el) return;
    const v = (val==null) ? "" : String(val);
    const opt = [...el.options].some(o=>o.value===v);
    if(opt) el.value = v;
  };

  setSelect("#f_cycleType", inferCycle());
  setSelect("#f_payDay", item?.payDay || (item?.nextPayDate ? (new Date(item.nextPayDate).getDate()) : 27));
  setSelect("#f_payMonth", item?.payMonth || (item?.nextPayDate ? (new Date(item.nextPayDate).getMonth()+1) : (new Date().getMonth()+1)));
  setSelect("#f_payAccount", item?.payAccountId || "");
  setSelect("#f_creditCard", item?.creditCardId || "");

  const syncPayWrap = ()=>{
    const pm = $("#f_pay").value || "";
    const isCard = (pm==="クレカ");
    if($("#f_cardWrap")) $("#f_cardWrap").style.display = isCard ? "" : "none";
    if($("#f_payAccountWrap")) $("#f_payAccountWrap").style.display = isCard ? "none" : "";
  };
  const syncCycleWrap = ()=>{
    const ct = $("#f_cycleType").value;
    if($("#f_payMonthWrap")) $("#f_payMonthWrap").style.display = (ct==="yearly") ? "" : "none";
  };

  const recalcNext = ()=>{
    const ct = $("#f_cycleType").value;
    const day = Number($("#f_payDay").value||0) || 1;
    const mo = Number($("#f_payMonth").value||0) || null;
    const base = Date.now();
    const ms = nextFixedCostDateFromSettings(ct, day, mo, base);
    const iso = new Date(ms).toISOString().slice(0,10);
    $("#f_next").value = iso;
    $("#f_next").dataset.ms = String(ms);
  };

  $("#f_pay").addEventListener("change", ()=>{ syncPayWrap(); recalcNext(); });
  $("#f_cycleType").addEventListener("change", ()=>{ syncCycleWrap(); recalcNext(); });
  $("#f_payDay").addEventListener("change", recalcNext);
  $("#f_payMonth").addEventListener("change", recalcNext);
  $("#f_pay").addEventListener("change", ()=>{
    syncPayWrap();
    // default card when switching to クレカ
    if($("#f_pay").value==="クレカ"){
      const sel = $("#f_creditCard");
      if(sel && !sel.value && sel.options.length){ sel.value = sel.options[0].value; }
    }
  });
  $("#f_payAccount").addEventListener("change", recalcNext);
  $("#f_creditCard").addEventListener("change", recalcNext);


  syncPayWrap();
  syncCycleWrap();
  recalcNext();


  $("#f_save").addEventListener("click", async ()=>{
    const payload = {
      name: $("#f_name").value || "",
      category: $("#f_cat").value || "",
      paymentMethod: $("#f_pay").value || "",
      amount: Number($("#f_amount").value||0),
      cycleType: $("#f_cycleType").value || "monthly",
      payDay: Number($("#f_payDay").value||0) || null,
      payMonth: ($("#f_cycleType").value==="yearly") ? (Number($("#f_payMonth").value||0) || null) : null,
      payAccountId: ($("#f_pay").value==="クレカ") ? null : ($("#f_payAccount").value || null),
      creditCardId: ($("#f_pay").value==="クレカ") ? ($("#f_creditCard").value || null) : null,
      nextPayDate: $("#f_next").dataset.ms ? Number($("#f_next").dataset.ms) : null,
      visible: $("#f_visible").value === "true",
      memo: $("#f_memo").value || "",
      updatedAt: Date.now()
    };
    // validation
    if(payload.paymentMethod==="クレカ" && !payload.creditCardId){
      alert("支払方法がクレカの場合は「支払カード」を選択してください");
      return;
    }
    if(payload.paymentMethod!=="クレカ" && !payload.payAccountId){
      alert("支払方法がクレカ以外の場合は「支払口座」を選択してください");
      return;
    }

    if(mode==="add"){
      await addDoc(collection(db, "fixedCosts"), payload);
    }else{
      await updateDoc(doc(db, "fixedCosts", item.id), payload);
    }
    hideModal();
    await reloadAll();
  }, { once:true });
}


function renderPrepaidCards(){
  const list = (state.prepaidCards||[]).slice().sort((a,b)=> (a.cardName||"").localeCompare(b.cardName||""));
  const visible = list.filter(x=>x.active!==false);

  const mb = mergedBalances();
  const deltas = accountDeltasFromEntries();
  const autoDeltas = autoCardPaymentDeltasForMonth(state.month);
  const deltaOf = (id)=> Number(deltas.get(id)||0) + Number(autoDeltas.get(id)||0);
  const balOf = (accId)=> Number((mb.find(x=>x.id===accId)?.balance)||0);
  const estOf = (accId)=> balOf(accId) + deltaOf(accId);

  return `
    <div class="card">
      <div class="row">
        <h2 class="h1">プリペイドカード</h2>
        <div class="spacer"></div>
        <button class="btn" id="btnAddPrepaid">＋追加</button>
      </div>
      <div class="sep"></div>

      <div style="overflow:auto;">
        <table class="table">
          <thead>
            <tr>
              <th>カード名</th>
              <th class="right">月末残高</th>
              <th class="right">今月差分</th>
              <th class="right">推定残高</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${visible.length===0 ? `<tr><td colspan="5" class="small">まだありません。</td></tr>` : visible.map(p=>{
              const accId = prepaidAccountIdForCardId(p.id);
              const b = balOf(accId);
              const d = deltaOf(accId);
              const e = estOf(accId);
              return `
                <tr>
                  <td>${escapeHtml(p.cardName||p.id)}</td>
                  <td class="right">¥${yen(b)}</td>
                  <td class="right">¥${yen(d)}</td>
                  <td class="right">¥${yen(e)}</td>
                  <td class="right">
                    <button class="btn secondary" data-edit-prepaid="${escapeHtml(p.id)}">編集</button>
                    <button class="btn danger" data-del-prepaid="${escapeHtml(p.id)}">削除</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>

      <div class="sep"></div>
      <div class="small">
        ・プリペイドは「口座」と同じ扱いで、月末残高は「口座管理 ＞ 残高入力」でも更新できます。<br/>
        ・出金で「プリペイド」を選ぶと残高から減算されます。チャージは「入出金 ＞ チャージ」で入力します。
      </div>
    </div>
  `;
}

function openPrepaidModal(mode, card=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }

  const c = card || {};
  showModal(mode==="add" ? "プリペイドカードを追加" : "プリペイドカードを編集", `
    <div class="formGrid">
      <div>
        <div class="small">カード名</div>
        <input id="pp_name" class="input" value="${escapeHtml(c.cardName||"")}" placeholder="例：TOICA / WAON / Suica など" />
      </div>
      <div>
        <div class="small">有効</div>
        <select id="pp_active" class="input">
          <option value="true" ${c.active!==false ? "selected":""}>有効</option>
          <option value="false" ${c.active===false ? "selected":""}>停止</option>
        </select>
      </div>
    </div>

    <div class="row" style="margin-top:12px;">
      <button class="btn" id="pp_save">保存</button>
      <div class="spacer"></div>
      <span class="small">${mode==="add" ? "" : `id: ${escapeHtml(c.id||"")}`}</span>
    </div>
  `);

  $("#pp_save").addEventListener("click", async ()=>{
    const cardName = $("#pp_name").value.trim();
    const active = $("#pp_active").value === "true";
    if(!cardName){ alert("カード名を入力してください"); return; }

    const payload = { cardName, active, updatedAt: Date.now() };

    if(mode==="add"){
      payload.createdAt = Date.now();
      payload.createdBy = state.user.uid;
      await addDoc(collection(db, "prepaidCards"), payload);
    }else{
      await updateDoc(doc(db, "prepaidCards", c.id), payload);
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
        <div class="small">締め日</div>
        <select id="c_close" class="input">
          <option value="EOM">末日</option>
          ${Array.from({length:31},(_,i)=>i+1).map(d=>`<option value="${d}">${d}日</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">支払タイミング</div>
        <select id="c_paymo" class="input">
          <option value="1">翌月</option>
          <option value="2">翌々月</option>
        </select>
      </div>
      <div>
        <div class="small">支払日</div>
        <select id="c_payday" class="input">
          ${Array.from({length:31},(_,i)=>i+1).map(d=>`<option value="${d}">${d}日</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">支払口座</div>
        <select id="c_payacc" class="input">
          ${(state.master.banks||[]).filter(x=>x.active!==false).map(b=>`<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="small">支払予定口座（自動）</div>
        <input id="c_payableName" class="input" disabled value="${escapeHtml(item?.id ? `${(item?.cardName||item?.id)}（支払予定）` : "（保存後に自動作成）")}" />
        <input id="c_payableId" type="hidden" value="${escapeHtml(item?.id ? payableAccountIdForCardId(item.id) : "")}" />
      </div>
      <div>
        <div class="small">例外締め（任意）</div>
        <div class="small" style="margin-top:6px;">例：楽天市場だけ25日締めにしたい場合</div>
        <input id="c_ex_channel" class="input" placeholder="楽天市場" value="${escapeHtml(item?.exceptionChannel||"")}" />
        <select id="c_ex_day" class="input" style="margin-top:8px;">
          <option value="">-</option>
          ${Array.from({length:31},(_,i)=>i+1).map(d=>`<option value="${d}">${d}日</option>`).join("")}
        </select>
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

  
  // prefill
  if($("#c_close")) $("#c_close").value = (item?.closingDay ?? "EOM");
  if($("#c_paymo")) $("#c_paymo").value = String(item?.paymentMonthOffset ?? 1);
  if($("#c_payday")) $("#c_payday").value = String(Number(item?.paymentDay||27));
  if($("#c_payacc")) $("#c_payacc").value = (item?.paymentAccountId ?? "rakuten");
  if($("#c_ex_channel")) $("#c_ex_channel").value = (item?.exceptionChannel ?? (((item?.cardName||"").includes("楽天")) ? "楽天市場" : ""));
  if($("#c_ex_day")) $("#c_ex_day").value = String(item?.exceptionClosingDay ?? (((item?.cardName||"").includes("楽天")) ? 25 : ""));

$("#c_save").addEventListener("click", async ()=>{
    const payload = {
      cardName: $("#c_name").value || "",
      issuer: $("#c_issuer").value || "",
      last4: $("#c_last4").value || "",
      expiryDate: $("#c_exp").value || "",

      closingDay: $("#c_close") ? $("#c_close").value : "EOM",
      paymentMonthOffset: Number($("#c_paymo") ? $("#c_paymo").value : 1) || 1,
      paymentDay: Number($("#c_payday") ? $("#c_payday").value : 0) || 27,
      paymentAccountId: $("#c_payacc") ? $("#c_payacc").value : "rakuten",
      // payable account is auto-generated per card
      payableAccountId: (mode==="edit" && item?.id) ? payableAccountIdForCardId(item.id) : null,
      exceptionChannel: $("#c_ex_channel") ? ($("#c_ex_channel").value || "") : "",
      exceptionClosingDay: ($("#c_ex_day" && $("#c_ex_day").value!=="") ? Number($("#c_ex_day").value) : null),

      status: $("#c_status").value || "active",
      memo: $("#c_memo").value || "",
      active: ( ($("#c_status").value || "active") === "active" ),
      updatedAt: Date.now(),
    };
    if(mode==="add"){
      const ref = await addDoc(collection(db, "creditCards"), payload);
      // set per-card payable account id (deterministic)
      await updateDoc(doc(db, "creditCards", ref.id), {
        payableAccountId: payableAccountIdForCardId(ref.id),
        updatedAt: Date.now()
      });
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
  const owners = ((state.peoplePersons && state.peoplePersons.length) ? state.peoplePersons : (state.family||[])).filter(f=>f.active!==false);
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
 *  People (Family) - new schema
 * ========================= */
function openPersonModal(mode, item=null){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }

  const isEdit = mode==="edit";
  const p = item || {
    name:"", relation:"self", birth_date:"", gender:"",
    name_kana:"", is_living_with:true,
    phone_number:"", email:"", notes:""
  };

  openModal(isEdit ? "家族：基本情報（編集）" : "家族：基本情報（追加）", `
    <div class="formGrid">
      <div>
        <div class="small">名前</div>
        <input id="pp_name" class="input" value="${escapeHtml(p.name||"")}" />
      </div>
      <div>
        <div class="small">ふりがな</div>
        <input id="pp_kana" class="input" value="${escapeHtml(p.name_kana||"")}" />
      </div>

      <div>
        <div class="small">続柄</div>
        <select id="pp_relation" class="input">
          ${["self","spouse","child","other"].map(v=>`<option value="${v}" ${(p.relation||"other")===v?"selected":""}>${v}</option>`).join("")}
        </select>
      </div>

      <div>
        <div class="small">誕生日</div>
        <input id="pp_birth" class="input" type="date" value="${escapeHtml((p.birth_date||p.birthDate||"").replace(/\//g,"-") )}" />
      </div>

      <div>
        <div class="small">性別（任意）</div>
        <select id="pp_gender" class="input">
          ${[
            {v:"", l:"-"},
            {v:"male", l:"male"},
            {v:"female", l:"female"},
            {v:"other", l:"other"},
          ].map(o=>`<option value="${o.v}" ${(p.gender||"")===(o.v)?"selected":""}>${o.l}</option>`).join("")}
        </select>
      </div>

      <div>
        <div class="small">同居</div>
        <select id="pp_living" class="input">
          <option value="true" ${(p.is_living_with!==false)?"selected":""}>true</option>
          <option value="false" ${(p.is_living_with===false)?"selected":""}>false</option>
        </select>
      </div>

      <div>
        <div class="small">電話（任意）</div>
        <input id="pp_phone" class="input" value="${escapeHtml(p.phone_number||"")}" />
      </div>

      <div>
        <div class="small">メール（任意）</div>
        <input id="pp_email" class="input" value="${escapeHtml(p.email||"")}" />
      </div>

      <div style="grid-column:1/-1;">
        <div class="small">メモ</div>
        <textarea id="pp_notes" class="input" rows="3" placeholder="">${escapeHtml(p.notes||p.memo||"")}</textarea>
      </div>
    </div>

    <div class="row" style="margin-top:12px;">
      <button class="btn" id="pp_save">保存</button>
      <div class="spacer"></div>
      ${isEdit ? `<button class="btn secondary" id="pp_open_health">健康情報を編集</button>` : `<span class="small muted">※保存後に健康情報を追加できます</span>`}
    </div>
  `);

  $("#pp_save")?.addEventListener("click", async ()=>{
    const name = $("#pp_name").value.trim();
    if(!name){ alert("名前は必須です"); return; }

    const payload = {
      name,
      relation: $("#pp_relation").value,
      birth_date: ($("#pp_birth").value||"").trim().replace(/\-/g,"/"),
      gender: $("#pp_gender").value.trim(),
      name_kana: $("#pp_kana").value.trim(),
      is_living_with: $("#pp_living").value === "true",
      phone_number: $("#pp_phone").value.trim(),
      email: $("#pp_email").value.trim(),
      notes: $("#pp_notes").value.trim(),
      updatedAt: Date.now()
    };

    if(isEdit){
      await setDoc(doc(db, "people_persons", p.id), payload, { merge: true });
    }else{
      const ref = await addDoc(collection(db, "people_persons"), { ...payload, createdAt: Date.now() });
    }

    closeModal();
    await reloadAll();
  });

  $("#pp_open_health")?.addEventListener("click", ()=>{
    closeModal();
    openHealthModal(p);
  });
}

function openHealthModal(person){
  if(state.role==="viewer"){ alert("viewer は編集できません"); return; }
  if(!person?.id){ alert("先に基本情報を保存してください"); return; }

  const h = state.peopleHealthByPersonId?.[person.id] || { person_id: person.id };

  openModal(`健康情報：${escapeHtml(person.name||"")}`, `
    <div class="formGrid">
      <div>
        <div class="small">血液型</div>
        <input id="ph_blood" class="input" value="${escapeHtml(h.blood_type||"")}" />
      </div>
      <div>
        <div class="small">身長</div>
        <input id="ph_height" class="input" value="${escapeHtml(h.height||"")}" />
      </div>
      <div>
        <div class="small">体重</div>
        <input id="ph_weight" class="input" value="${escapeHtml(h.weight||"")}" />
      </div>
      <div>
        <div class="small">アレルギー</div>
        <input id="ph_allergy" class="input" value="${escapeHtml(h.allergies||"")}" />
      </div>

      <div style="grid-column:1/-1;">
        <div class="small">持病</div>
        <textarea id="ph_chronic" class="input" rows="2">${escapeHtml(h.chronic_diseases||"")}</textarea>
      </div>
      <div style="grid-column:1/-1;">
        <div class="small">常用薬</div>
        <textarea id="ph_medicine" class="input" rows="2">${escapeHtml(h.regular_medicine||"")}</textarea>
      </div>

      <div>
        <div class="small">かかりつけ病院</div>
        <input id="ph_hospital" class="input" value="${escapeHtml(h.hospital_name||"")}" />
      </div>
      <div>
        <div class="small">最終健診日</div>
        <input id="ph_checkup" class="input" placeholder="YYYY/MM/DD" value="${escapeHtml(h.last_checkup||"")}" />
      </div>

      <div style="grid-column:1/-1;">
        <div class="small">通院歴・手術歴</div>
        <textarea id="ph_history" class="input" rows="3">${escapeHtml(h.medical_history||"")}</textarea>
      </div>

      <div style="grid-column:1/-1;">
        <div class="small">定期通院予定</div>
        <textarea id="ph_regular" class="input" rows="2">${escapeHtml(h.regular_visit_schedule||"")}</textarea>
      </div>

      <div style="grid-column:1/-1;">
        <div class="small">ワクチン履歴</div>
        <textarea id="ph_vaccine" class="input" rows="3">${escapeHtml(h.vaccination_history||"")}</textarea>
      </div>

      <div style="grid-column:1/-1;">
        <div class="small">メモ</div>
        <textarea id="ph_notes" class="input" rows="3">${escapeHtml(h.notes||"")}</textarea>
      </div>
    </div>

    <div class="row" style="margin-top:12px;">
      <button class="btn" id="ph_save">保存</button>
      <div class="spacer"></div>
      <button class="btn secondary" id="ph_back">戻る</button>
    </div>
  `);

  $("#ph_save")?.addEventListener("click", async ()=>{
    const payload = {
      person_id: person.id,
      blood_type: $("#ph_blood").value.trim(),
      height: $("#ph_height").value.trim(),
      weight: $("#ph_weight").value.trim(),
      allergies: $("#ph_allergy").value.trim(),
      chronic_diseases: $("#ph_chronic").value.trim(),
      regular_medicine: $("#ph_medicine").value.trim(),
      hospital_name: $("#ph_hospital").value.trim(),
      last_checkup: $("#ph_checkup").value.trim(),
      medical_history: $("#ph_history").value.trim(),
      regular_visit_schedule: $("#ph_regular").value.trim(),
      vaccination_history: $("#ph_vaccine").value.trim(),
      notes: $("#ph_notes").value.trim(),
      updatedAt: Date.now()
    };
    await setDoc(doc(db, "people_health", person.id), payload, { merge: true });
    closeModal();
    await reloadAll();
    // re-open family view at same route
  });

  $("#ph_back")?.addEventListener("click", ()=>{
    closeModal();
    openPersonModal("edit", person);
  });
}




async function syncBirthdayEvents(){
  // viewer cannot write; also avoid failing the whole load on permission errors
  if(state.role==="viewer") return;
  const persons = (state.peoplePersons && state.peoplePersons.length) ? state.peoplePersons : [];
  if(persons.length===0) return;

  // parse YYYY-MM-DD
  function parseYmd(s){
    if(!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
    if(m) return {y:+m[1], mo:+m[2], d:+m[3]};
    return null;
  }
  const today0 = new Date(); today0.setHours(0,0,0,0);
  function nextBirthdayMs(birth){
    const p = parseYmd(birth);
    if(!p) return null;
    const now = new Date();
    let y = now.getFullYear();
    let dt = new Date(y, p.mo-1, p.d, 12, 0, 0, 0).getTime();
    if(dt < today0.getTime()) dt = new Date(y+1, p.mo-1, p.d, 12, 0, 0, 0).getTime();
    return dt;
  }

  let changed = false;
  for(const p of persons){
    if(p.active===false) continue;
    const b = p.birth_date || p.birthDate || "";
    const ms = nextBirthdayMs(b);
    if(!ms) continue;
    try{
      await upsertEventBySource({
        sourceType: "people_persons",
        sourceId: p.id,
        type: "birthday",
        title: `${p.name||"家族"} 誕生日`,
        date: ms
      });
      changed = true;
    }catch(e){
      // permissions or missing index should not break app
      console.warn("[syncBirthdayEvents] skipped:", e.message);
    }
  }

  if(changed){
    const s4b = await getDocs(query(collection(db, "events"), orderBy("date","asc")));
    state.events = s4b.docs.map(d=>({id:d.id, ...d.data()}));
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