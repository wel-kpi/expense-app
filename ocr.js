// OCR helper built on Tesseract.js. Best-effort extraction only — user always reviews/edits the result.
const OCR = {
  async recognize(fileOrDataUrl, onProgress) {
    const result = await Tesseract.recognize(fileOrDataUrl, 'jpn+eng', {
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text') onProgress(Math.round(m.progress * 100));
      },
    });
    return result.data.text;
  },

  // Heuristic extraction of 支払日(date)・支払先(payee)・支払額(amount)・登録番号(regNo) from raw OCR text.
  // 1枚の画像に複数の領収書が並んでいる場合は、検出できた件数分の配列を返す。
  extractFields(text) {
    return this.extractMultiple(text)[0] || { date: '', payee: '', amount: null, regNo: '' };
  },

  extractMultiple(text) {
    const allLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    const transit = this.extractTransitUsage(allLines);
    if (transit) return [{ ...transit, regNo: '', date: this.extractDate(allLines) }];

    const groups = this.splitReceipts(allLines);
    const results = groups.map((lines) => ({
      date: this.extractDate(lines),
      payee: this.extractPayee(lines),
      amount: this.extractAmount(lines),
      regNo: this.extractRegNo(lines),
    }));
    const filtered = results.filter((r) => r.payee || r.amount != null);
    return filtered.length > 0 ? filtered : results.slice(0, 1);
  },

  // 領収書に印字された日付を YYYY-MM-DD 形式で返す（見つからない場合は空文字）。
  // 「2026年08月19日」「2026/08/19」のような年月日つきを優先し、
  // 年が無い「08/27」（交通系ICカード履歴など）は現在の年を補って扱う。
  extractDate(lines) {
    const text = lines.join(' ');
    let m = text.match(/(20[0-9]{2})[年/-]\s*([0-9]{1,2})[月/-]\s*([0-9]{1,2})日?/);
    if (m) {
      const [, y, mo, d] = m;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    // 年が省略された "MM/DD" 形式（スラッシュのみ。ハイフンは電話番号等と紛らわしいため対象外）。
    m = text.match(/(?<![0-9])([0-9]{1,2})\/([0-9]{1,2})(?![0-9])/);
    if (m) {
      const [, mo, d] = m;
      const year = new Date().getFullYear();
      return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return '';
  },

  // 「領収書」「領収証」の見出しが複数回出てくる場合、そこを境目として
  // 1枚の写真に写った複数枚の領収書をそれぞれ別のブロックに分割する。
  splitReceipts(lines) {
    const headerPattern = /^(領収書|領収証)/;
    const groups = [];
    let current = [];
    for (const line of lines) {
      if (headerPattern.test(line) && current.length > 0) {
        groups.push(current);
        current = [];
      }
      current.push(line);
    }
    if (current.length) groups.push(current);
    return groups.length > 1 ? groups : [lines];
  },

  // PASMO/Suica等の利用履歴（残高＋乗車ごとの +/- 差額）を検出し、
  // マイナス（乗車による減算）だけを合計する。チャージ（+）は経費ではないため除外。
  // 実機のOCRでは「¥2,870-220」のように残高と差額の間の隙間が無く1つに繋がって
  // 出力されることがあるため、¥マークを起点に「¥残高(区切り)±差額」をまとめて検出する。
  // ¥を必須にすることで、電話番号やIDのハイフンを誤検出することもない。
  extractTransitUsage(lines) {
    const text = lines.join(' ');
    const deltaPattern = /[¥￥]\s*[0-9][0-9,]*\s*([+\-－−])\s*([0-9][0-9,]{1,6})(?![0-9,])/g;
    const negatives = [];

    for (const m of text.matchAll(deltaPattern)) {
      const value = parseInt(m[2].replace(/,/g, ''), 10);
      if (isNaN(value)) continue;
      if (m[1] !== '+') negatives.push(value);
    }

    // 乗車による減算が複数見つかった場合のみ「履歴形式」と判断する（誤検出防止）。
    if (negatives.length < 3) return null;

    return {
      payee: 'PASMO/Suica',
      amount: negatives.reduce((sum, v) => sum + v, 0),
    };
  },

  extractPayee(lines) {
    const blacklist = /^(TEL|FAX|〒|https?:)/i;
    // タクシー・交通機関や一般的な会社/店舗名の目印になる語を優先して拾う。
    // 確信が持てる候補が無い場合は、誤った値を入れるより空欄にして手入力してもらう方が安全。
    const companyPattern = /(タクシー|交通|ハイヤー|運輸|株式会社|有限会社|合同会社|㈱|㈲|\(株\)|（株）|\(有\)|（有）|店|センター|食堂)/;
    const candidate = lines.find(
      (l) => companyPattern.test(l) && l.length <= 30 && !blacklist.test(l) && !/^[A-Z0-9 .,'-]+$/i.test(l)
    );
    return candidate ? candidate.replace(/[|:：]/g, '').trim() : '';
  },

  extractAmount(lines) {
    // 登録番号・注文番号・電話番号・郵便番号などの桁数字を金額と誤認しないよう、該当行は除外する。
    // 「T+8桁以上の数字」は登録番号のラベル文字がOCRで読み取れなかった場合の保険として、
    // 行の内容に関わらず構造的に除外する。
    const blacklist = /(登録番号|注文番号|レシート番号|電話|TEL|ＴＥＬ|ID[:：]|ナビコード|相談室|kmグループ|問合せ|QR|営業回数|〒|T[0-9]{8,})/;
    const usableLines = lines.filter((l) => !blacklist.test(l));

    const keywordPattern = /(合計|お会計|総額|ご請求額|請求金額|領収金額|税込)/;
    const yenPattern = /[¥￥]\s*([0-9][0-9,]*)/;

    // 優先: 「合計」等のキーワードと¥金額が同じ行にある場合はそれを使う。
    // （キーワードの後ろN行を見に行く方式は、OCRの行の並び順が入れ替わると
    //   別の項目の金額を誤って拾ってしまうため採用しない）
    for (const line of usableLines) {
      if (!keywordPattern.test(line)) continue;
      const m = line.match(yenPattern);
      if (m) {
        const value = parseInt(m[1].replace(/,/g, ''), 10);
        if (!isNaN(value)) return value;
      }
    }

    // それ以外: ¥ 付き金額の中で最大のもの（内訳の中では合計が最も大きいことが多い）。
    let max = null;
    for (const line of usableLines) {
      for (const m of line.matchAll(new RegExp(yenPattern, 'g'))) {
        const value = parseInt(m[1].replace(/,/g, ''), 10);
        if (!isNaN(value) && (max === null || value > max)) max = value;
      }
    }
    return max;
  },

  extractRegNo(lines) {
    for (let i = 0; i < lines.length; i++) {
      let m = lines[i].match(/T\s?([0-9]{10,14})/);
      if (!m && /登録番号/.test(lines[i]) && i + 1 < lines.length) {
        m = lines[i + 1].match(/T\s?([0-9]{10,14})/);
      }
      if (m) {
        const digits = m[1].replace(/\s/g, '').slice(0, 13);
        return 'T' + digits;
      }
    }
    return '';
  },
};
