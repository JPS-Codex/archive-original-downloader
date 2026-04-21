(function () {
  'use strict';

  var message = document.getElementById('message');
  var version = document.getElementById('version');

  if (message) {
    message.textContent = 'Перед скачиванием с ЦГА Московской области войдите в личный кабинет arch.mosreg.ru. Для Яндекс.Архива в Opera включите "Разрешить доступ к результатам на странице поиска".';
  }

  if (version) {
    version.textContent = 'Версия 1.8.1';
  }
})();
