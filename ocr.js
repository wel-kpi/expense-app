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

  // Heuristic extraction of 支払先(payee)・支払額(amount)・登録番号(regNo) from raw OCR text.
  // 1枚の画像に複数の領収書が並んでいる場合は、検出できた件数分の配列を返す。
  extractFields(text) {
    return this.extractMultiple(text)[0] || { payee: '', amount: null, regNo: '' };
  },

  extractMultiple(text) {
    const allLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    const transit = this.extractTransitUsage(allLines);
    if (transit) return [{ ...transit, regNo: '' }];

    const groups = this.splitReceipts(allLines);
    const results = groups.map((lines) => ({
      payee: this.extractPayee(lines),
      amount: this.extractAmount(lines),
      regNo: this.extractRegNo(lines),
    }));
    const filtered = results.filter((r) => r.payee || r.amount != null);
    return filtered.length > 0 ? filtered : results.slice(0, 1);
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
  // 実機のOCRでは「入/出の駅名 ¥残高 -454」のように1行にまとまって出力されることが多いため、
  // 行全体の一致ではなく、テキスト全体から孤立した +/-数字を探す（前後が数字・カンマでないことを条件に、
  // 電話番号やIDのハイフンなど数字に挟まれた「-」を誤検出しないようにする）。
  extractTransitUsage(lines) {
    const text = lines.join(' ');
    const deltaPattern = /(?<![0-9,])([+\-－−])\s?([0-9][0-9,]{1,6})(?![0-9,])/g;
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
    const companyPattern = /(タクシー|交通|ハイヤー|運輸|株式会社|有限会社|合同会社|㈱|㈲|\(株\)|（株）|\(有\)|（有）|店|センター|食堂)/;
    const candidate = lines.find(
      (l) => companyPattern.test(l) && l.length <= 30 && !blacklist.test(l) && !/^[A-Z0-9 .,'-]+$/i.test(l)
    );
    if (candidate) return candidate.replace(/[|:：]/g, '').trim();
    const first = lines.find((l) => l.length >= 2 && l.length <= 30 && !/^\d+$/.test(l));
    return first || '';
  },

  extractAmount(lines) {
    // 登録番号・注文番号・電話番号などの桁数字を金額と誤認しないよう、該当行は除外する。
    const blacklist = /(登録番号|注文番号|レシート番号|電話|TEL|ＴＥＬ|ID[:：]|ナビコード|相談室|kmグループ|問合せ|QR|営業回数)/;
    const usableLines = lines.filter((l) => !blacklist.test(l));

    const keywordPattern = /(合計|お会計|総額|ご請求額|請求金額|領収金額|税込)/;
    const yenPattern = /[¥￥]\s*([0-9][0-9,]*)/;

    // Tier 1: 「合計」等のキーワード行、またはその直後1〜2行にある ¥ 付き金額。
    for (let i = 0; i < usableLines.length; i++) {
      if (!keywordPattern.test(usableLines[i])) continue;
      for (let j = i; j <= i + 2 && j < usableLines.length; j++) {
        const m = usableLines[j].match(yenPattern);
        if (m) {
          const value = parseInt(m[1].replace(/,/g, ''), 10);
          if (!isNaN(value)) return value;
        }
      }
    }

    // Tier 2: ¥ 付き金額の中で最大のもの（内訳の中で合計が最も大きいことが多い）。
    let max = null;
    for (const line of usableLines) {
      for (const m of line.matchAll(new RegExp(yenPattern, 'g'))) {
        const value = parseInt(m[1].replace(/,/g, ''), 10);
        if (!isNaN(value) && (max === null || value > max)) max = value;
      }
    }
    if (max !== null) return max;

    // Tier 3: ¥ が読み取れなかった場合のみ、桁数を現実的な範囲に絞って数字を拾う。
    for (const line of usableLines) {
      for (const m of line.matchAll(/([0-9][0-9,]{2,})/g)) {
        const value = parseInt(m[1].replace(/,/g, ''), 10);
        if (!isNaN(value) && value <= 999999 && (max === null || value > max)) max = value;
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
