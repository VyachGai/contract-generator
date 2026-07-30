/*
 * Чтение .docx: текст для разбора карточки и HTML для предпросмотра договора.
 *
 * Раньше это делала библиотека mammoth, но в браузере она тратила на наши
 * шаблоны 26+ секунд (в Node — 100 мс), из-за чего предпросмотр выглядел
 * зависшим. Здесь тот же разбор через PizZip + штатный DOMParser занимает
 * около 70 мс: распаковка ~37 мс, разбор XML ~35 мс.
 *
 * Экспортирует window.DocxView:
 *   toHtml(zip)  -> HTML договора (абзацы, таблицы, жирный/курсив/подчёркнутый)
 *   toText(zip)  -> плоский текст, по одному абзацу и ячейке на строку
 *   fromBuffer(arrayBuffer) -> PizZip
 */
(function (global) {
  'use strict';

  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Прямой потомок с нужным именем (getElementsByTagName ищет на всю глубину,
  // а нам важно не залезть, например, в свойства вложенной таблицы)
  function child(node, name) {
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c.nodeType === 1 && c.namespaceURI === W && c.localName === name) return c;
    }
    return null;
  }

  function children(node) {
    var out = [];
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c.nodeType === 1 && c.namespaceURI === W) out.push(c);
    }
    return out;
  }

  function attr(node, name) {
    return node ? (node.getAttributeNS(W, name) || node.getAttribute('w:' + name)) : null;
  }

  // <w:b/> — включено, <w:b w:val="0"/> — выключено
  function isOn(node) {
    if (!node) return false;
    var v = attr(node, 'val');
    return !(v === '0' || v === 'false' || v === 'none');
  }

  function parseXml(xml) {
    var dom = new DOMParser().parseFromString(xml, 'application/xml');
    if (dom.getElementsByTagName('parsererror').length) {
      throw new Error('документ повреждён: не удалось разобрать XML');
    }
    return dom;
  }

  function body(zip) {
    var entry = zip.file('word/document.xml');
    if (!entry) throw new Error('это не документ Word: внутри нет word/document.xml');
    var dom = parseXml(entry.asText());
    var b = dom.getElementsByTagNameNS(W, 'body')[0];
    if (!b) throw new Error('в документе нет тела');
    return b;
  }

  // --- Прогон текста -------------------------------------------------------
  function runHtml(r) {
    var out = '';
    children(r).forEach(function (c) {
      if (c.localName === 't') out += esc(c.textContent);
      else if (c.localName === 'tab') out += '<span class="docx-tab"></span>';
      else if (c.localName === 'br') out += '<br>';
      else if (c.localName === 'noBreakHyphen') out += '-';
    });
    if (!out) return '';
    var pr = child(r, 'rPr');
    if (pr) {
      if (isOn(child(pr, 'u'))) out = '<u>' + out + '</u>';
      if (isOn(child(pr, 'i'))) out = '<em>' + out + '</em>';
      if (isOn(child(pr, 'b'))) out = '<strong>' + out + '</strong>';
    }
    return out;
  }

  function runText(r) {
    var out = '';
    children(r).forEach(function (c) {
      if (c.localName === 't') out += c.textContent;
      else if (c.localName === 'tab') out += ' ';
      else if (c.localName === 'br') out += '\n';
    });
    return out;
  }

  // Абзац: собственные прогоны плюс прогоны внутри гиперссылок
  function paraParts(p) {
    var parts = [];
    children(p).forEach(function (c) {
      if (c.localName === 'r') parts.push(c);
      else if (c.localName === 'hyperlink' || c.localName === 'smartTag' || c.localName === 'sdt') {
        var inner = c.getElementsByTagNameNS(W, 'r');
        for (var i = 0; i < inner.length; i++) parts.push(inner[i]);
      }
    });
    return parts;
  }

  var ALIGN = { center: 'center', right: 'right', both: 'justify', end: 'right' };
  var TAB = '<span class="docx-tab"></span>';

  // Правая табуляция у поля страницы: в Word так делают строки вида
  // «город Пермь ......... дата». В HTML это две половины, разведённые по краям.
  function hasRightTab(pr) {
    var tabs = pr && child(pr, 'tabs');
    if (!tabs) return false;
    return children(tabs).some(function (t) {
      return t.localName === 'tab' && attr(t, 'val') === 'right';
    });
  }

  function paraHtml(p) {
    var html = paraParts(p).map(runHtml).join('');
    var pr = child(p, 'pPr');
    var jc = pr && child(pr, 'jc');
    var align = jc && ALIGN[attr(jc, 'val')];
    var style = align ? ' style="text-align:' + align + '"' : '';
    if (!html.replace(/<[^>]*>/g, '').trim()) return '<p' + style + '><br></p>';
    var at = html.indexOf(TAB);
    if (hasRightTab(pr) && at !== -1) {
      return '<p class="docx-split"><span>' + html.slice(0, at) + '</span><span>' +
        html.slice(at + TAB.length).split(TAB).join('') + '</span></p>';
    }
    return '<p' + style + '>' + html + '</p>';
  }

  function paraText(p) {
    return paraParts(p).map(runText).join('');
  }

  // --- Таблицы -------------------------------------------------------------
  function tableHtml(tbl) {
    var rows = children(tbl).filter(function (c) { return c.localName === 'tr'; });
    return '<table>' + rows.map(function (tr) {
      var cells = children(tr).filter(function (c) { return c.localName === 'tc'; });
      return '<tr>' + cells.map(function (tc) {
        var pr = child(tc, 'tcPr');
        var span = pr && child(pr, 'gridSpan');
        var n = span ? parseInt(attr(span, 'val'), 10) : 1;
        return '<td' + (n > 1 ? ' colspan="' + n + '"' : '') + '>' + blockHtml(tc) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</table>';
  }

  function tableText(tbl) {
    var lines = [];
    children(tbl).forEach(function (tr) {
      if (tr.localName !== 'tr') return;
      children(tr).forEach(function (tc) {
        if (tc.localName === 'tc') lines.push(blockText(tc));
      });
    });
    return lines.join('\n');
  }

  // --- Обход блоков --------------------------------------------------------
  function blockHtml(node) {
    return children(node).map(function (c) {
      if (c.localName === 'p') return paraHtml(c);
      if (c.localName === 'tbl') return tableHtml(c);
      return '';
    }).join('');
  }

  function blockText(node) {
    var out = [];
    children(node).forEach(function (c) {
      if (c.localName === 'p') out.push(paraText(c));
      else if (c.localName === 'tbl') out.push(tableText(c));
    });
    return out.join('\n');
  }

  global.DocxView = {
    fromBuffer: function (arrayBuffer) { return new global.PizZip(arrayBuffer); },
    toHtml: function (zip) { return blockHtml(body(zip)); },
    toText: function (zip) {
      return blockText(body(zip))
        .split('\n').map(function (l) { return l.trim(); })
        .filter(function (l) { return l; }).join('\n');
    }
  };
})(typeof window !== 'undefined' ? window : this);
