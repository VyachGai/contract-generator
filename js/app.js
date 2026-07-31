/* =============================================================================
   Генератор договоров — основная логика интерфейса.
   Всё выполняется в браузере: чтение карточки, склонение ФИО, сборка .docx/.pdf.
   ============================================================================= */
(function () {
  'use strict';

  // --- Конфигурация договоров ---
  var CONTRACTS = {
    teo:   { file: 'templates/teo.docx',   title: 'Транспортно-экспедиционное обслуживание' },
    mixed: { file: 'templates/mixed.docx', title: 'Смешанный договор (ТЭО + таможенное оформление)' },
    to:    { file: 'templates/to.docx',    title: 'Договор поручения (таможенное оформление)' }
  };

  var FIELD_IDS = [
    'name_full', 'name_short', 'signatory_fio', 'signatory_role',
    'legal_address', 'postal_address', 'phone', 'email',
    'inn', 'kpp', 'ogrn', 'bank', 'account', 'corr_account', 'bik'
  ];

  var state = { type: 'teo' };
  // Пока оператор сам не выбрал основание полномочий, подсказываем его
  // по должности; после ручного выбора больше не перебиваем.
  var basisTouched = false;
  var lastRender = null; // кэш последнего отрендеренного договора (для скачивания)
  var $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------------------------
  // Инициализация
  // ---------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    initContractType();
    initDropzone();
    initDeclensionPreview();
    initActions();
    setDefaultDate();
    // Настройка pdf.js worker
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    }
  });

  function setDefaultDate() {
    var d = new Date();
    $('doc_date').value = d.toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // Выбор типа договора
  // ---------------------------------------------------------------------------
  function initContractType() {
    var seg = $('contractType');
    var buttons = seg.querySelectorAll('.seg');
    function activate(type) {
      state.type = type;
      buttons.forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.type === type);
      });
      $('typeDesc').textContent = CONTRACTS[type].title;
    }
    buttons.forEach(function (b) {
      b.addEventListener('click', function () { activate(b.dataset.type); });
    });
    activate('teo');
  }

  // ---------------------------------------------------------------------------
  // Загрузка и разбор карточки
  // ---------------------------------------------------------------------------
  function initDropzone() {
    var dz = $('dropzone');
    var input = $('cardFile');

    input.addEventListener('change', function () {
      if (input.files && input.files[0]) handleCardFile(input.files[0]);
    });
    ['dragover', 'dragenter'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('is-drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('is-drag'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleCardFile(f);
    });

    $('fillManual').addEventListener('click', function () {
      $('name_full').focus();
      setStatus('Заполните поля вручную и создайте договор.', 'ok');
    });
  }

  function setStatus(msg, kind) {
    var el = $('parseStatus');
    el.hidden = false;
    el.className = 'parse-status is-' + (kind || 'ok');
    el.textContent = msg;
  }

  function handleCardFile(file) {
    setStatus('Читаю карточку…', 'load');
    var name = file.name.toLowerCase();
    var reader = new FileReader();

    if (name.endsWith('.txt')) {
      reader.onload = function () { applyParsed(reader.result, file.name); };
      reader.readAsText(file, 'utf-8');
    } else if (name.endsWith('.docx')) {
      reader.onload = function () {
        try {
          applyParsed(window.DocxView.toText(window.DocxView.fromBuffer(reader.result)), file.name);
        } catch (err) {
          setStatus('Не удалось прочитать .docx: ' + err.message, 'err');
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (name.endsWith('.pdf')) {
      reader.onload = function () { extractPdfText(reader.result, file.name); };
      reader.readAsArrayBuffer(file);
    } else if (name.endsWith('.doc')) {
      setStatus('Старый формат .doc не читается в браузере. Пересохраните карточку как .docx (Файл → Сохранить как) или заполните вручную.', 'warn');
    } else {
      setStatus('Неподдерживаемый формат. Нужен .docx, .txt или .pdf.', 'err');
    }
  }

  function extractPdfText(arrayBuffer, fileName) {
    if (!window.pdfjsLib) { setStatus('PDF-модуль не загрузился.', 'err'); return; }
    pdfjsLib.getDocument({ data: arrayBuffer }).promise.then(function (pdf) {
      var pages = [];
      var tasks = [];
      for (var p = 1; p <= pdf.numPages; p++) {
        tasks.push(pdf.getPage(p).then(function (page) {
          return page.getTextContent().then(function (tc) {
            return tc.items.map(function (i) { return i.str; }).join(' ');
          });
        }));
      }
      Promise.all(tasks).then(function (texts) {
        applyParsed(texts.join('\n'), fileName);
      });
    }).catch(function (err) {
      setStatus('Не удалось прочитать PDF: ' + err.message, 'err');
    });
  }

  function applyParsed(text, fileName) {
    var data = window.CardParser.parse(text);
    var filled = 0, total = 0;
    var missing = [];
    var LABELS = {
      name_full: 'наименование', signatory_fio: 'ФИО подписанта',
      inn: 'ИНН', kpp: 'КПП', ogrn: 'ОГРН', legal_address: 'юр. адрес',
      account: 'р/с', bik: 'БИК', bank: 'банк'
    };
    FIELD_IDS.forEach(function (id) {
      var input = $(id);
      var val = data[id] || '';
      total++;
      if (val) {
        input.value = val;
        input.classList.add('is-autofilled');
        filled++;
      } else {
        input.classList.remove('is-autofilled');
        if (LABELS[id]) missing.push(LABELS[id]);
      }
    });
    updateDeclension();
    suggestBasis();
    uncheckConfirm();
    hidePreview();

    var pct = Math.round(filled / total * 100);
    if (missing.length === 0) {
      setStatus('Карточка «' + fileName + '» разобрана. Все ключевые поля заполнены — проверьте и создавайте договор.', 'ok');
    } else {
      setStatus('Заполнено ' + filled + ' из ' + total + ' полей (' + pct + '%). Допишите вручную: ' +
        missing.join(', ') + '. Зелёным подсвечены поля из карточки.', 'warn');
    }
  }

  // ---------------------------------------------------------------------------
  // Живой предпросмотр склонения ФИО
  // ---------------------------------------------------------------------------
  function initDeclensionPreview() {
    $('signatory_fio').addEventListener('input', updateDeclension);
    $('signatory_basis').addEventListener('change', function () {
      basisTouched = true;
      togglePoaFields();
    });
    $('signatory_role').addEventListener('input', suggestBasis);
    $('name_full').addEventListener('input', suggestBasis);
  }

  // Поля доверенности нужны только когда основанием выбрана доверенность
  function togglePoaFields() {
    $('poaFields').hidden = $('signatory_basis').value !== 'доверенности';
  }

  function isIndividual() {
    return /^\s*(индивидуальный предприниматель|ип\b)/i.test($('name_full').value) ||
      /индивидуальный предприниматель/i.test($('signatory_role').value);
  }

  // По уставу действует только единоличный исполнительный орган — директор
  // или генеральный директор. ИП — без основания. Все прочие подписанты
  // (коммерческий директор, представитель, президент) — по доверенности;
  // если это не так, оператор меняет выбор руками.
  function suggestBasis() {
    if (basisTouched) return;
    var role = $('signatory_role').value.trim();
    $('signatory_basis').value = isIndividual() ? ''
      : (/^(генеральный\s+)?директор$/i.test(role) ? 'Устава' : 'доверенности');
    togglePoaFields();
  }

  function updateDeclension() {
    var fio = $('signatory_fio').value.trim();
    var box = $('declPreview');
    if (!fio) { box.hidden = true; return; }
    var P = window.Petrovich;
    var parsed = P.parseFio(fio);
    var gender = P.detectGender(parsed.middle);
    var gen = P.declineFullName(fio, 'genitive');
    var sign = P.toInitials(fio);
    box.hidden = false;
    $('prevGen').textContent = gen;
    $('prevSign').textContent = sign;
    var g = gender === 'male' ? 'мужской' : gender === 'female' ? 'женский' : 'не определён (проверьте склонение)';
    $('prevGender').textContent = 'Пол по отчеству: ' + g;
  }

  // ---------------------------------------------------------------------------
  // Сбор данных формы -> объект для шаблона
  // ---------------------------------------------------------------------------
  function collectData() {
    var v = {};
    FIELD_IDS.forEach(function (id) { v[id] = $(id).value.trim(); });
    v.doc_number = $('doc_number').value.trim();
    v.doc_date = $('doc_date').value;
    v.signatory_basis = $('signatory_basis').value;
    v.poa_number = $('poa_number').value.trim();
    v.poa_date = $('poa_date').value;

    var P = window.Petrovich;
    var role = v.signatory_role || 'директора';
    // Роль в родительном падеже для «в лице ...»
    var roleGen = roleToGenitive(role);
    var fioGen = v.signatory_fio ? P.declineFullName(v.signatory_fio, 'genitive') : '';
    var fioSign = v.signatory_fio ? P.toInitials(v.signatory_fio) : '';
    var gender = v.signatory_fio ? P.detectGender(P.parseFio(v.signatory_fio).middle) : 'androgynous';

    // Наименование целиком, с ОПФ: в шаблонах теперь голый тег, чтобы договор
    // с клиентом-АО или ИП не начинался с зашитого «Общество с ограниченной
    // ответственностью».
    var isIp = /^\s*(индивидуальный предприниматель|ип\b)/i.test(v.name_full || '');

    // Формируем значения тегов для docxtemplater
    var tags = {
      client_name_full: v.name_full || '________________________',
      client_name_short: v.name_short || v.name_full || '________',
      client_signatory_role: roleGen,
      // Род согласуется с клиентом: «ООО …, именуемое», «ИП Иванова …, именуемая»
      client_named: isIp ? (gender === 'female' ? 'именуемая' : 'именуемый') : 'именуемое',
      client_acting: gender === 'female' ? 'действующей' : 'действующего',
      // Готовый оборот с ведущей запятой: «, действующего на основании Устава»
      // или «…доверенности № 3 от 03.12.2025 г.».
      // Если основание не выбрано (ИП), оборот из договора исчезает целиком.
      client_basis: buildBasis(v, gender),
      doc_number: v.doc_number || '____',
      doc_date: formatDocDate(v.doc_date),
      client_signatory_gen: fioGen || '________________________',
      client_signatory_sign: fioSign || '________________',
      client_legal_address: v.legal_address,
      client_postal_address: v.postal_address,
      client_phone: v.phone,
      client_email: v.email,
      client_inn_kpp: joinInnKpp(v.inn, v.kpp),
      client_ogrn: v.ogrn,
      client_account: v.account,
      client_corr_account: v.corr_account,
      client_bik: v.bik
    };

    // Реквизиты клиента: в шаблонах это цикл
    // {#client_requisites}{line}{/client_requisites} — по абзацу на строку,
    // незаполненные поля строк не создают. client_full_requisites — та же
    // выжимка одним абзацем, на случай если в шаблоне остался старый тег.
    var lines = buildRequisiteLines(v);
    tags.client_requisites = lines.map(function (line) { return { line: line }; });
    tags.client_full_requisites = lines.join('\n');

    return { v: v, tags: tags };
  }

  function joinInnKpp(inn, kpp) {
    if (inn && kpp) return inn + '/' + kpp;
    return inn || kpp || '';
  }

  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // '2026-07-30' -> '«30» июля 2026 г.'  Пусто -> прочерки под ручное заполнение.
  function formatDocDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '«__» ____________ 20__ г.';
    return '«' + m[3] + '» ' + MONTHS[parseInt(m[2], 10) - 1] + ' ' + m[1] + ' г.';
  }

  // '2025-12-03' -> '03.12.2025 г.'
  function formatShortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '.' + m[2] + '.' + m[1] + ' г.' : '';
  }

  // «, действующего на основании Устава» / «…доверенности № 3 от 03.12.2025 г.»
  function buildBasis(v, gender) {
    if (!v.signatory_basis) return '';
    var s = ', ' + (gender === 'female' ? 'действующей' : 'действующего') +
      ' на основании ' + v.signatory_basis;
    if (v.signatory_basis === 'доверенности') {
      if (v.poa_number) s += ' № ' + v.poa_number;
      var d = formatShortDate(v.poa_date);
      if (d) s += ' от ' + d;
    }
    return s;
  }

  // Должность в родительный падеж: «Генеральный директор» -> «Генерального
  // директора». Склоняем каждое слово по окончанию, регистр оператора сохраняем.
  function roleToGenitive(role) {
    var r = (role || '').trim();
    if (!r) return 'директора';
    return r.split(/\s+/).map(function (w) {
      if (/(ый|ой)$/.test(w)) return w.replace(/(ый|ой)$/, 'ого');
      if (/ий$/.test(w)) return w.replace(/ий$/, /[гкхжчшщ]ий$/.test(w) ? 'ого' : 'его');
      if (/ь$/.test(w)) return w.replace(/ь$/, 'я');
      if (/[бвгдзклмнпрстфх]$/i.test(w)) return w + 'а';
      return w; // уже в родительном («директора») или не склоняется («и.о.»)
    }).join(' ');
  }

  // Строки реквизитов клиента — по одной на заполненное поле.
  // Пустое поле строки не даёт вовсе: в договоре не должно быть «Телефон:»
  // без номера, если в карточке телефона нет. Формулировки и порядок — как
  // в колонке Исполнителя в шаблонах, чтобы столбцы читались одинаково.
  // Наименование клиента и строка подписи стоят в самом шаблоне — отдельными
  // ячейками таблицы, чтобы они были на одном уровне с реквизитами Исполнителя.
  function buildRequisiteLines(v) {
    var lines = [];
    function add(label, value) { if (value) lines.push(label + value); }
    add('Юридический адрес: ', v.legal_address);
    if (v.postal_address && v.postal_address !== v.legal_address) lines.push('Почтовый адрес: ' + v.postal_address);
    add('Телефон: ', v.phone);
    add('E-mail: ', v.email);
    add('ИНН/КПП ', joinInnKpp(v.inn, v.kpp));
    add('ОГРН ', v.ogrn);
    add('Банк: ', v.bank);
    add('Расчетный счет: ', v.account);
    add('Корреспондентский счет: ', v.corr_account);
    add('БИК банка ', v.bik);
    return lines;
  }

  // ---------------------------------------------------------------------------
  // Генерация .docx через docxtemplater
  // ---------------------------------------------------------------------------
  function loadTemplate(url) {
    return new Promise(function (resolve, reject) {
      PizZipUtils.getBinaryContent(url, function (err, content) {
        if (err) reject(new Error('не удалось загрузить шаблон «' + url +
          '». Проверьте, что файл лежит в папке templates/ и сайт открыт через веб-сервер, а не двойным кликом.'));
        else resolve(content);
      });
    });
  }

  // Рендерит шаблон с данными -> объект docxtemplater (переиспользуется
  // и для предпросмотра HTML, и для скачивания .docx/PDF из одного рендера)
  function renderDoc() {
    var cfg = CONTRACTS[state.type];
    var collected = collectData();
    if (!validate(collected.v)) return Promise.reject(new Error('validation'));

    return loadTemplate(cfg.file).then(function (content) {
      var zip = new PizZip(content);
      var doc = new window.docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{', end: '}' }
      });
      doc.render(collected.tags);
      return { doc: doc, v: collected.v };
    });
  }

  function docToBlob(doc) {
    return doc.getZip().generate({
      type: 'blob',
      // без DEFLATE файл сохраняется без сжатия и весит впятеро больше шаблона
      compression: 'DEFLATE',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  }

  function makeFileName(v, ext) {
    var num = v.doc_number ? '_' + v.doc_number : '';
    var client = (v.name_short || v.name_full || 'клиент')
      .replace(/[«»"']/g, '').replace(/[^\wа-яёА-ЯЁ\-]+/g, '_').slice(0, 40);
    var type = { teo: 'ТЭО', mixed: 'Смешанный', to: 'Поручение' }[state.type];
    return 'Договор_' + type + num + '_' + client + '.' + ext;
  }

  function validate(v) {
    var problems = [];
    if (!v.name_full) problems.push('полное наименование клиента');
    if (!v.signatory_fio) problems.push('ФИО подписанта');
    if (problems.length) {
      confirmError('Не хватает обязательных полей: ' + problems.join(', ') + '. Заполните и отметьте проверку снова.');
      uncheckConfirm();
      if (!v.name_full) $('name_full').focus();
      else $('signatory_fio').focus();
      return false;
    }
    confirmError('');
    return true;
  }

  function genStatus(msg, kind) {
    var el = $('genStatus');
    if (!el) return;
    el.className = 'preview__status' + (kind ? ' is-' + kind : '');
    el.textContent = msg || '';
  }

  function confirmError(msg) {
    var el = $('confirmError');
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  // ---------------------------------------------------------------------------
  // Кнопки действий
  // ---------------------------------------------------------------------------
  function initActions() {
    // --- Галочка подтверждения → показать/скрыть предпросмотр ---
    $('confirmCheck').addEventListener('change', function () {
      if (this.checked) showPreview();
      else hidePreview();
    });

    // --- Любое изменение данных сбрасывает подтверждение ---
    var watched = FIELD_IDS.concat(['doc_number', 'doc_date']);
    watched.forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', onDataChanged);
    });
    $('signatory_basis').addEventListener('change', onDataChanged);
    ['poa_number', 'poa_date'].forEach(function (id) {
      $(id).addEventListener('input', onDataChanged);
    });
    // смена типа договора тоже сбрасывает
    document.getElementById('contractType').addEventListener('click', onDataChanged);

    // --- Скачивание (доступно только при открытом предпросмотре) ---
    $('btnDocx').addEventListener('click', function () {
      if (!lastRender) return;
      genStatus('Сохраняю .docx…');
      try {
        var blob = docToBlob(lastRender.doc);
        window.saveAs(blob, makeFileName(lastRender.v, 'docx'));
        genStatus('Файл .docx сохранён', 'ok');
      } catch (err) { genStatus('Ошибка: ' + describeError(err), 'err'); }
    });

    $('btnPdf').addEventListener('click', function () {
      if (!lastRender) return;
      genStatus('Готовлю PDF…');
      try {
        printAsPdf(window.DocxView.toHtml(lastRender.doc.getZip()),
          makeFileName(lastRender.v, 'pdf'));
        genStatus('Окно печати PDF открыто', 'ok');
      } catch (err) {
        genStatus('Ошибка PDF: ' + describeError(err), 'err');
      }
    });

    $('btnClear').addEventListener('click', function () {
      FIELD_IDS.forEach(function (id) {
        $(id).value = (id === 'signatory_role') ? 'Генеральный директор' : '';
        $(id).classList.remove('is-autofilled');
      });
      $('doc_number').value = '';
      $('poa_number').value = '';
      $('poa_date').value = '';
      setDefaultDate();
      basisTouched = false;
      suggestBasis();
      updateDeclension();
      $('parseStatus').hidden = true;
      uncheckConfirm();
      hidePreview();
      confirmError('');
      $('cardFile').value = '';
    });
  }

  // Правка данных после подтверждения → снимаем галочку, прячем предпросмотр
  function onDataChanged() {
    if ($('confirmCheck').checked) {
      uncheckConfirm();
      hidePreview();
    }
  }

  function uncheckConfirm() {
    $('confirmCheck').checked = false;
  }

  function hidePreview() {
    $('previewSection').hidden = true;
    lastRender = null;
    genStatus('');
  }

  // Строим предпросмотр: рендерим договор и показываем как HTML
  function showPreview() {
    confirmError('');
    var section = $('previewSection');
    var paper = $('previewPaper');
    section.hidden = false;
    paper.innerHTML = '<div class="preview__loading">Формирую предпросмотр…</div>';
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });

    renderDoc().then(function (rendered) {
      lastRender = rendered;
      $('previewSub').textContent = 'Договор: ' + CONTRACTS[state.type].title +
        (rendered.v.doc_number ? ' · № ' + rendered.v.doc_number : '') + '. Проверьте и скачайте.';
      // Готовый документ уже распакован в памяти — читаем его напрямую,
      // без повторной сборки в blob и обратной распаковки.
      paper.innerHTML = window.DocxView.toHtml(rendered.doc.getZip());
    }).catch(function (err) {
      if (err.message === 'validation') {
        $('previewSection').hidden = true;
      } else {
        paper.innerHTML = '<div class="preview__loading">Не удалось построить предпросмотр: ' +
          describeError(err) + '</div>';
      }
    });
  }

  function describeError(err) {
    if (err && err.properties && err.properties.errors) {
      return 'проблема в шаблоне (' + err.properties.errors.length + ' тегов). Обратитесь к администратору.';
    }
    return (err && err.message) || 'неизвестная ошибка';
  }

  // ---------------------------------------------------------------------------
  // PDF: конвертация .docx -> PDF на клиенте.
  // Надёжного чистого JS-конвертера docx->pdf в браузере нет, поэтому используем
  // печать через окно предпросмотра: открываем HTML-представление и вызываем печать
  // в PDF. Для точного соответствия рекомендуем .docx + «Сохранить как PDF» в Word.
  // ---------------------------------------------------------------------------
  function printAsPdf(html, pdfName) {
    var win = window.open('', '_blank');
    if (!win) throw new Error('браузер заблокировал окно печати — разрешите всплывающие окна');
    win.document.write(
      '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>' + pdfName + '</title>' +
      '<style>@page{size:A4;margin:18mm 16mm}body{font-family:"Times New Roman",serif;font-size:12pt;line-height:1.35;color:#000}' +
      'table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:4px 6px;vertical-align:top}' +
      'p{margin:.3em 0}.docx-tab{display:inline-block;width:2em}.docx-split{display:flex;justify-content:space-between;gap:1em}</style></head><body>' + html +
      '<script>window.onload=function(){window.print();}<\/script></body></html>'
    );
    win.document.close();
  }
})();
