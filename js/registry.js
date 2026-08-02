/* =============================================================================
   Реестр договоров — вкладка со сводными таблицами по шести направлениям.

   Данные лежат снимком в data/registry.json (выгружен из «Реестр договоров
   27.xlsx»). Правки оператора не уходят никуда с компьютера: они хранятся в
   localStorage поверх снимка и выгружаются кнопкой «Скачать .xlsx», чтобы
   положить обновлённый файл в общую папку.
   ============================================================================= */
(function () {
  'use strict';

  var DATA_URL = 'data/registry.json';
  var LS_KEY = 'k27-registry-patch-v1';

  var book = null;          // снимок из data/registry.json
  var patch = null;         // правки оператора поверх снимка
  var current = null;       // выбранный реестр
  var view = {};            // состояние таблицы по каждому реестру: поиск, год, сортировка
  var editing = null;       // запись, открытая в окне правки
  var loading = false;

  var $ = function (id) { return document.getElementById(id); };

  // Снимок нужен генератору договоров ещё до открытия вкладки — из него берётся
  // очередной номер и подсказки по сейлзам и составителям.
  var readyResolve, readyReject;
  var ready = new Promise(function (res, rej) { readyResolve = res; readyReject = rej; });

  // ---------------------------------------------------------------------------
  // Вкладки «Генератор» / «Реестр»
  // ---------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    var tabs = document.querySelectorAll('.tab');
    if (!tabs.length) return;
    Array.prototype.forEach.call(tabs, function (t) {
      t.addEventListener('click', function () { showView(t.dataset.view); });
    });
    initRegistryUi();
    load();
  });

  function showView(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('is-active', t.dataset.view === name);
    });
    $('viewGenerator').hidden = (name !== 'generator');
    $('viewRegistry').hidden = (name !== 'registry');
    document.body.classList.toggle('is-registry', name === 'registry');
    window.scrollTo(0, 0);
    if (name === 'registry') { load(); if (book) show(); }
  }

  // ---------------------------------------------------------------------------
  // Загрузка снимка
  // ---------------------------------------------------------------------------
  function load() {
    if (book || loading) return ready;
    loading = true;
    setStatus('Загружаю реестр…');
    try {
      fetchJson();
    } catch (e) {   // старый браузер без fetch — генератор не должен встать
      loading = false;
      readyReject(e);
      setStatus('Не удалось загрузить реестр: ' + e.message, true);
    }
    return ready;
  }

  function fetchJson() {
    fetch(DATA_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        book = data;
        patch = loadPatch();
        loading = false;
        readyResolve(book);
        if (!$('viewRegistry').hidden) show();
      })
      .catch(function (e) {
        loading = false;
        readyReject(e);
        setStatus('Не удалось загрузить data/registry.json: ' + e.message +
          '. Приложение должно быть открыто через веб-сервер, а не двойным кликом по index.html.', true);
      });
  }

  function show() {
    renderButtons();
    selectRegistry(current || book.registries[0].id);
  }

  // ---------------------------------------------------------------------------
  // Правки оператора (localStorage)
  // ---------------------------------------------------------------------------
  function emptyPatch() { return { base: book ? book.exported : '', reg: {} }; }

  function loadPatch() {
    var p;
    try { p = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { p = null; }
    if (!p || !p.reg) return emptyPatch();
    // Снимок на сайте обновили — правки по строкам старого снимка уже не
    // привязать к новым номерам, а добавленные договоры сохраняем: они могли
    // ещё не попасть в общий файл.
    if (p.base !== book.exported) {
      var kept = { base: book.exported, reg: {} };
      Object.keys(p.reg).forEach(function (id) {
        var added = (p.reg[id] || {}).added || [];
        if (added.length) kept.reg[id] = { added: added, edits: {}, deleted: [] };
      });
      savePatch(kept);
      return kept;
    }
    return p;
  }

  function savePatch(p) {
    patch = p || patch;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(patch));
    } catch (e) {
      setStatus('Не удалось сохранить правки в браузере: ' + e.message, true);
    }
  }

  function patchFor(id) {
    if (!patch.reg[id]) patch.reg[id] = { added: [], edits: {}, deleted: [] };
    var p = patch.reg[id];
    if (!p.added) p.added = [];
    if (!p.edits) p.edits = {};
    if (!p.deleted) p.deleted = [];
    return p;
  }

  function patchCounts(id) {
    var p = patchFor(id);
    return { added: p.added.length, edited: Object.keys(p.edits).length, deleted: p.deleted.length };
  }

  function totalChanges() {
    var n = 0;
    book.registries.forEach(function (r) {
      var c = patchCounts(r.id);
      n += c.added + c.edited + c.deleted;
    });
    return n;
  }

  // ---------------------------------------------------------------------------
  // Кнопки реестров
  // ---------------------------------------------------------------------------
  function renderButtons() {
    var box = $('regButtons');
    box.innerHTML = book.registries.map(function (r, i) {
      return '<button type="button" class="reg-btn" data-id="' + esc(r.id) + '">' +
        '<span class="reg-btn__num">' + (i + 1) + '</span>' +
        '<span class="reg-btn__name">' + esc(r.title) + '</span>' +
        '<span class="reg-btn__count">' + r.rows.length + '</span>' +
        '</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.reg-btn'), function (b) {
      b.addEventListener('click', function () { selectRegistry(b.dataset.id); });
    });
  }

  function updateButtonCounts() {
    Array.prototype.forEach.call($('regButtons').querySelectorAll('.reg-btn'), function (b) {
      var reg = registry(b.dataset.id);
      var c = patchCounts(reg.id);
      b.querySelector('.reg-btn__count').textContent = reg.rows.length + c.added - c.deleted;
      b.classList.toggle('is-active', reg.id === current);
    });
  }

  function registry(id) {
    var found = null;
    book.registries.forEach(function (r) { if (r.id === id) found = r; });
    return found;
  }

  function selectRegistry(id) {
    current = id;
    var reg = registry(id);
    if (!view[id]) view[id] = { q: '', year: '', sort: null, dir: 1 };
    $('regTitle').textContent = reg.title;
    $('regSearch').value = view[id].q;
    renderYears(reg);
    updateButtonCounts();
    renderTable();
  }

  // ---------------------------------------------------------------------------
  // Данные к показу
  // ---------------------------------------------------------------------------
  function records(reg) {
    var p = patchFor(reg.id);
    var out = [];
    reg.rows.forEach(function (row, i) {
      if (p.deleted.indexOf(i) !== -1) return;
      var e = p.edits[String(i)];
      out.push({ ref: 'b' + i, base: i, data: e || row, edited: !!e });
    });
    p.added.forEach(function (row, i) {
      out.push({ ref: 'a' + i, add: i, data: row, added: true });
    });
    return out;
  }

  function recordByRef(reg, ref) {
    var found = null;
    records(reg).forEach(function (r) { if (r.ref === ref) found = r; });
    return found;
  }

  function yearOf(row) {
    var m = /(\d{4})\s*$/.exec(String(row.date || ''));
    return m ? m[1] : '';
  }

  function renderYears(reg) {
    var sel = $('regYear');
    var years = {};
    records(reg).forEach(function (r) {
      var y = yearOf(r.data);
      if (y) years[y] = (years[y] || 0) + 1;
    });
    var list = Object.keys(years).sort().reverse();
    sel.innerHTML = '<option value="">Все годы</option>' + list.map(function (y) {
      return '<option value="' + y + '">' + y + ' (' + years[y] + ')</option>';
    }).join('');
    sel.value = view[reg.id].year;
    if (sel.value !== view[reg.id].year) { view[reg.id].year = ''; sel.value = ''; }
  }

  function matches(row, reg, q) {
    if (!q) return true;
    for (var i = 0; i < reg.columns.length; i++) {
      var v = row[reg.columns[i].key];
      if (v && String(v).toLowerCase().indexOf(q) !== -1) return true;
    }
    return false;
  }

  function sortValue(row, col) {
    var v = row[col.key] || '';
    if (col.type === 'date') {
      var s = window.XlsxWrite ? XlsxWrite.dateSerial(v) : null;
      return s === null ? -1 : s;
    }
    return String(v).toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Таблица
  // ---------------------------------------------------------------------------
  function renderTable() {
    var reg = registry(current);
    var st = view[current];
    var q = st.q.trim().toLowerCase();
    var all = records(reg);

    var rows = all.filter(function (r) {
      if (st.year && yearOf(r.data) !== st.year) return false;
      return matches(r.data, reg, q);
    });

    var plain = !!(q || st.year || st.sort);   // бэнды по годам только в исходном порядке

    if (st.sort) {
      var col = null;
      reg.columns.forEach(function (c) { if (c.key === st.sort) col = c; });
      if (col) {
        rows = rows.slice().sort(function (a, b) {
          var va = sortValue(a.data, col), vb = sortValue(b.data, col);
          if (va < vb) return -st.dir;
          if (va > vb) return st.dir;
          return 0;
        });
      }
    }

    var head = '<tr><th class="reg-th reg-th--num">#</th>' + reg.columns.map(function (c) {
      var cls = 'reg-th' + (st.sort === c.key ? ' is-sorted' : '');
      var arrow = st.sort === c.key ? (st.dir === 1 ? ' ↑' : ' ↓') : '';
      return '<th class="' + cls + '" data-key="' + esc(c.key) + '" style="min-width:' +
        Math.max(70, Math.round(c.width * 6.2)) + 'px">' + esc(c.title) + arrow + '</th>';
    }).join('') + '</tr>';

    var bands = {};
    if (!plain) (reg.years || []).forEach(function (y) { bands[y[0]] = y[1]; });

    var body = [];
    var shown = 0;
    var lastBase = -1;
    rows.forEach(function (r) {
      if (!plain && r.base !== undefined) {
        // разделители лет между строками исходного файла
        for (var k = lastBase + 1; k <= r.base; k++) {
          if (bands[k]) body.push(bandRow(bands[k], reg.columns.length + 1));
        }
        lastBase = r.base;
      }
      shown++;
      body.push(dataRow(r, reg, shown));
    });
    if (!plain) {
      for (var k = lastBase + 1; k <= reg.rows.length; k++) {
        if (bands[k]) body.push(bandRow(bands[k], reg.columns.length + 1));
      }
    }

    if (!body.length) {
      body.push('<tr><td class="reg-empty" colspan="' + (reg.columns.length + 1) + '">' +
        (all.length ? 'Ничего не найдено — измените поиск или год.' : 'Реестр пуст.') + '</td></tr>');
    }

    $('regTable').innerHTML = '<thead>' + head + '</thead><tbody>' + body.join('') + '</tbody>';

    Array.prototype.forEach.call($('regTable').querySelectorAll('.reg-th[data-key]'), function (th) {
      th.addEventListener('click', function () { toggleSort(th.dataset.key); });
    });
    Array.prototype.forEach.call($('regTable').querySelectorAll('tr[data-ref]'), function (tr) {
      tr.addEventListener('click', function () { openEditor(tr.dataset.ref); });
    });

    var c = patchCounts(current);
    var parts = [];
    parts.push('Показано ' + shown + ' из ' + all.length);
    if (c.added) parts.push('добавлено ' + c.added);
    if (c.edited) parts.push('изменено ' + c.edited);
    if (c.deleted) parts.push('удалено ' + c.deleted);
    setStatus(parts.join(' · '));
    $('regReset').hidden = totalChanges() === 0;
    updateButtonCounts();
  }

  function bandRow(year, cols) {
    return '<tr class="reg-band"><td colspan="' + cols + '">' + esc(year) + '</td></tr>';
  }

  function dataRow(r, reg, num) {
    var cls = 'reg-row' + (r.added ? ' is-added' : '') + (r.edited ? ' is-edited' : '');
    var tds = reg.columns.map(function (c) {
      var v = r.data[c.key] || '';
      var cellCls = 'reg-td reg-td--' + c.type;
      if (c.type === 'sign' && v) cellCls += ' is-signed';
      return '<td class="' + cellCls + '">' + esc(v) + '</td>';
    }).join('');
    return '<tr class="' + cls + '" data-ref="' + esc(r.ref) + '">' +
      '<td class="reg-td reg-td--num">' + num + '</td>' + tds + '</tr>';
  }

  function toggleSort(key) {
    var st = view[current];
    if (st.sort !== key) { st.sort = key; st.dir = 1; }
    else if (st.dir === 1) { st.dir = -1; }
    else { st.sort = null; st.dir = 1; }   // третий клик — вернуть порядок файла
    renderTable();
  }

  // ---------------------------------------------------------------------------
  // Окно правки строки
  // ---------------------------------------------------------------------------
  function suggestions(reg, key) {
    var vals = {};
    records(reg).forEach(function (r) {
      var v = r.data[key];
      if (v && String(v).length <= 60) vals[v] = 1;
    });
    var list = Object.keys(vals);
    return list.length <= 60 ? list.sort() : [];
  }

  function isoFromRu(v) {
    var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(v || '').trim());
    if (!m) return '';
    return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  }

  function ruFromIso(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
    if (!m) return '';
    return m[3] + '.' + m[2] + '.' + m[1];
  }

  function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }

  function openEditor(ref) {
    var reg = registry(current);
    var rec = ref ? recordByRef(reg, ref) : null;
    editing = rec ? { ref: rec.ref } : { ref: null };
    var data = rec ? rec.data : {};

    $('regDlgTitle').textContent = rec ? 'Договор в реестре «' + reg.title + '»' :
      'Новый договор в реестре «' + reg.title + '»';

    $('regDlgBody').innerHTML = reg.columns.map(function (c) {
      var v = data[c.key] || '';
      var id = 'regf_' + c.key;
      var input;
      if (c.type === 'date' && (!v || isoFromRu(v))) {
        input = '<input type="date" id="' + id + '" data-key="' + esc(c.key) +
          '" data-kind="date" value="' + esc(isoFromRu(v)) + '">';
      } else {
        var list = suggestions(reg, c.key);
        var listId = list.length ? id + '_list' : '';
        input = '<input type="text" id="' + id + '" data-key="' + esc(c.key) + '" value="' + esc(v) + '"' +
          (listId ? ' list="' + listId + '"' : '') + '>' +
          (listId ? '<datalist id="' + listId + '">' +
            list.map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join('') +
            '</datalist>' : '');
      }
      return '<label class="field"><span class="field__label">' + esc(c.title) + '</span>' + input + '</label>';
    }).join('');

    $('regDlgDelete').hidden = !rec;
    $('regDialog').hidden = false;
    document.body.classList.add('is-modal');
    var first = $('regDlgBody').querySelector('input');
    if (first) first.focus();
  }

  function closeEditor() {
    $('regDialog').hidden = true;
    document.body.classList.remove('is-modal');
    editing = null;
  }

  function saveEditor() {
    var reg = registry(current);
    var row = {};
    Array.prototype.forEach.call($('regDlgBody').querySelectorAll('input[data-key]'), function (inp) {
      var v = inp.value.trim();
      if (inp.dataset.kind === 'date') v = ruFromIso(v);
      if (v) row[inp.dataset.key] = v;
    });

    if (!Object.keys(row).length) { closeEditor(); return; }

    var p = patchFor(reg.id);
    if (!editing.ref) {
      p.added.push(row);
    } else if (editing.ref.charAt(0) === 'a') {
      p.added[+editing.ref.slice(1)] = row;
    } else {
      p.edits[editing.ref.slice(1)] = row;
    }
    savePatch();
    closeEditor();
    renderYears(reg);
    renderTable();
  }

  function deleteRecord() {
    var reg = registry(current);
    if (!editing || !editing.ref) return;
    if (!window.confirm('Удалить строку из реестра? Правка сохранится только в этом браузере, ' +
      'общий файл изменится после выгрузки .xlsx.')) return;
    var p = patchFor(reg.id);
    if (editing.ref.charAt(0) === 'a') {
      p.added.splice(+editing.ref.slice(1), 1);
    } else {
      var i = +editing.ref.slice(1);
      if (p.deleted.indexOf(i) === -1) p.deleted.push(i);
      delete p.edits[String(i)];
    }
    savePatch();
    closeEditor();
    renderYears(reg);
    renderTable();
  }

  function resetPatch() {
    var n = totalChanges();
    if (!n) return;
    if (!window.confirm('Убрать все ваши правки (' + n + ') и вернуть реестр к снимку от ' +
      book.exported + '?')) return;
    patch = emptyPatch();
    savePatch();
    var reg = registry(current);
    renderYears(reg);
    renderTable();
  }

  // ---------------------------------------------------------------------------
  // Выгрузка .xlsx
  // ---------------------------------------------------------------------------
  function exportXlsx() {
    if (!book) return;
    try {
      var sheets = book.registries.map(function (reg) {
        var p = patchFor(reg.id);
        var bands = {};
        (reg.years || []).forEach(function (y) { bands[y[0]] = y[1]; });
        var orgIdx = 0;
        reg.columns.forEach(function (c, i) { if (c.key === 'org') orgIdx = i; });

        var rows = [];
        function band(text) {
          var r = [];
          r[orgIdx] = { v: text, band: true };
          rows.push(r);
        }
        reg.rows.forEach(function (row, i) {
          if (bands[i]) band(bands[i]);
          if (p.deleted.indexOf(i) !== -1) return;
          rows.push(cells(reg, p.edits[String(i)] || row));
        });
        if (bands[reg.rows.length]) band(bands[reg.rows.length]);
        p.added.forEach(function (row) { rows.push(cells(reg, row)); });

        return {
          name: reg.sheet || reg.title,
          cols: reg.columns.map(function (c) {
            return { title: c.title, width: c.width, type: c.type };
          }),
          rows: rows
        };
      });

      var blob = XlsxWrite.build(sheets);
      var name = 'Реестр договоров 27 — ' + stamp() + '.xlsx';
      if (window.saveAs) saveAs(blob, name);
      else {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
      }
      setStatus('Файл «' + name + '» скачан. Положите его в общую папку взамен старого.');
    } catch (e) {
      setStatus('Не удалось собрать .xlsx: ' + e.message, true);
    }
  }

  function cells(reg, row) {
    return reg.columns.map(function (c) { return row[c.key] || ''; });
  }

  function stamp() {
    var d = new Date();
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  // ---------------------------------------------------------------------------
  // Мелочи интерфейса
  // ---------------------------------------------------------------------------
  function initRegistryUi() {
    var search = $('regSearch');
    var timer = null;
    search.addEventListener('input', function () {
      if (!current) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        view[current].q = search.value;
        renderTable();
      }, 150);
    });
    $('regYear').addEventListener('change', function () {
      view[current].year = $('regYear').value;
      renderTable();
    });
    $('regAdd').addEventListener('click', function () { openEditor(null); });
    $('regExport').addEventListener('click', exportXlsx);
    $('regReset').addEventListener('click', resetPatch);
    $('regDlgSave').addEventListener('click', saveEditor);
    $('regDlgCancel').addEventListener('click', closeEditor);
    $('regDlgDelete').addEventListener('click', deleteRecord);
    $('regDialog').addEventListener('click', function (e) {
      if (e.target === $('regDialog')) closeEditor();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('regDialog').hidden) closeEditor();
      if (e.key === 'Enter' && !$('regDialog').hidden && e.target.tagName === 'INPUT') saveEditor();
    });
  }

  function setStatus(text, isError) {
    var el = $('regStatus');
    el.textContent = text;
    el.classList.toggle('is-error', !!isError);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // Связь с генератором договоров
  // ---------------------------------------------------------------------------
  var MAIN = 'to-teo';   // договоры из генератора идут в реестр «ТО и ТЭО»

  // Следующий номер по реестру: 59-<год>/<порядковый>. Порядковый берём
  // от наибольшего уже занятого за этот год, а не от числа строк — в реестре
  // попадаются договоры с номерами клиента, они в нумерацию не входят.
  function nextNumber(year) {
    if (!book) return '';
    var reg = registry(MAIN);
    var prefix = '59-' + (year || new Date().getFullYear()) + '/';
    var max = 0;
    records(reg).forEach(function (r) {
      var num = String(r.data.number || '');
      if (num.indexOf(prefix) !== 0) return;
      var n = parseInt(num.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return prefix + (max + 1);
  }

  // Значения колонки — для подсказок в полях генератора
  function values(key, regId) {
    if (!book) return [];
    var seen = {};
    records(registry(regId || MAIN)).forEach(function (r) {
      var v = r.data[key];
      if (v) seen[v] = 1;
    });
    return Object.keys(seen).sort();
  }

  // Запись только что сформированного договора: добавляем строку и открываем
  // на ней реестр. Повторное скачивание того же договора (.docx, потом PDF)
  // строку не дублирует — обновляет уже добавленную.
  function addContract(row) {
    return (book ? Promise.resolve(book) : load()).then(function () {
      var reg = registry(MAIN);
      var p = patchFor(reg.id);
      var at = -1;
      p.added.forEach(function (r, i) {
        if (row.number && r.number === row.number) at = i;
      });
      if (at === -1) { p.added.push(row); at = p.added.length - 1; }
      else { p.added[at] = row; }
      savePatch();

      // сбрасываем поиск и сортировку, иначе новая строка может не попасть в показ
      current = reg.id;
      view[reg.id] = { q: '', year: '', sort: null, dir: 1 };
      showView('registry');
      show();
      flash('a' + at);
      return 'a' + at;
    });
  }

  function flash(ref) {
    var tr = $('regTable').querySelector('tr[data-ref="' + ref + '"]');
    if (!tr) return;
    tr.classList.add('is-flash');
    if (tr.scrollIntoView) tr.scrollIntoView({ block: 'center' });
    setTimeout(function () { tr.classList.remove('is-flash'); }, 4000);
  }

  window.Registry = {
    ready: ready,
    nextNumber: nextNumber,
    values: values,
    addContract: addContract
  };
})();
