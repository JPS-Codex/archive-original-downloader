(function () {
  'use strict';

  var PANEL_ID = 'ya-archive-downloader-panel';
  var BUTTON_ID = 'ya-archive-downloader-button';
  var BULK_BUTTON_ID = 'ya-archive-downloader-bulk-button';
  var CONFIRM_BOX_ID = 'ya-archive-downloader-confirm-box';
  var RANGE_START_ID = 'ya-archive-downloader-range-start';
  var RANGE_END_ID = 'ya-archive-downloader-range-end';
  var CANCEL_BUTTON_ID = 'ya-archive-downloader-cancel-button';
  var STATUS_ID = 'ya-archive-downloader-status';
  var PROGRESS_ID = 'ya-archive-downloader-progress';
  var PROGRESS_BAR_ID = 'ya-archive-downloader-progress-bar';
  var PROGRESS_FILL_ID = 'ya-archive-downloader-progress-fill';
  var MODE_ZIP_ID = 'ya-archive-downloader-mode-zip';
  var MODE_FILES_ID = 'ya-archive-downloader-mode-files';
  var SKIP_EXISTING_ID = 'ya-archive-downloader-skip-existing';
  var SUMMARY_ID = 'ya-archive-downloader-summary';
  var PAUSE_BUTTON_ID = 'ya-archive-downloader-pause-button';
  var RETRY_ERRORS_BUTTON_ID = 'ya-archive-downloader-retry-errors-button';
  var RESET_MARKS_BUTTON_ID = 'ya-archive-downloader-reset-marks-button';
  var SETTINGS_KEY = 'yaArchiveDownloaderBulkSettingsV4';
  var CGAMO_BULK_JOB_KEY = 'yaArchiveDownloaderCgamoBulkJobV1';
  var CGAMO_BULK_DB = 'yaArchiveDownloaderCgamoBulkDbV1';
  var downloadInProgress = false;
  var bulkDownloadInProgress = false;
  var bulkCancelRequested = false;
  var bulkPaused = false;
  var bulkPauseWaiters = [];
  var lastBulkErrors = [];
  var lastBulkRange = null;
  var bulkRetryPagesOverride = null;
  var cgamoBulkResumeStarted = false;
  var crcTable = null;

  function isCgamosPage() {
    return /cgamos\.ru$/i.test(window.location.hostname);
  }

  function isYandexArchivePage() {
    return /(^|\.)yandex\.ru$/i.test(window.location.hostname) && /\/archive\//i.test(window.location.pathname);
  }

  function isCgamoPage() {
    return /(^|\.)arch\.mosreg\.ru$/i.test(window.location.hostname) && /\/srv2\/private\/imageViewer\//i.test(window.location.pathname);
  }

  function isCgamosScanPage() {
    if (!isCgamosPage()) {
      return false;
    }
    if (document.querySelector('.inventory-count-picture.ref-count-picture, .inventory-count-picture, .ref-count-picture')) {
      return true;
    }
    var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
    for (var i = 0; i < inputs.length; i += 1) {
      var input = inputs[i];
      var value = String(input.value || '').trim();
      if (!/^\d{1,5}$/.test(value)) {
        continue;
      }
      var rect = input.getBoundingClientRect();
      if (rect.width < 20 || rect.width > 160 || rect.height < 20 || rect.height > 80) {
        continue;
      }
      var contextText = '';
      if (input.parentElement) {
        contextText += ' ' + String(input.parentElement.textContent || '');
      }
      if (input.parentElement && input.parentElement.parentElement) {
        contextText += ' ' + String(input.parentElement.parentElement.textContent || '');
      }
      if (/\/\s*\d{1,5}/.test(contextText)) {
        return true;
      }
    }
    return !!extractCgamosRenderedImage();
  }

  function shouldShowPanel() {
    if (isYandexArchivePage()) {
      return true;
    }
    if (isCgamoPage()) {
      return true;
    }
    return isCgamosScanPage();
  }

  function isCgamosStaroobryadtsyPage() {
    return /\/metric-books\/staroobryadtsy\//i.test(normalizePageUrl(window.location.href));
  }

  function usesCgamosUnderscoreCipher() {
    return /\/metric-books\/staroobryadtsy\//i.test(normalizePageUrl(window.location.href)) ||
      /\/inye-konfessii\/islam\//i.test(normalizePageUrl(window.location.href)) ||
      /\/inye-konfessii\/iudaizm\//i.test(normalizePageUrl(window.location.href)) ||
      /\/inye-konfessii\/catholicism\//i.test(normalizePageUrl(window.location.href)) ||
      /\/skazki\//i.test(normalizePageUrl(window.location.href)) ||
      /\/ispovedalnye_vedomosti\//i.test(normalizePageUrl(window.location.href));
  }

  function normalizePageUrl(url) {
    var index = url.indexOf('?snippet=');
    return index >= 0 ? url.slice(0, index) : url;
  }

  function decodeHtmlValue(value) {
    if (!value) {
      return '';
    }

    var textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/\\u003A/gi, ':')
      .replace(/\\u0026/gi, '&')
      .replace(/&amp;/gi, '&')
      .trim();
  }

  function getCrcTable() {
    if (crcTable) {
      return crcTable;
    }

    crcTable = [];
    for (var n = 0; n < 256; n += 1) {
      var c = n;
      for (var k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[n] = c >>> 0;
    }
    return crcTable;
  }

  function crc32(bytes) {
    var table = getCrcTable();
    var crc = 0 ^ (-1);
    for (var i = 0; i < bytes.length; i += 1) {
      crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  function encodeUtf8(text) {
    return new TextEncoder().encode(String(text || ''));
  }

  function safeLocalStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      // ignore
    }
  }

  function safeLocalStorageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      // ignore
    }
  }

  function getDocumentStorageKey() {
    if (isCgamoPage()) {
      try {
        var cgamoUrl = new URL(normalizePageUrl(window.location.href));
        cgamoUrl.searchParams.delete('serial');
        return 'yaArchiveDownloaderDoc::' + cgamoUrl.href;
      } catch (e) {
        return 'yaArchiveDownloaderDoc::' + normalizePageUrl(window.location.href).replace(/([?&]serial=)\d+/i, '$1');
      }
    }
    return 'yaArchiveDownloaderDoc::' + normalizePageUrl(window.location.href).replace(/\/\d+\/?$/, '');
  }

  function getDownloadedPagesKey() {
    return getDocumentStorageKey() + '::downloadedPages';
  }

  function getDownloadedPagesMap() {
    var raw = safeLocalStorageGet(getDownloadedPagesKey());
    if (!raw) {
      return {};
    }
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveDownloadedPagesMap(map) {
    safeLocalStorageSet(getDownloadedPagesKey(), JSON.stringify(map || {}));
  }

  function clearDownloadedPagesMap() {
    saveDownloadedPagesMap({});
  }

  function markPageDownloaded(pageNumber, filename) {
    var map = getDownloadedPagesMap();
    map[String(pageNumber)] = {
      at: new Date().toISOString(),
      filename: filename || ''
    };
    saveDownloadedPagesMap(map);
  }

  function isPageMarkedDownloaded(pageNumber) {
    var map = getDownloadedPagesMap();
    return !!map[String(pageNumber)];
  }

  function setRetryErrorsButtonVisible(isVisible) {
    var button = document.getElementById(RETRY_ERRORS_BUTTON_ID);
    if (!button) {
      return;
    }
    button.style.display = isVisible ? 'block' : 'none';
    button.textContent = lastBulkErrors.length ? 'Повторить ошибки (' + lastBulkErrors.length + ')' : 'Повторить ошибки';
  }

  function resetDownloadedMarks() {
    if (bulkDownloadInProgress || downloadInProgress) {
      return;
    }
    clearDownloadedPagesMap();
    setStatus('Отметки уже скачанных страниц сброшены.');
    setProgress('');
    setProgressBar(0);
    setProgressBarVisible(false);
    updateBulkSummary(isCgamoPage() ? getCgamoEffectiveTotalPages(getTotalPageCount()) : (getTotalPageCount() || null));
    window.setTimeout(function () {
      if (!bulkDownloadInProgress && !downloadInProgress) {
        setStatus('Готово');
      }
    }, 3000);
  }

  function setPauseButtonState() {
    var button = document.getElementById(PAUSE_BUTTON_ID);
    if (!button) {
      return;
    }
    button.style.display = (bulkDownloadInProgress || !!getCgamoBulkJob()) ? 'block' : 'none';
    button.textContent = bulkPaused ? 'Продолжить' : 'Пауза';
  }

  function releasePauseWaiters() {
    var waiters = bulkPauseWaiters.slice();
    bulkPauseWaiters = [];
    waiters.forEach(function (resolve) {
      resolve();
    });
  }

  async function waitWhilePaused() {
    while (bulkPaused && !bulkCancelRequested) {
      await new Promise(function (resolve) {
        bulkPauseWaiters.push(resolve);
      });
    }
  }

  function createUint16LE(value) {
    return new Uint8Array([
      value & 0xFF,
      (value >>> 8) & 0xFF
    ]);
  }

  function createUint32LE(value) {
    return new Uint8Array([
      value & 0xFF,
      (value >>> 8) & 0xFF,
      (value >>> 16) & 0xFF,
      (value >>> 24) & 0xFF
    ]);
  }

  function concatUint8Arrays(parts) {
    var totalLength = 0;
    for (var i = 0; i < parts.length; i += 1) {
      totalLength += parts[i].length;
    }

    var result = new Uint8Array(totalLength);
    var offset = 0;
    for (var j = 0; j < parts.length; j += 1) {
      result.set(parts[j], offset);
      offset += parts[j].length;
    }
    return result;
  }

  function createStoredZip(entries) {
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    var utf8Flag = 0x0800;

    entries.forEach(function (entry) {
      var nameBytes = encodeUtf8(entry.name);
      var dataBytes = entry.data;
      var crc = crc32(dataBytes);

      var localHeader = concatUint8Arrays([
        createUint32LE(0x04034b50),
        createUint16LE(20),
        createUint16LE(utf8Flag),
        createUint16LE(0),
        createUint16LE(0),
        createUint16LE(0),
        createUint32LE(crc),
        createUint32LE(dataBytes.length),
        createUint32LE(dataBytes.length),
        createUint16LE(nameBytes.length),
        createUint16LE(0),
        nameBytes,
        dataBytes
      ]);

      localParts.push(localHeader);

      var centralHeader = concatUint8Arrays([
        createUint32LE(0x02014b50),
        createUint16LE(20),
        createUint16LE(20),
        createUint16LE(utf8Flag),
        createUint16LE(0),
        createUint16LE(0),
        createUint16LE(0),
        createUint32LE(crc),
        createUint32LE(dataBytes.length),
        createUint32LE(dataBytes.length),
        createUint16LE(nameBytes.length),
        createUint16LE(0),
        createUint16LE(0),
        createUint16LE(0),
        createUint16LE(0),
        createUint32LE(0),
        createUint32LE(offset),
        nameBytes
      ]);

      centralParts.push(centralHeader);
      offset += localHeader.length;
    });

    var centralDirectory = concatUint8Arrays(centralParts);
    var centralSize = centralDirectory.length;
    var centralOffset = offset;

    var endRecord = concatUint8Arrays([
      createUint32LE(0x06054b50),
      createUint16LE(0),
      createUint16LE(0),
      createUint16LE(entries.length),
      createUint16LE(entries.length),
      createUint32LE(centralSize),
      createUint32LE(centralOffset),
      createUint16LE(0)
    ]);

    return new Blob([
      concatUint8Arrays(localParts),
      centralDirectory,
      endRecord
    ], { type: 'application/zip' });
  }

  async function getBytesFromUrl(url) {
    if (/^data:/i.test(url || '')) {
      var base64Index = url.indexOf('base64,');
      if (base64Index >= 0) {
        var binary = atob(url.slice(base64Index + 7));
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      }
    }

    var response = await fetch(url);
    var buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  function openCgamoBulkDb() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(CGAMO_BULK_DB, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'key' });
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error('Не удалось открыть временное хранилище.'));
      };
    });
  }

  async function withCgamoBulkStore(mode, callback) {
    var db = await openCgamoBulkDb();
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction('files', mode);
      var store = transaction.objectStore('files');
      var result;
      try {
        result = callback(store);
      } catch (e) {
        db.close();
        reject(e);
        return;
      }
      transaction.oncomplete = function () {
        db.close();
        resolve(result);
      };
      transaction.onerror = function () {
        db.close();
        reject(transaction.error || new Error('Ошибка временного хранилища.'));
      };
    });
  }

  async function clearCgamoBulkEntries() {
    await withCgamoBulkStore('readwrite', function (store) {
      store.clear();
    });
  }

  async function putCgamoBulkEntry(jobId, pageNumber, name, bytes) {
    await withCgamoBulkStore('readwrite', function (store) {
      store.put({
        key: jobId + ':' + String(pageNumber).padStart(6, '0'),
        jobId: jobId,
        page: pageNumber,
        name: name,
        data: bytes
      });
    });
  }

  async function getCgamoBulkEntries(jobId) {
    var db = await openCgamoBulkDb();
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction('files', 'readonly');
      var store = transaction.objectStore('files');
      var request = store.getAll();
      request.onsuccess = function () {
        var rows = (request.result || []).filter(function (row) {
          return row.jobId === jobId;
        }).sort(function (a, b) {
          return a.page - b.page;
        });
        db.close();
        resolve(rows);
      };
      request.onerror = function () {
        db.close();
        reject(request.error || new Error('Не удалось прочитать временное хранилище.'));
      };
    });
  }

  function looksLikeHtmlBytes(bytes) {
    if (!bytes || !bytes.length) {
      return false;
    }
    var sample = '';
    var limit = Math.min(bytes.length, 256);
    for (var i = 0; i < limit; i += 1) {
      sample += String.fromCharCode(bytes[i]);
    }
    sample = sample.replace(/^\s+/, '').toLowerCase();
    return /^<!doctype html|^<html|^<head|^<body/.test(sample);
  }

  async function getValidatedYandexBytes(url, pageNumber) {
    var response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Не удалось скачать скан страницы ' + pageNumber + '. HTTP ' + response.status + '.');
    }
    var contentType = String(response.headers.get('content-type') || '').toLowerCase();
    var buffer = await response.arrayBuffer();
    var bytes = new Uint8Array(buffer);
    if (contentType && contentType.indexOf('image/') !== 0) {
      throw new Error('Страница ' + pageNumber + ' вернула не изображение.');
    }
    if (looksLikeHtmlBytes(bytes)) {
      throw new Error('Страница ' + pageNumber + ' вернула HTML вместо скана.');
    }
    if (bytes.length < 20000) {
      throw new Error('Страница ' + pageNumber + ' вернула слишком маленький файл.');
    }
    return bytes;
  }

  async function getStableCgamosEntry(pageNumber) {
    var lastError = null;
    var minimumExpectedBytes = 500000;
    for (var attempt = 1; attempt <= 12; attempt += 1) {
      if (bulkCancelRequested) {
        throw new Error('Процесс прерван пользователем.');
      }

      var result = resolveDownloadResult();
      if (result.url) {
        try {
          var bytes = await getBytesFromUrl(result.url);
          var looksTooSmall = bytes.length < minimumExpectedBytes;
          if (!looksTooSmall) {
            return {
              name: buildFilename(window.location.href, result.url),
              data: bytes
            };
          }
          lastError = new Error('Скан ещё не прогрузился полностью. Текущий размер: ' + bytes.length + ' байт.');
        } catch (e) {
          lastError = e;
        }
      } else {
        lastError = new Error('Не удалось получить изображение для скана ' + pageNumber + '.');
      }

      setStatus('Жду прогрузку скана ' + pageNumber + ', попытка ' + attempt + '...');
      await wait(1500);
    }

    throw lastError || new Error('Не удалось дождаться полной загрузки скана ' + pageNumber + '.');
  }

  function toAbsoluteUrl(value) {
    if (!value) {
      return null;
    }

    try {
      return new URL(decodeHtmlValue(value), normalizePageUrl(window.location.href)).href;
    } catch (e) {
      return null;
    }
  }

  function toAbsoluteUrlForBase(value, baseUrl) {
    if (!value) {
      return null;
    }

    try {
      return new URL(decodeHtmlValue(value), baseUrl).href;
    } catch (e) {
      return null;
    }
  }

  function isBlockedAsset(url) {
    var blocked = [
      /captcha/i,
      /og-image/i,
      /favicon/i,
      /logo/i,
      /sprite/i,
      /avatar/i,
      /thumbnail/i,
      /preview/i,
      /mc\.yandex\.ru/i,
      /yastatic\.net\/s3\/home-static/i,
      /adfstat\.yandex\.ru/i
    ];

    for (var i = 0; i < blocked.length; i += 1) {
      if (blocked[i].test(url)) {
        return true;
      }
    }

    return false;
  }

  function isAllowedCandidate(url) {
    if (!url || isBlockedAsset(url)) return false;
    if (/\.js(?:$|[?#])/i.test(url)) return false;
    if (/\.css(?:$|[?#])/i.test(url)) return false;
    if (/\/_next\//i.test(url)) return false;
    if (/\/webpack/i.test(url)) return false;
    if (/\/get_img\.htm(?:$|[?#])/i.test(url)) return true;
    if (/\/info\.json(?:$|[?#])/i.test(url)) return true;
    if (/\/iiif\//i.test(url)) return true;
    if (/\/srv2\/private\/imageViewer\/image\?/i.test(url)) return true;
    if (/\.(jpg|jpeg|png|gif|bmp|webp|tif|tiff|jp2|avif)(?:$|[?#])/i.test(url)) return true;
    if (/(image|download|scan|page|canvas|manifest|content|entity)/i.test(url)) return true;
    return false;
  }

  function improveIiifUrl(url) {
    if (!url) {
      return url;
    }

    if (/\/get_img\.htm(?:$|[?#])/i.test(url)) {
      return url;
    }

    if (/\/info\.json(?:$|[?#])/i.test(url)) {
      return url.replace(/\/info\.json(?:$|[?#].*)/i, '/full/full/0/default.jpg');
    }

    if (!/\/iiif\//i.test(url)) {
      return url;
    }

    var withoutQuery = url.split('?')[0].split('#')[0];
    var baseMatch = withoutQuery.match(/^(.*\/iiif\/[^/]+\/[^/]+)(?:\/.*)?$/i);
    if (baseMatch && baseMatch[1]) {
      return baseMatch[1] + '/full/full/0/default.jpg';
    }

    return url
      .replace(/\/info\.json(?:$|[?#].*)/i, '/full/full/0/default.jpg')
      .replace(/\/[^/]+\/[^/]+\/[^/]+\/[^/?#]+(?=$|[?#])/i, '/full/full/0/default.jpg');
  }

  function scoreUrl(url, width, height, source) {
    var score = 0;

    if (!isAllowedCandidate(url)) {
      return -100000;
    }

    if (/\/get_img\.htm(?:$|[?#])/i.test(url)) score += 2500;
    if (/\/iiif\//i.test(url)) score += 1000;
    if (/\/full\/full\/0\/default\.jpg/i.test(url)) score += 900;
    if (/\/full\/max\/0\//i.test(url)) score += 700;
    if (/\/info\.json(?:$|[?#])/i.test(url)) score += 500;
    if (/[?&]type=original(?:[&#]|$)/i.test(url)) score += 1200;
    if (/[?&]type=thumb(?:[&#]|$)/i.test(url)) score -= 1200;
    if (/\/full\/\d+,/i.test(url)) score -= 650;
    if (/\/srv2\/private\/imageViewer\/image\?/i.test(url)) score += 3000;
    if (/\/(\d{1,3}),/i.test(url)) score -= 450;
    if (/([?&](w|width|h|height)=)(\d{1,3})(?:[&#]|$)/i.test(url)) score -= 450;
    if (/\/thumb/i.test(url)) score -= 600;
    if (/(thumbnail|preview|small)/i.test(url)) score -= 700;
    if (/\.(jpg|jpeg|png|webp|jp2|tif|tiff)(?:$|[?#])/i.test(url)) score += 100;
    if (/(image|download|scan|page|canvas|manifest|content|entity)/i.test(url)) score += 120;
    if (source === 'json' || source === 'script') score += 260;
    if (source === 'anchor') score += 120;
    if (source === 'img') score += 40;
    if (source === 'background') score -= 40;
    if (isCgamosPage() && source === 'img') score += 300;
    if (isCgamosPage() && source === 'anchor') score += 300;
    if (width > 400 && height > 400) score += 300;
    if (width > 800 && height > 800) score += 300;
    if (width > 0 && width < 400) score -= 500;
    if (height > 0 && height < 400) score -= 500;
    if (width && height) score += Math.min((width * height) / 1000, 300);

    return score;
  }

  function extractBestImageFromPage() {
    var candidates = [];
    var seen = {};
    var debug = {
      imageCount: 0,
      canvasCount: 0,
      backgroundCount: 0,
      anchorCount: 0,
      scriptHits: 0,
      rawHits: []
    };

    function rememberRawHit(source, rawUrl) {
      if (!rawUrl || debug.rawHits.length >= 16) {
        return;
      }
      debug.rawHits.push(source + ': ' + String(rawUrl).slice(0, 260));
    }

    function pushCandidate(rawUrl, width, height, source) {
      rememberRawHit(source || 'candidate', rawUrl);
      var url = improveIiifUrl(toAbsoluteUrl(rawUrl));
      if (!url || seen[url] || !isAllowedCandidate(url)) {
        return;
      }

      seen[url] = true;
      candidates.push({
        url: url,
        rawUrl: rawUrl,
        source: source || 'unknown',
        width: width || 0,
        height: height || 0,
        score: scoreUrl(url, width || 0, height || 0, source || 'unknown')
      });
    }

    function walkJson(value) {
      if (!value) {
        return;
      }

      if (typeof value === 'string') {
        pushCandidate(value, 0, 0, 'json');
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(walkJson);
        return;
      }

      if (typeof value === 'object') {
        Object.keys(value).forEach(function (key) {
          walkJson(value[key]);
        });
      }
    }

    var imgs = Array.prototype.slice.call(document.images || []);
    debug.imageCount = imgs.length;
    imgs.forEach(function (img) {
      var rect = img.getBoundingClientRect();
      var width = img.naturalWidth || rect.width || 0;
      var height = img.naturalHeight || rect.height || 0;
      pushCandidate(img.currentSrc || img.src, width, height, 'img');
      pushCandidate(img.getAttribute('data-src'), width, height, 'img');
      pushCandidate(img.getAttribute('data-original'), width, height, 'img');
      pushCandidate(img.getAttribute('data-full-image'), width, height, 'img');
      pushCandidate(img.getAttribute('data-image'), width, height, 'img');
    });

    var canvases = Array.prototype.slice.call(document.querySelectorAll('canvas'));
    debug.canvasCount = canvases.length;
    var bestCanvas = null;
    var bestCanvasArea = 0;
    canvases.forEach(function (canvas) {
      var rect = canvas.getBoundingClientRect();
      var width = canvas.width || rect.width || 0;
      var height = canvas.height || rect.height || 0;
      var visible = rect.width > 200 && rect.height > 200;
      var area = width * height;
      if (visible && area > bestCanvasArea) {
        bestCanvasArea = area;
        bestCanvas = canvas;
      }
    });

    Array.prototype.slice.call(document.querySelectorAll('*')).forEach(function (node) {
      var style;
      var bg;
      var match;
      var rect;
      try {
        style = window.getComputedStyle(node);
      } catch (e) {
        return;
      }

      bg = style && style.backgroundImage ? style.backgroundImage : '';
      if (!bg || bg === 'none') return;
      match = bg.match(/url\((['"]?)(.*?)\1\)/i);
      if (!match || !match[2]) return;
      rect = node.getBoundingClientRect();
      debug.backgroundCount += 1;
      pushCandidate(match[2], rect.width || 0, rect.height || 0, 'background');
    });

    var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
    debug.anchorCount = anchors.length;
    anchors.forEach(function (anchor) {
      var href = anchor.getAttribute('href');
      if (!href) return;
      if (/\/iiif\//i.test(href) || /\/srv2\/private\/imageViewer\/image\?/i.test(href) || /(download|image|scan|page|canvas|manifest|content|entity|info\.json)/i.test(href)) {
        pushCandidate(href, 0, 0, 'anchor');
      }
    });

    var html = document.documentElement.outerHTML;
    var patterns = [
      /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi,
      /<img\b[^>]*?\bdata-src\s*=\s*["']([^"']+)["']/gi,
      /<img\b[^>]*?\bdata-original\s*=\s*["']([^"']+)["']/gi,
      /<img\b[^>]*?\bdata-full-image\s*=\s*["']([^"']+)["']/gi,
      /<img\b[^>]*?\bsrc\s*=\s*["']([^"']*get_img\.htm[^"']*)["']/gi,
      /<a\b[^>]*?\bhref\s*=\s*["']([^"']*get_img\.htm[^"']*)["']/gi,
      /\b(?:imageUrl|originalUrl|downloadUrl|contentUrl|resourceUrl|tileSource|serviceUrl|infoUrl|@id)\b\s*[:=]\s*["']([^"']+)["']/gi,
      /(https?:\\?\/\\?\/[^"'<>\\\s]*iiif[^"'<>\\\s]*)/gi,
      /(https?:\\?\/\\?\/[^"'<>\\\s]*get_img\.htm(?:[?#][^"'<>\\\s]*)?)/gi,
      /(https?:\\?\/\\?\/[^"'<>\\\s]*\/srv2\/private\/imageViewer\/image\?[^"'<>\\\s]*)/gi,
      /(https?:\\?\/\\?\/[^"'<>\\\s]*info\.json(?:[?#][^"'<>\\\s]*)?)/gi,
      /(https?:\\?\/\\?\/[^"'<>\\\s]*\.(?:jpg|jpeg|png|webp|jp2|tif|tiff)(?:[?#][^"'<>\\\s]*)?)/gi,
      /(["'])(\/[^"'<>\\\s]*iiif[^"'<>\\\s]*)\1/gi,
      /(["'])(\/[^"'<>\\\s]*\/srv2\/private\/imageViewer\/image\?[^"'<>\\\s]*)\1/gi,
      /(["'])(\/[^"'<>\\\s]*info\.json[^"'<>\\\s]*)\1/gi,
      /(["'])(\/[^"'<>\\\s]*get_img\.htm[^"'<>\\\s]*)\1/gi
    ];

    patterns.forEach(function (pattern) {
      var match;
      while ((match = pattern.exec(html)) !== null) {
        debug.scriptHits += 1;
        pushCandidate(match[2] || match[1], 0, 0, 'script');
      }
    });

    var jsonScripts = Array.prototype.slice.call(document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"], script#__NEXT_DATA__'));
    jsonScripts.forEach(function (scriptNode) {
      var text = scriptNode.textContent || '';
      if (!text.trim()) {
        return;
      }

      try {
        var parsed = JSON.parse(text);
        walkJson(parsed);
      } catch (e) {
        rememberRawHit('json-error', e && e.message ? e.message : String(e));
      }
    });

    Array.prototype.slice.call(document.scripts || []).forEach(function (scriptNode) {
      var text = scriptNode.textContent || '';
      if (!text) {
        return;
      }

      var matches = text.match(/https?:\/\/[^"'\\\s)]+|\/[^"'\\\s)]*\/srv2\/private\/imageViewer\/image\?[^"'\\\s)]*|\/[^"'\\\s)]*get_img\.htm[^"'\\\s)]*|\/[^"'\\\s)]*info\.json[^"'\\\s)]*|\/[^"'\\\s)]*iiif[^"'\\\s)]*/gi) || [];
      matches.forEach(function (item) {
        pushCandidate(item, 0, 0, 'script');
      });
    });

    candidates.sort(function (a, b) {
      return b.score - a.score;
    });
    var canvasDataUrl = null;
    if (bestCanvas) {
      try {
        canvasDataUrl = bestCanvas.toDataURL('image/png');
      } catch (e) {
        rememberRawHit('canvas-error', e && e.message ? e.message : String(e));
      }
    }

    return {
      url: candidates.length ? candidates[0].url : canvasDataUrl,
      kind: candidates.length ? 'url' : (canvasDataUrl ? 'canvas' : null),
      debug: debug
    };
  }

  function extractCgamosRenderedImage() {
    function getVisibleScore(rect) {
      var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      var left = Math.max(0, rect.left);
      var top = Math.max(0, rect.top);
      var right = Math.min(viewportWidth, rect.right);
      var bottom = Math.min(viewportHeight, rect.bottom);
      var visibleWidth = Math.max(0, right - left);
      var visibleHeight = Math.max(0, bottom - top);
      return visibleWidth * visibleHeight;
    }

    var elements = Array.prototype.slice.call(document.querySelectorAll('img, canvas'));
    var candidates = [];

    elements.forEach(function (element) {
      var rect = element.getBoundingClientRect();
      if (rect.width < 150 || rect.height < 150) {
        return;
      }

      var visibleArea = getVisibleScore(rect);
      if (visibleArea <= 0) {
        return;
      }

      var score = visibleArea;
      if (element.tagName === 'CANVAS') {
        score += 25000;
      }

      candidates.push({
        element: element,
        rect: rect,
        visibleArea: visibleArea,
        score: score
      });
    });

    candidates.sort(function (a, b) {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.rect.left !== b.rect.left) {
        return a.rect.left - b.rect.left;
      }
      if (a.rect.top !== b.rect.top) {
        return a.rect.top - b.rect.top;
      }
      return 0;
    });

    var bestElement = candidates.length ? candidates[0].element : null;
    if (!bestElement) {
      return null;
    }

    try {
      if (bestElement.tagName === 'CANVAS') {
        return bestElement.toDataURL('image/jpeg', 0.98);
      }

      var canvas = document.createElement('canvas');
      canvas.width = bestElement.naturalWidth || bestElement.width;
      canvas.height = bestElement.naturalHeight || bestElement.height;
      var context = canvas.getContext('2d');
      context.drawImage(bestElement, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.98);
    } catch (e) {
      return null;
    }
  }

  function extractArchiveNamingParts(imageUrl) {
    if (isCgamosPage()) {
      var normalizedCgamosUrl = normalizePageUrl(window.location.href);
      var cgamosSegments = normalizedCgamosUrl.split('/').filter(Boolean);
      var cgamosPath = cgamosSegments.length ? cgamosSegments[cgamosSegments.length - 1] : null;
      var leafPage = null;
      var pagerCandidates = Array.prototype.slice.call(document.querySelectorAll('input, span, div'));
      pagerCandidates.some(function (node) {
        var text = '';
        if (node.tagName === 'INPUT') {
          text = node.value || '';
        } else {
          text = node.textContent || '';
        }
        text = String(text).trim();
        if (/^\d{1,5}$/.test(text)) {
          var rect = node.getBoundingClientRect();
          var nearbyTexts = [];
          if (node.parentElement) {
            nearbyTexts.push(String(node.parentElement.textContent || '').trim());
          }
          if (node.parentElement && node.parentElement.parentElement) {
            nearbyTexts.push(String(node.parentElement.parentElement.textContent || '').trim());
          }
          if (node.previousElementSibling) {
            nearbyTexts.push(String(node.previousElementSibling.textContent || '').trim());
          }
          if (node.nextElementSibling) {
            nearbyTexts.push(String(node.nextElementSibling.textContent || '').trim());
          }
          var pagerLooksLikeCurrent = nearbyTexts.some(function (value) {
            return /\/\s*\d{1,5}/.test(value) || /^\d{1,5}\s*\/\s*\d{1,5}$/.test(value);
          });
          if (rect.width >= 20 && rect.width <= 140 && rect.height >= 20 && rect.height <= 80 && pagerLooksLikeCurrent) {
            leafPage = text;
            return true;
          }
        }
        return false;
      });

      return {
        archive: 'ЦГА_Москвы',
        fund: null,
        opis: null,
        delo: null,
        page: leafPage,
        cgamosPath: cgamosPath
      };
    }

    var pageText = document.body ? document.body.innerText : '';

    function findNumber(pattern) {
      var match = pageText.match(pattern);
      return match && match[1] ? match[1] : null;
    }

    var fund = findNumber(/фонд\s*№?\s*(\d+)/i);
    var opis = findNumber(/опись\s*№?\s*(\d+)/i);
    var delo = findNumber(/дело\s*№?\s*(\d+)/i);
    var page = findNumber(/(?:стр\.?|страница)\s*№?\s*(\d+)/i);
    var archive = null;

    var archiveLineMatch = pageText.match(/([^\n,]+?),\s*фонд\s*№?\s*\d+/i);
    if (archiveLineMatch && archiveLineMatch[1]) {
      archive = archiveLineMatch[1].trim();
    }

    if (!(fund && opis && delo && page) && imageUrl) {
      var pathMatch = imageUrl.match(/(\d+)-(\d+)-(\d+)-(\d{4,})\.(?:jpg|jpeg|png|webp|jp2|tif|tiff)(?:$|[?#])/i);
      if (pathMatch) {
        fund = fund || pathMatch[1];
        opis = opis || pathMatch[2];
        delo = delo || pathMatch[3];
        page = page || String(parseInt(pathMatch[4], 10));
      }
    }

    return {
      archive: archive,
      fund: fund,
      opis: opis,
      delo: delo,
      page: page,
      cgamosPath: null
    };
  }

  function sanitizeFilenamePart(value) {
    return String(value || '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function extractCgamoOriginalName() {
    return extractCgamoOriginalNameFromText('');
  }

  function extractCgamoOriginalNameFromText(extraText) {
    var text = String(extraText || '');
    if (document.body) {
      text += ' ' + String(document.body.innerText || '');
      text += ' ' + String(document.body.textContent || '');
      text += ' ' + String(document.body.innerHTML || '');
    }

    var nodes = Array.prototype.slice.call(document.querySelectorAll('[title], [alt], [href], [src], [data-name], [data-filename], [data-file-name]'));
    nodes.forEach(function (node) {
      ['title', 'alt', 'href', 'src', 'data-name', 'data-filename', 'data-file-name'].forEach(function (attr) {
        var value = node.getAttribute && node.getAttribute(attr);
        if (value) {
          text += ' ' + value;
        }
      });
    });

    var match = text.match(/(\d+_\d+_\d+_[^"'<>\\\/\s]+?\.jpe?g)/i);
    if (match && match[1]) {
      return decodeHtmlValue(match[1]);
    }
    return null;
  }

  function buildCgamoFilenameFromOriginalName(originalName) {
    if (!originalName) {
      var objectIdMatch = String(window.location.href || '').match(/[?&]objectId=(\d+)/i);
      originalName = objectIdMatch ? objectIdMatch[1] + '.jpg' : 'cgamo-scan.jpg';
    }

    originalName = originalName
      .replace(/\.jpeg$/i, '.jpg')
      .replace(/^(\d+)_(\d+)_(\d+)_/, '$1-$2-$3-');

    if (!/\.jpg$/i.test(originalName)) {
      originalName = originalName.replace(/\.[^.]+$/, '') + '.jpg';
    }

    return 'ЦГА_МосОбл_' + sanitizeFilenamePart(originalName).replace(/_#/, '-#');
  }

  function buildCgamoFilename() {
    return buildCgamoFilenameFromOriginalName(extractCgamoOriginalName());
  }

  function buildCgamoFilenameForSpecificPage(pageNumber, html) {
    var originalName = extractCgamoOriginalNameFromText(html);
    if (!originalName) {
      var baseName = buildCgamoFilename().replace(/\.jpg$/i, '');
      return baseName + '-' + String(pageNumber).padStart(4, '0') + '.jpg';
    }
    return buildCgamoFilenameFromOriginalName(originalName);
  }

  function buildYandexArchivePrefix(archiveName) {
    if (!archiveName) {
      return '';
    }
    return sanitizeFilenamePart(archiveName) + '_[ЯА]_';
  }

  function buildFilename(pageUrl, imageUrl) {
    if (isCgamoPage()) {
      return buildCgamoFilename();
    }

    var naming = extractArchiveNamingParts(imageUrl);
    var extension = 'jpg';
    if (isCgamosPage()) {
      extension = 'jpg';
    } else if (/\/get_img\.(?:htm|php)(?:$|[?#])/i.test(imageUrl || '')) {
      extension = 'jpg';
    } else if (/^data:image\/png/i.test(imageUrl || '')) {
      extension = 'png';
    } else {
      var extensionMatch = (imageUrl || '').match(/\.([a-z0-9]+)(?:$|[?#])/i);
      extension = extensionMatch ? extensionMatch[1].toLowerCase() : 'jpg';
    }

    if (naming.fund && naming.opis && naming.delo && naming.page) {
      var paddedPage = String(naming.page).padStart(4, '0');
      var baseName = naming.fund + '-' + naming.opis + '-' + naming.delo + '-' + paddedPage;
      if (naming.archive) {
        if (isYandexArchivePage()) {
          return buildYandexArchivePrefix(naming.archive) + baseName + '.' + extension;
        }
        return sanitizeFilenamePart(naming.archive) + '_' + baseName + '.' + extension;
      }
      return baseName + '.' + extension;
    }

    if (naming.cgamosPath) {
      var archivePrefix = naming.archive ? sanitizeFilenamePart(naming.archive) + '_' : '';
      var suffix = naming.page ? '-' + String(naming.page).padStart(4, '0') : '';
      var cgamosBaseName = sanitizeFilenamePart(naming.cgamosPath);
      if (usesCgamosUnderscoreCipher()) {
        cgamosBaseName = cgamosBaseName.replace(/_/g, '-');
      }
      return archivePrefix + cgamosBaseName + suffix + '.' + extension;
    }

    var cleaned = normalizePageUrl(pageUrl);
    var parts = cleaned.split('/').filter(Boolean);
    var pageId = parts.length ? parts[parts.length - 1] : 'archive';
    return pageId + '.' + extension;
  }

  function buildBulkZipFilename(range) {
    if (isCgamoPage()) {
      var cgamoBase = buildCgamoFilename().replace(/(?:-\d{4})?\.jpg$/i, '').replace(/\.jpg$/i, '');
      var cgamoSuffix = '';
      var cgamoTotalPages = getTotalPageCount();
      if (range && range.start && range.end && (!cgamoTotalPages || range.start !== 1 || range.end !== cgamoTotalPages)) {
        cgamoSuffix = '_' + String(range.start).padStart(4, '0') + '-' + String(range.end).padStart(4, '0');
      }
      return cgamoBase + cgamoSuffix + '.zip';
    }

    var naming = extractArchiveNamingParts('');
    var suffix = '';
    var totalPages = getTotalPageCount();
    if (range && range.start && range.end && (!totalPages || range.start !== 1 || range.end !== totalPages)) {
      suffix = '_' + String(range.start).padStart(4, '0') + '-' + String(range.end).padStart(4, '0');
    }
    if (naming.cgamosPath) {
      var archivePrefix = naming.archive ? sanitizeFilenamePart(naming.archive) + '_' : '';
      var cgamosBaseName = sanitizeFilenamePart(naming.cgamosPath);
      if (usesCgamosUnderscoreCipher()) {
        cgamosBaseName = cgamosBaseName.replace(/_/g, '-');
      }
      return archivePrefix + cgamosBaseName + suffix + '.zip';
    }

    if (isYandexArchivePage()) {
      var base = extractYandexBaseNaming();
      if (base.fund && base.opis && base.delo) {
        var baseName = base.fund + '-' + base.opis + '-' + base.delo;
        if (base.archive) {
          return buildYandexArchivePrefix(base.archive) + baseName + suffix + '.zip';
        }
        return baseName + suffix + '.zip';
      }

      var cleaned = normalizePageUrl(window.location.href);
      var parts = cleaned.split('/').filter(Boolean);
      var pageId = parts.length ? parts[parts.length - 1] : 'yandex-archive';
      return 'yandex-archive-' + sanitizeFilenamePart(pageId) + suffix + '.zip';
    }

    return 'cgamos-scans.zip';
  }

  function extractYandexBaseNaming() {
    var pageText = document.body ? document.body.innerText : '';

    function findNumber(pattern) {
      var match = pageText.match(pattern);
      return match && match[1] ? match[1] : null;
    }

    var fund = findNumber(/фонд\s*№?\s*(\d+)/i);
    var opis = findNumber(/опись\s*№?\s*(\d+)/i);
    var delo = findNumber(/дело\s*№?\s*(\d+)/i);
    var archive = null;

    var archiveLineMatch = pageText.match(/([^\n,]+?),\s*фонд\s*№?\s*\d+/i);
    if (archiveLineMatch && archiveLineMatch[1]) {
      archive = archiveLineMatch[1].trim();
    }

    return {
      archive: archive,
      fund: fund,
      opis: opis,
      delo: delo
    };
  }

  function buildFilenameForSpecificPage(pageNumber, pageUrl, imageUrl) {
    if (isCgamoPage()) {
      return buildCgamoFilenameForSpecificPage(pageNumber, '');
    }

    if (isYandexArchivePage()) {
      var base = extractYandexBaseNaming();
      if (base.fund && base.opis && base.delo) {
        var paddedPage = String(pageNumber).padStart(4, '0');
        var baseName = base.fund + '-' + base.opis + '-' + base.delo + '-' + paddedPage;
        if (base.archive) {
          return buildYandexArchivePrefix(base.archive) + baseName + '.jpg';
        }
        return baseName + '.jpg';
      }
    }

    return buildFilename(pageUrl, imageUrl);
  }

  function getYandexPageUrl(pageNumber) {
    var cleaned = normalizePageUrl(window.location.href);
    return cleaned.replace(/\/\d+\/?$/, '/' + pageNumber);
  }

  function extractBestYandexImageFromHtml(html, pageUrl) {
    var candidates = [];
    var seen = {};

    function push(rawUrl, score) {
      var absolute = improveIiifUrl(toAbsoluteUrlForBase(rawUrl, pageUrl));
      if (!absolute || seen[absolute] || !isAllowedCandidate(absolute)) {
        return;
      }
      seen[absolute] = true;
      candidates.push({
        url: absolute,
        score: score
      });
    }

    var originalApiPattern = /https?:\\?\/\\?\/[^"'<>\\\s]*\/archive\/api\/image\?[^"'<>\\\s]*type=original[^"'<>\\\s]*/gi;
    var apiMatch;
    while ((apiMatch = originalApiPattern.exec(html)) !== null) {
      push(apiMatch[0], 5000);
    }

    var rawApiPattern = /(["'])(\/archive\/api\/image\?[^"']*type=original[^"']*)\1/gi;
    while ((apiMatch = rawApiPattern.exec(html)) !== null) {
      push(apiMatch[2], 4800);
    }

    var imagePathPattern = /(["'])(\/archive\/catalog\/[^"']+\.(?:jpg|jpeg|png|webp|jp2|tif|tiff)[^"']*)\1/gi;
    while ((apiMatch = imagePathPattern.exec(html)) !== null) {
      push(apiMatch[2], 4200);
    }

    var genericPattern = /(https?:\\?\/\\?\/[^"'<>\\\s]*\.(?:jpg|jpeg|png|webp|jp2|tif|tiff)(?:[?#][^"'<>\\\s]*)?)/gi;
    while ((apiMatch = genericPattern.exec(html)) !== null) {
      push(apiMatch[1], 3000);
    }

    candidates.sort(function (a, b) {
      return b.score - a.score;
    });

    return candidates.length ? candidates[0].url : null;
  }

  async function fetchYandexPageImage(pageNumber) {
    var pageUrl = getYandexPageUrl(pageNumber);
    var response = await fetch(pageUrl, { credentials: 'include' });
    var html = await response.text();
    var imageUrl = extractBestYandexImageFromHtml(html, pageUrl);
    if (!imageUrl) {
      throw new Error('Не удалось найти изображение на странице ' + pageNumber + '.');
    }
    return {
      pageUrl: pageUrl,
      imageUrl: imageUrl
    };
  }

  function getCgamoPageUrl(pageNumber) {
    try {
      var url = new URL(normalizePageUrl(window.location.href));
      url.searchParams.set('serial', String(pageNumber));
      return url.href;
    } catch (e) {
      var current = normalizePageUrl(window.location.href);
      if (/[?&]serial=\d+/i.test(current)) {
        return current.replace(/([?&]serial=)\d+/i, '$1' + pageNumber);
      }
      return current + (current.indexOf('?') >= 0 ? '&' : '?') + 'serial=' + pageNumber;
    }
  }

  function extractBestCgamoImageFromHtml(html, pageUrl) {
    var candidates = [];
    var seen = {};

    function push(rawUrl, score) {
      var absolute = toAbsoluteUrlForBase(rawUrl, pageUrl);
      if (!absolute || seen[absolute] || !/\/srv2\/private\/imageViewer\/image\?/i.test(absolute)) {
        return;
      }
      seen[absolute] = true;
      candidates.push({ url: absolute, score: score });
    }

    var imagePattern = /https?:\\?\/\\?\/[^"'<>\\\s]*\/srv2\/private\/imageViewer\/image\?[^"'<>\\\s]*/gi;
    var match;
    while ((match = imagePattern.exec(html)) !== null) {
      push(match[0], 5000);
    }

    var quotedPattern = /(["'])([^"']*\/srv2\/private\/imageViewer\/image\?[^"']*)\1/gi;
    while ((match = quotedPattern.exec(html)) !== null) {
      push(match[2], 4800);
    }

    var escapedPattern = /(\/srv2\/private\/imageViewer\/image\?url=[^"'<>\\\s]+)/gi;
    while ((match = escapedPattern.exec(html)) !== null) {
      push(match[1], 4600);
    }

    candidates.sort(function (a, b) {
      return b.score - a.score;
    });

    return candidates.length ? candidates[0].url : null;
  }

  function extractBestCgamoImageFromDocument(doc, pageUrl) {
    if (!doc) {
      return null;
    }

    var candidates = [];
    var seen = {};

    function push(rawUrl, score) {
      var absolute = toAbsoluteUrlForBase(rawUrl, pageUrl);
      if (!absolute || seen[absolute] || !/\/srv2\/private\/imageViewer\/image\?/i.test(absolute)) {
        return;
      }
      seen[absolute] = true;
      candidates.push({ url: absolute, score: score });
    }

    Array.prototype.slice.call(doc.querySelectorAll('img')).forEach(function (img) {
      push(img.currentSrc || img.src || img.getAttribute('src'), 6000);
      push(img.getAttribute('data-src'), 5800);
    });

    Array.prototype.slice.call(doc.querySelectorAll('a[href], source[src], [data-url], [data-src]')).forEach(function (node) {
      push(node.getAttribute('href'), 5200);
      push(node.getAttribute('src'), 5200);
      push(node.getAttribute('data-url'), 5000);
      push(node.getAttribute('data-src'), 5000);
    });

    Array.prototype.slice.call(doc.querySelectorAll('[style]')).forEach(function (node) {
      var style = node.getAttribute('style') || '';
      var match;
      var pattern = /url\((['"]?)(.*?)\1\)/gi;
      while ((match = pattern.exec(style)) !== null) {
        push(match[2], 4800);
      }
    });

    var html = doc.documentElement ? doc.documentElement.outerHTML : '';
    var fromHtml = extractBestCgamoImageFromHtml(html, pageUrl);
    push(fromHtml, 4500);

    candidates.sort(function (a, b) {
      return b.score - a.score;
    });

    return candidates.length ? candidates[0].url : null;
  }

  function getCgamoDocumentText(doc) {
    if (!doc) {
      return '';
    }
    var text = '';
    if (doc.body) {
      text += ' ' + String(doc.body.innerText || '');
      text += ' ' + String(doc.body.textContent || '');
    }
    if (doc.documentElement) {
      text += ' ' + String(doc.documentElement.outerHTML || '');
    }
    return text;
  }

  function loadCgamoPageInIframe(pageNumber, pageUrl) {
    return new Promise(function (resolve, reject) {
      var iframe = document.createElement('iframe');
      var done = false;
      var startedAt = Date.now();
      iframe.style.position = 'fixed';
      iframe.style.left = '-10000px';
      iframe.style.top = '-10000px';
      iframe.style.width = '1200px';
      iframe.style.height = '900px';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';

      function cleanup() {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }

      function finish(result, error) {
        if (done) {
          return;
        }
        done = true;
        cleanup();
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }

      function check() {
        if (bulkCancelRequested) {
          finish(null, new Error('Процесс прерван пользователем.'));
          return;
        }

        try {
          var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
          var imageUrl = extractBestCgamoImageFromDocument(doc, pageUrl);
          if (imageUrl) {
            finish({
              pageUrl: pageUrl,
              imageUrl: imageUrl,
              html: getCgamoDocumentText(doc)
            });
            return;
          }
        } catch (e) {
          finish(null, new Error('Не удалось прочитать встроенную страницу ' + pageNumber + ': ' + (e && e.message ? e.message : String(e))));
          return;
        }

        if (Date.now() - startedAt > 20000) {
          finish(null, new Error('Не удалось дождаться изображения на странице ' + pageNumber + '.'));
          return;
        }

        window.setTimeout(check, 700);
      }

      iframe.addEventListener('load', function () {
        window.setTimeout(check, 1200);
      });
      iframe.addEventListener('error', function () {
        finish(null, new Error('Не удалось загрузить встроенную страницу ' + pageNumber + '.'));
      });

      document.body.appendChild(iframe);
      iframe.src = pageUrl;
      window.setTimeout(check, 2500);
    });
  }

  async function fetchCgamoPageImage(pageNumber) {
    var pageUrl = getCgamoPageUrl(pageNumber);
    var imageUrl = null;
    var html = '';

    var response = await fetch(pageUrl, { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Не удалось открыть страницу ' + pageNumber + '. HTTP ' + response.status + '.');
    }
    html = await response.text();
    imageUrl = extractBestCgamoImageFromHtml(html, pageUrl);

    if (!imageUrl) {
      var iframeResult = await loadCgamoPageInIframe(pageNumber, pageUrl);
      imageUrl = iframeResult.imageUrl;
      html = iframeResult.html || html;
    }

    if (!imageUrl) {
      throw new Error('Не удалось найти изображение на странице ' + pageNumber + '.');
    }
    return {
      pageUrl: pageUrl,
      imageUrl: imageUrl,
      filename: buildCgamoFilenameForSpecificPage(pageNumber, html)
    };
  }

  async function getValidatedCgamoBytes(url, pageNumber) {
    var response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Не удалось скачать скан страницы ' + pageNumber + '. HTTP ' + response.status + '.');
    }
    var contentType = String(response.headers.get('content-type') || '').toLowerCase();
    var buffer = await response.arrayBuffer();
    var bytes = new Uint8Array(buffer);
    if (contentType && contentType.indexOf('image/') !== 0 && contentType.indexOf('octet-stream') < 0) {
      throw new Error('Страница ' + pageNumber + ' вернула не изображение.');
    }
    if (looksLikeHtmlBytes(bytes)) {
      throw new Error('Страница ' + pageNumber + ' вернула HTML вместо скана.');
    }
    if (bytes.length < 20000) {
      throw new Error('Страница ' + pageNumber + ' вернула слишком маленький файл.');
    }
    return bytes;
  }

  function getCgamoBulkJob() {
    var raw = safeLocalStorageGet(CGAMO_BULK_JOB_KEY);
    if (!raw) {
      return null;
    }
    try {
      var job = JSON.parse(raw);
      return job && job.active ? job : null;
    } catch (e) {
      return null;
    }
  }

  function saveCgamoBulkJob(job) {
    safeLocalStorageSet(CGAMO_BULK_JOB_KEY, JSON.stringify(job));
  }

  function clearCgamoBulkJob() {
    safeLocalStorageRemove(CGAMO_BULK_JOB_KEY);
  }

  function getCurrentCgamoSerial() {
    var match = String(window.location.href || '').match(/[?&]serial=(\d{1,5})/i);
    return match ? parseInt(match[1], 10) : null;
  }

  async function waitForCurrentCgamoEntry(pageNumber) {
    var lastError = null;
    for (var attempt = 1; attempt <= 24; attempt += 1) {
      if (bulkCancelRequested) {
        throw new Error('Процесс прерван пользователем.');
      }

      var result = resolveDownloadResult();
      if (result && result.url) {
        try {
          var bytes = await getValidatedCgamoBytes(result.url, pageNumber);
          return {
            name: buildCgamoFilenameForSpecificPage(pageNumber, document.documentElement ? document.documentElement.outerHTML : ''),
            data: bytes
          };
        } catch (e) {
          lastError = e;
        }
      } else {
        lastError = new Error('Не удалось найти изображение на текущей странице.');
      }

      setStatus('Жду прогрузку скана ' + pageNumber + ', попытка ' + attempt + '...');
      await wait(700);
    }

    throw lastError || new Error('Не удалось дождаться изображения на странице ' + pageNumber + '.');
  }

  async function startCgamoNavigatingBulkJob(requestedRange, pagesToDownload, totalPages, saveAsFiles) {
    var job = {
      active: true,
      id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
      range: requestedRange,
      pages: pagesToDownload,
      index: 0,
      totalPages: totalPages,
      saveAsFiles: saveAsFiles,
      errors: [],
      preparedCount: 0,
      startedAt: Date.now(),
      zipName: buildBulkZipFilename(requestedRange)
    };

    await clearCgamoBulkEntries();
    saveCgamoBulkJob(job);
    setStatus('Начинаю пакетное скачивание ЦГАМО...');
    setProgress('Переход к странице ' + pagesToDownload[0]);
    window.location.href = getCgamoPageUrl(pagesToDownload[0]);
  }

  async function finishCgamoNavigatingBulkJob(job) {
    if (job.saveAsFiles) {
      if (job.errors && job.errors.length) {
        downloadTextFile('errors.txt', job.errors.join('\r\n'));
        setStatus('Скачивание отдельных файлов завершено с ошибками. Список сохранён в errors.txt');
      } else {
        setStatus('Скачивание отдельных файлов завершено.');
      }
      setProgress('Готово');
      setProgressBar(1);
      clearCgamoBulkJob();
      return;
    }

    var rows = await getCgamoBulkEntries(job.id);
    if (!rows.length) {
      if (job.errors && job.errors.length) {
        throw new Error('Не удалось подготовить ни одного файла для ZIP. Первая ошибка: ' + job.errors[0]);
      }
      throw new Error('Не удалось подготовить ни одного файла для ZIP.');
    }

    var entries = rows.map(function (row) {
      return {
        name: row.name,
        data: row.data
      };
    });
    entries.push({
      name: 'info.txt',
      data: encodeUtf8(buildInfoText(job.range, job.totalPages, job.preparedCount || rows.length, job.errors || []))
    });
    if (job.errors && job.errors.length) {
      entries.push({
        name: 'errors.txt',
        data: encodeUtf8(job.errors.join('\r\n'))
      });
    }

    setStatus('Собираю ZIP...');
    triggerBlobDownload(createStoredZip(entries), job.zipName || buildBulkZipFilename(job.range));
    setStatus(job.errors && job.errors.length ? 'ZIP подготовлен с errors.txt' : 'ZIP со всеми сканами подготовлен.');
    setProgress('Готово');
    setProgressBar(1);
    clearCgamoBulkJob();
  }

  async function resumeCgamoNavigatingBulkJob() {
    if (!isCgamoPage() || cgamoBulkResumeStarted) {
      return;
    }
    var job = getCgamoBulkJob();
    if (!job || !job.pages || !job.pages.length) {
      return;
    }
    cgamoBulkResumeStarted = true;
    bulkDownloadInProgress = true;
    bulkCancelRequested = false;
    setPanelBusyState(true);
    setCancelButtonVisible(true);
    setProgressBarVisible(true);
    setPauseButtonState();

    try {
      if (job.index >= job.pages.length) {
        await finishCgamoNavigatingBulkJob(job);
        return;
      }

      var pageNumber = job.pages[job.index];
      if (getCurrentCgamoSerial() !== pageNumber) {
        window.location.href = getCgamoPageUrl(pageNumber);
        return;
      }

      updateProgress(job.index, job.pages.length, job.startedAt);
      setStatus('Подготавливаю скан ' + pageNumber + ' из диапазона ' + job.range.start + '-' + job.range.end + '...');
      var entry = await waitForCurrentCgamoEntry(pageNumber);
      if (job.saveAsFiles) {
        triggerBlobDownload(new Blob([entry.data], { type: 'image/jpeg' }), entry.name);
      } else {
        await putCgamoBulkEntry(job.id, pageNumber, entry.name, entry.data);
      }
      markPageDownloaded(pageNumber, entry.name);
      job.preparedCount = (job.preparedCount || 0) + 1;
      job.index += 1;
      saveCgamoBulkJob(job);
      updateProgress(job.index, job.pages.length, job.startedAt);

      if (job.index >= job.pages.length) {
        await finishCgamoNavigatingBulkJob(job);
        return;
      }

      setStatus('Перехожу к скану ' + job.pages[job.index] + '...');
      window.location.href = getCgamoPageUrl(job.pages[job.index]);
    } catch (e) {
      var message = e && e.message ? e.message : String(e);
      if (/прерван пользователем/i.test(message)) {
        clearCgamoBulkJob();
        setStatus('Процесс прерван.');
        setProgress('Остановлено');
      } else {
        if (job.index >= job.pages.length) {
          clearCgamoBulkJob();
          setStatus('Ошибка: ' + message, true);
          setProgress('Ошибка');
          return;
        }
        var failedPage = job.pages[job.index] || '?';
        job.errors = job.errors || [];
        job.errors.push('Страница ' + failedPage + ': ' + message);
        job.index += 1;
        saveCgamoBulkJob(job);
        if (job.index >= job.pages.length) {
          await finishCgamoNavigatingBulkJob(job);
        } else {
          setStatus('Ошибка на странице ' + failedPage + ', продолжаю...');
          window.location.href = getCgamoPageUrl(job.pages[job.index]);
        }
      }
    } finally {
      if (getCgamoBulkJob()) {
        bulkDownloadInProgress = true;
        setPanelBusyState(true);
        setCancelButtonVisible(true);
        setPauseButtonState();
      } else {
        bulkDownloadInProgress = false;
        bulkCancelRequested = false;
        setPanelBusyState(false);
        setCancelButtonVisible(false);
        setPauseButtonState();
      }
    }
  }

  function setStatus(text, isError) {
    var status = document.getElementById(STATUS_ID);
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? '#b42318' : '#111827';
  }

  function setProgress(text) {
    var progress = document.getElementById(PROGRESS_ID);
    if (!progress) return;
    progress.textContent = text || '';
  }

  function setProgressBar(ratio) {
    var fill = document.getElementById(PROGRESS_FILL_ID);
    if (!fill) return;
    var percent = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
    fill.style.width = percent + '%';
  }

  function setProgressBarVisible(isVisible) {
    var bar = document.getElementById(PROGRESS_BAR_ID);
    if (!bar) return;
    bar.style.display = isVisible ? 'block' : 'none';
  }

  function formatDuration(ms) {
    if (!ms || ms < 0 || !isFinite(ms)) {
      return '';
    }
    var totalSeconds = Math.round(ms / 1000);
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    if (minutes > 0) {
      return minutes + ' мин ' + seconds + ' сек';
    }
    return seconds + ' сек';
  }

  function updateProgress(completed, total, startedAt) {
    if (!total) {
      setProgress('');
      setProgressBar(0);
      return;
    }
    var text = 'Прогресс: ' + completed + ' из ' + total;
    if (completed > 0 && startedAt) {
      var elapsed = Date.now() - startedAt;
      var average = elapsed / completed;
      var remaining = average * Math.max(total - completed, 0);
      text += ' | Осталось примерно: ' + formatDuration(remaining);
    }
    setProgress(text);
    setProgressBar(completed / total);
  }

  function getSelectedBulkMode() {
    var modeFiles = document.getElementById(MODE_FILES_ID);
    return modeFiles && modeFiles.checked ? 'files' : 'zip';
  }

  function getSkipExistingEnabled() {
    var input = document.getElementById(SKIP_EXISTING_ID);
    return !!(input && input.checked);
  }

  function getSiteLabel() {
    if (isCgamoPage()) {
      return 'ЦГА Московской области';
    }
    return isYandexArchivePage() ? 'Яндекс.Архив' : 'ЦГА Москвы';
  }

  function buildInfoText(range, totalPages, savedCount, errorMessages) {
    var lines = [
      'Сайт: ' + getSiteLabel(),
      'URL: ' + normalizePageUrl(window.location.href),
      'Диапазон: ' + range.start + '-' + range.end,
      'Всего листов в документе: ' + totalPages,
      'Формат: ' + (getSelectedBulkMode() === 'files' ? 'Отдельными файлами JPG' : 'Одним ZIPом'),
      'Дата: ' + new Date().toLocaleString('ru-RU'),
      'Успешно подготовлено листов: ' + savedCount
    ];
    if (errorMessages && errorMessages.length) {
      lines.push('Ошибок: ' + errorMessages.length);
    }
    return lines.join('\r\n');
  }

  function updateBulkSummary(totalPages) {
    var node = document.getElementById(SUMMARY_ID);
    if (!node) {
      return;
    }
    var actualTotal = isCgamoPage() ? getCgamoEffectiveTotalPages(totalPages || getTotalPageCount()) : (totalPages || getTotalPageCount() || 1);
    if (bulkRetryPagesOverride && bulkRetryPagesOverride.length) {
      node.textContent = getSiteLabel() + ' | Повтор ошибок | Только страницы: ' + bulkRetryPagesOverride.join(', ');
      return;
    }
    var range = getRequestedBulkRange(actualTotal);
    var modeLabel = getSelectedBulkMode() === 'files' ? 'Отдельными файлами JPG' : 'Одним ZIPом';
    var skipLabel = getSkipExistingEnabled() ? ' | Пропускать уже скачанные: да' : '';
    if (!range) {
      node.textContent = 'Проверьте диапазон скачивания.';
      return;
    }
    node.textContent = getSiteLabel() + ' | ' + modeLabel + ' | Страницы: ' + range.start + '-' + range.end + ' из ' + actualTotal + skipLabel;
  }

  function loadBulkSettings() {
    var raw = safeLocalStorageGet(SETTINGS_KEY);
    var currentDocKey = getDocumentStorageKey();
    if (!raw) {
      return { mode: 'zip', start: '1', end: '', skipExisting: false, docKey: currentDocKey };
    }
    try {
      var parsed = JSON.parse(raw);
      if (parsed.docKey !== currentDocKey) {
        return { mode: parsed.mode === 'files' ? 'files' : 'zip', start: '1', end: '', skipExisting: !!parsed.skipExisting, docKey: currentDocKey };
      }
      return {
        mode: parsed.mode === 'files' ? 'files' : 'zip',
        start: parsed.start ? String(parsed.start) : '1',
        end: parsed.end ? String(parsed.end) : '',
        skipExisting: !!parsed.skipExisting,
        docKey: currentDocKey
      };
    } catch (e) {
      return { mode: 'zip', start: '1', end: '', skipExisting: false, docKey: currentDocKey };
    }
  }

  function saveBulkSettings() {
    var startInput = document.getElementById(RANGE_START_ID);
    var endInput = document.getElementById(RANGE_END_ID);
    var modeFiles = document.getElementById(MODE_FILES_ID);
    var skipExisting = document.getElementById(SKIP_EXISTING_ID);
    safeLocalStorageSet(SETTINGS_KEY, JSON.stringify({
      mode: modeFiles && modeFiles.checked ? 'files' : 'zip',
      start: startInput ? String(startInput.value || '') : '',
      end: endInput ? String(endInput.value || '') : '',
      skipExisting: !!(skipExisting && skipExisting.checked),
      docKey: getDocumentStorageKey()
    }));
    updateBulkSummary(isCgamoPage() ? getCgamoEffectiveTotalPages(getTotalPageCount()) : (getTotalPageCount() || null));
  }

  function setRangeInputsEnabled() {
    var startInput = document.getElementById(RANGE_START_ID);
    var endInput = document.getElementById(RANGE_END_ID);
    var enabled = true;
    if (startInput) {
      startInput.disabled = !enabled;
      startInput.style.opacity = enabled ? '1' : '0.65';
    }
    if (endInput) {
      endInput.disabled = !enabled;
      endInput.style.opacity = enabled ? '1' : '0.65';
    }
  }

  function setButtonBusyState(button, isBusy) {
    if (!button) {
      return;
    }
    button.disabled = !!isBusy;
    button.style.opacity = isBusy ? '0.65' : '1';
    button.style.cursor = isBusy ? 'wait' : 'pointer';
  }

  function setPanelBusyState(isBusy) {
    setButtonBusyState(document.getElementById(BUTTON_ID), isBusy);
    setButtonBusyState(document.getElementById(BULK_BUTTON_ID), isBusy);
    setButtonBusyState(document.getElementById(RETRY_ERRORS_BUTTON_ID), isBusy);
    setButtonBusyState(document.getElementById(RESET_MARKS_BUTTON_ID), isBusy);
  }

  function setCancelButtonVisible(isVisible) {
    var cancelButton = document.getElementById(CANCEL_BUTTON_ID);
    if (!cancelButton) {
      return;
    }
    cancelButton.style.display = isVisible ? 'block' : 'none';
    cancelButton.disabled = false;
    cancelButton.style.opacity = '1';
    cancelButton.style.cursor = 'pointer';
    setPauseButtonState();
  }

  function hideBulkConfirm() {
    var confirmBox = document.getElementById(CONFIRM_BOX_ID);
    if (confirmBox) {
      confirmBox.style.display = 'none';
    }
    if (!bulkDownloadInProgress) {
      bulkRetryPagesOverride = null;
      updateBulkSummary(isCgamoPage() ? getCgamoEffectiveTotalPages(getTotalPageCount()) : (getTotalPageCount() || null));
    }
  }

  function showBulkConfirm() {
    var confirmBox = document.getElementById(CONFIRM_BOX_ID);
    if (confirmBox) {
      confirmBox.style.display = 'block';
    }
    var totalPages = isCgamoPage() ? getCgamoEffectiveTotalPages(getTotalPageCount()) : getTotalPageCount();
    var startInput = document.getElementById(RANGE_START_ID);
    var endInput = document.getElementById(RANGE_END_ID);
    var modeZip = document.getElementById(MODE_ZIP_ID);
    var modeFiles = document.getElementById(MODE_FILES_ID);
    var skipExisting = document.getElementById(SKIP_EXISTING_ID);
    var settings = loadBulkSettings();
    if (modeZip) modeZip.checked = settings.mode !== 'files';
    if (modeFiles) modeFiles.checked = settings.mode === 'files';
    if (skipExisting) skipExisting.checked = !!settings.skipExisting;
    if (startInput) {
      startInput.value = settings.start || '1';
      if (!startInput.value) startInput.value = '1';
    }
    if (endInput) {
      endInput.value = settings.end || '';
      if (!endInput.value && totalPages) {
        endInput.value = String(totalPages);
      }
    }
    setRangeInputsEnabled();
    saveBulkSettings();
    updateBulkSummary(totalPages);
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function getRequestedBulkRange(totalPages) {
    var startInput = document.getElementById(RANGE_START_ID);
    var endInput = document.getElementById(RANGE_END_ID);
    var startPage = startInput ? parseInt(String(startInput.value || '').trim(), 10) : 1;
    var endPage = endInput ? parseInt(String(endInput.value || '').trim(), 10) : totalPages;

    if (!startPage || startPage < 1) {
      startPage = 1;
    }
    if (!endPage || endPage < 1) {
      endPage = totalPages;
    }
    if (totalPages && endPage > totalPages) {
      endPage = totalPages;
    }
    if (totalPages && startPage > totalPages) {
      startPage = totalPages;
    }
    if (startPage > endPage) {
      return null;
    }

    return {
      start: startPage,
      end: endPage
    };
  }

  function getCgamoEffectiveTotalPages(totalPages) {
    if (!isCgamoPage() || (totalPages && totalPages > 0)) {
      return totalPages;
    }

    var endInput = document.getElementById(RANGE_END_ID);
    var endPage = endInput ? parseInt(String(endInput.value || '').trim(), 10) : 0;
    if (endPage && endPage > 0) {
      return endPage;
    }

    return getCurrentCgamoSerial() || 1;
  }

  function buildPageSequence(range) {
    var pages = [];
    for (var page = range.start; page <= range.end; page += 1) {
      pages.push(page);
    }
    return pages;
  }

  function filterPagesToDownload(pages) {
    if (!getSkipExistingEnabled()) {
      return pages.slice();
    }
    return pages.filter(function (page) {
      return !isPageMarkedDownloaded(page);
    });
  }

  function retryLastBulkErrors() {
    if (!lastBulkErrors.length || bulkDownloadInProgress || downloadInProgress) {
      return;
    }
    var uniquePages = Array.from(new Set(lastBulkErrors)).sort(function (a, b) { return a - b; });
    bulkRetryPagesOverride = uniquePages;
    showBulkConfirm();
    setStatus('Повторно будут скачаны только страницы с ошибками: ' + uniquePages.join(', '));
  }

  function findPagerState() {
    if (isYandexArchivePage()) {
      function findYandexInputNode() {
        var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
        var bestInput = null;
        var bestScore = -1;

        inputs.forEach(function (input) {
          var value = String(input.value || '').trim();
          if (!/^\d{1,5}$/.test(value)) {
            return;
          }

          var rect = input.getBoundingClientRect();
          if (rect.width < 20 || rect.width > 120 || rect.height < 20 || rect.height > 80) {
            return;
          }

          var contextText = '';
          if (input.parentElement) {
            contextText += ' ' + String(input.parentElement.textContent || '');
          }
          if (input.parentElement && input.parentElement.parentElement) {
            contextText += ' ' + String(input.parentElement.parentElement.textContent || '');
          }
          if (!/\/\s*\d{1,5}/.test(contextText) && !/ShortPagination/i.test(input.className || '')) {
            return;
          }

          var score = 0;
          if (/ShortPagination/i.test(input.className || '')) {
            score += 2000;
          }
          score += 1000 - Math.min(rect.top, 1000);
          score += 500 - Math.min(Math.abs(((window.innerWidth || 0) / 2) - (rect.left + rect.width / 2)), 500);

          if (score > bestScore) {
            bestScore = score;
            bestInput = input;
          }
        });

        return bestInput;
      }

      function findYandexTotal() {
        var shortNodes = Array.prototype.slice.call(document.querySelectorAll('[class*="ShortPagination"], [class*="Pagination"]'));
        for (var i = 0; i < shortNodes.length; i += 1) {
          var text = String(shortNodes[i].textContent || '').replace(/\s+/g, ' ').trim();
          var match = text.match(/(\d{1,5})\s*\/\s*(\d{1,5})/);
          if (match) {
            return parseInt(match[2], 10);
          }
        }

        var pageText = String(document.body ? document.body.innerText || '' : '');
        var bodyMatch = pageText.match(/(\d{1,5})\s*\/\s*(\d{1,5})/);
        if (bodyMatch) {
          return parseInt(bodyMatch[2], 10);
        }

        return null;
      }

      var yandexInput = findYandexInputNode();
      var yandexCurrent = null;
      if (yandexInput) {
        var inputValue = String(yandexInput.value || '').trim();
        if (/^\d{1,5}$/.test(inputValue)) {
          yandexCurrent = parseInt(inputValue, 10);
        }
      }
      if (!yandexCurrent) {
        var urlMatch = normalizePageUrl(window.location.href).match(/\/(\d+)\/?$/);
        if (urlMatch) {
          yandexCurrent = parseInt(urlMatch[1], 10);
        }
      }

      var yandexTotal = findYandexTotal();
      if (yandexTotal && yandexInput) {
        return {
          current: yandexCurrent,
          total: yandexTotal,
          inputNode: yandexInput
        };
      }
    }

    function findInputNode() {
      var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
      var bestInput = null;
      var bestScore = -1;

      inputs.forEach(function (input) {
        var value = String(input.value || '').trim();
        if (!/^\d{1,5}$/.test(value)) {
          return;
        }

        var rect = input.getBoundingClientRect();
        if (rect.width < 20 || rect.width > 160 || rect.height < 20 || rect.height > 80) {
          return;
        }
        if (rect.top < 0 || rect.left < 0) {
          return;
        }

        var score = 0;
        score += 1000 - Math.min(rect.top, 1000);
        score += 500 - Math.min(Math.abs(((window.innerWidth || 0) / 2) - (rect.left + rect.width / 2)), 500);
        if (input.parentElement && /\/\s*\d{1,5}/.test(String(input.parentElement.textContent || ''))) {
          score += 1000;
        }

        if (score > bestScore) {
          bestScore = score;
          bestInput = input;
        }
      });

      return bestInput;
    }

    var classTotal = getTotalPageCount();
    var inputNode = findInputNode();
    if (classTotal && inputNode) {
      return {
        current: null,
        total: classTotal,
        inputNode: inputNode
      };
    }

    return null;
  }

  function getCurrentPageNumber() {
    var pager = findPagerState();
    if (pager && pager.inputNode) {
      var value = String(pager.inputNode.value || '').trim();
      if (/^\d{1,5}$/.test(value)) {
        return parseInt(value, 10);
      }
    }
    return pager ? pager.current : null;
  }

  function getTotalPageCount() {
    if (isCgamoPage()) {
      var slideSearchText = document.querySelector('.slide_search_text');
      if (slideSearchText) {
        var slideText = String(slideSearchText.textContent || '').replace(/\s+/g, ' ').trim();
        var slideMatch = slideText.match(/из\s*(\d{1,5})/i);
        if (slideMatch) {
          return parseInt(slideMatch[1], 10);
        }
      }

      var tfPage = document.getElementById('tfPage');
      if (tfPage) {
        var tfContext = '';
        if (tfPage.parentElement) {
          tfContext += ' ' + String(tfPage.parentElement.textContent || '');
        }
        if (tfPage.parentElement && tfPage.parentElement.parentElement) {
          tfContext += ' ' + String(tfPage.parentElement.parentElement.textContent || '');
        }
        tfContext = tfContext.replace(/\s+/g, ' ').trim();
        var tfMatch = tfContext.match(/из\s*(\d{1,5})/i);
        if (tfMatch) {
          return parseInt(tfMatch[1], 10);
        }
      }

      var cgamoText = String(document.body ? document.body.innerText || document.body.textContent || '' : '').replace(/\s+/g, ' ').trim();
      var cgamoPair = cgamoText.match(/(?:^|\D)(\d{1,5})\s*\/\s*(\d{1,5})(?:\D|$)/);
      if (cgamoPair) {
        return parseInt(cgamoPair[2], 10);
      }
      var cgamoOfPair = cgamoText.match(/(?:^|\D)(\d{1,5})\s*(?:из|of)\s*(\d{1,5})(?:\D|$)/i);
      if (cgamoOfPair) {
        return parseInt(cgamoOfPair[2], 10);
      }

      var serialLinks = Array.prototype.slice.call(document.querySelectorAll('a[href*="serial="], option[value], [data-serial]'));
      var maxSerial = 0;
      serialLinks.forEach(function (node) {
        if (node.getAttribute) {
          var href = node.getAttribute('href') || '';
          var hrefMatch = href.match(/[?&]serial=(\d{1,5})/i);
          if (hrefMatch) {
            maxSerial = Math.max(maxSerial, parseInt(hrefMatch[1], 10));
          }

          var value = String(node.getAttribute('value') || '').trim();
          if (/^\d{1,5}$/.test(value)) {
            maxSerial = Math.max(maxSerial, parseInt(value, 10));
          }

          var dataSerial = String(node.getAttribute('data-serial') || '').trim();
          if (/^\d{1,5}$/.test(dataSerial)) {
            maxSerial = Math.max(maxSerial, parseInt(dataSerial, 10));
          }
        }
        var text = String(node.textContent || '').trim();
        if (/^\d{1,5}$/.test(text)) {
          maxSerial = Math.max(maxSerial, parseInt(text, 10));
        }
      });
      if (maxSerial > 0) {
        return maxSerial;
      }

      return null;
    }

    if (isYandexArchivePage()) {
      var shortNodes = Array.prototype.slice.call(document.querySelectorAll('[class*="ShortPagination"], [class*="Pagination"]'));
      for (var i = 0; i < shortNodes.length; i += 1) {
        var text = String(shortNodes[i].textContent || '').replace(/\s+/g, ' ').trim();
        var match = text.match(/(\d{1,5})\s*\/\s*(\d{1,5})/);
        if (match) {
          return parseInt(match[2], 10);
        }
      }

      var bodyText = String(document.body ? document.body.innerText || '' : '').replace(/\s+/g, ' ').trim();
      var bodyMatch = bodyText.match(/(\d{1,5})\s*\/\s*(\d{1,5})/);
      if (bodyMatch) {
        return parseInt(bodyMatch[2], 10);
      }

      return null;
    }

    var countNode = document.querySelector('.inventory-count-picture.ref-count-picture, .inventory-count-picture, .ref-count-picture');
    if (countNode) {
      var countText = String(countNode.textContent || '').replace(/\s+/g, ' ').trim();
      var countMatch = countText.match(/(\d{1,5})/);
      if (countMatch) {
        return parseInt(countMatch[1], 10);
      }
    }

    var pager = findPagerState();
    return pager ? pager.total : null;
  }

  function goToPage(pageNumber) {
    var pager = findPagerState();
    if (!pager || !pager.inputNode) {
      return false;
    }

    var input = pager.inputNode;
    input.focus();
    input.value = String(pageNumber);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      bubbles: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13
    }));
    input.blur();
    return true;
  }

  function waitForInputValue(targetPage, timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    return new Promise(function (resolve) {
      var startedAt = Date.now();
      function check() {
        var current = getCurrentPageNumber();
        if (current === targetPage) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }
        window.setTimeout(check, 250);
      }
      check();
    });
  }

  function resolveDownloadResult() {
    var result = extractBestImageFromPage();

    if (isCgamoPage()) {
      var cgamoImage = result && result.url && /\/srv2\/private\/imageViewer\/image\?/i.test(result.url) ? result.url : null;
      if (!cgamoImage) {
        var html = document.documentElement ? document.documentElement.outerHTML : '';
        var match = html.match(/https?:\\?\/\\?\/[^"'<>\\\s]*\/srv2\/private\/imageViewer\/image\?[^"'<>\\\s]*/i) ||
          html.match(/(["'])(\/[^"'<>\\\s]*\/srv2\/private\/imageViewer\/image\?[^"'<>\\\s]*)\1/i);
        if (match) {
          cgamoImage = toAbsoluteUrl(match[2] || match[0]);
        }
      }
      if (cgamoImage) {
        result = {
          url: cgamoImage,
          kind: 'cgamo-image-viewer',
          debug: result.debug
        };
      }
    }

    if (isCgamosPage()) {
      var renderedImage = extractCgamosRenderedImage();
      if (renderedImage) {
        result = {
          url: renderedImage,
          kind: 'cgamos-rendered',
          debug: result.debug
        };
      }
    }

    return result;
  }

  function triggerBrowserDownload(url, filename) {
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function triggerBlobDownload(blob, filename) {
    var objectUrl = URL.createObjectURL(blob);
    try {
      triggerBrowserDownload(objectUrl, filename);
    } finally {
      window.setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 5000);
    }
  }

  function downloadTextFile(filename, text) {
    triggerBlobDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
  }

  function startDownload() {
    if (downloadInProgress || bulkDownloadInProgress) {
      setStatus('Скачивание уже запущено, подождите...');
      return;
    }

    downloadInProgress = true;
    setPanelBusyState(true);

    var result = resolveDownloadResult();

    if (!result.url) {
      setStatus(
        'Не найдено. img: ' + result.debug.imageCount +
        ', canvases: ' + result.debug.canvasCount +
        ', backgrounds: ' + result.debug.backgroundCount +
        ', anchors: ' + result.debug.anchorCount +
        ', script hits: ' + result.debug.scriptHits,
        true
      );
      console.log('Raw hits', result.debug.rawHits);
      downloadInProgress = false;
      setPanelBusyState(false);
      return;
    }

    setStatus('Скачиваю...');
    try {
      setStatus('Выбран URL: ' + result.url.slice(0, 120));
      triggerBrowserDownload(result.url, buildFilename(window.location.href, result.url));
      setStatus('Скачивание запущено');
    } catch (e) {
      setStatus('Ошибка: ' + (e && e.message ? e.message : String(e)), true);
    } finally {
      window.setTimeout(function () {
        downloadInProgress = false;
        setPanelBusyState(false);
      }, 1500);
    }
  }

  async function startBulkDownloadConfirmed() {
    if (!isCgamosPage() && !isYandexArchivePage()) {
      hideBulkConfirm();
      setStatus('Массовое скачивание пока доступно только для ЦГА Москвы и Яндекс.Архива.', true);
      return;
    }

    if (downloadInProgress || bulkDownloadInProgress) {
      hideBulkConfirm();
      setStatus('Скачивание уже запущено, подождите...');
      return;
    }

    var totalPages = getCgamoEffectiveTotalPages(getTotalPageCount());
    if (!totalPages || totalPages < 1) {
      hideBulkConfirm();
      setStatus('Не удалось определить количество сканов.', true);
      return;
    }

    var requestedRange = getRequestedBulkRange(totalPages);
    if (!requestedRange) {
      hideBulkConfirm();
      setStatus('Неверно задан диапазон скачивания.', true);
      window.setTimeout(function () {
        if (!bulkDownloadInProgress && !downloadInProgress) {
          setStatus('Готово');
          setProgress('');
          setProgressBar(0);
        }
      }, 3000);
      return;
    }

    bulkDownloadInProgress = true;
    bulkCancelRequested = false;
    hideBulkConfirm();
    setPanelBusyState(true);
    setCancelButtonVisible(true);
    setProgressBarVisible(true);

    try {
      var entries = [];
      var errors = [];
      var modeFiles = document.getElementById(MODE_FILES_ID);
      var saveAsFiles = !!(modeFiles && modeFiles.checked);
      var startedAt = Date.now();
      var totalItems = requestedRange.end - requestedRange.start + 1;
      updateProgress(0, totalItems, startedAt);
      saveBulkSettings();

      if (isYandexArchivePage()) {
        for (var yPage = requestedRange.start; yPage <= requestedRange.end; yPage += 1) {
          if (bulkCancelRequested) {
            throw new Error('Процесс прерван пользователем.');
          }
          setStatus('Загружаю страницу ' + yPage + ' из диапазона ' + requestedRange.start + '-' + requestedRange.end + '...');
          try {
            var yandexResult = await fetchYandexPageImage(yPage);
            if (bulkCancelRequested) {
              throw new Error('Процесс прерван пользователем.');
            }
            var yandexName = buildFilenameForSpecificPage(yPage, yandexResult.pageUrl, yandexResult.imageUrl);
            var yandexData = await getBytesFromUrl(yandexResult.imageUrl);
            if (saveAsFiles) {
              triggerBlobDownload(new Blob([yandexData], { type: 'image/jpeg' }), yandexName);
            } else {
              entries.push({
                name: yandexName,
                data: yandexData
              });
            }
            setStatus('Подготовлен скан ' + yPage + ' из диапазона ' + requestedRange.start + '-' + requestedRange.end + '.');
          } catch (pageError) {
            if (/прерван пользователем/i.test(String(pageError && pageError.message ? pageError.message : pageError))) {
              throw pageError;
            }
            errors.push('Страница ' + yPage + ': ' + (pageError && pageError.message ? pageError.message : String(pageError)));
            setStatus('Ошибка на странице ' + yPage + ', продолжаю...');
          }
          updateProgress(yPage - requestedRange.start + 1, totalItems, startedAt);
          await wait(600);
        }

        if (bulkCancelRequested) {
          throw new Error('Процесс прерван пользователем.');
        }
        if (saveAsFiles) {
          if (errors.length) {
            downloadTextFile('errors.txt', errors.join('\r\n'));
            setStatus('Скачивание отдельных файлов завершено с ошибками. Список сохранён в errors.txt');
          } else {
            setStatus('Скачивание отдельных файлов завершено.');
          }
          setProgress('Готово');
          return;
        }
        if (!entries.length) {
          throw new Error('Не удалось подготовить ни одного файла для ZIP.');
        }
        if (errors.length) {
          entries.push({
            name: 'errors.txt',
            data: encodeUtf8(errors.join('\r\n'))
          });
        }
        setStatus('Собираю ZIP...');
        var yandexZipBlob = createStoredZip(entries);
        triggerBlobDownload(yandexZipBlob, buildBulkZipFilename(requestedRange));
        setStatus(errors.length ? 'ZIP подготовлен с errors.txt' : 'ZIP со всеми сканами подготовлен.');
        setProgress('Готово');
        return;
      }

      setStatus('Перехожу к скану ' + requestedRange.start + '...');
      if (!goToPage(requestedRange.start)) {
        throw new Error('Не удалось управлять пагинатором.');
      }
      await waitForInputValue(requestedRange.start, 5000);
      await wait(3500);

      for (var page = requestedRange.start; page <= requestedRange.end; page += 1) {
        if (bulkCancelRequested) {
          throw new Error('Процесс прерван пользователем.');
        }
        if (page > requestedRange.start) {
          setStatus('Перехожу к скану ' + page + ' из диапазона ' + requestedRange.start + '-' + requestedRange.end + '...');
          if (!goToPage(page)) {
            throw new Error('Не удалось перейти к скану ' + page + '.');
          }
          await waitForInputValue(page, 5000);
          await wait(2500);
        }

        try {
          var entry = await getStableCgamosEntry(page);
          if (saveAsFiles) {
            triggerBlobDownload(new Blob([entry.data], { type: 'image/jpeg' }), entry.name);
          } else {
            entries.push(entry);
          }
          setStatus('Подготовлен скан ' + page + ' из диапазона ' + requestedRange.start + '-' + requestedRange.end + '.');
        } catch (pageEntryError) {
          if (/прерван пользователем/i.test(String(pageEntryError && pageEntryError.message ? pageEntryError.message : pageEntryError))) {
            throw pageEntryError;
          }
          errors.push('Страница ' + page + ': ' + (pageEntryError && pageEntryError.message ? pageEntryError.message : String(pageEntryError)));
          setStatus('Ошибка на странице ' + page + ', продолжаю...');
        }
        updateProgress(page - requestedRange.start + 1, totalItems, startedAt);
        await wait(1100);
      }

      if (bulkCancelRequested) {
        throw new Error('Процесс прерван пользователем.');
      }
      if (saveAsFiles) {
        if (errors.length) {
          downloadTextFile('errors.txt', errors.join('\r\n'));
          setStatus('Скачивание отдельных файлов завершено с ошибками. Список сохранён в errors.txt');
        } else {
          setStatus('Скачивание отдельных файлов завершено.');
        }
        setProgress('Готово');
        return;
      }
      if (!entries.length) {
        if (errors.length) {
          throw new Error('Не удалось подготовить ни одного файла для ZIP. Первая ошибка: ' + errors[0]);
        }
        throw new Error('Не удалось подготовить ни одного файла для ZIP.');
      }
      if (errors.length) {
        entries.push({
          name: 'errors.txt',
          data: encodeUtf8(errors.join('\r\n'))
        });
      }
      setStatus('Собираю ZIP...');
      var zipBlob = createStoredZip(entries);
      triggerBlobDownload(zipBlob, buildBulkZipFilename(requestedRange));
      setStatus(errors.length ? 'ZIP подготовлен с errors.txt' : 'ZIP со всеми сканами подготовлен.');
      setProgress('Готово');
    } catch (e) {
      var message = e && e.message ? e.message : String(e);
      if (/прерван пользователем/i.test(message)) {
        setStatus('Процесс прерван.');
        setProgress('Остановлено');
        setProgressBarVisible(false);
        window.setTimeout(function () {
          if (!bulkDownloadInProgress && !downloadInProgress) {
            setStatus('Готово');
            setProgress('');
            setProgressBar(0);
          }
        }, 3000);
      } else {
        setStatus('Ошибка: ' + message, true);
        setProgress('Ошибка');
      }
    } finally {
      bulkDownloadInProgress = false;
      bulkCancelRequested = false;
      setPanelBusyState(false);
      setCancelButtonVisible(false);
    }
  }

  async function startBulkDownloadConfirmedV2() {
    if (!isCgamosPage() && !isYandexArchivePage() && !isCgamoPage()) {
      hideBulkConfirm();
      setStatus('Массовое скачивание пока доступно только для ЦГА Москвы, ЦГА Московской области и Яндекс.Архива.', true);
      return;
    }

    if (downloadInProgress || bulkDownloadInProgress) {
      hideBulkConfirm();
      setStatus('Скачивание уже запущено, подождите...');
      return;
    }

    var totalPages = getCgamoEffectiveTotalPages(getTotalPageCount());
    if (!totalPages || totalPages < 1) {
      hideBulkConfirm();
      setStatus('Не удалось определить количество сканов.', true);
      return;
    }

    var requestedRange = getRequestedBulkRange(totalPages);
    if (!requestedRange) {
      hideBulkConfirm();
      setStatus('Неверно задан диапазон скачивания.', true);
      window.setTimeout(function () {
        if (!bulkDownloadInProgress && !downloadInProgress) {
          setStatus('Готово');
          setProgress('');
          setProgressBar(0);
        }
      }, 3000);
      return;
    }

    var allPages = bulkRetryPagesOverride && bulkRetryPagesOverride.length ? bulkRetryPagesOverride.slice() : buildPageSequence(requestedRange);
    var pagesToDownload = filterPagesToDownload(allPages);
    if (!pagesToDownload.length) {
      hideBulkConfirm();
      setStatus('В выбранном диапазоне уже нет новых страниц для скачивания.');
      setProgress('Готово');
      setProgressBar(1);
      return;
    }

    bulkDownloadInProgress = true;
    bulkCancelRequested = false;
    bulkPaused = false;
    lastBulkErrors = [];
    lastBulkRange = requestedRange;
    hideBulkConfirm();
    setPanelBusyState(true);
    setCancelButtonVisible(true);
    setPauseButtonState();
    setRetryErrorsButtonVisible(false);
    setProgressBarVisible(true);

    try {
      var entries = [];
      var errors = [];
      var failedPages = [];
      var saveAsFiles = getSelectedBulkMode() === 'files';
      var startedAt = Date.now();
      var detectedTotalPages = getTotalPageCount();
      var totalItems = pagesToDownload.length;
      var preparedCount = 0;
      updateProgress(0, totalItems, startedAt);
      saveBulkSettings();

      if (isCgamoPage()) {
        await startCgamoNavigatingBulkJob(requestedRange, pagesToDownload, detectedTotalPages || 'не определено', saveAsFiles);
        return;
      } else if (isYandexArchivePage()) {
        for (var yIndex = 0; yIndex < pagesToDownload.length; yIndex += 1) {
          var yPage = pagesToDownload[yIndex];
          if (bulkCancelRequested) {
            throw new Error('Процесс прерван пользователем.');
          }
          await waitWhilePaused();
          setStatus('Загружаю страницу ' + yPage + ' из диапазона ' + requestedRange.start + '-' + requestedRange.end + '...');
          try {
            var yandexResult = await fetchYandexPageImage(yPage);
            if (bulkCancelRequested) {
              throw new Error('Процесс прерван пользователем.');
            }
            var yandexName = buildFilenameForSpecificPage(yPage, yandexResult.pageUrl, yandexResult.imageUrl);
            var yandexData = await getValidatedYandexBytes(yandexResult.imageUrl, yPage);
            if (saveAsFiles) {
              triggerBlobDownload(new Blob([yandexData], { type: 'image/jpeg' }), yandexName);
            } else {
              entries.push({ name: yandexName, data: yandexData });
            }
            markPageDownloaded(yPage, yandexName);
            preparedCount += 1;
            setStatus('Подготовлен скан ' + yPage + ' из диапазона ' + requestedRange.start + '-' + requestedRange.end + '.');
          } catch (pageError) {
            if (/прерван пользователем/i.test(String(pageError && pageError.message ? pageError.message : pageError))) {
              throw pageError;
            }
            failedPages.push(yPage);
            errors.push('Страница ' + yPage + ': ' + (pageError && pageError.message ? pageError.message : String(pageError)));
            setStatus('Ошибка на странице ' + yPage + ', продолжаю...');
          }
          updateProgress(yIndex + 1, totalItems, startedAt);
          await waitWhilePaused();
          await wait(600);
        }
      } else {
        setStatus('Перехожу к скану ' + pagesToDownload[0] + '...');
        if (!goToPage(pagesToDownload[0])) {
          throw new Error('Не удалось управлять пагинатором.');
        }
        await waitForInputValue(pagesToDownload[0], 5000);
        await wait(3500);

        for (var index = 0; index < pagesToDownload.length; index += 1) {
          var page = pagesToDownload[index];
          if (bulkCancelRequested) {
            throw new Error('Процесс прерван пользователем.');
          }
          await waitWhilePaused();
          if (index > 0) {
            setStatus('Перехожу к скану ' + page + ' из диапазона ' + requestedRange.start + '-' + requestedRange.end + '...');
            if (!goToPage(page)) {
              throw new Error('Не удалось перейти к скану ' + page + '.');
            }
            await waitForInputValue(page, 5000);
            await wait(2500);
          }

          try {
            var entry = await getStableCgamosEntry(page);
            if (saveAsFiles) {
              triggerBlobDownload(new Blob([entry.data], { type: 'image/jpeg' }), entry.name);
            } else {
              entries.push(entry);
            }
            markPageDownloaded(page, entry.name);
            preparedCount += 1;
            setStatus('Подготовлен скан ' + page + ' из диапазона ' + requestedRange.start + '-' + requestedRange.end + '.');
          } catch (pageEntryError) {
            if (/прерван пользователем/i.test(String(pageEntryError && pageEntryError.message ? pageEntryError.message : pageEntryError))) {
              throw pageEntryError;
            }
            failedPages.push(page);
            errors.push('Страница ' + page + ': ' + (pageEntryError && pageEntryError.message ? pageEntryError.message : String(pageEntryError)));
            setStatus('Ошибка на странице ' + page + ', продолжаю...');
          }
          updateProgress(index + 1, totalItems, startedAt);
          await waitWhilePaused();
          await wait(1100);
        }
      }

      if (bulkCancelRequested) {
        throw new Error('Процесс прерван пользователем.');
      }

      lastBulkErrors = failedPages.slice();
      setRetryErrorsButtonVisible(!!lastBulkErrors.length);

      if (saveAsFiles) {
        if (errors.length) {
          downloadTextFile('errors.txt', errors.join('\r\n'));
          setStatus('Скачивание отдельных файлов завершено с ошибками. Список сохранён в errors.txt');
        } else {
          setStatus('Скачивание отдельных файлов завершено.');
        }
        setProgress('Готово');
        setProgressBar(1);
        return;
      }

      if (!entries.length) {
        if (errors.length) {
          throw new Error('Не удалось подготовить ни одного файла для ZIP. Первая ошибка: ' + errors[0]);
        }
        throw new Error('Не удалось подготовить ни одного файла для ZIP.');
      }

      entries.push({
        name: 'info.txt',
        data: encodeUtf8(buildInfoText(requestedRange, totalPages, preparedCount, errors))
      });

      if (errors.length) {
        entries.push({
          name: 'errors.txt',
          data: encodeUtf8(errors.join('\r\n'))
        });
      }

      setStatus('Собираю ZIP...');
      var zipBlob = createStoredZip(entries);
      triggerBlobDownload(zipBlob, buildBulkZipFilename(requestedRange));
      setStatus(errors.length ? 'ZIP подготовлен с errors.txt' : 'ZIP со всеми сканами подготовлен.');
      setProgress('Готово');
      setProgressBar(1);
    } catch (e) {
      var message = e && e.message ? e.message : String(e);
      if (/прерван пользователем/i.test(message)) {
        setStatus('Процесс прерван.');
        setProgress('Остановлено');
        setProgressBarVisible(false);
        window.setTimeout(function () {
          if (!bulkDownloadInProgress && !downloadInProgress) {
            setStatus('Готово');
            setProgress('');
          }
        }, 3000);
      } else {
        setStatus('Ошибка: ' + message, true);
        setProgress('Ошибка');
      }
    } finally {
      bulkRetryPagesOverride = null;
      bulkDownloadInProgress = false;
      bulkCancelRequested = false;
      bulkPaused = false;
      releasePauseWaiters();
      setPanelBusyState(false);
      setCancelButtonVisible(false);
      setPauseButtonState();
    }
  }

  function ensurePanel() {
    var existingPanel = document.getElementById(PANEL_ID);
    if (!document.body) {
      return;
    }
    if (!shouldShowPanel()) {
      if (existingPanel && existingPanel.parentNode) {
        existingPanel.parentNode.removeChild(existingPanel);
      }
      return;
    }
    if (existingPanel) {
      return;
    }

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.position = 'fixed';
    panel.style.top = '16px';
    panel.style.right = '16px';
    panel.style.zIndex = '2147483647';
    panel.style.background = '#ffffff';
    panel.style.border = '2px solid #991b1b';
    panel.style.borderRadius = '12px';
    panel.style.padding = '12px';
    panel.style.boxShadow = '0 10px 24px rgba(0,0,0,0.18)';
    panel.style.fontFamily = 'Arial, sans-serif';
    panel.style.minWidth = '220px';

    var button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Скачать скан';
    button.style.display = 'block';
    button.style.width = '100%';
    button.style.padding = '10px 12px';
    button.style.border = '0';
    button.style.borderRadius = '8px';
    button.style.background = '#dc2626';
    button.style.color = '#ffffff';
    button.style.cursor = 'pointer';
    button.style.fontSize = '14px';
    button.style.fontWeight = '700';
    button.addEventListener('click', startDownload);

    var bulkButton = document.createElement('button');
    bulkButton.id = BULK_BUTTON_ID;
    bulkButton.type = 'button';
    bulkButton.textContent = 'Скачать всё дело';
    bulkButton.style.display = (isCgamosPage() || isYandexArchivePage() || isCgamoPage()) ? 'block' : 'none';
    bulkButton.style.width = '100%';
    bulkButton.style.marginTop = '8px';
    bulkButton.style.padding = '10px 12px';
    bulkButton.style.border = '1px solid #991b1b';
    bulkButton.style.borderRadius = '8px';
    bulkButton.style.background = '#fff5f5';
    bulkButton.style.color = '#991b1b';
    bulkButton.style.cursor = 'pointer';
    bulkButton.style.fontSize = '14px';
    bulkButton.style.fontWeight = '700';
    bulkButton.addEventListener('click', showBulkConfirm);

    var cancelButton = document.createElement('button');
    cancelButton.id = CANCEL_BUTTON_ID;
    cancelButton.type = 'button';
    cancelButton.textContent = 'Прервать';
    cancelButton.style.display = 'none';
    cancelButton.style.width = '100%';
    cancelButton.style.marginTop = '8px';
    cancelButton.style.padding = '10px 12px';
    cancelButton.style.border = '1px solid #9ca3af';
    cancelButton.style.borderRadius = '8px';
    cancelButton.style.background = '#ffffff';
    cancelButton.style.color = '#111827';
    cancelButton.style.cursor = 'pointer';
    cancelButton.style.fontSize = '14px';
    cancelButton.style.fontWeight = '700';
    cancelButton.addEventListener('click', function () {
      bulkCancelRequested = true;
      if (isCgamoPage() && getCgamoBulkJob()) {
        clearCgamoBulkJob();
      }
      setStatus('Останавливаю процесс...');
      setProgress('Останавливаю...');
    });

    var pauseButton = document.createElement('button');
    pauseButton.id = PAUSE_BUTTON_ID;
    pauseButton.type = 'button';
    pauseButton.textContent = 'Пауза';
    pauseButton.style.display = 'none';
    pauseButton.style.width = '100%';
    pauseButton.style.marginTop = '8px';
    pauseButton.style.padding = '10px 12px';
    pauseButton.style.border = '1px solid #9ca3af';
    pauseButton.style.borderRadius = '8px';
    pauseButton.style.background = '#ffffff';
    pauseButton.style.color = '#111827';
    pauseButton.style.cursor = 'pointer';
    pauseButton.style.fontSize = '14px';
    pauseButton.style.fontWeight = '700';
    pauseButton.addEventListener('click', function () {
      if (!bulkDownloadInProgress) {
        return;
      }
      bulkPaused = !bulkPaused;
      if (bulkPaused) {
        setStatus('Процесс поставлен на паузу.');
        setProgress('Пауза');
      } else {
        releasePauseWaiters();
        setStatus('Продолжаю скачивание...');
      }
      setPauseButtonState();
    });

    var retryErrorsButton = document.createElement('button');
    retryErrorsButton.id = RETRY_ERRORS_BUTTON_ID;
    retryErrorsButton.type = 'button';
    retryErrorsButton.textContent = 'Повторить ошибки';
    retryErrorsButton.style.display = 'none';
    retryErrorsButton.style.width = '100%';
    retryErrorsButton.style.marginTop = '8px';
    retryErrorsButton.style.padding = '10px 12px';
    retryErrorsButton.style.border = '1px solid #991b1b';
    retryErrorsButton.style.borderRadius = '8px';
    retryErrorsButton.style.background = '#fff5f5';
    retryErrorsButton.style.color = '#991b1b';
    retryErrorsButton.style.cursor = 'pointer';
    retryErrorsButton.style.fontSize = '14px';
    retryErrorsButton.style.fontWeight = '700';
    retryErrorsButton.addEventListener('click', retryLastBulkErrors);

    var resetMarksButton = document.createElement('button');
    resetMarksButton.id = RESET_MARKS_BUTTON_ID;
    resetMarksButton.type = 'button';
    resetMarksButton.textContent = 'Сбросить отметки скачанного';
    resetMarksButton.style.display = 'block';
    resetMarksButton.style.width = '100%';
    resetMarksButton.style.marginTop = '8px';
    resetMarksButton.style.padding = '10px 12px';
    resetMarksButton.style.border = '1px solid #d1d5db';
    resetMarksButton.style.borderRadius = '8px';
    resetMarksButton.style.background = '#ffffff';
    resetMarksButton.style.color = '#111827';
    resetMarksButton.style.cursor = 'pointer';
    resetMarksButton.style.fontSize = '13px';
    resetMarksButton.style.fontWeight = '700';
    resetMarksButton.addEventListener('click', resetDownloadedMarks);

    var confirmBox = document.createElement('div');
    confirmBox.id = CONFIRM_BOX_ID;
    confirmBox.style.display = 'none';
    confirmBox.style.marginTop = '8px';
    confirmBox.style.padding = '10px';
    confirmBox.style.border = '1px solid #fecaca';
    confirmBox.style.borderRadius = '8px';
    confirmBox.style.background = '#fff1f2';

    var modeRow = document.createElement('div');
    modeRow.style.display = 'flex';
    modeRow.style.gap = '10px';
    modeRow.style.marginTop = '4px';
    modeRow.style.justifyContent = 'center';

    var modeZipLabel = document.createElement('label');
    modeZipLabel.style.fontSize = '12px';
    modeZipLabel.style.color = '#111827';
    var modeZipInput = document.createElement('input');
    modeZipInput.id = MODE_ZIP_ID;
    modeZipInput.type = 'radio';
    modeZipInput.name = 'ya-archive-bulk-mode';
    modeZipInput.checked = true;
    modeZipInput.addEventListener('change', saveBulkSettings);
    modeZipLabel.appendChild(modeZipInput);
    modeZipLabel.appendChild(document.createTextNode(' Одним ZIPом'));

    var modeFilesLabel = document.createElement('label');
    modeFilesLabel.style.fontSize = '12px';
    modeFilesLabel.style.color = '#111827';
    var modeFilesInput = document.createElement('input');
    modeFilesInput.id = MODE_FILES_ID;
    modeFilesInput.type = 'radio';
    modeFilesInput.name = 'ya-archive-bulk-mode';
    modeFilesInput.addEventListener('change', saveBulkSettings);
    modeFilesLabel.appendChild(modeFilesInput);
    modeFilesLabel.appendChild(document.createTextNode(' Отдельными файлами JPG'));

    modeRow.appendChild(modeZipLabel);
    modeRow.appendChild(modeFilesLabel);

    var skipRow = document.createElement('label');
    skipRow.style.display = 'block';
    skipRow.style.marginTop = '8px';
    skipRow.style.fontSize = '12px';
    skipRow.style.color = '#111827';

    var skipInput = document.createElement('input');
    skipInput.id = SKIP_EXISTING_ID;
    skipInput.type = 'checkbox';
    skipInput.style.marginRight = '6px';
    skipInput.addEventListener('change', saveBulkSettings);
    skipRow.appendChild(skipInput);
    skipRow.appendChild(document.createTextNode(' Пропускать уже скачанные страницы'));

    var rangeRow = document.createElement('div');
    rangeRow.style.display = 'grid';
    rangeRow.style.gridTemplateColumns = '20px 1fr 28px 1fr';
    rangeRow.style.gap = '8px';
    rangeRow.style.alignItems = 'center';
    rangeRow.style.marginTop = '8px';

    var startLabel = document.createElement('div');
    startLabel.textContent = 'С';
    startLabel.style.textAlign = 'left';
    startLabel.style.fontSize = '13px';
    startLabel.style.fontWeight = '700';
    startLabel.style.color = '#7f1d1d';

    var endLabel = document.createElement('div');
    endLabel.textContent = 'По';
    endLabel.style.textAlign = 'left';
    endLabel.style.fontSize = '13px';
    endLabel.style.fontWeight = '700';
    endLabel.style.color = '#7f1d1d';

    var startInput = document.createElement('input');
    startInput.id = RANGE_START_ID;
    startInput.type = 'number';
    startInput.min = '1';
    startInput.step = '1';
    startInput.placeholder = 'С';
    startInput.style.flex = '1';
    startInput.style.padding = '8px 10px';
    startInput.style.border = '1px solid #d1d5db';
    startInput.style.borderRadius = '6px';
    startInput.addEventListener('input', saveBulkSettings);

    var endInput = document.createElement('input');
    endInput.id = RANGE_END_ID;
    endInput.type = 'number';
    endInput.min = '1';
    endInput.step = '1';
    endInput.placeholder = 'По';
    endInput.style.flex = '1';
    endInput.style.padding = '8px 10px';
    endInput.style.border = '1px solid #d1d5db';
    endInput.style.borderRadius = '6px';
    endInput.addEventListener('input', saveBulkSettings);

    var confirmText = document.createElement('div');
    confirmText.textContent = 'Начать скачивание?';
    confirmText.style.marginTop = '10px';
    confirmText.style.textAlign = 'center';
    confirmText.style.fontSize = '14px';
    confirmText.style.fontWeight = '700';
    confirmText.style.color = '#7f1d1d';

    var summary = document.createElement('div');
    summary.id = SUMMARY_ID;
    summary.style.marginTop = '8px';
    summary.style.textAlign = 'center';
    summary.style.fontSize = '12px';
    summary.style.lineHeight = '1.4';
    summary.style.color = '#374151';

    var confirmButtons = document.createElement('div');
    confirmButtons.style.display = 'flex';
    confirmButtons.style.gap = '8px';
    confirmButtons.style.marginTop = '8px';

    var confirmYes = document.createElement('button');
    confirmYes.type = 'button';
    confirmYes.textContent = 'Да';
    confirmYes.style.flex = '1';
    confirmYes.style.padding = '8px 10px';
    confirmYes.style.border = '0';
    confirmYes.style.borderRadius = '6px';
    confirmYes.style.background = '#dc2626';
    confirmYes.style.color = '#ffffff';
    confirmYes.style.cursor = 'pointer';
    confirmYes.addEventListener('click', startBulkDownloadConfirmedV2);

    var confirmNo = document.createElement('button');
    confirmNo.type = 'button';
    confirmNo.textContent = 'Нет';
    confirmNo.style.flex = '1';
    confirmNo.style.padding = '8px 10px';
    confirmNo.style.border = '1px solid #d1d5db';
    confirmNo.style.borderRadius = '6px';
    confirmNo.style.background = '#ffffff';
    confirmNo.style.color = '#111827';
    confirmNo.style.cursor = 'pointer';
    confirmNo.addEventListener('click', hideBulkConfirm);

    rangeRow.appendChild(startLabel);
    rangeRow.appendChild(startInput);
    rangeRow.appendChild(endLabel);
    rangeRow.appendChild(endInput);
    confirmButtons.appendChild(confirmYes);
    confirmButtons.appendChild(confirmNo);
    confirmBox.appendChild(modeRow);
    confirmBox.appendChild(skipRow);
    confirmBox.appendChild(rangeRow);
    confirmBox.appendChild(confirmText);
    confirmBox.appendChild(summary);
    confirmBox.appendChild(confirmButtons);

    var status = document.createElement('div');
    status.id = STATUS_ID;
    status.textContent = 'Готово';
    status.style.marginTop = '8px';
    status.style.fontSize = '12px';
    status.style.lineHeight = '1.4';
    status.style.color = '#111827';

    var progress = document.createElement('div');
    progress.id = PROGRESS_ID;
    progress.textContent = '';
    progress.style.marginTop = '6px';
    progress.style.fontSize = '12px';
    progress.style.lineHeight = '1.4';
    progress.style.color = '#6b7280';

    var progressBar = document.createElement('div');
    progressBar.id = PROGRESS_BAR_ID;
    progressBar.style.marginTop = '8px';
    progressBar.style.width = '100%';
    progressBar.style.height = '8px';
    progressBar.style.display = 'none';
    progressBar.style.borderRadius = '999px';
    progressBar.style.background = '#fee2e2';
    progressBar.style.overflow = 'hidden';

    var progressFill = document.createElement('div');
    progressFill.id = PROGRESS_FILL_ID;
    progressFill.style.width = '0%';
    progressFill.style.height = '100%';
    progressFill.style.background = '#dc2626';
    progressFill.style.transition = 'width 0.2s ease';
    progressBar.appendChild(progressFill);

    panel.appendChild(button);
    panel.appendChild(bulkButton);
    panel.appendChild(cancelButton);
    panel.appendChild(pauseButton);
    panel.appendChild(retryErrorsButton);
    panel.appendChild(resetMarksButton);
    panel.appendChild(confirmBox);
    panel.appendChild(status);
    panel.appendChild(progressBar);
    panel.appendChild(progress);
    document.body.appendChild(panel);
    setRangeInputsEnabled();
    setPauseButtonState();
    setRetryErrorsButtonVisible(false);
    updateBulkSummary(isCgamoPage() ? getCgamoEffectiveTotalPages(getTotalPageCount()) : (getTotalPageCount() || null));
  }

  function init() {
    ensurePanel();
    setTimeout(resumeCgamoNavigatingBulkJob, 800);
    setTimeout(ensurePanel, 1000);
    setTimeout(ensurePanel, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
