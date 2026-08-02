/* =============================================================================
   Чтение .xlsx в браузере — для обновления реестра из присланной книги Excel.
   Возвращает листы «как есть»: имя листа и значения ячеек по номерам колонок.
   Раскладку по полям реестра делает registry.js, он знает, какая колонка
   какому полю соответствует (см. src в data/registry.json).

   Распаковывает тот же pizzip, что и договоры; сторонних библиотек нет.
   ============================================================================= */
(function () {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;

  // Встроенные форматы Excel, показывающие дату
  var BUILTIN_DATE = { 14: 1, 15: 1, 16: 1, 17: 1, 22: 1 };

  function parseXml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('файл повреждён: не читается внутренняя разметка');
    }
    return doc;
  }

  function colIndex(ref) {   // 'AB12' -> 28
    var n = 0;
    for (var i = 0; i < ref.length; i++) {
      var ch = ref.charCodeAt(i);
      if (ch < 65 || ch > 90) break;
      n = n * 26 + (ch - 64);
    }
    return n;
  }

  function text(node) {
    return node && node.textContent != null ? node.textContent : '';
  }

  // Строка из sharedStrings: либо <t>, либо куски <r><t>
  function siText(si) {
    var ts = si.getElementsByTagName('t');
    var s = '';
    for (var i = 0; i < ts.length; i++) {
      // <rPh> — фонетика японского, её в текст брать не надо
      if (ts[i].parentNode && ts[i].parentNode.nodeName === 'rPh') continue;
      s += text(ts[i]);
    }
    return s;
  }

  // Формат даты по коду: интересует только, дата это или нет, и что показывать
  function dateKind(code) {
    var c = String(code).replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').toLowerCase();
    if (/[hs]/.test(c)) return null;              // время, а не дата
    var hasY = c.indexOf('y') !== -1;
    var hasD = c.indexOf('d') !== -1;
    var hasM = c.indexOf('m') !== -1;
    if (hasD && (hasM || hasY)) return 'dmy';
    if (hasM && hasY) return 'my';
    if (hasY) return 'y';
    return null;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function serialToText(serial, kind, date1904) {
    var base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    var d = new Date(base + Math.floor(serial) * DAY);
    var dd = pad(d.getUTCDate()), mm = pad(d.getUTCMonth() + 1), yy = d.getUTCFullYear();
    if (kind === 'my') return mm + '.' + yy;
    if (kind === 'y') return String(yy);
    return dd + '.' + mm + '.' + yy;
  }

  /**
   * Разбирает .xlsx.
   * @param {ArrayBuffer} buffer содержимое файла
   * @return {{sheets: Array<{name: string, rows: Array<{r: number, cells: Object}>}>}}
   */
  function parse(buffer) {
    if (!window.PizZip) throw new Error('PizZip не загружен');
    var zip;
    try {
      zip = new PizZip(buffer);
    } catch (e) {
      throw new Error('это не .xlsx (файл не распаковывается). Старый .xls нужно пересохранить как .xlsx');
    }

    function fileText(path) {
      var f = zip.file(path);
      return f ? f.asText() : null;
    }

    var wbXml = fileText('xl/workbook.xml');
    if (!wbXml) throw new Error('это не книга Excel: внутри нет xl/workbook.xml');
    var wb = parseXml(wbXml);

    var pr = wb.getElementsByTagName('workbookPr')[0];
    var date1904 = !!(pr && (pr.getAttribute('date1904') === '1' || pr.getAttribute('date1904') === 'true'));

    // rId -> путь к листу
    var targets = {};
    var relsXml = fileText('xl/_rels/workbook.xml.rels');
    if (relsXml) {
      var rels = parseXml(relsXml).getElementsByTagName('Relationship');
      for (var i = 0; i < rels.length; i++) {
        var t = rels[i].getAttribute('Target') || '';
        targets[rels[i].getAttribute('Id')] = t.replace(/^\/?xl\//, '').replace(/^\.\//, '');
      }
    }

    // общие строки
    var shared = [];
    var ssXml = fileText('xl/sharedStrings.xml');
    if (ssXml) {
      var sis = parseXml(ssXml).getElementsByTagName('si');
      for (var s = 0; s < sis.length; s++) shared.push(siText(sis[s]));
    }

    // стили: индекс -> вид даты
    var styleDate = {};
    var stXml = fileText('xl/styles.xml');
    if (stXml) {
      var st = parseXml(stXml);
      var custom = {};
      var nfs = st.getElementsByTagName('numFmt');
      for (var n = 0; n < nfs.length; n++) {
        var kind = dateKind(nfs[n].getAttribute('formatCode') || '');
        if (kind) custom[nfs[n].getAttribute('numFmtId')] = kind;
      }
      var xfsBox = st.getElementsByTagName('cellXfs')[0];
      var xfs = xfsBox ? xfsBox.getElementsByTagName('xf') : [];
      for (var x = 0; x < xfs.length; x++) {
        var id = xfs[x].getAttribute('numFmtId');
        if (custom[id]) styleDate[x] = custom[id];
        else if (BUILTIN_DATE[+id]) styleDate[x] = 'dmy';
      }
    }

    var sheets = [];
    var sheetNodes = wb.getElementsByTagName('sheet');
    for (var k = 0; k < sheetNodes.length; k++) {
      var node = sheetNodes[k];
      var rid = node.getAttribute('r:id') || node.getAttribute('id');
      var path = targets[rid] || ('worksheets/sheet' + (k + 1) + '.xml');
      var xml = fileText('xl/' + path);
      if (!xml) continue;
      sheets.push({ name: node.getAttribute('name') || ('Лист' + (k + 1)),
                    rows: readRows(parseXml(xml), shared, styleDate, date1904) });
    }
    if (!sheets.length) throw new Error('в книге не нашлось ни одного листа');
    return { sheets: sheets };
  }

  function readRows(doc, shared, styleDate, date1904) {
    var out = [];
    var rows = doc.getElementsByTagName('row');
    for (var i = 0; i < rows.length; i++) {
      var cs = rows[i].getElementsByTagName('c');
      var cells = {};
      var any = false;
      for (var j = 0; j < cs.length; j++) {
        var c = cs[j];
        var type = c.getAttribute('t');
        var v = '';
        if (type === 's') {
          var idx = parseInt(text(c.getElementsByTagName('v')[0]), 10);
          v = shared[idx] || '';
        } else if (type === 'inlineStr') {
          var is = c.getElementsByTagName('is')[0];
          v = is ? siText(is) : '';
        } else if (type === 'str') {
          v = text(c.getElementsByTagName('v')[0]);   // результат формулы
        } else {
          var raw = text(c.getElementsByTagName('v')[0]);
          if (raw !== '') {
            var num = parseFloat(raw);
            var kind = styleDate[+(c.getAttribute('s') || 0)];
            // 1..100000 — разумный диапазон дат Excel: 1900..2173 год
            v = (kind && !isNaN(num) && num > 0 && num < 100000)
              ? serialToText(num, kind, date1904)
              : raw;
          }
        }
        v = String(v).replace(/\r\n/g, '\n').trim();
        if (v !== '') { cells[colIndex(c.getAttribute('r') || '')] = v; any = true; }
      }
      if (any) out.push({ r: parseInt(rows[i].getAttribute('r'), 10) || (i + 1), cells: cells });
    }
    return out;
  }

  window.XlsxRead = { parse: parse };
})();
