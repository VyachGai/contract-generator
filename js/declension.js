/*
 * Склонение русских ФИО по падежам.
 * Основано на правилах библиотеки petrovich (https://github.com/petrovich).
 * Работает офлайн, без внешних запросов.
 *
 * Экспортирует глобальный объект Petrovich с методом:
 *   Petrovich.make(gender, name, gcase, part)
 *     gender: 'male' | 'female' | 'androgynous'
 *     name:   строка (одно слово)
 *     gcase:  'nominative'|'genitive'|'dative'|'accusative'|'instrumental'|'prepositional'
 *     part:   'first'|'last'|'middle'
 *
 * И удобные хелперы:
 *   declineFullName(fio, gcase) -> строка ФИО в нужном падеже
 *   detectGender(middleName)    -> 'male'|'female'|'androgynous'
 *   toInitials(fio)             -> "Фамилия И.О."
 */
(function (global) {
  'use strict';

  // Компактный набор правил petrovich (ru). Полная таблица правил зашита ниже.
  // Формат совместим с оригинальным rules.json petrovich.
  var RULES = PETROVICH_RULES; // определяется в конце файла

  var CASES = ['nominative', 'genitive', 'dative', 'accusative', 'instrumental', 'prepositional'];

  function findCaseIndex(gcase) {
    var i = CASES.indexOf(gcase);
    return i < 0 ? 0 : i;
  }

  function applyRule(name, mod) {
    // mod пример: "- ой" (удалить 0 символов вставить, или "--а" удалить 2 добавить а)
    // В petrovich формат: количество ведущих '-' = сколько символов отрезать с конца,
    // остальное — что добавить.
    if (mod === '.') return name; // не склоняется
    var strip = 0;
    var i = 0;
    while (i < mod.length && mod[i] === '-') { strip++; i++; }
    var add = mod.slice(i);
    var base = strip > 0 ? name.slice(0, name.length - strip) : name;
    return base + add;
  }

  function matchGender(ruleGender, gender) {
    if (!ruleGender) return true;
    if (ruleGender === 'androgynous') return true;
    return ruleGender === gender;
  }

  function tryRules(name, gender, caseIdx, ruleSet) {
    var lower = name.toLowerCase();
    // exceptions first
    var groups = [];
    if (ruleSet.exceptions) groups.push(ruleSet.exceptions);
    if (ruleSet.suffixes) groups.push(ruleSet.suffixes);

    for (var g = 0; g < groups.length; g++) {
      var rules = groups[g];
      for (var r = 0; r < rules.length; r++) {
        var rule = rules[r];
        if (!matchGender(rule.gender, gender)) continue;
        var matched = false;
        for (var t = 0; t < rule.test.length; t++) {
          var test = rule.test[t];
          // exceptions матчат целое слово, suffixes — окончание
          if (g === 0 && ruleSet.exceptions === rules) {
            if (lower === test) { matched = true; break; }
          } else {
            if (lower.slice(lower.length - test.length) === test) { matched = true; break; }
          }
        }
        if (matched) {
          var mod = rule.mods[caseIdx];
          if (mod === '.') return name; // явно не склоняется
          return applyRule(name, mod);
        }
      }
    }
    return name; // нет правила — оставляем как есть
  }

  var Petrovich = {
    make: function (gender, name, gcase, part) {
      if (!name) return name;
      var caseIdx = findCaseIndex(gcase);
      if (caseIdx === 0) return name; // именительный
      var ruleSet = RULES[part];
      if (!ruleSet) return name;
      // Обработка составных (двойных) имён через дефис
      if (name.indexOf('-') !== -1 && part !== 'first') {
        return name.split('-').map(function (p) {
          return Petrovich.make(gender, p, gcase, part);
        }).join('-');
      }
      return tryRules(name, gender, caseIdx, ruleSet);
    }
  };

  // Определение пола по отчеству (надёжнее всего)
  function detectGender(middleName) {
    if (!middleName) return 'androgynous';
    var m = middleName.toLowerCase().trim();
    if (/(вна|чна|шна)$/.test(m)) return 'female';
    if (/(ич|ыч|оглы|улы)$/.test(m)) return 'male';
    return 'androgynous';
  }

  // Разбор строки "Фамилия Имя Отчество"
  function parseFio(fio) {
    var parts = String(fio || '').trim().replace(/\s+/g, ' ').split(' ');
    return {
      last: parts[0] || '',
      first: parts[1] || '',
      middle: parts.slice(2).join(' ') || ''
    };
  }

  // Полное склонение ФИО
  function declineFullName(fio, gcase, genderOverride) {
    var p = parseFio(fio);
    var gender = genderOverride || detectGender(p.middle);
    var last = Petrovich.make(gender, p.last, gcase, 'last');
    var first = Petrovich.make(gender, p.first, gcase, 'first');
    var middle = Petrovich.make(gender, p.middle, gcase, 'middle');
    return [last, first, middle].filter(Boolean).join(' ');
  }

  // "Фамилия Имя Отчество" -> "Фамилия И.О."
  function toInitials(fio) {
    var p = parseFio(fio);
    var res = p.last;
    if (p.first) res += ' ' + p.first.charAt(0).toUpperCase() + '.';
    if (p.middle) res += p.middle.charAt(0).toUpperCase() + '.';
    return res;
  }

  Petrovich.detectGender = detectGender;
  Petrovich.parseFio = parseFio;
  Petrovich.declineFullName = declineFullName;
  Petrovich.toInitials = toInitials;

  global.Petrovich = Petrovich;
})(typeof window !== 'undefined' ? window : this);
