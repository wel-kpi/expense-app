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

  async build({ expenses, month, userName, fullName, employeeCode, companyName }) {
    const workbook = new ExcelJS.Workbook();
    const [yyyy, mm] = month.split('-');
    const m = parseInt(mm, 10);
    const total = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    // --- Sheet 1: 経費精算書（出張費除く） ---
    const sheet1 = workbook.addWorksheet('経費精算書（出張費除く）');
    sheet1.getColumn(1).width = 3;
    sheet1.getColumn(2).width = 12;
    sheet1.getColumn(3).width = 20;
    sheet1.getColumn(4).width = 16;
    sheet1.getColumn(5).width = 12;
    sheet1.getColumn(6).width = 26;
    sheet1.getColumn(7).width = 12;
    sheet1.getColumn(8).width = 10;
    sheet1.getColumn(9).width = 10;

    sheet1.addRow([]);
    sheet1.mergeCells('B2:E2');
    const titleCell = sheet1.getCell('B2');
    titleCell.value = '経費精算書';
    titleCell.font = { bold: true, size: 26 };
    titleCell.alignment = { horizontal: 'center' };
    sheet1.addRow([]);

    const headerField = (row, label, value) => {
      sheet1.mergeCells(`C${row}:E${row}`);
      sheet1.getCell(`B${row}`).value = label;
      sheet1.getCell(`C${row}`).value = value;
    };
    headerField(4, '会社名', companyName || '');
    headerField(5, '年月度', `${yyyy}年${m}月度`);
    headerField(6, '氏名', fullName || userName || '');
    headerField(7, '社員コード', employeeCode || '');

    sheet1.mergeCells('B8:E8');
    const noteCell = sheet1.getCell('B8');
    noteCell.value = '※本精算書は、毎月末日までに締め、翌月3営業日までに経理部へ提出してください。';
    noteCell.font = { color: { argb: 'FFFF0000' }, size: 10 };

    sheet1.getCell('F8').value = '精算合計';
    sheet1.getCell('F8').alignment = { horizontal: 'right' };
    sheet1.mergeCells('G8:H8');
    const totalCell = sheet1.getCell('G8');
    totalCell.value = total;
    totalCell.numFmt = '#,##0';
    totalCell.font = { bold: true, size: 14 };
    totalCell.alignment = { horizontal: 'center' };
    totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

    const headerRow = sheet1.getRow(9);
    ['', '支払日', '支払先', '登録番号', '内容', '利用目的（対象者）', '支払額', '領収書No.', '同席人数'].forEach((v, i) => {
      headerRow.getCell(i + 1).value = v;
    });
    headerRow.font = { bold: true };
    for (let col = 2; col <= 9; col++) {
      const cell = headerRow.getCell(col);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    }
    sheet1.autoFilter = { from: 'B9', to: 'I9' };

    expenses.forEach((exp, i) => {
      const receiptNo = i + 1;
      const row = sheet1.addRow([
        '',
        exp.date,
        exp.payee,
        exp.regNo || '',
        exp.category,
        exp.purpose || '',
        Number(exp.amount) || 0,
        receiptNo,
        exp.attendees ?? '',
      ]);
      row.getCell(7).numFmt = '#,##0';
      for (let col = 2; col <= 9; col++) {
        row.getCell(col).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      }
    });

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
