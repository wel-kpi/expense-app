// Builds the monthly expense report workbook (ExcelJS) and triggers a download.
const ExcelExport = {
  buildFileName(month, userName) {
    // month: 'YYYY-MM'
    const [yyyy, mm] = month.split('-');
    const yy = yyyy.slice(2);
    const m = String(parseInt(mm, 10));
    return `【${yy}年${m}月_${userName}】経費精算書・出張旅費精算書_${yy}${mm}_${userName}.xlsx`;
  },

  dataUrlToExt(dataUrl) {
    const match = /^data:image\/(png|jpeg|jpg);/.exec(dataUrl || '');
    if (!match) return 'jpeg';
    return match[1] === 'jpg' ? 'jpeg' : match[1];
  },

  async build({ expenses, month, userName, companyName }) {
    const workbook = new ExcelJS.Workbook();
    const [yyyy, mm] = month.split('-');
    const m = parseInt(mm, 10);

    // --- Sheet 1: 経費精算書（出張費除く） ---
    const sheet1 = workbook.addWorksheet('経費精算書（出張費除く）');
    sheet1.getColumn(1).width = 12;
    sheet1.getColumn(2).width = 20;
    sheet1.getColumn(3).width = 16;
    sheet1.getColumn(4).width = 12;
    sheet1.getColumn(5).width = 24;
    sheet1.getColumn(6).width = 12;
    sheet1.getColumn(7).width = 10;
    sheet1.getColumn(8).width = 10;

    sheet1.addRow(['会社名', companyName || '']);
    sheet1.addRow(['年月', `${yyyy}年${m}月`]);
    sheet1.addRow(['氏名', userName || '']);
    sheet1.addRow([]);

    const headerRow = sheet1.addRow([
      '支払日', '支払先', '登録番号', '内容', '利用目的（対象者）', '支払額', '領収書№', '同席人数',
    ]);
    headerRow.font = { bold: true };
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });

    let total = 0;
    expenses.forEach((exp, i) => {
      const receiptNo = i + 1;
      total += Number(exp.amount) || 0;
      const row = sheet1.addRow([
        exp.date,
        exp.payee,
        exp.regNo || '',
        exp.category,
        exp.purpose || '',
        Number(exp.amount) || 0,
        receiptNo,
        exp.attendees ?? '',
      ]);
      row.getCell(6).numFmt = '#,##0';
      row.eachCell(cell => {
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });
    });

    const totalRow = sheet1.addRow(['', '', '', '', '合計', total, '', '']);
    totalRow.font = { bold: true };
    totalRow.getCell(6).numFmt = '#,##0';

    // --- Sheet 2: 領収書 ---
    const sheet2 = workbook.addWorksheet('領収書');
    sheet2.getColumn(1).width = 14;
    let rowCursor = 1;
    const ROWS_PER_IMAGE = 16;

    expenses.forEach((exp, i) => {
      const receiptNo = i + 1;
      sheet2.getCell(`A${rowCursor}`).value = `領収書№ ${receiptNo}（${exp.payee || ''} / ${exp.date || ''}）`;
      sheet2.getCell(`A${rowCursor}`).font = { bold: true };

      if (exp.receiptImage) {
        const ext = this.dataUrlToExt(exp.receiptImage);
        const imageId = workbook.addImage({ base64: exp.receiptImage, extension: ext });
        sheet2.addImage(imageId, {
          tl: { col: 0, row: rowCursor },
          ext: { width: 260, height: 320 },
        });
      } else {
        sheet2.getCell(`A${rowCursor + 1}`).value = '（画像未登録）';
      }

      rowCursor += ROWS_PER_IMAGE;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = this.buildFileName(month, userName || '未設定');
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return fileName;
  },
};
