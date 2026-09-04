// 経費精算メモ 同期用 Google Apps Script
//
// デプロイ手順:
// 1. 新しいGoogleスプレッドシートを作成する
// 2. 拡張機能 > Apps Script を開き、このファイルの内容を貼り付ける
// 3. 左メニューの「プロジェクトの設定」>「スクリプト プロパティ」で
//    SYNC_TOKEN というキーに好きな文字列（合言葉）を設定する
// 4. 右上の「デプロイ」>「新しいデプロイ」>「ウェブアプリ」
//    - 実行するユーザー: 自分
//    - アクセスできるユーザー: 全員
//    でデプロイし、発行されたウェブアプリのURLをコピーする
// 5. 経費精算メモアプリの設定（⚙）に、そのURLと手順3で決めた合言葉を入力する

const SHEET_NAME = 'expenses';
const HEADERS = ['id', 'date', 'payee', 'regNo', 'category', 'purpose', 'amount', 'attendees', 'receiptFileId', 'updatedAt'];
const DRIVE_FOLDER_NAME = '経費精算メモ_領収書';

function doGet(e) {
  try {
    if (!checkToken_(e.parameter.token)) return json_({ error: 'unauthorized' });
    if (e.parameter.action === 'pull') return pull_();
    return json_({ error: 'unknown action' });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!checkToken_(body.token)) return json_({ error: 'unauthorized' });
    if (body.action === 'push') return push_(body.expenses || []);
    return json_({ error: 'unknown action' });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function checkToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  return expected && token === expected;
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

function getFolder_() {
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

// data:image/jpeg;base64,xxxx... 形式のURLをDriveに保存し、ファイルIDを返す。
function saveImageToDrive_(dataUrl, id) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return '';
  const ext = m[1] === 'jpg' ? 'jpeg' : m[1];
  const bytes = Utilities.base64Decode(m[2]);
  const blob = Utilities.newBlob(bytes, 'image/' + ext, id + '.' + ext);
  const folder = getFolder_();
  const existing = folder.getFilesByName(id + '.' + ext);
  if (existing.hasNext()) existing.next().setTrashed(true);
  const file = folder.createFile(blob);
  return file.getId();
}

function loadImageFromDrive_(fileId) {
  if (!fileId) return '';
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());
    return 'data:' + blob.getContentType() + ';base64,' + base64;
  } catch (err) {
    return '';
  }
}

function pull_() {
  const sheet = getSheet_();
  const rows = sheet.getDataRange().getValues();
  const [header, ...data] = rows;
  const expenses = data
    .filter((r) => r[0])
    .map((r) => {
      const obj = {};
      header.forEach((h, i) => (obj[h] = r[i]));
      obj.amount = Number(obj.amount) || 0;
      obj.attendees = obj.attendees === '' ? null : Number(obj.attendees);
      obj.receiptImage = loadImageFromDrive_(obj.receiptFileId);
      delete obj.receiptFileId;
      return obj;
    });
  return json_({ expenses });
}

// idが既存なら該当行を上書き、無ければ追加する（IDベースのマージ）。
function push_(expenses) {
  const sheet = getSheet_();
  const rows = sheet.getDataRange().getValues();
  const idToRow = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) idToRow[rows[i][0]] = i + 1;
  }

  expenses.forEach((exp) => {
    const receiptFileId = exp.receiptImage && exp.receiptImage.startsWith('data:')
      ? saveImageToDrive_(exp.receiptImage, exp.id)
      : exp.receiptFileId || '';
    const rowValues = HEADERS.map((h) => (h === 'receiptFileId' ? receiptFileId : exp[h] ?? ''));
    if (idToRow[exp.id]) {
      sheet.getRange(idToRow[exp.id], 1, 1, HEADERS.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }
  });

  return json_({ ok: true, count: expenses.length });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
