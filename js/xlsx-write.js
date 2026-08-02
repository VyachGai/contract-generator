/* =============================================================================
   Сборка .xlsx из данных реестра — чтобы выгруженный файл открывался в Excel
   так же, как исходный «Реестр договоров 27.xlsx»: лист на реестр, шапка
   закреплена, даты остаются датами, а не текстом.

   Файл собирается тем же pizzip, что и договоры (см. lib/), сторонние
   библиотеки для Excel не нужны.
   ============================================================================= */
(function () {
  'use strict';

  // Excel считает дни от 30.12.1899 — с этой точки и переводим.
  var EPOCH = Date.UTC(1899, 11, 30);
  var DAY = 24 * 60 * 60 * 1000;

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // управляющие символы Excel не принимает
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  function colName(n) { // 1 -> A, 27 -> AA
    var s = '';
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // «05.02.2021» -> порядковый номер дня в Excel; иначе null
  function dateSerial(text) {
    var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(text).trim());
    if (!m) return null;
    var d = +m[1], mo = +m[2], y = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var utc = Date.UTC(y, mo - 1, d);
    var back = new Date(utc);
    if (back.getUTCDate() !== d || back.getUTCMonth() !== mo - 1) return null;
    return Math.round((utc - EPOCH) / DAY);
  }

  // Имя листа: Excel запрещает : \ / ? * [ ] и длину больше 31 символа
  function sheetName(name, used) {
    var n = String(name).replace(/[:\\\/\?\*\[\]]/g, ' ').slice(0, 31).trim() || 'Лист';
    var base = n, i = 2;
    while (used.indexOf(n) !== -1) { n = base.slice(0, 28) + ' ' + i; i++; }
    used.push(n);
    return n;
  }

  var CT =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';

  var RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  // Стили: 0 — обычная ячейка, 1 — дата, 2 — шапка, 3 — строка-разделитель года
  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/></numFmts>' +
    '<fonts count="2">' +
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><charset val="204"/></font>' +
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><charset val="204"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE8F1F7"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFC7CDD6"/></left><right style="thin"><color rgb="FFC7CDD6"/></right>' +
    '<top style="thin"><color rgb="FFC7CDD6"/></top><bottom style="thin"><color rgb="FFC7CDD6"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function cellXml(ref, value, style) {
    if (value === null || value === undefined || value === '') return '';
    // число (дата) — только внутри <v>, иначе Excel молча теряет ячейку
    if (style === 1) return '<c r="' + ref + '" s="1"><v>' + value + '</v></c>';
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
      esc(value) + '</t></is></c>';
  }

  function sheetXml(sheet) {
    var cols = sheet.cols || [];
    var out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>';

    if (cols.length) {
      out += '<cols>';
      cols.forEach(function (c, i) {
        out += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' +
          (c.width || 18) + '" customWidth="1"/>';
      });
      out += '</cols>';
    }

    out += '<sheetData>';

    // шапка
    out += '<row r="1" ht="24" customHeight="1">';
    cols.forEach(function (c, i) {
      out += cellXml(colName(i + 1) + '1', c.title || '', 2);
    });
    out += '</row>';

    // данные
    sheet.rows.forEach(function (row, ri) {
      var r = ri + 2;
      out += '<row r="' + r + '">';
      row.forEach(function (cell, ci) {
        if (cell === null || cell === undefined || cell === '') return;
        var ref = colName(ci + 1) + r;
        if (cell.band) { out += cellXml(ref, cell.v, 3); return; }
        var text = typeof cell === 'string' ? cell : cell.v;
        if (text === '' || text === undefined || text === null) return;
        if ((cell.type || (cols[ci] && cols[ci].type)) === 'date') {
          var serial = dateSerial(text);
          if (serial !== null) { out += cellXml(ref, serial, 1); return; }
        }
        out += cellXml(ref, text, 0);
      });
      out += '</row>';
    });

    out += '</sheetData>';
    out += '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>';
    out += '</worksheet>';
    return out;
  }

  /**
   * Собирает книгу Excel.
   * sheets: [{ name, cols: [{title, width, type}], rows: [[строка|{v,type}|{v,band:true}]] }]
   * Возвращает Blob (.xlsx).
   */
  function build(sheets) {
    if (!window.PizZip) throw new Error('PizZip не загружен');
    var zip = new PizZip();
    var used = [];
    var names = sheets.map(function (s) { return sheetName(s.name, used); });

    var ct = CT;
    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    var wbSheets = '';

    sheets.forEach(function (sheet, i) {
      var n = i + 1;
      ct += '<Override PartName="/xl/worksheets/sheet' + n + '.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      wbRels += '<Relationship Id="rId' + n + '" ' +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
        'Target="worksheets/sheet' + n + '.xml"/>';
      wbSheets += '<sheet name="' + esc(names[i]) + '" sheetId="' + n + '" r:id="rId' + n + '"/>';
      zip.file('xl/worksheets/sheet' + n + '.xml', sheetXml(sheet));
    });

    var stylesId = 'rId' + (sheets.length + 1);
    wbRels += '<Relationship Id="' + stylesId + '" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
    ct += '</Types>';

    zip.file('[Content_Types].xml', ct);
    zip.file('_rels/.rels', RELS);
    zip.file('xl/_rels/workbook.xml.rels', wbRels);
    zip.file('xl/styles.xml', STYLES);
    zip.file('xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + wbSheets + '</sheets></workbook>');

    return zip.generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      compression: 'DEFLATE'
    });
  }

  window.XlsxWrite = { build: build, dateSerial: dateSerial };
})();
