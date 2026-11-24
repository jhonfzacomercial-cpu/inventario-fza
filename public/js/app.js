(function () {
  'use strict';
  // Menu lateral no celular
  var sidebar = document.getElementById('sidebar');
  var sombra = document.getElementById('sombra');
  var btn = document.getElementById('menuBtn');
  function alternar(abrir) {
    if (!sidebar) return;
    sidebar.classList.toggle('aberto', abrir);
    sombra.classList.toggle('aberto', abrir);
  }
  if (btn) btn.addEventListener('click', function () { alternar(!sidebar.classList.contains('aberto')); });
  if (sombra) sombra.addEventListener('click', function () { alternar(false); });

  // Valor desconhecido
  var chkValor = document.getElementById('valorDesconhecido');
  var valor = document.getElementById('valor');
  if (chkValor && valor) {
    var sync = function () { valor.disabled = chkValor.checked; if (chkValor.checked) valor.value = ''; };
    chkValor.addEventListener('change', sync);
  }

  // Quantidade > 1: números de série por unidade
  var qtd = document.getElementById('quantidade');
  if (qtd) {
    var unica = document.getElementById('serieUnica');
    var lote = document.getElementById('serieLote');
    var syncQ = function () {
      var multi = parseInt(qtd.value, 10) > 1;
      unica.hidden = multi; lote.hidden = !multi;
    };
    qtd.addEventListener('input', syncQ); syncQ();
  }

  // Confirmação da baixa patrimonial
  var fb = document.getElementById('formBaixa');
  if (fb) fb.addEventListener('submit', function (e) {
    var motivo = fb.querySelector('select[name=motivo]');
    var txt = motivo.options[motivo.selectedIndex] ? motivo.options[motivo.selectedIndex].text : '';
    if (!window.confirm('Confirmar a baixa do item ' + fb.dataset.codigo + ' (motivo: ' + txt + ')?\nEsta ação não pode ser desfeita.')) e.preventDefault();
  });

  // Confirmações genéricas
  document.querySelectorAll('form[data-confirmar]').forEach(function (f) {
    if (!f.dataset.confirmar) return;
    f.addEventListener('submit', function (e) { if (!window.confirm(f.dataset.confirmar)) e.preventDefault(); });
  });
})();
