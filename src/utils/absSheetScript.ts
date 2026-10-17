/**
 * Текст скрипта Google Apps Script, который Owner вставляет в свою
 * Google-таблицу (Расширения → Apps Script). Скрипт сам присылает выбранные
 * листы в ABS → «Таблица» (SQL `abs_sheet_push`, 20261051_abs_sheet.sql):
 *
 *  - при любой правке таблицы (триггер «при изменении» — в том числе правки
 *    других листов, от которых пересчитываются формулы отчёта) и раз в 5 минут
 *    (формулы с IMPORTRANGE/NOW, правки, не пойманные триггером);
 *  - только если лист изменился (отпечаток MD5 в свойствах скрипта), а раз в
 *    30 минут — «на связи», чтобы Nova видела, что скрипт жив;
 *  - после передачи «звонит» в тему ABS (`nova:{ws}~{соль}:abssheet`) — открытые
 *    вкладки дочитывают таблицу сразу; не дозвонился — их опрос раз в 20 с.
 *
 * Цвета: если в скрипте подключён сервис «Google Sheets API» (Сервисы → +),
 * читаются ИТОГОВЫЕ цвета — с условным форматированием (зелёные/жёлтые/красные
 * строки рейтинга обычно ставит именно оно). Без сервиса — цвета, заданные
 * руками, через SpreadsheetApp.
 *
 * Какие листы присылать, решает Owner в Nova (`pick` приходит в ответе на
 * передачу); пока не выбрал — листы со словом «OUTPUT», иначе первый видимый.
 *
 * Тело скрипта — без обратных кавычек, `${` и обратных слешей: оно лежит в
 * шаблонной строке. Логика проверяется в Node на подставных SpreadsheetApp,
 * Sheets и UrlFetchApp (см. описание в CLAUDE.md).
 */

export interface AbsSheetScriptConfig {
  url: string;
  key: string;
  workspace: string;
  token: string;
  /** Тема звонка (солёная, если соль известна). */
  topic: string;
}

export function buildAbsSheetScript(cfg: AbsSheetScriptConfig): string {
  const config = JSON.stringify(
    { url: cfg.url, key: cfg.key, workspace: cfg.workspace, token: cfg.token, topic: cfg.topic },
    null,
    2
  );
  return `/**
 * Nova CRM → ABS «Таблица».
 * Передаёт выбранные листы этой таблицы в Nova при каждой правке и раз в 5 минут.
 *
 * Установка (один раз):
 *   1. Вставьте этот код целиком вместо того, что было в редакторе, и сохраните.
 *   2. Слева «Сервисы» (+) → «Google Sheets API» → «Добавить» — тогда в Nova
 *      придут и цвета условного форматирования.
 *   3. Вверху выберите функцию novaSetup и нажмите «Выполнить», разрешите доступ.
 *
 * Ключ ниже — секрет вашей компании в Nova: не пересылайте этот код.
 * Новый ключ выдаётся в Nova (ABS → Таблица → Подключение), старый тогда перестаёт работать.
 */
var NOVA = ${config};
var NOVA_MAX_ROWS = 200;
var NOVA_MAX_COLS = 30;
var NOVA_MAX_TABS = 8;
var NOVA_MAX_BYTES = 700000;
var NOVA_PING_MS = 30 * 60 * 1000;

/** Подключить: триггеры + первая передача. Запускать вручную один раз. */
function novaSetup() {
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'novaOnChange' || fn === 'novaTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('novaOnChange').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('novaTick').timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().deleteProperty('novaHash');
  var result = novaPush_(true, true);
  Logger.log('Nova: подключено — ' + result);
  try {
    ss.toast('Таблица подключена к Nova: ' + result, 'Nova', 8);
  } catch (e) {}
  return result;
}

/** Передать сейчас (для проверки). */
function novaPushNow() {
  var result = novaPush_(true, true);
  Logger.log('Nova: ' + result);
  return result;
}

/** Отключить: убрать триггеры этого скрипта. */
function novaStop() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'novaOnChange' || fn === 'novaTick') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Nova: передача остановлена');
}

function novaOnChange(e) {
  novaPush_(false, !e || e.changeType !== 'EDIT');
}

function novaTick() {
  novaPush_(false, false);
}

function novaPush_(force, freshLayout) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'занято — передам в следующий раз';
  try {
    var props = PropertiesService.getScriptProperties();
    var result = 'без изменений';
    for (var round = 0; round < 2; round++) {
      var pick = novaJson_(props.getProperty('novaPick'), []);
      var payload = novaCollect_(pick, freshLayout);
      var body = JSON.stringify(payload);
      while (novaBytes_(body) > NOVA_MAX_BYTES && payload.tabs.length > 1) {
        payload.tabs.pop();
        body = JSON.stringify(payload);
      }
      if (novaBytes_(body) > NOVA_MAX_BYTES) throw new Error('Nova: лист слишком большой — уменьшите его или выберите другой лист в Nova');
      var hash = novaDigest_(body);
      var lastAt = Number(props.getProperty('novaAt') || 0);
      if (!force && props.getProperty('novaHash') === hash && Date.now() - lastAt < NOVA_PING_MS) return result;
      var out = novaCall_('abs_sheet_push', { p_workspace: NOVA.workspace, p_token: NOVA.token, p_payload: payload });
      props.setProperty('novaHash', hash);
      props.setProperty('novaAt', String(Date.now()));
      if (out.changed) {
        novaRing_();
        result = 'передано листов: ' + payload.tabs.length;
      }
      var nextPick = Array.isArray(out.pick) ? out.pick : [];
      if (JSON.stringify(nextPick) === JSON.stringify(pick)) break;
      // В Nova выбрали другие листы — передать их сразу.
      props.setProperty('novaPick', JSON.stringify(nextPick));
      force = true;
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}

function novaCollect_(pick, freshLayout) {
  var ss = SpreadsheetApp.getActive();
  var sheets = ss.getSheets();
  var chosen = novaChoose_(sheets, pick);
  var tabs = null;
  if (typeof Sheets !== 'undefined' && chosen.length > 0) {
    try {
      tabs = novaReadApi_(ss, chosen);
    } catch (e) {
      Logger.log('Nova: Google Sheets API не ответил, беру цвета без условного форматирования — ' + e);
      tabs = null;
    }
  }
  if (!tabs) {
    tabs = chosen.map(function (sh) {
      return novaReadPlain_(sh, freshLayout);
    });
  }
  return {
    v: 1,
    id: ss.getId(),
    title: ss.getName(),
    sheets: sheets.slice(0, 60).map(function (sh) {
      return sh.getName();
    }),
    tabs: tabs
  };
}

function novaChoose_(sheets, pick) {
  var chosen = [];
  if (pick && pick.length) {
    pick.forEach(function (name) {
      var found = sheets.filter(function (sh) {
        return sh.getName() === name;
      })[0];
      if (found) chosen.push(found);
    });
  }
  var visible = sheets.filter(function (sh) {
    return !sh.isSheetHidden();
  });
  if (!chosen.length) {
    chosen = visible.filter(function (sh) {
      return /output/i.test(sh.getName());
    });
  }
  if (!chosen.length && visible.length) chosen = [visible[0]];
  return chosen.slice(0, NOVA_MAX_TABS);
}

function novaSize_(sh) {
  return [Math.max(1, Math.min(sh.getLastRow(), NOVA_MAX_ROWS)), Math.max(1, Math.min(sh.getLastColumn(), NOVA_MAX_COLS))];
}

function novaColName_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Лист через Google Sheets API: значения, итоговые цвета, объединения, ширины — одним запросом. */
function novaReadApi_(ss, chosen) {
  var sizes = chosen.map(novaSize_);
  var ranges = chosen.map(function (sh, i) {
    return "'" + sh.getName().replace(/'/g, "''") + "'!A1:" + novaColName_(sizes[i][1]) + sizes[i][0];
  });
  var res = Sheets.Spreadsheets.get(ss.getId(), {
    ranges: ranges,
    fields: 'sheets(properties(sheetId,title,gridProperties(frozenRowCount,frozenColumnCount)),merges,' +
      'data(rowMetadata(hiddenByUser,hiddenByFilter),columnMetadata(hiddenByUser,pixelSize),' +
      'rowData(values(formattedValue,effectiveValue,effectiveFormat(backgroundColor,horizontalAlignment,textFormat(bold,italic,foregroundColor))))))'
  });
  var byId = {};
  (res.sheets || []).forEach(function (s) {
    if (s.properties) byId[s.properties.sheetId] = s;
  });
  return chosen.map(function (sh, i) {
    var api = byId[sh.getSheetId()];
    if (!api) throw new Error('нет листа ' + sh.getName());
    var nRows = sizes[i][0];
    var nCols = sizes[i][1];
    var data = (api.data && api.data[0]) || {};
    var rowData = data.rowData || [];
    var grid = novaEmptyGrid_(nRows, nCols);
    for (var r = 0; r < nRows; r++) {
      var values = (rowData[r] && rowData[r].values) || [];
      for (var c = 0; c < nCols; c++) {
        var cell = values[c] || {};
        var fmt = cell.effectiveFormat || {};
        var text = fmt.textFormat || {};
        var value = cell.effectiveValue || {};
        grid.shown[r][c] = cell.formattedValue == null ? '' : String(cell.formattedValue);
        grid.bg[r][c] = fmt.backgroundColor ? novaRgb_(fmt.backgroundColor) : '#ffffff';
        grid.fg[r][c] = text.foregroundColor ? novaRgb_(text.foregroundColor) : '#000000';
        grid.bold[r][c] = text.bold === true;
        grid.italic[r][c] = text.italic === true;
        var a = String(fmt.horizontalAlignment || '').toLowerCase();
        var kind = value.numberValue !== undefined ? 'number' : value.boolValue !== undefined ? 'boolean' : 'text';
        grid.align[r][c] = novaAlign_(a, kind);
      }
    }
    (api.merges || []).forEach(function (m) {
      var r0 = m.startRowIndex || 0;
      var c0 = m.startColumnIndex || 0;
      if (r0 >= nRows || c0 >= nCols) return;
      grid.merges.push([r0, c0, Math.min(m.endRowIndex, nRows) - r0, Math.min(m.endColumnIndex, nCols) - c0]);
    });
    var colMeta = data.columnMetadata || [];
    for (var j = 0; j < nCols; j++) {
      var cm = colMeta[j] || {};
      grid.widths.push(cm.pixelSize || 100);
      if (cm.hiddenByUser) grid.hiddenCols.push(j);
    }
    var rowMeta = data.rowMetadata || [];
    for (var k = 0; k < nRows; k++) {
      var rm = rowMeta[k] || {};
      if (rm.hiddenByUser || rm.hiddenByFilter) grid.hiddenRows.push(k);
    }
    var gp = (api.properties && api.properties.gridProperties) || {};
    return novaTab_(sh.getName(), sh.getSheetId(), gp.frozenRowCount || 0, gp.frozenColumnCount || 0, grid);
  });
}

/** Лист без Google Sheets API: цвета, заданные руками (условное форматирование не видно). */
function novaReadPlain_(sh, freshLayout) {
  var size = novaSize_(sh);
  var nRows = size[0];
  var nCols = size[1];
  var range = sh.getRange(1, 1, nRows, nCols);
  var raw = range.getValues();
  var weights = range.getFontWeights();
  var styles = range.getFontStyles();
  var aligns = range.getHorizontalAlignments();
  var fg;
  try {
    fg = range.getFontColors();
  } catch (e) {
    fg = null;
  }
  var grid = novaEmptyGrid_(nRows, nCols);
  grid.shown = range.getDisplayValues();
  grid.bg = range.getBackgrounds();
  for (var r = 0; r < nRows; r++) {
    for (var c = 0; c < nCols; c++) {
      grid.fg[r][c] = fg ? fg[r][c] : '#000000';
      grid.bold[r][c] = weights[r][c] === 'bold';
      grid.italic[r][c] = styles[r][c] === 'italic';
      var v = raw[r][c];
      var kind = typeof v === 'number' || v instanceof Date ? 'number' : typeof v === 'boolean' ? 'boolean' : 'text';
      grid.align[r][c] = novaAlign_(String(aligns[r][c] || '').toLowerCase(), kind);
    }
  }
  range.getMergedRanges().forEach(function (m) {
    var r0 = m.getRow() - 1;
    var c0 = m.getColumn() - 1;
    if (r0 < 0 || c0 < 0) return;
    grid.merges.push([r0, c0, Math.min(m.getNumRows(), nRows - r0), Math.min(m.getNumColumns(), nCols - c0)]);
  });
  var layout = novaLayout_(sh, nRows, nCols, freshLayout);
  grid.widths = layout.w;
  grid.hiddenCols = layout.hc;
  grid.hiddenRows = layout.hr;
  return novaTab_(sh.getName(), sh.getSheetId(), sh.getFrozenRows(), sh.getFrozenColumns(), grid);
}

/** Ширины и скрытое — поштучные вызовы, поэтому помним 10 минут (сбрасывает не-правка: вставка, формат, скрытие). */
function novaLayout_(sh, nRows, nCols, fresh) {
  var cache = CacheService.getScriptCache();
  var key = 'novaLayout:' + sh.getSheetId() + ':' + nRows + ':' + nCols;
  if (!fresh) {
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }
  var layout = { w: [], hc: [], hr: [] };
  for (var c = 1; c <= nCols; c++) {
    layout.w.push(sh.getColumnWidth(c));
    if (sh.isColumnHiddenByUser(c)) layout.hc.push(c - 1);
  }
  for (var r = 1; r <= nRows; r++) {
    if (sh.isRowHiddenByUser(r) || sh.isRowHiddenByFilter(r)) layout.hr.push(r - 1);
  }
  try {
    cache.put(key, JSON.stringify(layout), 600);
  } catch (e) {}
  return layout;
}

function novaEmptyGrid_(nRows, nCols) {
  function matrix(fill) {
    var out = [];
    for (var r = 0; r < nRows; r++) {
      var line = [];
      for (var c = 0; c < nCols; c++) line.push(fill);
      out.push(line);
    }
    return out;
  }
  return {
    shown: matrix(''),
    bg: matrix('#ffffff'),
    fg: matrix('#000000'),
    bold: matrix(false),
    italic: matrix(false),
    align: matrix('l'),
    merges: [],
    widths: [],
    hiddenCols: [],
    hiddenRows: []
  };
}

/** Сжатый лист: значения, номера стилей, таблица стилей; хвост пустых строк и столбцов отрезан. */
function novaTab_(name, gid, frozenRows, frozenCols, grid) {
  var nRows = grid.shown.length;
  var nCols = nRows ? grid.shown[0].length : 0;
  function blank(r, c) {
    return String(grid.shown[r][c] || '') === '' && novaHex_(grid.bg[r][c], '#ffffff') === '#ffffff';
  }
  while (nRows > 0) {
    var emptyRow = true;
    for (var c0 = 0; c0 < nCols && emptyRow; c0++) if (!blank(nRows - 1, c0)) emptyRow = false;
    if (!emptyRow) break;
    nRows--;
  }
  while (nCols > 0) {
    var emptyCol = true;
    for (var r0 = 0; r0 < nRows && emptyCol; r0++) if (!blank(r0, nCols - 1)) emptyCol = false;
    if (!emptyCol) break;
    nCols--;
  }
  var palette = [];
  var index = {};
  var rows = [];
  var styles = [];
  for (var r = 0; r < nRows; r++) {
    var line = [];
    var sline = [];
    for (var c = 0; c < nCols; c++) {
      var st = {};
      var b = novaHex_(grid.bg[r][c], '#ffffff');
      if (b !== '#ffffff') st.b = b;
      var f = novaHex_(grid.fg[r][c], '#000000');
      if (f !== '#000000') st.c = f;
      if (grid.bold[r][c]) st.w = 1;
      if (grid.italic[r][c]) st.i = 1;
      if (grid.align[r][c] && grid.align[r][c] !== 'l') st.a = grid.align[r][c];
      var key = JSON.stringify(st);
      var id = index[key];
      if (id === undefined) {
        id = palette.length;
        index[key] = id;
        palette.push(st);
      }
      line.push(String(grid.shown[r][c] == null ? '' : grid.shown[r][c]).slice(0, 500));
      sline.push(id);
    }
    rows.push(line);
    styles.push(sline);
  }
  return {
    name: name,
    gid: gid,
    fr: frozenRows,
    fc: frozenCols,
    rows: rows,
    s: styles,
    st: palette,
    m: grid.merges.filter(function (m) {
      return m[0] < nRows && m[1] < nCols && m[2] * m[3] > 1;
    }),
    w: grid.widths.slice(0, nCols),
    hc: grid.hiddenCols.filter(function (c) {
      return c < nCols;
    }),
    hr: grid.hiddenRows.filter(function (r) {
      return r < nRows;
    })
  };
}

function novaAlign_(a, kind) {
  if (a.indexOf('center') >= 0) return 'c';
  if (a.indexOf('right') >= 0) return 'r';
  if (a.indexOf('left') >= 0) return 'l';
  if (kind === 'number') return 'r';
  if (kind === 'boolean') return 'c';
  return 'l';
}

function novaRgb_(color) {
  function part(v) {
    var n = Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255).toString(16);
    return n.length < 2 ? '0' + n : n;
  }
  return '#' + part(color.red) + part(color.green) + part(color.blue);
}

function novaHex_(v, fallback) {
  var s = String(v || '').toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : fallback;
}

function novaBytes_(text) {
  return Utilities.newBlob(text).getBytes().length;
}

function novaDigest_(text) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8));
}

function novaJson_(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function novaCall_(fn, args) {
  var res = UrlFetchApp.fetch(NOVA.url + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: NOVA.key, Authorization: 'Bearer ' + NOVA.key },
    payload: JSON.stringify(args),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code >= 300) {
    var reason = text;
    try {
      reason = JSON.parse(text).message || text;
    } catch (e) {}
    if (/bad token/.test(reason)) {
      throw new Error('Nova: ключ этого скрипта отключён. Скопируйте новый скрипт в Nova (ABS → Таблица → Подключение).');
    }
    if (/read-only/.test(reason)) throw new Error('Nova: компания сейчас только на чтение — передача не принята.');
    throw new Error('Nova ответила ' + code + ': ' + String(reason).slice(0, 300));
  }
  return novaJson_(text, {}) || {};
}

/** Позвонить открытым вкладкам Nova: «таблица обновилась» (без данных). */
function novaRing_() {
  if (!NOVA.topic) return;
  try {
    UrlFetchApp.fetch(NOVA.url + '/realtime/v1/api/broadcast', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: NOVA.key, Authorization: 'Bearer ' + NOVA.key },
      payload: JSON.stringify({
        messages: [{ topic: NOVA.topic, event: 'ring', payload: { from: 'sheet', rid: 'sheet.' + Date.now() }, private: false }]
      }),
      muteHttpExceptions: true
    });
  } catch (e) {}
}
`;
}
