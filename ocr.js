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

  // Heuristic extraction of 支払先(payee) and 支払額(amount) from raw OCR text.
  extractFields(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    const transit = this.extractTransitUsage(lines);
    if (transit) return transit;

    return {
      payee: this.extractPayee(lines),
      amount: this.extractAmount(lines),
    };
  },

  // PASMO/Suica等の利用履歴（残高＋乗車ごとの +/- 差額）を検出し、
  // マイナス（乗車による減算）だけを合計する。チャージ（+）は経費ではないため除外。
  extractTransitUsage(lines) {
    const deltaPattern = /^[+\-－−]\s?([0-9][0-9,]{1,6})$/;
    const negatives = [];

    for (const line of lines) {
      const m = line.match(deltaPattern);
      if (!m) continue;
      const value = parseInt(m[1].replace(/,/g, ''), 10);
      if (isNaN(value)) continue;
      if (line[0] !== '+') negatives.push(value);
    }

    // 乗車による減算が複数見つかった場合のみ「履歴形式」と判断する（誤検出防止）。
    if (negatives.length < 3) return null;

    return {
      payee: 'PASMO/Suica',
      amount: negatives.reduce((sum, v) => sum + v, 0),
    };
  },

  extractPayee(lines) {
    // Prefer a line ending in a common business suffix; otherwise take the first substantial line.
    const suffixPattern = /(株式会社|有限会社|合同会社|\(株\)|㈱|店|センター)/;
    const candidate = lines.find(l => suffixPattern.test(l) && l.length <= 30);
    if (candidate) return candidate.replace(/[|:：]/g, '').trim();
    const first = lines.find(l => l.length >= 2 && l.length <= 30 && !/^\d+$/.test(l));
    return first || '';
  },

  extractAmount(lines) {
    const keywordPattern = /(合計|お会計|総額|ご請求額|請求金額|金額|税込)/;
    const numberPattern = /[¥￥]?\s*([0-9][0-9,]{2,})\s*円?/;

    let best = null;
    for (const line of lines) {
      if (keywordPattern.test(line)) {
        const m = line.match(numberPattern);
        if (m) {
          const value = parseInt(m[1].replace(/,/g, ''), 10);
          if (!isNaN(value)) best = value;
        }
      }
    }
    if (best !== null) return best;

    // Fallback: largest plausible amount found anywhere in the receipt.
    let max = null;
    for (const line of lines) {
      const matches = line.matchAll(/[¥￥]?\s*([0-9][0-9,]{2,})\s*円?/g);
      for (const m of matches) {
        const value = parseInt(m[1].replace(/,/g, ''), 10);
        if (!isNaN(value) && (max === null || value > max)) max = value;
      }
    }
    return max;
  },
};
