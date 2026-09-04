// Main UI wiring for the expense memo app.
(() => {
  const CATEGORIES = ['交通費', '接待費', '会議費', '消耗品費', '通信費', 'その他'];

  const $ = (id) => document.getElementById(id);
  const yen = (n) => '¥' + (Number(n) || 0).toLocaleString('ja-JP');

  const monthSelect = $('monthSelect');
  const summaryTableBody = document.querySelector('#summaryTable tbody');
  const monthTotalEl = $('monthTotal');
  const expenseTableBody = document.querySelector('#expenseTable tbody');
  const emptyMsg = $('emptyMsg');

  const expenseModalEl = $('expenseModal');
  const expenseModal = new bootstrap.Modal(expenseModalEl);
  const previewModal = new bootstrap.Modal($('previewModal'));
  const settingsModal = new bootstrap.Modal($('settingsModal'));

  let currentMonth = new Date().toISOString().slice(0, 7);
  let currentExpenses = [];
  let pendingReceiptImage = null; // data URL of the receipt currently attached in the form

  function toast(message, variant = 'primary') {
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${variant} border-0`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    $('toastHost').appendChild(el);
    const t = new bootstrap.Toast(el, { delay: 3000 });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  }

  function shiftMonth(month, delta) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  async function populateMonthSelect() {
    const known = await ExpenseDB.getAllMonths();
    known.add(currentMonth);
    // Also always offer the trailing 6 months for convenience.
    let cursor = currentMonth;
    for (let i = 0; i < 6; i++) {
      known.add(cursor);
      cursor = shiftMonth(cursor, -1);
    }
    const months = Array.from(known).sort().reverse();
    monthSelect.innerHTML = months.map(m => {
      const [y, mm] = m.split('-');
      return `<option value="${m}">${y}年${parseInt(mm, 10)}月</option>`;
    }).join('');
    monthSelect.value = currentMonth;
  }

  async function renderAll() {
    currentExpenses = await ExpenseDB.getByMonth(currentMonth);
    renderExpenseTable();
    await renderSummary();
  }

  function renderExpenseTable() {
    expenseTableBody.innerHTML = '';
    emptyMsg.classList.toggle('d-none', currentExpenses.length > 0);
    currentExpenses.forEach((exp) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${exp.date}</td>
        <td>${escapeHtml(exp.payee)}</td>
        <td>${escapeHtml(exp.category)}</td>
        <td>${escapeHtml(exp.purpose || '')}</td>
        <td class="text-end">${yen(exp.amount)}</td>
        <td>${exp.receiptImage ? `<img src="${exp.receiptImage}" class="receipt-thumb" data-id="${exp.id}">` : '—'}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-secondary edit-btn" data-id="${exp.id}">編集</button>
          <button class="btn btn-sm btn-outline-danger del-btn" data-id="${exp.id}">削除</button>
        </td>`;
      expenseTableBody.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function renderSummary() {
    const prevMonth = shiftMonth(currentMonth, -1);
    const prevExpenses = await ExpenseDB.getByMonth(prevMonth);

    const sumByCategory = (list) => {
      const map = {};
      for (const c of CATEGORIES) map[c] = 0;
      for (const exp of list) {
        map[exp.category] = (map[exp.category] || 0) + (Number(exp.amount) || 0);
      }
      return map;
    };

    const current = sumByCategory(currentExpenses);
    const previous = sumByCategory(prevExpenses);

    summaryTableBody.innerHTML = CATEGORIES.map((cat) => {
      const diff = current[cat] - previous[cat];
      const diffClass = diff > 0 ? 'text-danger' : diff < 0 ? 'text-success' : 'text-muted';
      const diffText = diff === 0 ? '±0' : (diff > 0 ? '+' : '') + diff.toLocaleString('ja-JP');
      return `<tr><td>${cat}</td><td class="text-end">${yen(current[cat])}</td><td class="text-end ${diffClass}">${diffText}</td></tr>`;
    }).join('');

    const total = Object.values(current).reduce((a, b) => a + b, 0);
    monthTotalEl.textContent = yen(total);
  }

  function resetForm() {
    $('expenseForm').reset();
    $('expenseId').value = '';
    $('receiptPreview').classList.add('d-none');
    $('receiptPreview').src = '';
    $('ocrStatus').textContent = '';
    pendingReceiptImage = null;
    $('fieldDate').value = new Date().toISOString().slice(0, 10);
  }

  function openAddModal() {
    resetForm();
    $('expenseModalTitle').textContent = '経費を登録';
    expenseModal.show();
  }

  function openEditModal(exp) {
    resetForm();
    $('expenseModalTitle').textContent = '経費を編集';
    $('expenseId').value = exp.id;
    $('fieldDate').value = exp.date;
    $('fieldPayee').value = exp.payee;
    $('fieldRegNo').value = exp.regNo || '';
    $('fieldCategory').value = exp.category;
    $('fieldAttendees').value = exp.attendees ?? '';
    $('fieldPurpose').value = exp.purpose || '';
    $('fieldAmount').value = exp.amount;
    if (exp.receiptImage) {
      pendingReceiptImage = exp.receiptImage;
      $('receiptPreview').src = exp.receiptImage;
      $('receiptPreview').classList.remove('d-none');
    }
    expenseModal.show();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  $('receiptInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    pendingReceiptImage = dataUrl;
    $('receiptPreview').src = dataUrl;
    $('receiptPreview').classList.remove('d-none');

    const statusEl = $('ocrStatus');
    statusEl.textContent = 'OCR読み取り中... 0%';
    try {
      const text = await OCR.recognize(dataUrl, (pct) => {
        statusEl.textContent = `OCR読み取り中... ${pct}%`;
      });
      const fields = OCR.extractFields(text);
      if (fields.payee && !$('fieldPayee').value) $('fieldPayee').value = fields.payee;
      if (fields.amount != null && !$('fieldAmount').value) $('fieldAmount').value = fields.amount;
      if (fields.regNo && !$('fieldRegNo').value) $('fieldRegNo').value = fields.regNo;
      statusEl.textContent = '読み取り完了。内容を確認・修正してください。';
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'OCR読み取りに失敗しました（手動で入力してください）。';
    }
  });

  $('receiptPreview').addEventListener('click', () => {
    $('previewImage').src = $('receiptPreview').src;
    previewModal.show();
  });

  expenseTableBody.addEventListener('click', async (e) => {
    const editId = e.target.closest('.edit-btn')?.dataset.id;
    const delId = e.target.closest('.del-btn')?.dataset.id;
    const thumb = e.target.closest('.receipt-thumb');

    if (thumb) {
      $('previewImage').src = thumb.src;
      previewModal.show();
      return;
    }
    if (editId) {
      const exp = currentExpenses.find(x => x.id === editId);
      if (exp) openEditModal(exp);
      return;
    }
    if (delId) {
      if (confirm('この経費データを削除しますか？')) {
        await ExpenseDB.remove(delId);
        toast('削除しました', 'secondary');
        await renderAll();
      }
    }
  });

  $('addBtn').addEventListener('click', openAddModal);

  $('saveExpenseBtn').addEventListener('click', async () => {
    const date = $('fieldDate').value;
    const payee = $('fieldPayee').value.trim();
    const amount = $('fieldAmount').value;
    if (!date || !payee || amount === '') {
      toast('支払日・支払先・支払額は必須です', 'danger');
      return;
    }
    const expense = {
      id: $('expenseId').value || undefined,
      date,
      payee,
      regNo: $('fieldRegNo').value.trim(),
      category: $('fieldCategory').value,
      purpose: $('fieldPurpose').value.trim(),
      amount: Number(amount),
      attendees: $('fieldAttendees').value === '' ? null : Number($('fieldAttendees').value),
      receiptImage: pendingReceiptImage,
    };
    await ExpenseDB.add(expense);
    expenseModal.hide();
    toast('保存しました');
    const savedMonth = expense.date.slice(0, 7);
    if (savedMonth !== currentMonth) {
      currentMonth = savedMonth;
      await populateMonthSelect();
    }
    await renderAll();
  });

  monthSelect.addEventListener('change', async () => {
    currentMonth = monthSelect.value;
    await renderAll();
  });

  $('exportBtn').addEventListener('click', async () => {
    if (currentExpenses.length === 0) {
      toast('この月の経費データがありません', 'warning');
      return;
    }
    const userName = await ExpenseDB.getSetting('userName', '');
    const companyName = await ExpenseDB.getSetting('companyName', '');
    if (!userName) {
      toast('設定（⚙）で氏名を入力してください', 'warning');
      settingsModal.show();
      return;
    }
    toast('Excelファイルを生成中...', 'info');
    try {
      const fileName = await ExcelExport.build({
        expenses: currentExpenses,
        month: currentMonth,
        userName,
        companyName,
      });
      toast(`出力しました: ${fileName}`, 'success');
    } catch (err) {
      console.error(err);
      toast('Excel出力に失敗しました', 'danger');
    }
  });

  $('settingsBtn').addEventListener('click', async () => {
    $('settingUserName').value = await ExpenseDB.getSetting('userName', '');
    $('settingCompanyName').value = await ExpenseDB.getSetting('companyName', '');
    settingsModal.show();
  });

  $('saveSettingsBtn').addEventListener('click', async () => {
    await ExpenseDB.setSetting('userName', $('settingUserName').value.trim());
    await ExpenseDB.setSetting('companyName', $('settingCompanyName').value.trim());
    settingsModal.hide();
    toast('設定を保存しました');
  });

  (async function init() {
    await populateMonthSelect();
    await renderAll();
  })();
})();
