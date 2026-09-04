// Google Apps Script（google-apps-script/Code.gs）とのプッシュ/プル同期。
const Sync = {
  // fetchでContent-Type: application/jsonを付けるとブラウザがCORSプリフライト(OPTIONS)を送り、
  // Apps ScriptがOPTIONSに応答できず失敗するため、text/plainで送ってプリフライトを回避する。
  async push(syncUrl, token) {
    const expenses = await ExpenseDB.getAll();
    const res = await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'push', token, expenses }),
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    return result;
  },

  async pull(syncUrl, token) {
    const url = `${syncUrl}?action=pull&token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    for (const exp of result.expenses || []) {
      await ExpenseDB.add(exp);
    }
    return result;
  },
};
