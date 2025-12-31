# Personal File（個人管理）DL版

このフォルダは **ビルド不要（HTML/CSS/JSのみ）** の新規アプリです。  
**GitHub Pages の JSON（bundle/master）を優先**で読み取り、**Firestore は差分（入力・編集）**を持ちます。

---

## 1) セットアップ手順（最短）

### A. Firebase を作る
1. Firebase プロジェクト作成
2. Authentication → Email/Password を有効化
3. Firestore Database を作成
4. Rules に `firestore.rules` をコピペして公開

### B. users/{uid} を作る（必須）
Authで作ったユーザーの UID を調べて、Firestore に:

`users/{uid}`
```json
{ "role": "admin", "active": true }
```

### C. app.js の設定
`app.js` 内の `FIREBASE_CONFIG` をあなたの値に差し替え。

### D. GitHub Pages にアップ
- このフォルダをそのまま GitHub へ
- Pages を有効化
- URLへアクセス → ログイン → 動作

---

## 2) データ構成（重要）
- master: `./data/master.json`
- 月次bundle: `./data/bundles/YYYY-MM.json`（任意）
- Firestore（差分）
  - `months/{YYYY-MM}/entries`   … 収入/支出/資金移動
  - `months/{YYYY-MM}/balances` … 口座残高
  - `fixedCosts`                … 固定費
  - `events`                    … 定期イベント

---

## 3) 次の拡張（あなたの要件）
このDL版は「お金/口座/固定費/定期イベント」を最小で動かすところまで実装しています。
次は以下を同じパターン（一覧→詳細→編集）で追加できます:

- 保険（insurances）
- クレカ（creditCards）
- 車（cars）
- 家（homes / homeLoans / homeEquipments）
- 家族（family）
- 定期イベントは 90日抽出のまま、targetRef でリンクを追加

---

## 4) 注意
- master.json のカテゴリや口座を増減させれば UI は追従します（JS直書きしません）
- NISA「種別A/B/Cの割合」は、次の段階で transfer 由来から算出に変更できます
