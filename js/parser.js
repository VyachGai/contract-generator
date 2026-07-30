/*
 * Парсер карточки партнёра / реквизитов.
 * Извлекает поля из ПЛОСКОГО ТЕКСТА карточки (любой из форматов компании).
 * Работает по «якорям» (ИНН, КПП, ОГРН, р/с, БИК и т.д.), а не по позиции,
 * поэтому переносит то, что нашёл; остальное оператор дозаполняет вручную.
 *
 * Экспортирует window.CardParser.parse(text) -> { поля }
 */
(function (global) {
  'use strict';

  // Нормализация: убираем лишние пробелы/переносы, но сохраняем строки
  function normalize(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ');
  }

  // Финальная чистка значения поля от артефактов таблиц и оформления
  function clean(val) {
    if (!val) return '';
    return String(val)
      .replace(/\s*\|\s*/g, ' ')
      .replace(/["']{2,}/g, '"')
      .replace(/\s{2,}/g, ' ')
      .replace(/[\s,;]+$/g, '')
      .replace(/^[\s,:;\-–—]+/g, '')
      .trim();
  }

  // Достаём значение после якоря. anchors — массив вариантов метки.
  // stop — где обрезать (по умолчанию до конца строки).
  function grab(text, anchors, opts) {
    opts = opts || {};
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      // якорь + необязательное двоеточие/тире + значение
      var re = new RegExp(a + '\\s*[:\\-–—]?\\s*([^\\n]+)', 'i');
      var m = text.match(re);
      if (m && m[1]) {
        var val = m[1].trim();
        // отрезаем хвост, если встретили следующую метку в той же строке
        if (opts.stopWords) {
          for (var s = 0; s < opts.stopWords.length; s++) {
            var idx = val.search(new RegExp('\\s*' + opts.stopWords[s], 'i'));
            if (idx > 0) val = val.slice(0, idx).trim();
          }
        }
        // чистим оформление
        val = val.replace(/[|«»"']+$/g, '').replace(/^[|«»"']+/g, '').trim();
        if (val && !/^_+$/.test(val)) return val;
      }
    }
    return '';
  }

  // Ищем число по шаблону (например, счёт из 20 цифр) в тексте рядом с якорем
  function grabDigits(text, anchors, len) {
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var re = new RegExp(a + '[^0-9]*([0-9]{' + len + '})', 'i');
      var m = text.match(re);
      if (m) return m[1];
    }
    return '';
  }

  function parse(rawText) {
    var t = normalize(rawText);
    var out = {};

    // --- Наименование организации ---
    // Стратегия: ищем ОПФ + кавычки где угодно в тексте — это самый надёжный якорь.
    var OPF = {
      'ООО': 'Общество с ограниченной ответственностью',
      'АО': 'Акционерное общество',
      'ПАО': 'Публичное акционерное общество',
      'ЗАО': 'Закрытое акционерное общество',
      'НАО': 'Непубличное акционерное общество'
    };
    var quoted = t.match(/(Общество с ограниченной ответственностью|Публичное акционерное общество|Закрытое акционерное общество|Непубличное акционерное общество|Акционерное общество)\s*«([^»]+)»/i);
    var abbr = t.match(/(?:^|[^А-ЯЁа-яё])(ООО|ПАО|ЗАО|НАО|АО)\s*«([^»]+)»/);
    var ipM = t.match(/Индивидуальный предприниматель\s+([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/i);

    var brand = '';
    if (quoted) { out.name_full = clean(quoted[0]); brand = quoted[2]; }
    else if (abbr) {
      brand = abbr[2];
      var pfx = OPF[abbr[1].toUpperCase()] || abbr[1];
      out.name_full = pfx + ' «' + brand + '»';
    } else if (ipM) {
      out.name_full = 'Индивидуальный предприниматель ' + ipM[1];
    } else {
      // ОПФ и бренд на разных строках (капсом): найдём ОПФ, затем ближайшие кавычки
      var opfPos = t.search(/(Общество с ограниченной ответственностью|Публичное акционерное общество|Закрытое акционерное общество|Акционерное общество)/i);
      if (opfPos >= 0) {
        var opfM2 = t.slice(opfPos).match(/(Общество с ограниченной ответственностью|Публичное акционерное общество|Закрытое акционерное общество|Акционерное общество)/i);
        var after = t.slice(opfPos, opfPos + 200);
        var qm = after.match(/«([^»]+)»/);
        if (qm) {
          brand = qm[1];
          out.name_full = clean(opfM2[1] + ' «' + brand + '»');
        } else {
          out.name_full = clean(opfM2[1]);
        }
      } else {
        out.name_full = '';
      }
    }
    // Сокращённое: аббревиатура ОПФ + бренд
    if (abbr) out.name_short = clean(abbr[0]);
    else if (brand) {
      var map = { 'общество с ограниченной ответственностью': 'ООО', 'акционерное общество': 'АО', 'публичное акционерное общество': 'ПАО', 'закрытое акционерное общество': 'ЗАО', 'непубличное акционерное общество': 'НАО' };
      var mkey = (out.name_full || '').toLowerCase();
      var ab = '';
      for (var kk in map) { if (mkey.indexOf(kk) === 0) { ab = map[kk]; break; } }
      out.name_short = (ab ? ab + ' ' : '') + '«' + brand + '»';
    } else out.name_short = out.name_full;

    // --- ИНН / КПП / ОГРН / ОКПО ---
    out.inn = grabDigits(t, ['ИНН'], 10) || grabDigits(t, ['ИНН'], 12);
    out.kpp = grabDigits(t, ['КПП'], 9);
    out.ogrn = grabDigits(t, ['ОГРНИП'], 15) || grabDigits(t, ['ОГРН'], 13) || grabDigits(t, ['ОГРН'], 15);

    // --- Адреса ---
    out.legal_address = clean(grab(t, ['Юридический адрес', 'Юр\\.?\\s*адрес', 'Адрес места нахождения', 'местонахождение юридического лица', 'Место\\s*нахождения', 'Местонахождение', 'Адрес'], { stopWords: ['Почтовый', 'Фактический', 'ИНН', 'Телефон', 'Р/с', 'р/с', 'р/сч', 'Расчет', 'руководитель'] }));
    // если адрес зацепил префикс — уберём его
    out.legal_address = out.legal_address.replace(/^(юридического лица|места нахождения)\s*[:\-]?\s*/i, '');
    out.postal_address = clean(grab(t, ['Почтовый адрес', 'Почт\\.?\\s*адрес'], { stopWords: ['ИНН', 'Телефон', 'отправлять', 'Р/с'] }));
    out.actual_address = clean(grab(t, ['Фактический адрес', 'Факт\\.?\\s*адрес'], { stopWords: ['ИНН', 'Телефон'] }));
    if (!out.postal_address) out.postal_address = out.actual_address || out.legal_address;

    // --- Контакты ---
    var phone = grab(t, ['Телефон/Факс', 'Телефон/факс', 'Телефон', 'Тел\\.?\\s*/\\s*факс', 'Тел\\.?'], { stopWords: ['E-mail', 'Эл', 'Электрон', 'Сайт', 'Факс'] });
    // телефон: должен быть телефоноподобным (наличие скобок/плюса/дефисов или формат кода)
    out.phone = '';
    if (phone) {
      var pm = phone.match(/(\+?\d[\d\s()\-]{4,}\d)/);
      if (pm && /[()\-+]/.test(pm[1])) out.phone = clean(pm[1]);
      else if (pm && pm[1].replace(/\D/g, '').length >= 10) out.phone = clean(pm[1]);
    }
    var emailM = t.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
    out.email = emailM ? emailM[0] : '';

    // --- Банковские реквизиты ---
    // Расчётный счёт 20 цифр
    out.account = grabDigits(t, ['Расчетный счет', 'Расчётный счёт', 'Р/с', 'Р/сч', 'р/сч', 'р/с', 'Осн.*расч'], 20);
    if (!out.account) {
      // первый 20-значный, начинающийся на 407/408 (расчётные счета)
      var acc = t.match(/\b(40[78]\d{17})\b/);
      out.account = acc ? acc[1] : '';
    }
    // Корр. счёт 20 цифр, начинается на 301
    out.corr_account = grabDigits(t, ['Корреспондентский счет', 'Корр\\.?\\s*сч', 'Кор\\.?\\s*сч', 'К/с', 'к/сч', 'к/с'], 20);
    if (!out.corr_account) {
      var corr = t.match(/\b(301\d{17})\b/);
      out.corr_account = corr ? corr[1] : '';
    }
    // БИК 9 цифр
    out.bik = grabDigits(t, ['БИК'], 9);
    // Банк — строка с ключевыми словами банка (самый надёжный способ для сплошного текста)
    out.bank = '';
    var blines = t.split('\n');
    var bestBank = '';
    var BANK_RE = /(БАНК|Банк|банк|филиал|Филиал|ВТБ|Открытие|Сбербанк|Альфа|Райффайзен|ЛАНТА|ТОЧКА|Тинькофф|Т-Банк|ФК Открытие)/;
    for (var bi = 0; bi < blines.length; bi++) {
      var bl = blines[bi];
      if (!BANK_RE.test(bl)) continue;
      // должна быть форма собственности или кавычки
      if (!/(АО|ПАО|ООО|\(АО\)|\(ПАО\)|«[^»]+»|"[^"]+")/.test(bl)) continue;
      var cand = bl
        .replace(/\|/g, ' ')
        .replace(/(БИК|Кор\.?\s*сч|Корреспондентский|К\/с|к\/с|Расчетный счет|р\/с|р\/сч|к\/сч)[\s\S]*$/i, '')
        .replace(/^\s*(Банк|Полное наименование банка|Наименование банка)\s*[:\-]?\s*/i, '');
      cand = clean(cand);
      // отрежем ведущий мусор до первой значимой части (буква ОПФ/Ф/кавычка)
      cand = cand.replace(/^[^А-ЯA-Zа-я"«(]+/, '');
      if (cand.length > bestBank.length && cand.length < 140) bestBank = cand;
    }
    out.bank = bestBank;

    // --- Руководитель ---
    var ruk = grab(t, [
      'Генеральный директор', 'Директор', 'Руководитель', 'Президент',
      'в лице', 'действующего'
    ], { stopWords: ['действующ', 'на основании', ','] });
    // Часто указано "Директор – Иванов Иван Иванович"
    // Достаём ФИО (три слова с заглавных букв)
    var fioM = (ruk + ' ' + t).match(/([А-ЯЁ][а-яё\-]+)\s+([А-ЯЁ][а-яё\-]+)\s+([А-ЯЁ][а-яё\-]+(?:вич|вна|ыч|чна|шна|оглы|улы))/);
    if (fioM) {
      out.signatory_fio = (fioM[1] + ' ' + fioM[2] + ' ' + fioM[3]).trim();
    } else {
      out.signatory_fio = '';
    }
    // Должность подписанта
    var roleM = t.match(/(Генеральный директор|Директор|Президент|Руководитель|Управляющий|Индивидуальный предприниматель)/i);
    out.signatory_role = roleM ? roleM[1] : 'Директор';
    // Основание
    out.basis = /устав/i.test(t) ? 'Устава' : (/довер/i.test(t) ? 'Доверенности' : 'Устава');

    return out;
  }

  global.CardParser = { parse: parse, normalize: normalize };
})(typeof window !== 'undefined' ? window : this);
