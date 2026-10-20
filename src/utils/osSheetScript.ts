/**
 * Текст скрипта Google Apps Script для «Таблицы ОС» (реестр продаж ОС). Owner
 * вставляет его в Google-таблицу (Расширения → Apps Script). В отличие от ABS
 * (`absSheetScript.ts`, только показ) связь двусторонняя — SQL
 * `20261053_os_sheet.sql`:
 *
 *  - таблица → Nova: выбранные листы (значения как на экране, стили, ширины,
 *    объединения, скрытое, типы столбцов, варианты выпадающих списков, ячейки
 *    с формулами) уходят в `os_sheet_push` — при любой правке таблицы (триггер
 *    «при изменении») и раз в 10 минут, только если отпечаток листов сменился
 *    (раз в 30 минут — «на связи»);
 *  - Nova → таблица: раз в минуту (и сразу, если Nova будит веб-приложение
 *    скрипта) — `os_sheet_pull`: правки ОС из Nova вписываются в ячейки, отчёт
 *    по каждой (`p_done`) уходит со следующей передачей. Пустая минута — один
 *    короткий запрос (квота триггеров обычного аккаунта — 90 минут в сутки).
 *
 * Правка ложится в строку, только если строка узнаётся по ключу (первые
 * видимые столбцы без формул с непустой шапкой — «Имя», «Дата», «Телефон»):
 * лист пересортировали — правка находит строку по ключу; не нашлась или таких
 * строк две — «moved», в таблицу ничего не пишется. Формулы (и результаты
 * формул-массивов) не трогаются, текст пишется с апострофом, чтобы Sheets не
 * превратил «+7 777» в число, а «=IMPORTRANGE(…)» — в формулу. Новая строка —
 * после последней строки с данными, формулы и проверки данных — как в строке
 * выше; если данные — «Таблица» Google Sheets, она продолжается через Sheets API.
 *
 * Тело скрипта — String.raw: обратные слеши (регулярные выражения) остаются
 * как есть, но обратных кавычек и `${` внутри быть не должно. Логика
 * проверяется в Node на подставных SpreadsheetApp, Sheets, UrlFetchApp и т. д.
 * против настоящих функций SQL (см. описание в CLAUDE.md).
 */

export interface OsSheetScriptConfig {
  url: string;
  key: string;
  workspace: string;
  token: string;
  /** Тема звонка (солёная, если соль известна). */
  topic: string;
}

export function buildOsSheetScript(cfg: OsSheetScriptConfig): string {
  const config = JSON.stringify(
    { url: cfg.url, key: cfg.key, workspace: cfg.workspace, token: cfg.token, topic: cfg.topic },
    null,
    2
  );
  return String.raw`/**
 * Nova CRM ⇄ «Таблица ОС».
 * Передаёт выбранные листы этой таблицы в Nova и вписывает в них правки, сделанные в Nova.
 *
 * Установка (один раз):
 *   1. Вставьте этот код целиком вместо того, что было в редакторе, и сохраните.
 *   2. Слева «Сервисы» (+) → «Google Sheets API» → «Добавить» — тогда в Nova придут и цвета
 *      условного форматирования, а новые строки из Nova будут продолжать «Таблицу»
 *      (Формат → Преобразовать в таблицу), если данные оформлены ею.
 *   3. Вверху выберите функцию novaSetup и нажмите «Выполнить», разрешите доступ.
 *   4. Чтобы правки из Nova ложились за секунды, а не за минуту:
 *      Развернуть → Новое развертывание → тип «Веб-приложение» → Запуск от имени: «Я»,
 *      Доступ: «Все» → Развернуть → скопируйте адрес (оканчивается на /exec) и вставьте его
 *      в Nova (Таблица ОС → Подключение).
 *      Заменили код — Развернуть → Управление развертываниями → изменить → версия «Новая версия».
 *
 * Ключ ниже — секрет вашей компании в Nova: не пересылайте этот код.
 * Новый ключ выдаётся в Nova (Таблица ОС → Подключение), старый тогда перестаёт работать.
 * Копия таблицы на новый месяц: в копии снова запустите novaSetup — подключение перейдёт
 * к ней, а здесь передача остановится сама.
 */
var NOVA = ${config};
var NOVA_MAX_ROWS = 3000;
var NOVA_MAX_COLS = 40;
var NOVA_MAX_TABS = 4;
var NOVA_MAX_BYTES = 3500000;
var NOVA_PING_MS = 30 * 60 * 1000;
var NOVA_FULL_MS = 10 * 60 * 1000;
var NOVA_APPLY_MS = 100 * 1000;
var NOVA_KIND_ROWS = 300;
var NOVA_TRIGGERS = ['novaOnChange', 'novaTick'];

/** Подключить: триггеры + первая передача. Запускать вручную один раз (и в каждой новой копии таблицы). */
function novaSetup() {
  var ss = SpreadsheetApp.getActive();
  novaDropTriggers_();
  ScriptApp.newTrigger('novaOnChange').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('novaTick').timeBased().everyMinutes(1).create();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('novaSs', ss.getId());
  ['novaHash', 'novaAt', 'novaFull', 'novaDirty'].forEach(function (k) {
    props.deleteProperty(k);
  });
  var result = novaSay_(novaRun_('setup', null));
  Logger.log('Nova: подключено — ' + result);
  try {
    ss.toast('Таблица подключена к Nova: ' + result, 'Nova', 8);
  } catch (e) {}
  return result;
}

/** Передать сейчас и вписать ждущие правки из Nova (для проверки). */
function novaPushNow() {
  var result = novaSay_(novaRun_('now', null));
  Logger.log('Nova: ' + result);
  return result;
}

/** Отключить: убрать триггеры этого скрипта. */
function novaStop() {
  novaDropTriggers_();
  Logger.log('Nova: передача остановлена');
}

/** Любая правка таблицы: передать листы, если они изменились (только передача — дёшево). */
function novaOnChange(e) {
  novaRun_('change', e || null);
}

/** Раз в минуту: забрать правки из Nova (один короткий запрос), раз в 10 минут — сверить листы. */
function novaTick() {
  novaRun_('tick', null);
}

/** Веб-приложение: Nova будит скрипт сразу после правки (тело запроса не читается). */
function doPost(e) {
  return novaHook_();
}

function doGet(e) {
  return novaHook_();
}

function novaHook_() {
  var out;
  try {
    var res = novaRun_('hook', null);
    out = {
      ok: true,
      busy: !!res.busy,
      applied: res.applied || 0,
      failed: res.failed || 0,
      pushed: !!res.pushed,
      changed: !!res.changed
    };
  } catch (err) {
    out = { ok: false, error: novaErr_(err).slice(0, 300) };
  }
  try {
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput('{"ok":false}');
  }
}

function novaDropTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (NOVA_TRIGGERS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

/** Все входы — под одним замком скрипта; занято — тихо выйти (догонит следующий запуск). */
function novaRun_(mode, e) {
  var props = PropertiesService.getScriptProperties();
  var fresh = mode === 'setup' || mode === 'now' || (mode === 'change' && (!e || e.changeType !== 'EDIT'));
  var lock = LockService.getScriptLock();
  var wait = mode === 'setup' || mode === 'now' ? 60000 : mode === 'hook' ? 20000 : 5000;
  if (!lock.tryLock(wait)) {
    // Правку таблицы, которую не успели передать, передаст ближайший тик.
    if (mode === 'change') novaMarkDirty_(props, fresh);
    if (mode === 'setup') throw new Error('Nova: скрипт сейчас занят передачей — запустите novaSetup ещё раз через минуту.');
    return { busy: true };
  }
  try {
    var dirty = novaJson_(props.getProperty('novaDirty'), null);
    if (dirty && dirty.fresh) fresh = true;
    if (mode === 'setup') return novaPush_(props, { force: true, fresh: true, claim: true, done: novaDoneLoad_(props) });
    if (mode === 'change') return novaPush_(props, { force: false, fresh: fresh, done: novaDoneLoad_(props) });
    return novaSync_(props, { force: mode === 'now', fresh: fresh, dirty: !!dirty });
  } finally {
    lock.releaseLock();
  }
}

function novaSay_(res) {
  if (res.busy) return 'занято — передам в следующий раз';
  var parts = [];
  if (res.applied || res.failed) {
    parts.push('правок из Nova вписано: ' + (res.applied || 0) + (res.failed ? ', не вписано: ' + res.failed : ''));
  }
  parts.push(res.pushed ? 'передано листов: ' + res.tabs : 'без изменений');
  return parts.join('; ');
}

function novaSs_(props) {
  var ss = null;
  try {
    ss = SpreadsheetApp.getActive();
  } catch (e) {
    ss = null;
  }
  if (ss) return ss;
  var id = props.getProperty('novaSs');
  if (!id) throw new Error('Nova: сначала запустите novaSetup в самой таблице.');
  return SpreadsheetApp.openById(id);
}

/** Очередь правок из Nova → таблица → передача с отчётом. Пусто и рано сверять листы — один запрос. */
function novaSync_(props, opts) {
  var ss = novaSs_(props);
  var res = { pushed: false, changed: false, acked: 0, applied: 0, failed: 0, tabs: 0 };
  var started = Date.now();
  for (var round = 0; round < 3; round++) {
    var out = novaCall_('os_sheet_pull', { p_workspace: NOVA.workspace, p_token: NOVA.token, p_source: ss.getId() });
    var edits = (Array.isArray(out.edits) ? out.edits : []).filter(function (x) {
      return x && typeof x.id === 'number' && isFinite(x.id);
    });
    edits.sort(function (a, b) {
      return a.id - b.id;
    });
    var pick = Array.isArray(out.pick) ? out.pick : [];
    var pickChanged = JSON.stringify(pick) !== JSON.stringify(novaJson_(props.getProperty('novaPick'), []));
    // В Nova выбрали другие листы — передать их сразу.
    if (pickChanged) props.setProperty('novaPick', JSON.stringify(pick));
    var pending = {};
    edits.forEach(function (x) {
      pending[x.id] = true;
    });
    // Уже вписанные, но не подтверждённые (передача тогда не дошла) — не вписывать второй раз.
    var stored = novaDoneLoad_(props).filter(function (d) {
      return pending[d.id];
    });
    var seen = {};
    stored.forEach(function (d) {
      seen[d.id] = true;
    });
    var todo = edits.filter(function (x) {
      return !seen[x.id];
    });
    var applied = todo.length ? novaApply_(ss, props, todo, stored, started + NOVA_APPLY_MS) : [];
    var done = stored.concat(applied);
    novaDoneSave_(props, done);
    applied.forEach(function (d) {
      if (d.ok) res.applied++;
      else res.failed++;
    });
    var due = Date.now() - Number(props.getProperty('novaFull') || 0) >= NOVA_FULL_MS;
    if (!done.length && !pickChanged && !opts.dirty && !due && !opts.force) return res;
    if (applied.length) SpreadsheetApp.flush();
    var pushed = novaPush_(props, { force: opts.force || pickChanged || done.length > 0, fresh: opts.fresh, done: done, ss: ss });
    res.pushed = res.pushed || pushed.pushed;
    res.changed = res.changed || pushed.changed;
    res.acked += pushed.acked;
    if (pushed.pushed) res.tabs = pushed.tabs;
    opts = { force: false, fresh: false, dirty: false };
    // Пока вписывали, в Nova поправили ещё — забрать сразу, а не через минуту.
    if (!(pushed.pending > 0) || !applied.length || Date.now() - started > NOVA_APPLY_MS) break;
  }
  return res;
}

function novaPush_(props, opts) {
  var ss = opts.ss || novaSs_(props);
  var res = { pushed: false, changed: false, acked: 0, tabs: 0, pending: 0 };
  var force = !!opts.force;
  var claim = !!opts.claim;
  var fresh = !!opts.fresh;
  var done = opts.done || [];
  var started = Date.now();
  for (var round = 0; round < 2; round++) {
    var pick = novaJson_(props.getProperty('novaPick'), []);
    var payload = novaCollect_(ss, pick, fresh);
    var body = novaFit_(payload);
    props.setProperty('novaFull', String(Date.now()));
    var hash = novaDigest_(body);
    var lastAt = Number(props.getProperty('novaAt') || 0);
    if (!force && !claim && !done.length && props.getProperty('novaHash') === hash && Date.now() - lastAt < NOVA_PING_MS) break;
    var out = novaCall_('os_sheet_push', {
      p_workspace: NOVA.workspace,
      p_token: NOVA.token,
      p_source: ss.getId(),
      p_payload: payload,
      p_done: novaDoneWire_(done),
      p_claim: claim
    });
    props.setProperty('novaHash', hash);
    props.setProperty('novaAt', String(Date.now()));
    if (done.length) props.deleteProperty('novaDone');
    done = [];
    claim = false;
    fresh = false;
    res.pushed = true;
    res.tabs = payload.tabs.length;
    if (out.changed) res.changed = true;
    res.acked += Number(out.acked) || 0;
    res.pending = Number(out.pending) || 0;
    var nextPick = Array.isArray(out.pick) ? out.pick : [];
    if (JSON.stringify(nextPick) === JSON.stringify(pick)) break;
    // В Nova выбрали другие листы — передать их сразу.
    props.setProperty('novaPick', JSON.stringify(nextPick));
    force = true;
  }
  novaClearDirty_(props, started);
  if (res.changed || res.acked) novaRing_();
  return res;
}

function novaMarkDirty_(props, fresh) {
  var prev = novaJson_(props.getProperty('novaDirty'), null) || {};
  props.setProperty('novaDirty', JSON.stringify({ at: Date.now(), fresh: !!(fresh || prev.fresh) }));
}

function novaClearDirty_(props, started) {
  var d = novaJson_(props.getProperty('novaDirty'), null);
  if (d && Number(d.at) <= started) props.deleteProperty('novaDirty');
}

/** Отчёт по правкам хранится до подтверждения: [id, ok, причина, строка] — коротко (свойство ≤ 9 КБ). */
function novaDoneSave_(props, done) {
  if (!done.length) {
    props.deleteProperty('novaDone');
    return;
  }
  var cut = 80;
  var text = '';
  while (true) {
    text = JSON.stringify(done.map(function (d) {
      return [d.id, d.ok ? 1 : 0, String(d.reason || '').slice(0, cut), typeof d.row === 'number' ? d.row : -1];
    }));
    if (text.length <= 8500 || cut === 0) break;
    cut = cut > 20 ? 20 : 0;
  }
  props.setProperty('novaDone', text);
}

function novaDoneLoad_(props) {
  var list = novaJson_(props.getProperty('novaDone'), []);
  if (!Array.isArray(list)) return [];
  return list.filter(function (x) {
    return Array.isArray(x) && typeof x[0] === 'number';
  }).map(function (x) {
    var d = { id: x[0], ok: x[1] === 1 };
    if (x[2]) d.reason = String(x[2]);
    if (typeof x[3] === 'number' && x[3] >= 0) d.row = x[3];
    return d;
  });
}

function novaDoneWire_(done) {
  return done.map(function (d) {
    var o = { id: d.id, ok: !!d.ok };
    if (d.reason) o.reason = String(d.reason).slice(0, 200);
    if (typeof d.row === 'number') o.row = d.row;
    return o;
  });
}

// ---------------------------------------------------------------------------
// Таблица → Nova.

function novaCollect_(ss, pick, fresh) {
  var sheets = ss.getSheets();
  var chosen = novaChoose_(sheets, pick);
  var grids = null;
  if (typeof Sheets !== 'undefined' && chosen.length > 0) {
    try {
      grids = novaReadApi_(ss, chosen);
    } catch (e) {
      Logger.log('Nova: Google Sheets API не ответил, беру цвета без условного форматирования — ' + e);
      grids = null;
    }
  }
  if (!grids) {
    grids = chosen.map(function (sh) {
      return novaReadPlain_(sh, fresh);
    });
  }
  return {
    v: 1,
    id: ss.getId(),
    title: ss.getName(),
    sheets: sheets.slice(0, 60).map(function (sh) {
      return sh.getName();
    }),
    tabs: chosen.map(function (sh, i) {
      return novaTab_(sh, grids[i], fresh);
    })
  };
}

function novaChoose_(sheets, pick) {
  var chosen = [];
  var names = {};
  (pick || []).forEach(function (name) {
    if (names[name]) return;
    var found = sheets.filter(function (sh) {
      return sh.getName() === name;
    })[0];
    if (found) {
      names[name] = true;
      chosen.push(found);
    }
  });
  if (!chosen.length) {
    var visible = sheets.filter(function (sh) {
      return !sh.isSheetHidden();
    });
    if (visible.length) chosen = [visible[0]];
  }
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

/** Листы через Google Sheets API: значения, формулы, итоговые цвета, объединения, ширины — одним запросом. */
function novaReadApi_(ss, chosen) {
  var sizes = chosen.map(novaSize_);
  var ranges = chosen.map(function (sh, i) {
    return "'" + sh.getName().replace(/'/g, "''") + "'!A1:" + novaColName_(sizes[i][1]) + sizes[i][0];
  });
  var res = Sheets.Spreadsheets.get(ss.getId(), {
    ranges: ranges,
    fields: 'sheets(properties(sheetId,title,gridProperties(frozenRowCount,frozenColumnCount)),merges,' +
      'data(rowMetadata(hiddenByUser,hiddenByFilter),columnMetadata(hiddenByUser,pixelSize),' +
      'rowData(values(formattedValue,effectiveValue,userEnteredValue(formulaValue),' +
      'effectiveFormat(backgroundColor,horizontalAlignment,numberFormat(type),textFormat(bold,italic,foregroundColor))))))'
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
        var entered = cell.userEnteredValue || {};
        var type = String((fmt.numberFormat && fmt.numberFormat.type) || '');
        var kind = '';
        if (value.numberValue !== undefined) kind = /DATE|TIME/.test(type) ? 'd' : 'n';
        else if (value.boolValue !== undefined) kind = value.boolValue ? 'b1' : 'b0';
        else if (value.errorValue !== undefined || (value.stringValue !== undefined && value.stringValue !== '')) kind = 't';
        grid.shown[r][c] = cell.formattedValue == null ? '' : String(cell.formattedValue);
        grid.kind[r][c] = kind;
        grid.fx[r][c] = entered.formulaValue ? String(entered.formulaValue) : '';
        grid.bg[r][c] = fmt.backgroundColor ? novaRgb_(fmt.backgroundColor) : '#ffffff';
        grid.fg[r][c] = text.foregroundColor ? novaRgb_(text.foregroundColor) : '#000000';
        grid.bold[r][c] = text.bold === true;
        grid.italic[r][c] = text.italic === true;
        grid.align[r][c] = novaAlign_(String(fmt.horizontalAlignment || '').toLowerCase(), kind);
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
    grid.fr = gp.frozenRowCount || 0;
    grid.fc = gp.frozenColumnCount || 0;
    return grid;
  });
}

/** Лист без Google Sheets API: цвета, заданные руками (условное форматирование не видно). */
function novaReadPlain_(sh, fresh) {
  var size = novaSize_(sh);
  var nRows = size[0];
  var nCols = size[1];
  var range = sh.getRange(1, 1, nRows, nCols);
  var raw = range.getValues();
  var formulas = range.getFormulas();
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
      var kind = novaKindOf_(raw[r][c]);
      grid.kind[r][c] = kind;
      grid.fx[r][c] = formulas[r][c] ? String(formulas[r][c]) : '';
      grid.fg[r][c] = fg ? fg[r][c] : '#000000';
      grid.bold[r][c] = weights[r][c] === 'bold';
      grid.italic[r][c] = styles[r][c] === 'italic';
      grid.align[r][c] = novaAlign_(String(aligns[r][c] || '').toLowerCase(), kind);
    }
  }
  range.getMergedRanges().forEach(function (m) {
    var r0 = m.getRow() - 1;
    var c0 = m.getColumn() - 1;
    if (r0 < 0 || c0 < 0) return;
    grid.merges.push([r0, c0, Math.min(m.getNumRows(), nRows - r0), Math.min(m.getNumColumns(), nCols - c0)]);
  });
  var layout = novaLayout_(sh, nRows, nCols, fresh);
  grid.widths = layout.w.slice(0, nCols);
  grid.hiddenCols = layout.hc;
  grid.hiddenRows = layout.hr;
  grid.fr = sh.getFrozenRows();
  grid.fc = sh.getFrozenColumns();
  return grid;
}

/**
 * Ширины и скрытое — поштучные вызовы, поэтому помним 10 минут (сбрасывает не-правка: вставка,
 * формат, скрытие). Строки, дописанные с тех пор, проверяются дополнительно.
 */
function novaLayout_(sh, nRows, nCols, fresh) {
  var cache = CacheService.getScriptCache();
  var key = 'novaLayout:' + sh.getSheetId() + ':' + nCols;
  var layout = fresh ? null : novaJson_(cache.get(key), null);
  if (!layout || !Array.isArray(layout.w) || layout.w.length !== nCols || !Array.isArray(layout.hr)) {
    layout = { w: [], hc: [], hr: [], n: 0 };
    for (var c = 1; c <= nCols; c++) {
      layout.w.push(sh.getColumnWidth(c));
      if (sh.isColumnHiddenByUser(c)) layout.hc.push(c - 1);
    }
  }
  if (!(layout.n >= nRows)) {
    for (var r = (layout.n || 0) + 1; r <= nRows; r++) {
      if (sh.isRowHiddenByUser(r) || sh.isRowHiddenByFilter(r)) layout.hr.push(r - 1);
    }
    layout.n = nRows;
    try {
      cache.put(key, JSON.stringify(layout), 600);
    } catch (e) {}
  }
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
    kind: matrix(''),
    fx: matrix(''),
    bg: matrix('#ffffff'),
    fg: matrix('#000000'),
    bold: matrix(false),
    italic: matrix(false),
    align: matrix('l'),
    merges: [],
    widths: [],
    hiddenCols: [],
    hiddenRows: [],
    fr: 0,
    fc: 0
  };
}

/** Тип значения ячейки: 'n' число, 'd' дата, 'b1'/'b0' флажок, 't' текст, '' пусто. */
function novaKindOf_(v) {
  if (typeof v === 'number') return 'n';
  if (Object.prototype.toString.call(v) === '[object Date]') return 'd';
  if (typeof v === 'boolean') return v ? 'b1' : 'b0';
  if (v === '' || v == null) return '';
  return 't';
}

/** Формула-массив, которая разливается вниз (ARRAYFORMULA, QUERY, FILTER, {…}): ячейки под ней писать нельзя. */
function novaSpills_(f) {
  var s = String(f || '');
  return /ARRAYFORMULA\s*\(/i.test(s) || /^=\s*\{[^}]*;/.test(s) ||
    /^=\s*(IFERROR\s*\(\s*)?(QUERY|FILTER|SORTN?|UNIQUE|IMPORTRANGE|FLATTEN|BYROW|MAP|SCAN|MAKEARRAY|SEQUENCE|VSTACK|TRANSPOSE|IMPORTDATA|IMPORTXML|IMPORTHTML)\s*\(/i.test(s);
}

/** Строка, с которой столбец заполняет формула-массив (верхняя формула столбца, под ней формул нет), или -1. */
function novaSpillOrigin_(formulas) {
  for (var r = 0; r < formulas.length; r++) {
    if (!formulas[r]) continue;
    return novaSpills_(formulas[r]) && !formulas[r + 1] ? r : -1;
  }
  return -1;
}

/** Сжатый лист для Nova: значения, ключи стилей, формулы, столбцы, ключ строки; хвост пустого отрезан. */
function novaTab_(sh, grid, fresh) {
  var nRows = grid.shown.length;
  var nCols = nRows ? grid.shown[0].length : 0;
  var fr = Number(grid.fr) || 0;
  var fc = Number(grid.fc) || 0;
  var hdr = fr > 0 ? fr : 1;
  var c;
  var r;
  // Результаты формул-массивов — тоже формулы: писать в них нельзя.
  for (c = 0; c < nCols; c++) {
    var column = [];
    for (r = 0; r < nRows; r++) column.push(grid.fx[r][c]);
    var origin = novaSpillOrigin_(column);
    if (origin < 0) continue;
    for (r = origin + 1; r < nRows; r++) if (!grid.fx[r][c]) grid.fx[r][c] = '=';
  }
  // Столбец-формула: ≥ 80 % заполненных ячеек данных — формулы.
  var colF = [];
  for (c = 0; c < nCols; c++) {
    var filled = 0;
    var fxCount = 0;
    for (r = hdr; r < nRows; r++) {
      if (grid.fx[r][c]) {
        fxCount++;
        filled++;
      } else if (grid.shown[r][c] !== '') {
        filled++;
      }
    }
    colF.push(filled > 0 && fxCount >= 0.8 * filled);
  }
  // Хвост строк без введённых данных (протянутые вниз формулы, пустые флажки, заливка) — отрезать.
  function typed(row, col) {
    if (grid.shown[row][col] === '' || grid.kind[row][col] === 'b0') return false;
    return !(grid.fx[row][col] && colF[col]);
  }
  while (nRows > hdr) {
    var emptyRow = true;
    for (c = 0; c < nCols && emptyRow; c++) if (typed(nRows - 1, c)) emptyRow = false;
    if (!emptyRow) break;
    nRows--;
  }
  while (nCols > 1) {
    var emptyCol = true;
    for (r = 0; r < nRows && emptyCol; r++) if (grid.shown[r][nCols - 1] !== '') emptyCol = false;
    if (!emptyCol) break;
    nCols--;
  }
  // Стили: ключ — отпечаток самого стиля, а не номер по порядку (иначе новый стиль сдвигал бы все строки).
  var canonOf = [];
  var styleOf = {};
  for (r = 0; r < nRows; r++) {
    var cline = [];
    for (c = 0; c < nCols; c++) {
      var st = {};
      var b = novaHex_(grid.bg[r][c], '#ffffff');
      if (b !== '#ffffff') st.b = b;
      var f = novaHex_(grid.fg[r][c], '#000000');
      if (f !== '#000000') st.c = f;
      if (grid.bold[r][c]) st.w = 1;
      if (grid.italic[r][c]) st.i = 1;
      if (grid.align[r][c] === 'c' || grid.align[r][c] === 'r') st.a = grid.align[r][c];
      var canon = [st.b || '', st.c || '', st.w || 0, st.i || 0, st.a || ''].join('|');
      if (canon === '||0|0|') canon = '';
      if (canon && !styleOf[canon]) styleOf[canon] = st;
      cline.push(canon);
    }
    canonOf.push(cline);
  }
  var keyOf = novaStyleKeys_(Object.keys(styleOf));
  var palette = {};
  Object.keys(styleOf).sort().forEach(function (canon) {
    palette[keyOf[canon]] = styleOf[canon];
  });
  var rows = [];
  var styles = [];
  var fx = [];
  for (r = 0; r < nRows; r++) {
    var line = [];
    var sline = [];
    var fline = [];
    for (c = 0; c < nCols; c++) {
      line.push(String(grid.shown[r][c] == null ? '' : grid.shown[r][c]).slice(0, 1000));
      sline.push(canonOf[r][c] ? keyOf[canonOf[r][c]] : '');
      if (grid.fx[r][c]) fline.push(c);
    }
    rows.push(line);
    styles.push(sline);
    fx.push(fline.length ? fline : null);
  }
  // Столбцы: проверка данных важнее типа значений.
  var rules = novaRules_(sh, hdr, nRows, nCols, fresh);
  var cols = [];
  for (c = 0; c < nCols; c++) {
    var col = {};
    var rule = rules[c];
    if (rule) {
      col.k = rule.k;
      if (rule.k === 'l') col.o = rule.o || [];
      if (rule.ai) col.ai = 1;
    } else {
      var counts = { t: 0, n: 0, d: 0, b: 0 };
      for (r = hdr; r < nRows; r++) {
        var kind = grid.kind[r][c];
        if (kind) counts[kind.charAt(0)]++;
      }
      col.k = novaPickKind_(counts);
    }
    if (colF[c]) col.f = 1;
    cols.push(col);
  }
  var hidden = {};
  grid.hiddenCols.forEach(function (x) {
    hidden[x] = true;
  });
  // Ключ строки: до 3 первых видимых столбцов без формул с непустой шапкой.
  var key = [];
  if (hdr - 1 < nRows) {
    for (c = 0; c < nCols && key.length < 3; c++) {
      if (hidden[c] || colF[c]) continue;
      if (String(rows[hdr - 1][c]).trim() !== '') key.push(c);
    }
  }
  return {
    name: sh.getName(),
    gid: sh.getSheetId(),
    fr: fr,
    fc: fc,
    hdr: hdr,
    w: grid.widths.slice(0, nCols),
    hc: grid.hiddenCols.filter(function (x) {
      return x < nCols;
    }),
    hr: grid.hiddenRows.filter(function (x) {
      return x < nRows;
    }),
    m: grid.merges.map(function (m) {
      return [m[0], m[1], Math.min(m[2], nRows - m[0]), Math.min(m[3], nCols - m[1])];
    }).filter(function (m) {
      return m[0] < nRows && m[1] < nCols && m[2] * m[3] > 1;
    }),
    cols: cols,
    key: key,
    st: palette,
    rows: rows,
    s: styles,
    fx: fx
  };
}

function novaPickKind_(counts) {
  var best = 't';
  ['n', 'd', 'b'].forEach(function (k) {
    if (counts[k] > counts[best]) best = k;
  });
  return best;
}

/** Ключи стилей: отпечаток FNV-1a в base36; совпали отпечатки разных стилей — суффикс по порядку. */
function novaStyleKeys_(canons) {
  var byHash = {};
  canons.forEach(function (canon) {
    var h = novaHash36_(canon);
    if (!Object.prototype.hasOwnProperty.call(byHash, h)) byHash[h] = [];
    byHash[h].push(canon);
  });
  var out = {};
  Object.keys(byHash).forEach(function (h) {
    byHash[h].sort().forEach(function (canon, i) {
      out[canon] = i === 0 ? h : h + '-' + i;
    });
  });
  return out;
}

function novaHash36_(text) {
  var h = 0x811c9dc5;
  for (var i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h.toString(36);
}

/**
 * Проверки данных по столбцам (последние ~300 строк данных): выпадающий список, флажок, дата, число.
 * Меняются редко — помним 10 минут (сбрасывает не-правка).
 */
function novaRules_(sh, hdr, nRows, nCols, fresh) {
  var cache = CacheService.getScriptCache();
  var key = 'novaRules:' + sh.getSheetId();
  if (!fresh) {
    var hit = novaJson_(cache.get(key), null);
    if (hit && Array.isArray(hit.r) && hit.c >= nCols) return hit.r.slice(0, nCols);
  }
  var rules = [];
  for (var c = 0; c < nCols; c++) rules.push(null);
  var last = Math.min(Math.max(nRows, hdr + 1), sh.getMaxRows());
  var first = Math.max(hdr, last - NOVA_KIND_ROWS);
  if (last > first && nCols > 0) {
    var dvs = sh.getRange(first + 1, 1, last - first, nCols).getDataValidations();
    var memo = {};
    for (var col = 0; col < nCols; col++) {
      var tally = {};
      var best = '';
      var bestN = 0;
      var none = 0;
      for (var r = 0; r < dvs.length; r++) {
        var dv = dvs[r][col];
        var sig = dv ? novaRuleSig_(dv) : '';
        if (!sig) {
          none++;
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(tally, sig)) tally[sig] = { n: 0, dv: dv };
        tally[sig].n++;
        if (tally[sig].n > bestN) {
          bestN = tally[sig].n;
          best = sig;
        }
      }
      if (best && bestN >= none) {
        if (!Object.prototype.hasOwnProperty.call(memo, best)) memo[best] = novaRuleKind_(tally[best].dv);
        rules[col] = memo[best];
      }
    }
  }
  try {
    cache.put(key, JSON.stringify({ c: nCols, r: rules }), 600);
  } catch (e) {}
  return rules;
}

function novaRuleType_(dv) {
  return String(dv.getCriteriaType());
}

function novaRuleSig_(dv) {
  var type = novaRuleType_(dv);
  var vals = dv.getCriteriaValues() || [];
  var ai = dv.getAllowInvalid() ? 1 : 0;
  if (type === 'VALUE_IN_LIST') return type + '|' + ai + '|' + JSON.stringify(vals[0] || []);
  if (type === 'VALUE_IN_RANGE') {
    var rg = vals[0];
    return type + '|' + ai + '|' + (rg && rg.getSheet ? rg.getSheet().getSheetId() + '!' + rg.getA1Notation() : '');
  }
  if (type === 'CHECKBOX') return type + '|' + JSON.stringify(vals.map(String));
  if (type.indexOf('DATE_') === 0) return 'DATE';
  if (type.indexOf('NUMBER_') === 0) return 'NUMBER';
  return '';
}

function novaRuleKind_(dv) {
  var type = novaRuleType_(dv);
  var vals = dv.getCriteriaValues() || [];
  if (type === 'VALUE_IN_LIST' || type === 'VALUE_IN_RANGE') {
    var seen = {};
    var out = [];
    novaOptionList_(type, vals).forEach(function (o) {
      var s = String(o).trim().slice(0, 100);
      if (!s || Object.prototype.hasOwnProperty.call(seen, s) || out.length >= 200) return;
      seen[s] = true;
      out.push(s);
    });
    var rule = { k: 'l', o: out };
    if (dv.getAllowInvalid()) rule.ai = 1;
    return rule;
  }
  if (type === 'CHECKBOX') return { k: 'b' };
  if (type.indexOf('DATE_') === 0) return { k: 'd' };
  if (type.indexOf('NUMBER_') === 0) return { k: 'n' };
  return null;
}

/** Варианты выпадающего списка как есть (для записи в ячейку — точный текст варианта). */
function novaOptionList_(type, vals) {
  var list = [];
  if (type === 'VALUE_IN_LIST') {
    list = Array.isArray(vals[0]) ? vals[0] : [];
  } else if (vals[0] && typeof vals[0].getDisplayValues === 'function') {
    var rg = vals[0];
    if (rg.getNumRows() * rg.getNumColumns() > 20000) {
      rg = rg.getSheet().getRange(rg.getRow(), rg.getColumn(), Math.max(1, Math.floor(20000 / rg.getNumColumns())), rg.getNumColumns());
    }
    rg.getDisplayValues().forEach(function (line) {
      list = list.concat(line);
    });
  }
  var out = [];
  var seen = {};
  for (var i = 0; i < list.length && out.length < 500; i++) {
    var s = list[i] == null ? '' : String(list[i]);
    if (!s.trim() || Object.prototype.hasOwnProperty.call(seen, s)) continue;
    seen[s] = true;
    out.push(s);
  }
  return out;
}

function novaAlign_(a, kind) {
  if (a.indexOf('center') >= 0) return 'c';
  if (a.indexOf('right') >= 0) return 'r';
  if (a.indexOf('left') >= 0) return 'l';
  if (kind === 'n' || kind === 'd') return 'r';
  if (kind === 'b0' || kind === 'b1') return 'c';
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

// ---------------------------------------------------------------------------
// Nova → таблица.

/** Правки из Nova по порядку; ошибка одной не останавливает остальные. */
function novaApply_(ss, props, edits, stored, deadline) {
  var ctx = { ss: ss, tz: ss.getSpreadsheetTimeZone(), tabs: {} };
  var out = [];
  for (var i = 0; i < edits.length; i++) {
    // Не успели — остальное в следующий запуск (правки ждут в очереди).
    if (Date.now() > deadline) break;
    var e = edits[i];
    var isAdd = Array.isArray(e.add);
    var res;
    try {
      res = isAdd ? novaAddRow_(ctx, e) : novaSetCell_(ctx, e);
    } catch (err) {
      res = { ok: false, reason: 'error: ' + novaErr_(err).slice(0, 80) };
    }
    res.id = e.id;
    out.push(res);
    // Новую строку запомнить сразу: повтор после сбоя добавил бы её второй раз.
    if (isAdd) novaDoneSave_(props, stored.concat(out));
  }
  return out;
}

function novaTabCtx_(ctx, name) {
  var id = '#' + name;
  if (!Object.prototype.hasOwnProperty.call(ctx.tabs, id)) {
    var sh = ctx.ss.getSheetByName(name);
    ctx.tabs[id] = sh ? { sh: sh, hdr: novaHdr_(sh), n: 0, cols: {}, spill: {}, kinds: {} } : null;
  }
  return ctx.tabs[id];
}

function novaHdr_(sh) {
  var fr = sh.getFrozenRows();
  return fr > 0 ? fr : 1;
}

function novaTabRows_(t) {
  if (!t.n) t.n = Math.max(1, t.sh.getLastRow());
  return t.n;
}

function novaIndex_(x, max) {
  return typeof x === 'number' && isFinite(x) && x % 1 === 0 && x >= 0 && x < max;
}

/** Сравнение ключа: без регистра, пробелов (в том числе неразрывных) и апострофов. */
function novaNorm_(x) {
  return String(x == null ? '' : x).toLowerCase().replace(/[\s\u00a0\u202f'\u2018\u2019\u02bc\u0060]/g, '');
}

function novaFold_(x) {
  return String(x == null ? '' : x).replace(/[\s\u00a0\u202f]+/g, ' ').trim().toLowerCase();
}

/** Значения столбца-ключа (как на экране, сжатые для сравнения) — один раз на пачку правок. */
function novaKeyCol_(t, col) {
  if (!Object.prototype.hasOwnProperty.call(t.cols, col)) {
    var n = novaTabRows_(t);
    t.cols[col] = t.sh.getRange(1, col + 1, n, 1).getDisplayValues().map(function (line) {
      return novaNorm_(line[0]);
    });
  }
  return t.cols[col];
}

function novaRowIs_(t, row, pairs) {
  for (var i = 0; i < pairs.length; i++) {
    var v = novaKeyCol_(t, pairs[i][0])[row];
    if ((v == null ? '' : v) !== pairs[i][1]) return false;
  }
  return true;
}

/**
 * Строка правки: на своём месте, если ключ совпал; иначе — единственная строка с этим ключом.
 * Не нашлась или их несколько — -1 («moved»). Шапка — никогда.
 */
function novaFindRow_(t, r, c, k) {
  var pairs = [];
  (Array.isArray(k) ? k : []).forEach(function (p) {
    if (Array.isArray(p) && p.length >= 2 && novaIndex_(p[0], NOVA_MAX_COLS)) pairs.push([p[0], novaNorm_(p[1])]);
  });
  var others = pairs.filter(function (p) {
    return p[0] !== c;
  });
  var filled = function (list) {
    return list.some(function (p) {
      return p[1] !== '';
    });
  };
  // Правимый столбец не сверяем (его могла поменять прошлая правка), если без него ключ не пуст.
  var check = filled(others) ? others : pairs;
  var n = novaTabRows_(t);
  if (r >= t.hdr && r < n && novaRowIs_(t, r, check)) return r;
  if (!filled(check)) return -1;
  var found = -1;
  for (var row = t.hdr; row < n; row++) {
    if (!novaRowIs_(t, row, check)) continue;
    if (found >= 0) return -1;
    found = row;
  }
  return found;
}

/** Строка, с которой столбец заполняет формула-массив, — один раз на пачку правок. */
function novaSpillAt_(t, c) {
  if (!Object.prototype.hasOwnProperty.call(t.spill, c)) {
    var n = novaTabRows_(t);
    t.spill[c] = novaSpillOrigin_(t.sh.getRange(1, c + 1, n, 1).getFormulas().map(function (line) {
      return line[0];
    }));
  }
  return t.spill[c];
}

function novaSetCell_(ctx, e) {
  var t = novaTabCtx_(ctx, String(e.tab));
  if (!t) return { ok: false, reason: 'no tab' };
  if (!novaIndex_(e.r, NOVA_MAX_ROWS * 10) || !novaIndex_(e.c, NOVA_MAX_COLS)) return { ok: false, reason: 'bad cell' };
  var c = e.c;
  var row = novaFindRow_(t, e.r, c, e.k);
  if (row < 0) return { ok: false, reason: 'moved' };
  var cell = t.sh.getRange(row + 1, c + 1);
  if (cell.getFormula()) return { ok: false, reason: 'formula' };
  var origin = novaSpillAt_(t, c);
  if (origin >= 0 && origin < row) return { ok: false, reason: 'formula' };
  var conv = novaConvert_(ctx, t, c, cell.getDataValidation(), cell.getValue(), e.v == null ? '' : String(e.v));
  if (!conv.ok) return conv;
  cell.setValue(conv.value);
  if (Object.prototype.hasOwnProperty.call(t.cols, c)) t.cols[c][row] = novaNorm_(cell.getDisplayValue());
  return { ok: true, row: row };
}

/** Тип ячейки: её проверка данных → её значение → тип столбца. */
function novaConvert_(ctx, t, c, rule, raw, v) {
  var spec = rule ? novaRuleSpec_(rule) : null;
  if (!spec) {
    var kind = novaKindOf_(raw);
    if (kind) spec = { k: kind.charAt(0) };
  }
  if (!spec) spec = novaColSpec_(t, c);
  return novaValue_(ctx, spec, v);
}

function novaRuleSpec_(dv) {
  var type = novaRuleType_(dv);
  var vals = dv.getCriteriaValues() || [];
  if (type === 'VALUE_IN_LIST' || type === 'VALUE_IN_RANGE') {
    return { k: 'l', o: novaOptionList_(type, vals), ai: dv.getAllowInvalid() ? 1 : 0 };
  }
  if (type === 'CHECKBOX') return { k: 'b', cb: vals.length ? [vals[0], vals.length > 1 ? vals[1] : ''] : null };
  if (type.indexOf('DATE_') === 0) return { k: 'd' };
  if (type.indexOf('NUMBER_') === 0) return { k: 'n' };
  return null;
}

function novaColSpec_(t, c) {
  if (Object.prototype.hasOwnProperty.call(t.kinds, c)) return t.kinds[c];
  var sh = t.sh;
  var n = novaTabRows_(t);
  var nCols = Math.max(c + 1, Math.min(sh.getLastColumn(), NOVA_MAX_COLS));
  var rule = novaRules_(sh, t.hdr, Math.min(n, NOVA_MAX_ROWS), nCols, false)[c];
  var spec;
  if (rule) {
    spec = { k: rule.k, o: rule.o || [], ai: rule.ai ? 1 : 0 };
  } else {
    var counts = { t: 0, n: 0, d: 0, b: 0 };
    if (n > t.hdr) {
      sh.getRange(t.hdr + 1, c + 1, n - t.hdr, 1).getValues().forEach(function (line) {
        var kind = novaKindOf_(line[0]);
        if (kind) counts[kind.charAt(0)]++;
      });
    }
    spec = { k: novaPickKind_(counts) };
  }
  t.kinds[c] = spec;
  return spec;
}

function novaValue_(ctx, spec, v) {
  var s = String(v);
  var plain = s.trim();
  var k = spec.k;
  if (plain === '') {
    if (k === 'b') return { ok: true, value: spec.cb ? spec.cb[1] : false };
    return { ok: true, value: '' };
  }
  if (k === 'l') {
    var wanted = novaFold_(plain);
    var opts = spec.o || [];
    for (var i = 0; i < opts.length; i++) {
      if (novaFold_(opts[i]) === wanted) return { ok: true, value: /^=/.test(String(opts[i])) ? "'" + opts[i] : opts[i] };
    }
    if (!spec.ai && opts.length) return { ok: false, reason: 'not in list' };
    return { ok: true, value: novaText_(s) };
  }
  if (k === 'b') {
    var w = novaFold_(plain);
    if (spec.cb) {
      if (w === novaFold_(spec.cb[0])) return { ok: true, value: spec.cb[0] };
      if (w === novaFold_(spec.cb[1])) return { ok: true, value: spec.cb[1] };
    }
    if (/^(true|да|1|истина|yes|✓)$/.test(w)) return { ok: true, value: spec.cb ? spec.cb[0] : true };
    if (/^(false|нет|0|ложь|no)$/.test(w)) return { ok: true, value: spec.cb ? spec.cb[1] : false };
    return { ok: false, reason: 'bad value' };
  }
  if (k === 'n') {
    var num = novaNumber_(plain);
    return num === null ? { ok: false, reason: 'bad number' } : { ok: true, value: num };
  }
  if (k === 'd') {
    var date = novaDate_(plain, ctx.tz);
    return date === null ? { ok: false, reason: 'bad date' } : { ok: true, value: date };
  }
  return { ok: true, value: novaText_(s) };
}

/** Текст из Nova пишется как текст: ни формулой, ни числом, ни датой его Sheets не сделает. */
function novaText_(s) {
  if (/^[=+\-@#']/.test(s) || /[0-9]/.test(s) || /^(true|false|истина|ложь)$/i.test(s.trim())) return "'" + s;
  return s;
}

function novaNumber_(s) {
  var t = String(s).replace(/[\s\u00a0\u202f'\u2019₸$€₽]/g, '').replace(/,/g, '.');
  var pct = /%$/.test(t);
  if (pct) t = t.slice(0, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  var n = Number(t);
  if (!isFinite(n)) return null;
  return pct ? n / 100 : n;
}

function novaPad_(n) {
  return n < 10 ? '0' + n : String(n);
}

/** «01.10.2026», «1.10.26», «01/10/2026», «2026-10-01» (и с «чч:мм») → дата в часовом поясе таблицы. */
function novaDate_(s, tz) {
  var m;
  var d;
  var mo;
  var y;
  var hh = -1;
  var mi = 0;
  if ((m = /^(\d{1,2})([./])(\d{1,2})\2(\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s))) {
    d = Number(m[1]);
    mo = Number(m[3]);
    y = Number(m[4]);
    if (m[4].length === 2) y += 2000;
    if (m[5] != null) {
      hh = Number(m[5]);
      mi = Number(m[6]);
    }
  } else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s))) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
    if (m[4] != null) {
      hh = Number(m[4]);
      mi = Number(m[5]);
    }
  } else {
    return null;
  }
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate() || hh > 23 || mi > 59) {
    return null;
  }
  var text = novaPad_(d) + '.' + novaPad_(mo) + '.' + y;
  var pattern = 'dd.MM.yyyy';
  if (hh >= 0) {
    text += ' ' + novaPad_(hh) + ':' + novaPad_(mi);
    pattern += ' HH:mm';
  }
  return Utilities.parseDate(text, tz, pattern);
}

function novaRowState_(sh, row, width) {
  var rg = sh.getRange(row + 1, 1, 1, width);
  return { v: rg.getValues()[0], f: rg.getFormulas()[0], r1c1: rg.getFormulasR1C1()[0], dv: rg.getDataValidations()[0] };
}

/** Последняя строка с данными (вне формул) и столбцы под формулами-массивами — одним чтением. */
function novaScan_(t, width) {
  var sh = t.sh;
  var n = sh.getLastRow();
  var spill = [];
  for (var c = 0; c < width; c++) spill.push(-1);
  if (n < 1) return { last: t.hdr - 1, spill: spill };
  var rg = sh.getRange(1, 1, n, width);
  var vals = rg.getValues();
  var fs = rg.getFormulas();
  for (var c1 = 0; c1 < width; c1++) {
    spill[c1] = novaSpillOrigin_(fs.map(function (line) {
      return line[c1];
    }));
  }
  var last = t.hdr - 1;
  for (var r = n - 1; r >= t.hdr && last < t.hdr; r--) {
    for (var c2 = 0; c2 < width; c2++) {
      if (fs[r][c2] || (spill[c2] >= 0 && r > spill[c2])) continue;
      var v = vals[r][c2];
      if (v !== '' && v !== false && v != null) {
        last = r;
        break;
      }
    }
  }
  return { last: last, spill: spill };
}

/** Новая строка из Nova: сразу после последней строки с данными; сначала проверить всё, потом писать. */
function novaAddRow_(ctx, e) {
  var t = novaTabCtx_(ctx, String(e.tab));
  if (!t) return { ok: false, reason: 'no tab' };
  var sh = t.sh;
  var pairs = [];
  var used = {};
  for (var i = 0; i < e.add.length; i++) {
    var p = e.add[i];
    if (!Array.isArray(p) || p.length < 2 || !novaIndex_(p[0], NOVA_MAX_COLS) || used[p[0]]) return { ok: false, reason: 'bad value' };
    used[p[0]] = true;
    pairs.push([p[0], p[1] == null ? '' : String(p[1])]);
  }
  if (!pairs.length) return { ok: false, reason: 'bad value' };
  pairs.sort(function (a, b) {
    return a[0] - b[0];
  });
  var width = Math.max(pairs[pairs.length - 1][0] + 1, Math.min(sh.getLastColumn(), NOVA_MAX_COLS));
  var scan = novaScan_(t, width);
  var last = scan.last;
  var row = last + 1;
  var cur = row < sh.getMaxRows() ? novaRowState_(sh, row, width) : null;
  var tpl = last >= t.hdr ? novaRowState_(sh, last, width) : null;
  var writes = [];
  for (var j = 0; j < pairs.length; j++) {
    var c = pairs[j][0];
    if ((cur && cur.f[c]) || (scan.spill[c] >= 0 && scan.spill[c] < row)) return { ok: false, reason: 'formula' };
    var rule = (cur && cur.dv[c]) || (tpl && tpl.dv[c]) || null;
    var conv = novaConvert_(ctx, t, c, rule, cur ? cur.v[c] : '', pairs[j][1]);
    if (!conv.ok) return conv;
    writes.push([c, conv.value, pairs[j][1]]);
  }
  var placed = novaTableAppend_(ctx, t, last, writes);
  if (placed >= 0) {
    row = placed;
  } else if (row >= sh.getMaxRows()) {
    sh.insertRowAfter(last + 1);
  }
  // Формулы (в своём столбце, R1C1) и проверки данных — как в строке выше.
  if (tpl) {
    var now = novaRowState_(sh, row, width);
    var written = {};
    writes.forEach(function (w) {
      written[w[0]] = true;
    });
    for (var c2 = 0; c2 < width; c2++) {
      var cell = null;
      if (tpl.r1c1[c2] && !now.f[c2] && (now.v[c2] === '' || now.v[c2] == null) && !written[c2]) {
        cell = sh.getRange(row + 1, c2 + 1);
        cell.setFormulaR1C1(tpl.r1c1[c2]);
      }
      if (tpl.dv[c2] && !now.dv[c2]) (cell || sh.getRange(row + 1, c2 + 1)).setDataValidation(tpl.dv[c2]);
    }
  }
  writes.forEach(function (w) {
    sh.getRange(row + 1, w[0] + 1).setValue(w[1]);
  });
  t.n = 0;
  t.cols = {};
  t.spill = {};
  return { ok: true, row: row };
}

/**
 * Данные оформлены «Таблицей» Google Sheets и в ней нет свободной строки — продолжить её через
 * Sheets API (иначе строка легла бы под «Таблицей», вне её). Не вышло до записи — -1 (обычный путь).
 */
function novaTableAppend_(ctx, t, last, writes) {
  if (typeof Sheets === 'undefined' || !writes.length) return -1;
  var probe = writes.filter(function (w) {
    return String(w[2]).trim() !== '';
  })[0];
  if (!probe) return -1;
  var id = ctx.ss.getId();
  var gid = t.sh.getSheetId();
  var minC = writes[0][0];
  var maxC = writes[writes.length - 1][0];
  var table;
  try {
    SpreadsheetApp.flush();
    table = novaTableFind_(id, gid, function (tb) {
      var g = tb.range;
      return (g.startRowIndex || 0) <= t.hdr - 1 && g.endRowIndex >= last + 1 &&
        (g.startColumnIndex || 0) <= minC && g.endColumnIndex > maxC;
    });
  } catch (e) {
    return -1;
  }
  if (!table) return -1;
  var end = table.range.endRowIndex;
  // В «Таблице» есть свободная строка — запись в неё обычным путём «Таблицу» не ломает.
  if (end > last + 1) return -1;
  var values = [];
  for (var c = table.range.startColumnIndex || 0; c < probe[0]; c++) values.push({});
  values.push({ userEnteredValue: { stringValue: probe[2] } });
  try {
    Sheets.Spreadsheets.batchUpdate({
      requests: [{ appendCells: { tableId: table.tableId, rows: [{ values: values }], fields: 'userEnteredValue' } }]
    }, id);
  } catch (e) {
    Logger.log('Nova: «Таблицу» продолжить не удалось, строка ляжет обычным путём — ' + e);
    return -1;
  }
  var grown = null;
  try {
    grown = novaTableFind_(id, gid, function (tb) {
      return tb.tableId === table.tableId;
    });
  } catch (e) {
    grown = null;
  }
  var candidates = [];
  if (grown && grown.range && grown.range.endRowIndex > end) candidates.push(grown.range.endRowIndex - 1);
  if (candidates.indexOf(end) < 0) candidates.push(end);
  for (var i = 0; i < candidates.length; i++) {
    if (String(t.sh.getRange(candidates[i] + 1, probe[0] + 1).getValue()) === probe[2]) return candidates[i];
  }
  throw new Error('строка «Таблицы» не найдена после добавления');
}

function novaTableFind_(id, gid, pred) {
  var res = Sheets.Spreadsheets.get(id, { fields: 'sheets(properties.sheetId,tables(tableId,range))' });
  var sheet = (res.sheets || []).filter(function (s) {
    return s.properties && s.properties.sheetId === gid;
  })[0];
  var tables = (sheet && sheet.tables) || [];
  for (var i = 0; i < tables.length; i++) {
    if (tables[i] && tables[i].range && pred(tables[i])) return tables[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Общее.

/** Слишком много — сначала лишние листы, потом понятная ошибка. */
function novaFit_(payload) {
  var body = JSON.stringify(payload);
  while (novaWeight_(body) > NOVA_MAX_BYTES && payload.tabs.length > 1) {
    payload.tabs.pop();
    body = JSON.stringify(payload);
  }
  if (novaWeight_(body) > NOVA_MAX_BYTES) {
    throw new Error('Nova: лист слишком большой — уменьшите его или выберите другой лист в Nova (Таблица ОС → Подключение).');
  }
  return body;
}

/** Размер, как его считает база: jsonb в тексте ставит пробел после каждой запятой и двоеточия. */
function novaWeight_(text) {
  var extra = 0;
  for (var i = text.indexOf(','); i >= 0; i = text.indexOf(',', i + 1)) extra++;
  for (var j = text.indexOf(':'); j >= 0; j = text.indexOf(':', j + 1)) extra++;
  return novaBytes_(text) + extra;
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

function novaErr_(err) {
  return String(err && err.message ? err.message : err);
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
      throw new Error('Nova: ключ этого скрипта отключён. Скопируйте новый скрипт в Nova (Таблица ОС → Подключение).');
    }
    if (/other sheet/.test(reason)) {
      novaStop();
      throw new Error('Nova: подключение забрала другая Google-таблица (там запустили novaSetup). В этой таблице передача остановлена.');
    }
    if (/read-only/.test(reason)) throw new Error('Nova: компания сейчас только на чтение — передача не принята.');
    if (/payload too large/.test(reason)) throw new Error('Nova: лист слишком большой — уменьшите его или выберите другой лист в Nova.');
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
