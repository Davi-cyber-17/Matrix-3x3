(() => {
  'use strict';

  /* ---------- Constantes ---------- */
  const PREFIXO = 'matrix3x3-sala-';
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const LINHAS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  // Servidores usados para conectar aparelhos em redes diferentes (PC <-> celular 4G/Wi-Fi).
  // STUN descobre o endereço público; TURN é a reserva quando a conexão direta é bloqueada.
  // O TURN abaixo é um servidor público gratuito (pode ficar lento ou instável).
  // Para uso sério, troque pelas suas próprias credenciais.
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ];
  const OPCOES_PEER = { debug: 0, config: { iceServers: ICE_SERVERS } };

  /* ---------- Elementos ---------- */
  const $ = (id) => document.getElementById(id);
  const telas = document.querySelectorAll('.tela');
  const celulas = Array.from(document.querySelectorAll('.celula'));
  const tabuleiro = $('tabuleiro');
  const overlay = $('linha-vitoria');

  /* ---------- Estado ---------- */
  let modo = null;          // 'local' | 'online'
  let souHost = false;
  let minhaMarca = null;    // 'X' (anfitrião) ou 'O' (convidado)
  let codigoSala = '';
  let peer = null;
  let conn = null;
  let timeoutConexao = null;
  let batimento = null;
  let ultimoRecebido = 0;
  let chaveLinha = '';
  let wake = null;
  let estado = novoEstado();

  function novoEstado(placar, inicial) {
    const ini = inicial || 'X';
    return {
      tab: Array(9).fill(null),
      vez: ini,
      inicial: ini,
      vencedor: null,          // 'X' | 'O' | 'E' (empate) | null
      linha: null,
      placar: placar || { X: 0, O: 0, E: 0 }
    };
  }

  /* ---------- Navegação ---------- */
  function mostrar(id) {
    telas.forEach((t) => t.classList.toggle('ativa', t.id === id));
  }

  function mensagem(el, texto, erro) {
    el.textContent = texto || '';
    el.classList.toggle('erro', !!erro);
  }

  /* ---------- Regras do jogo ---------- */
  function jogar(i, marca) {
    if (estado.vencedor || estado.tab[i] || estado.vez !== marca) return false;
    estado.tab[i] = marca;

    const linha = LINHAS.find(([a, b, c]) =>
      estado.tab[a] && estado.tab[a] === estado.tab[b] && estado.tab[a] === estado.tab[c]);

    if (linha) {
      estado.vencedor = marca;
      estado.linha = linha;
      estado.placar[marca]++;
    } else if (estado.tab.every(Boolean)) {
      estado.vencedor = 'E';
      estado.placar.E++;
    } else {
      estado.vez = marca === 'X' ? 'O' : 'X';
    }
    return true;
  }

  function reiniciarPartida() {
    estado = novoEstado(estado.placar, estado.inicial === 'X' ? 'O' : 'X');
  }

  /* ---------- Interface ---------- */
  function svgMarca(m) {
    if (m === 'X') {
      return '<svg class="marca x" viewBox="0 0 100 100" aria-hidden="true">' +
        '<path d="M22 22 L78 78" pathLength="1"/><path d="M78 22 L22 78" pathLength="1"/></svg>';
    }
    return '<svg class="marca o" viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="29" pathLength="1"/></svg>';
  }

  const tag = (m) => `<span class="${m.toLowerCase()}">${m}</span>`;

  function textoStatus() {
    const online = modo === 'online';
    if (estado.vencedor === 'E') return 'Empate!';
    if (estado.vencedor) {
      if (!online) return `Jogador ${tag(estado.vencedor)} venceu!`;
      return estado.vencedor === minhaMarca ? 'Você venceu!' : 'O oponente venceu.';
    }
    if (!online) return `Vez do jogador ${tag(estado.vez)}`;
    return estado.vez === minhaMarca
      ? `Sua vez (${tag(minhaMarca)})`
      : 'Vez do oponente…';
  }

  const centro = (i) => ({ x: (i % 3) * 100 + 50, y: Math.floor(i / 3) * 100 + 50 });

  function desenharLinhaVitoria() {
    const valida = Array.isArray(estado.linha) && estado.linha.length === 3 &&
                   (estado.vencedor === 'X' || estado.vencedor === 'O');
    const chave = valida ? estado.linha.join('') + estado.vencedor : '';
    if (chave === chaveLinha) return;       // evita reiniciar a animação a cada render
    chaveLinha = chave;
    if (!valida) { overlay.innerHTML = ''; return; }

    const a = centro(estado.linha[0]);
    const c = centro(estado.linha[2]);
    const dx = c.x - a.x, dy = c.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, ext = 30;
    overlay.innerHTML =
      `<line class="${estado.vencedor.toLowerCase()}" pathLength="1" ` +
      `x1="${a.x - ux * ext}" y1="${a.y - uy * ext}" x2="${c.x + ux * ext}" y2="${c.y + uy * ext}"/>`;
  }

  function render() {
    const online = modo === 'online';
    const fim = !!estado.vencedor;

    celulas.forEach((el, i) => {
      const m = estado.tab[i];
      if ((el.dataset.marca || '') !== (m || '')) {
        el.dataset.marca = m || '';
        el.innerHTML = m ? svgMarca(m) : '';
      }
      const minhaVez = !online || estado.vez === minhaMarca;
      el.disabled = !!m || fim || !minhaVez;
      el.classList.toggle('vitoria', !!estado.linha && estado.linha.includes(i));
      el.setAttribute('aria-label', `Casa ${i + 1}: ${m || 'vazia'}`);
    });
    tabuleiro.classList.toggle('fim', fim && !!estado.linha);
    desenharLinhaVitoria();

    $('status').innerHTML = textoStatus();

    $('valor-x').textContent = estado.placar.X;
    $('valor-o').textContent = estado.placar.O;
    $('valor-e').textContent = estado.placar.E;

    if (online) {
      $('nome-x').textContent = minhaMarca === 'X' ? 'Você (X)' : 'Oponente (X)';
      $('nome-o').textContent = minhaMarca === 'O' ? 'Você (O)' : 'Oponente (O)';
    } else {
      $('nome-x').textContent = 'Jogador X';
      $('nome-o').textContent = 'Jogador O';
    }
    $('placar-x').classList.toggle('vez', !fim && estado.vez === 'X');
    $('placar-o').classList.toggle('vez', !fim && estado.vez === 'O');

    // No online, só dá para pedir nova partida quando a atual terminou.
    $('btn-nova').disabled = online && !fim;

    $('sala-info').hidden = !online;
    $('sala-texto').textContent = online ? `Sala ${codigoSala}` : '';
  }

  function abrirJogo() {
    mostrar('tela-jogo');
    render();
    if (modo === 'online') travarTela();
  }

  /* ---------- Tela ligada (celular não apaga durante a partida online) ---------- */
  async function travarTela() {
    try {
      if ('wakeLock' in navigator && !wake) {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; });
      }
    } catch (e) { /* não suportado ou negado: segue sem */ }
  }

  function liberarTela() {
    try { if (wake) wake.release(); } catch (e) { /* ignora */ }
    wake = null;
  }

  /* ---------- Modo local ---------- */
  function iniciarLocal() {
    encerrarRede();
    modo = 'local';
    estado = novoEstado();
    abrirJogo();
  }

  /* ---------- Rede (PeerJS / WebRTC) ---------- */
  function pararBatimento() {
    clearInterval(batimento);
    batimento = null;
  }

  function definirLed(classe) {
    $('led').className = 'led ' + classe;
  }

  // Envia um "ping" a cada 4s e avisa se o outro lado parou de responder.
  function iniciarBatimento() {
    pararBatimento();
    ultimoRecebido = Date.now();
    definirLed('ok');
    batimento = setInterval(() => {
      enviar({ tipo: 'ping' });
      const atraso = Date.now() - ultimoRecebido;
      definirLed(atraso > 8000 ? 'lento' : 'ok');
      if (atraso > 25000 && conn) oponenteSaiu();
    }, 4000);
  }

  function encerrarRede() {
    clearTimeout(timeoutConexao);
    pararBatimento();
    liberarTela();
    const c = conn, p = peer;
    conn = null;
    peer = null;
    try { if (c) c.close(); } catch (e) { /* ignora */ }
    try { if (p) p.destroy(); } catch (e) { /* ignora */ }
    souHost = false;
    minhaMarca = null;
    codigoSala = '';
  }

  function sairParaMenu() {
    encerrarRede();
    modo = null;
    mostrar('tela-menu');
  }

  function aoAbrir(c, fn) {
    if (c.open) fn(); else c.on('open', fn);
  }

  function gerarCodigo() {
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
  }

  function bibliotecaOk() {
    if (typeof Peer === 'undefined') {
      mensagem($('msg-online'), 'Não foi possível carregar a biblioteca online. Verifique sua internet e recarregue a página.', true);
      mostrar('tela-online');
      return false;
    }
    return true;
  }

  function enviar(dado) {
    try { if (conn && conn.open) conn.send(dado); } catch (e) { /* ignora */ }
  }

  function enviarEstado() {
    enviar({ tipo: 'estado', estado });
  }

  function ligarConexao(c) {
    c.on('data', (d) => {
      if (c !== conn) return;
      ultimoRecebido = Date.now();
      receber(d);
    });
    c.on('close', () => { if (c === conn) oponenteSaiu(); });
    c.on('error', () => { if (c === conn) oponenteSaiu(); });
  }

  // Se a conexão com o servidor de sinalização cair (comum no celular), tenta voltar.
  function manterSinalizacao(p) {
    p.on('disconnected', () => {
      if (p === peer && !p.destroyed) {
        try { p.reconnect(); } catch (e) { /* ignora */ }
      }
    });
  }

  /* --- Anfitrião: cria a sala --- */
  function criarSala(tentativa) {
    if (!bibliotecaOk()) return;
    encerrarRede();
    mensagem($('msg-online'), 'Criando sala…');

    const codigo = gerarCodigo();
    const p = new Peer(PREFIXO + codigo, OPCOES_PEER);
    peer = p;
    manterSinalizacao(p);

    p.on('open', () => {
      if (p !== peer) return;
      souHost = true;
      minhaMarca = 'X';
      modo = 'online';
      codigoSala = codigo;
      estado = novoEstado();
      $('codigo-sala').textContent = codigo;
      mensagem($('msg-espera'), 'Aguardando o outro jogador entrar…');
      mensagem($('msg-online'), '');
      mostrar('tela-espera');
    });

    p.on('connection', (c) => {
      if (p !== peer) return;
      if (conn) {                       // sala cheia
        aoAbrir(c, () => {
          c.send({ tipo: 'cheia' });
          setTimeout(() => c.close(), 300);
        });
        return;
      }
      conn = c;
      ligarConexao(c);
      aoAbrir(c, () => {
        if (c !== conn) return;
        estado = novoEstado();
        iniciarBatimento();
        abrirJogo();
        enviarEstado();
      });
    });

    p.on('error', (err) => {
      if (p !== peer) return;
      if (err.type === 'unavailable-id' && (tentativa || 0) < 5) {
        criarSala((tentativa || 0) + 1);
        return;
      }
      // Erros de rede após a sala aberta: a reconexão com o servidor é tratada em 'disconnected'.
      if (modo === 'online' && souHost) return;
      encerrarRede();
      mensagem($('msg-online'), 'Não foi possível criar a sala. Verifique sua internet e tente novamente.', true);
      mostrar('tela-online');
    });
  }

  /* --- Convidado: entra numa sala --- */
  function falhaEntrada(texto) {
    encerrarRede();
    modo = null;
    $('btn-entrar').disabled = false;
    $('btn-criar').disabled = false;
    mensagem($('msg-online'), texto, true);
    mostrar('tela-online');
  }

  function entrarSala() {
    if (!bibliotecaOk()) return;
    const codigo = $('input-codigo').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(codigo)) {
      mensagem($('msg-online'), 'Digite o código de 5 caracteres da sala.', true);
      return;
    }

    encerrarRede();
    $('input-codigo').blur();
    $('btn-entrar').disabled = true;
    $('btn-criar').disabled = true;
    mensagem($('msg-online'), 'Conectando…');

    const p = new Peer(OPCOES_PEER);
    peer = p;
    manterSinalizacao(p);

    timeoutConexao = setTimeout(() => {
      if (p === peer) falhaEntrada('Não foi possível conectar. Confira o código e a internet e tente de novo.');
    }, 20000);

    p.on('open', () => {
      if (p !== peer) return;
      const c = p.connect(PREFIXO + codigo, { reliable: true });
      conn = c;
      ligarConexao(c);
      aoAbrir(c, () => {
        if (c !== conn) return;
        clearTimeout(timeoutConexao);
        souHost = false;
        minhaMarca = 'O';
        modo = 'online';
        codigoSala = codigo;
        $('btn-entrar').disabled = false;
        $('btn-criar').disabled = false;
        mensagem($('msg-online'), '');
        iniciarBatimento();
        // aguarda o anfitrião enviar o estado inicial
      });
    });

    p.on('error', (err) => {
      if (p !== peer) return;
      if (modo === 'online') return;     // já conectado: erros de sinalização não derrubam a partida
      if (err.type === 'peer-unavailable') {
        falhaEntrada('Sala não encontrada. Confira o código com quem criou a sala.');
      } else {
        falhaEntrada('Erro de conexão. Verifique sua internet e tente novamente.');
      }
    });
  }

  /* --- Mensagens recebidas --- */
  function receber(d) {
    if (!d || typeof d !== 'object' || d.tipo === 'ping') return;

    if (souHost) {
      if (d.tipo === 'jogada' && Number.isInteger(d.i) && d.i >= 0 && d.i < 9) {
        if (jogar(d.i, 'O')) {
          enviarEstado();
          render();
        }
      } else if (d.tipo === 'reiniciar' && estado.vencedor) {
        reiniciarPartida();
        enviarEstado();
        render();
      }
      return;
    }

    // convidado
    if (d.tipo === 'estado' && d.estado && Array.isArray(d.estado.tab) && d.estado.tab.length === 9) {
      estado = d.estado;
      if (!$('tela-jogo').classList.contains('ativa')) abrirJogo();
      else render();
    } else if (d.tipo === 'cheia') {
      falhaEntrada('Essa sala já está cheia.');
    }
  }

  function oponenteSaiu() {
    if (modo !== 'online') return;
    pararBatimento();
    if (souHost) {
      // a sala continua aberta esperando outro jogador
      const c = conn;
      conn = null;
      try { if (c) c.close(); } catch (e) { /* ignora */ }
      estado = novoEstado();
      liberarTela();
      mensagem($('msg-espera'), 'O outro jogador saiu. Aguardando alguém entrar…');
      mostrar('tela-espera');
    } else {
      encerrarRede();
      modo = null;
      mensagem($('msg-online'), 'A conexão com a sala foi encerrada.', true);
      mostrar('tela-online');
    }
  }

  /* ---------- Eventos ---------- */
  celulas.forEach((el) => {
    el.addEventListener('click', () => {
      const i = Number(el.dataset.i);
      if (modo === 'local') {
        if (jogar(i, estado.vez)) render();
      } else if (modo === 'online') {
        if (souHost) {
          if (jogar(i, minhaMarca)) {
            enviarEstado();
            render();
          }
        } else if (estado.vez === minhaMarca && !estado.vencedor && !estado.tab[i]) {
          enviar({ tipo: 'jogada', i });
        }
      }
    });
  });

  $('btn-nova').addEventListener('click', () => {
    if (modo === 'local') {
      reiniciarPartida();
      render();
    } else if (modo === 'online') {
      if (souHost) {
        if (!estado.vencedor) return;
        reiniciarPartida();
        enviarEstado();
        render();
      } else {
        enviar({ tipo: 'reiniciar' });
      }
    }
  });

  $('btn-sair').addEventListener('click', sairParaMenu);
  $('btn-local').addEventListener('click', iniciarLocal);
  $('btn-online').addEventListener('click', () => {
    mensagem($('msg-online'), '');
    mostrar('tela-online');
  });
  $('btn-voltar-online').addEventListener('click', sairParaMenu);
  $('btn-criar').addEventListener('click', () => criarSala(0));
  $('btn-entrar').addEventListener('click', entrarSala);
  $('btn-cancelar-sala').addEventListener('click', sairParaMenu);

  $('input-codigo').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  $('input-codigo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') entrarSala();
  });

  async function copiar(texto, botao, rotuloOriginal) {
    try {
      await navigator.clipboard.writeText(texto);
      botao.textContent = 'Copiado!';
    } catch (e) {
      botao.textContent = 'Não foi possível copiar';
    }
    setTimeout(() => { botao.textContent = rotuloOriginal; }, 1500);
  }

  $('btn-copiar-codigo').addEventListener('click', (e) => {
    copiar(codigoSala, e.currentTarget, 'Copiar código');
  });
  $('btn-copiar-link').addEventListener('click', (e) => {
    const url = location.origin + location.pathname + '?sala=' + codigoSala;
    copiar(url, e.currentTarget, 'Copiar link');
  });

  // Ao voltar para a aba (ex.: celular desbloqueado), evita falso "oponente saiu".
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && modo === 'online') {
      ultimoRecebido = Date.now();
      enviar({ tipo: 'ping' });
      if ($('tela-jogo').classList.contains('ativa')) travarTela();
    }
  });

  /* ---------- Link direto: ?sala=CODIGO ---------- */
  const sala = new URLSearchParams(location.search).get('sala');
  if (sala && /^[A-Za-z0-9]{5}$/.test(sala)) {
    $('input-codigo').value = sala.toUpperCase();
    mostrar('tela-online');
  }

  window.addEventListener('beforeunload', encerrarRede);
})();
