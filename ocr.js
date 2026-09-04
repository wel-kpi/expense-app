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
    return {
      payee: this.extractPayee(lines),
      amount: this.extractAmount(lines),
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
