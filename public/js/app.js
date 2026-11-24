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

  // Reduz a foto no navegador antes de enviar (lado maior até 1600 px, JPEG):
  // economiza espaço no banco gratuito e acelera o envio pelo celular.
  document.querySelectorAll('input[type=file][name=foto]').forEach(function (input) {
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f || !/^image\//.test(f.type) || !window.DataTransfer || !window.createImageBitmap) return;
      var form = input.form, botoes = form ? form.querySelectorAll('button') : [];
      Array.prototype.forEach.call(botoes, function (b) { b.disabled = true; });
      var liberar = function () { Array.prototype.forEach.call(botoes, function (b) { b.disabled = false; }); };
      createImageBitmap(f).then(function (img) {
        var MAX = 1600, k = Math.min(1, MAX / Math.max(img.width, img.height));
        if (k === 1 && f.size < 600 * 1024) { liberar(); return; }
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (blob) {
          try {
            if (blob && blob.size < f.size) {
              var dt = new DataTransfer();
              dt.items.add(new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
              input.files = dt.files;
            }
          } catch (e) { /* mantém o arquivo original */ }
          liberar();
        }, 'image/jpeg', 0.82);
      }).catch(liberar);
    });
  });

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
