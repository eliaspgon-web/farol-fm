/**
 * Farol FM — backend (API + loja + pagamentos Mercado Pago)
 * Node 18+  |  npm install  |  npm start
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const dns = require('dns').promises;
const nodemailer = require('nodemailer');

const {
  PORT = 3000,
  PUBLIC_URL = `http://localhost:${PORT}`,       // URL pública do backend (usada no webhook)
  SITE_ORIGIN = '*',                              // domínio do site, ex.: https://farolnews.com.br
  JWT_SECRET = 'troque-este-segredo',
  ADMIN_EMAIL = 'admin@farolradiotv.com.br',
  ADMIN_PASSWORD = '',                            // OU use ADMIN_PASSWORD_HASH (bcrypt)
  ADMIN_PASSWORD_HASH = '',
  MP_ACCESS_TOKEN = '',                           // Mercado Pago (APP_USR-... de produção ou TEST-...)
  MP_WEBHOOK_SECRET = '',                         // "Assinatura secreta" das notificações do MP
  WA_TOKEN = '',                                  // WhatsApp Cloud API (Meta) — token permanente do app
  WA_PHONE_ID = '',                               // ID do número de telefone no WhatsApp Business
  WA_VERIFY_TOKEN = 'farol-verifica',             // texto que você define ao cadastrar o webhook
  WA_APP_SECRET = '',                             // segredo do app Meta (valida a assinatura do webhook)
  WA_VENDEDORES = '',                             // números que recebem aviso de novo cliente na fila (5582...)
  SITE_URL = '',                                  // endereço do site (links de produtos enviados pelo robô)
  SMTP_HOST = '', SMTP_PORT = '587', SMTP_USER = '', SMTP_PASS = '',  // envio de e-mails (confirmação, senha, campanhas)
  SMTP_FROM = '',                                 // ex.: "Farol FM <promocoes@farolradiotv.com.br>"
  GOOGLE_CLIENT_ID = '',                          // login "Continuar com o Google" (mesmo valor do painel)
  AI_API_KEY = '',                                // opcional: chave da API da Anthropic (respostas livres do agente)
  AI_MODEL = 'claude-haiku-5-5',
  YT_API_KEY = '',                                // opcional: YouTube Data API v3 (sem ela, a live é detectada pela página /live)
  DB_FILE = path.join(__dirname, 'farol.db'),
} = process.env;

if (JWT_SECRET === 'troque-este-segredo') console.warn('⚠️  Defina JWT_SECRET no .env');
if (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH) console.warn('⚠️  Defina ADMIN_PASSWORD ou ADMIN_PASSWORD_HASH no .env');

/* ------------------------------------------------------------------ banco */
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); // disco persistente do servidor na nuvem (ex.: /var/data)
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  updated INTEGER NOT NULL, PRIMARY KEY (col, id));`);
const COLS = ['posts', 'videos', 'produtos', 'cupons', 'promocoes', 'pedidos', 'oracoes', 'musicas', 'conversas', 'anuncios', 'comentarios'];
// perfis: admin (tudo), redacao (jornalismo), loja (vendas + atendimento)
// Perfis da equipe: cada um enxerga e altera só os módulos liberados (o painel usa os mesmos nomes)
const TODOS_MODULOS = ['dash', 'atendimento', 'equipe', 'aparencia', 'publicidade', 'redacao', 'posts', 'comentarios', 'videos', 'oracoes', 'radio', 'redes', 'loja', 'pedidos', 'clientes', 'produtos', 'estoque', 'promocoes', 'cupons', 'campanhas', 'financeiro', 'pagamentos'];
const PERFIS = {
  admin: { m: TODOS_MODULOS, pub: true }, editor: { m: ['dash', 'redacao', 'posts', 'comentarios', 'videos', 'oracoes', 'radio', 'redes'], pub: true },
  jornalista: { m: ['dash', 'redacao', 'posts', 'comentarios', 'videos'], pub: false }, colunista: { m: ['dash', 'posts'], pub: false },
  locutor: { m: ['dash', 'radio', 'oracoes', 'redes', 'videos'], pub: false },
  gerente: { m: ['dash', 'loja', 'pedidos', 'clientes', 'produtos', 'estoque', 'promocoes', 'cupons', 'campanhas', 'financeiro', 'pagamentos', 'atendimento'], pub: false },
  vendedor: { m: ['dash', 'atendimento', 'loja', 'pedidos', 'clientes'], pub: false }, comercial: { m: ['dash', 'publicidade', 'campanhas'], pub: false },
  financeiro: { m: ['dash', 'financeiro', 'pedidos', 'clientes'], pub: false },
};
const papelOk = (p) => (p === 'redacao' ? 'editor' : p === 'loja' ? 'gerente' : p);
const modsDe = (u) => { const p = papelOk(u.papel); if (p === 'admin') return TODOS_MODULOS; return Array.isArray(u.modulos) && u.modulos.length ? u.modulos.filter((m) => TODOS_MODULOS.includes(m)) : (PERFIS[p] || { m: [] }).m; };
const pubDe = (u) => papelOk(u.papel) === 'admin' || (u.publicar ?? (PERFIS[papelOk(u.papel)] || {}).pub) === true;
// coleção → módulos que podem alterá-la
const COL_MOD = { posts: ['posts'], videos: ['videos'], oracoes: ['oracoes'], musicas: ['oracoes'], produtos: ['produtos', 'estoque'], cupons: ['cupons'], promocoes: ['promocoes'], pedidos: ['pedidos'], conversas: ['atendimento'], anuncios: ['publicidade'], comentarios: ['comentarios'] };
// configurações → módulo que pode alterá-las (quem tem "aparencia" altera todas)
const SETTINGS_MOD = {
  radio: ['rdsAtivo', 'rdsUrl', 'radioAuto', 'radioBarra', 'radioNome', 'radioFreq', 'streamUrl', 'ytChannelId', 'ytVideoId', 'aoVivo', 'programacao'],
  redes: ['ytChannelId', 'ytNome', 'ytHandle', 'youtube', 'igUser', 'instagram', 'igPosts', 'redesHome'],
  redacao: ['versiculos', 'versiculosAgenda', 'categorias', 'carrosselQtd'],
  pagamentos: ['lojaAtiva', 'pixChave', 'pixNome', 'pixCidade', 'pixDesconto', 'parcelasMax', 'parcelasSemJuros', 'jurosMes', 'frete', 'freteGratisAcima', 'retirada', 'enderecoRetirada', 'taxaPix', 'taxaCredito', 'taxaDebito', 'mpPublicKey', 'catLoja'],
  publicidade: ['anuncieAqui', 'adMobile', 'adsenseClient', 'adsenseSlots', 'adOculto', 'comprovanteAuto', 'gaId', 'adsenseAuto', 'adsenseModo', 'gscVerify', 'cookiesAviso', ...['topo', 'home1', 'home2', 'lateral1', 'lateral2', 'materia2', 'loja', 'radio', 'rodape', 'mobile'].map((k) => 'adOff_' + k)],
  campanhas: ['googleClientId', 'cupomBoasVindas', 'politicaPrivacidade'],
  comentarios: ['comentariosAtivo', 'comentariosModeracao', 'comentariosLogin', 'palavrasBloqueadas'],
  atendimento: ['waVendas', 'horarioAtendimento', 'botNome'],
};
const q = {
  all: db.prepare('SELECT data FROM docs WHERE col=?'),
  get: db.prepare('SELECT data FROM docs WHERE col=? AND id=?'),
  put: db.prepare('INSERT INTO docs (col,id,data,updated) VALUES (?,?,?,?) ON CONFLICT(col,id) DO UPDATE SET data=excluded.data, updated=excluded.updated'),
  del: db.prepare('DELETE FROM docs WHERE col=? AND id=?'),
  count: db.prepare('SELECT COUNT(*) n FROM docs'),
};
const all = (c) => q.all.all(c).map((r) => JSON.parse(r.data));
const get = (c, id) => { const r = q.get.get(c, id); return r ? JSON.parse(r.data) : null; };
const put = (c, doc) => { q.put.run(c, doc.id, JSON.stringify(doc), Date.now()); return doc; };
const settings = () => get('settings', 'main') || {};

// Primeira execução: carrega dados de exemplo
if (q.count.get().n === 0) {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
  db.transaction(() => {
    for (const c of COLS) for (const d of seed[c] || []) put(c, d);
    const s = { ...seed.settings }; delete s.senhaAdmin;
    put('settings', { id: 'main', ...s });
  })();
  console.log('Banco criado com dados de exemplo.');
}

/* ------------------------------------------------------------- utilidades */
const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const now = () => new Date().toISOString();
const inRange = (i, f) => { const n = Date.now(); return (!i || Date.parse(i) <= n) && (!f || (String(f).includes('T') ? Date.parse(f) : Date.parse(f) + 864e5) > n); };
const PRIVATE_SETTINGS = ['taxaPix', 'taxaCredito', 'taxaDebito', 'senhaAdmin'];
const publicSettings = () => { const s = { ...settings() }; PRIVATE_SETTINGS.forEach((k) => delete s[k]); delete s.id; return s; };

function campaignPct(p) {
  return all('promocoes').filter((c) => c.ativo && inRange(c.inicio, c.fim) &&
    (c.alvo === 'todos' || c.alvo === 'cat:' + p.categoria || c.alvo === 'p:' + p.id))
    .reduce((m, c) => Math.max(m, +c.percentual || 0), 0);
}
function priceOf(p) {
  let v = +p.preco;
  if (p.precoPromo && +p.precoPromo > 0 && +p.precoPromo < v) v = +p.precoPromo;
  const pc = campaignPct(p); if (pc) v = Math.min(v, +p.preco * (1 - pc / 100));
  return r2(v);
}
function couponError(c, sub) {
  if (!c) return 'Cupom não encontrado'; if (!c.ativo) return 'Cupom inativo';
  if (c.validade && Date.parse(c.validade) + 864e5 < Date.now()) return 'Cupom expirado';
  if (c.limite && c.usos >= c.limite) return 'Cupom esgotado';
  if (c.minimo && sub < c.minimo) return 'Pedido abaixo do mínimo do cupom';
  return '';
}
const findCoupon = (code) => all('cupons').find((c) => c.codigo.toUpperCase() === String(code || '').toUpperCase().trim());

/** Recalcula TUDO no servidor — o navegador nunca define preço. */
function quote({ itens, cupom, entrega, metodo }) {
  const s = settings();
  if (!Array.isArray(itens) || !itens.length) throw new Error('Carrinho vazio');
  const used = {};
  const lines = itens.map((l) => {
    const p = get('produtos', String(l.id));
    const qty = Math.max(1, Math.floor(+l.qty || 0));
    if (!p || !p.ativo) throw new Error('Produto indisponível');
    const vars = String(p.variacoes || '').split(',').map((x) => x.trim()).filter(Boolean);
    const v = String(l.v || '');
    if (vars.length && !vars.includes(v)) throw new Error(`Escolha uma opção para ${p.nome}`);
    used[p.id] = (used[p.id] || 0) + qty;
    if (used[p.id] > +p.estoque) throw new Error(`Estoque insuficiente: ${p.nome}`);
    const unit = priceOf(p); return { id: p.id, nome: p.nome + (v ? ` (${v})` : ''), v, qty, unit, line: r2(unit * qty) };
  });
  const sub = r2(lines.reduce((a, i) => a + i.line, 0));
  let frete = entrega === 'retirada' && s.retirada ? 0 : (s.freteGratisAcima && sub >= s.freteGratisAcima ? 0 : +s.frete || 0);
  let desc = 0, cupomOk = '';
  if (cupom) {
    const c = findCoupon(cupom); const err = couponError(c, sub);
    if (err) throw new Error(err);
    cupomOk = c.codigo;
    if (c.tipo === 'percentual') desc = r2(sub * c.valor / 100);
    else if (c.tipo === 'fixo') desc = Math.min(sub, +c.valor);
    else if (c.tipo === 'frete') frete = 0;
  }
  const pixDesc = metodo === 'pix' && s.pixDesconto ? r2((sub - desc) * s.pixDesconto / 100) : 0;
  return { itens: lines, subtotal: sub, desconto: desc, cupom: cupomOk, frete, descontoPix: pixDesc, total: r2(sub - desc + frete - pixDesc) };
}

function markPaid(o, msg) {
  if (['pago', 'separacao', 'enviado', 'entregue'].includes(o.status)) return o;
  o.status = 'pago'; o.pagoEm = now(); o.historico.push({ d: o.pagoEm, s: msg || 'Pagamento confirmado' });
  db.transaction(() => {
    for (const i of o.itens) { const p = get('produtos', i.id); if (p) { p.estoque = Math.max(0, +p.estoque - i.qty); put('produtos', p); } }
    if (o.cupom) { const c = findCoupon(o.cupom); if (c) { c.usos = (+c.usos || 0) + 1; put('cupons', c); } }
    put('pedidos', o);
  })();
  return o;
}
function restock(o) { for (const i of o.itens) { const p = get('produtos', i.id); if (p) { p.estoque = +p.estoque + i.qty; put('produtos', p); } } }

/* PIX estático (BR Code) — usado quando não há Mercado Pago configurado */
function crc16(s) { let c = 0xFFFF; for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1); c &= 0xFFFF; } return c.toString(16).toUpperCase().padStart(4, '0'); }
const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
const ascii = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 @.\-_+]/g, '').toUpperCase();
function pixPayload({ chave, nome, cidade, valor, txid }) {
  const mai = tlv('00', 'br.gov.bcb.pix') + tlv('01', String(chave).trim());
  const p = tlv('00', '01') + tlv('26', mai) + tlv('52', '0000') + tlv('53', '986') + tlv('54', (+valor).toFixed(2)) + tlv('58', 'BR') +
    tlv('59', ascii(nome).slice(0, 25) || 'LOJA') + tlv('60', ascii(cidade).slice(0, 15) || 'MACEIO') + tlv('62', tlv('05', String(txid).replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***')) + '6304';
  return p + crc16(p);
}

/* Mercado Pago */
async function mp(method, pathName, body, idem) {
  const r = await fetch('https://api.mercadopago.com' + pathName, {
    method, headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...(idem ? { 'X-Idempotency-Key': idem } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || 'Erro no Mercado Pago'); e.mp = j; throw e; }
  return j;
}
const MP_STATUS_MSG = { cc_rejected_insufficient_amount: 'Saldo/limite insuficiente', cc_rejected_bad_filled_security_code: 'CVV incorreto', cc_rejected_bad_filled_date: 'Validade incorreta', cc_rejected_call_for_authorize: 'Autorize o pagamento junto ao banco', cc_rejected_high_risk: 'Pagamento recusado por segurança' };
function applyMpStatus(o, pay) {
  o.mpId = pay.id; o.mpStatus = pay.status; o.mpDetail = pay.status_detail;
  if (pay.status === 'approved') return markPaid(o, `Pagamento aprovado (Mercado Pago #${pay.id})`);
  if (pay.status === 'rejected') { o.status = 'recusado'; o.historico.push({ d: now(), s: 'Recusado: ' + (MP_STATUS_MSG[pay.status_detail] || pay.status_detail) }); }
  else if (pay.status === 'cancelled' && o.status === 'aguardando') { o.status = 'cancelado'; o.historico.push({ d: now(), s: 'PIX expirado/cancelado' }); }
  else if ((pay.status === 'refunded' || pay.status === 'charged_back') && o.status !== 'estornado') { if (o.status !== 'aguardando') restock(o); o.status = 'estornado'; o.historico.push({ d: now(), s: 'Pagamento estornado' }); }
  put('pedidos', o); return o;
}

/* ------------------------------------------------------------------- app */
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: SITE_ORIGIN === '*' ? true : SITE_ORIGIN.split(',') }));
app.use(express.json({ limit: '8mb', verify: (req, res, buf) => { req.rawBody = buf; } })); // imagens em base64 enviadas pelo painel

// rate-limit simples em memória para rotas públicas de escrita
const hits = new Map();
const limit = (max, win = 60e3) => (req, res, next) => {
  const k = req.ip + req.path; const t = Date.now(); const a = (hits.get(k) || []).filter((x) => t - x < win);
  if (a.length >= max) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
  a.push(t); hits.set(k, a); next();
};
const ok = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e.mp || e); res.status(400).json({ error: e.message }); });
// can(usuário, módulos): verdadeiro se o perfil tem pelo menos um dos módulos (ou é administrador)
const can = (user, mods) => { if (papelOk(user.papel) === 'admin' || !mods) return true; const m = modsDe(user); return [].concat(mods).some((x) => m.includes(x)); };
const auth = (mods) => (req, res, next) => {
  let t; try { t = jwt.verify(String(req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' }); }
  // relê o usuário a cada pedido: alterações de perfil ou desativação valem na hora
  if (t.id && t.id !== 'root') { const u = get('usuarios', t.id); if (!u || u.ativo === false) return res.status(401).json({ error: 'Acesso desativado. Fale com o administrador.' }); req.user = { id: u.id, sub: u.email, nome: u.nome, papel: u.papel, modulos: u.modulos, publicar: u.publicar }; }
  else req.user = { id: 'root', sub: t.sub, nome: t.nome || 'Administrador', papel: t.papel || 'admin' };
  if (mods === 'admin' ? papelOk(req.user.papel) !== 'admin' : (mods && !can(req.user, mods))) return res.status(403).json({ error: 'Seu perfil não tem acesso a esta área.' });
  next();
};

/* público */
app.get('/api/bootstrap', (req, res) => {
  res.json({
    posts: all('posts').filter((p) => (p.status ? p.status === 'publicado' : !p.rascunho) && Date.parse(p.data) <= Date.now()),
    videos: all('videos'),
    produtos: all('produtos').filter((p) => p.ativo),
    promocoes: all('promocoes').filter((c) => c.ativo && inRange(c.inicio, c.fim)),
    anuncios: all('anuncios').filter((a) => a.ativo && inRange(a.inicio, a.fim)).map(({ views, clicks, comprovantes, diario, ...a }) => a),
    cupons: [], pedidos: [], oracoes: [], musicas: [], conversas: [], comentarios: [],
    settings: publicSettings(),
  });
});
app.get('/api/coupons/:code', limit(20), (req, res) => {
  const c = findCoupon(req.params.code);
  if (!c || !c.ativo) return res.status(404).json({ error: 'Cupom não encontrado' });
  const { id, codigo, tipo, valor, minimo, validade, limite, usos, ativo } = c;
  res.json({ id, codigo, tipo, valor, minimo, validade, limite, usos, ativo });
});
app.post('/api/posts/:id/view', limit(30), (req, res) => { const p = get('posts', req.params.id); if (p) { p.views = (p.views || 0) + 1; put('posts', p); } res.json({ ok: true }); });
// métricas de anúncios (visualizações e cliques); contadores somados em memória e gravados a cada 30 s
const adBuf = new Map();
app.post('/api/ads/:id/:ev', limit(120), (req, res) => {
  const { id, ev } = req.params; if (!['view', 'click'].includes(ev)) return res.status(400).end();
  const k = id + '|' + ev; adBuf.set(k, (adBuf.get(k) || 0) + 1); res.status(204).end();
});
setInterval(() => {
  if (!adBuf.size) return; const batch = [...adBuf]; adBuf.clear();
  const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Maceio' }); // AAAA-MM-DD no horário de Maceió
  db.transaction(() => { for (const [k, n] of batch) { const [id, ev] = k.split('|'); const a = get('anuncios', id); if (a) { a[ev === 'view' ? 'views' : 'clicks'] = (+a[ev === 'view' ? 'views' : 'clicks'] || 0) + n;
    a.diario = a.diario || {}; const d = (a.diario[dia] = a.diario[dia] || { v: 0, c: 0 }); d[ev === 'view' ? 'v' : 'c'] += n; const ks = Object.keys(a.diario).sort(); while (ks.length > 120) delete a.diario[ks.shift()];
    put('anuncios', a); } } })();
}, 30e3);
/* comentários dos leitores no fim das notícias */
const PALAVRAS_PADRAO = 'idiota, imbecil, burro, otario, babaca, porra, caralho, merda, puta, viado, desgraçado, vagabundo';
const normCom = (t) => ' ' + String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
const comSuspeito = (t, s) => /https?:\/\/|www\.|\.com\b/i.test(t) || String(s.palavrasBloqueadas ?? PALAVRAS_PADRAO).split(',').map((x) => normCom(x).trim()).filter(Boolean).some((x) => normCom(t).includes(' ' + x + ' '));
const comPub = ({ email, ip, contaId, autorId, ...c }) => c;
const contaDoToken = (req) => { try { const t = jwt.verify(String(req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); return t.tipo === 'cliente' ? get('contas', t.sub) : null; } catch { return null; } };
app.get('/api/posts/:id/comentarios', (req, res) => {
  res.json(all('comentarios').filter((c) => c.postId === req.params.id && c.status === 'aprovado').sort((a, b) => String(a.data).localeCompare(b.data)).slice(-500).map(comPub));
});
app.post('/api/comentarios', limit(6, 10 * 60e3), (req, res) => {
  const s = settings(); const b = req.body || {};
  if (s.comentariosAtivo === false) return res.status(403).json({ error: 'Os comentários estão desativados no momento.' });
  if (b.site) return res.json({ id: uid(), status: 'pendente' }); // armadilha anti-robô
  const post = get('posts', String(b.postId || '')); if (!post) return res.status(404).json({ error: 'Notícia não encontrada' });
  const conta = contaDoToken(req);
  if (s.comentariosLogin && !conta) return res.status(401).json({ error: 'Entre na sua conta para comentar.' });
  const nome = String(conta?.nome || b.nome || '').trim().slice(0, 60); const texto = String(b.texto || '').trim().slice(0, 1000);
  if (nome.length < 2) return res.status(400).json({ error: 'Informe seu nome' });
  if (texto.length < 3) return res.status(400).json({ error: 'Escreva seu comentário' });
  let pai = null; if (b.pai) { const p = get('comentarios', String(b.pai)); if (!p || p.postId !== post.id) return res.status(400).json({ error: 'Comentário original não encontrado' }); pai = p.pai || p.id; }
  const c = put('comentarios', { id: uid(), postId: post.id, pai, nome, texto, email: conta?.email || '', contaId: conta?.id || null, ip: req.ip, data: now(), curtidas: 0,
    status: s.comentariosModeracao === 'previa' || comSuspeito(texto, s) ? 'pendente' : 'aprovado' });
  res.json(comPub(c));
});
app.post('/api/comentarios/:id/:ev', limit(60), (req, res) => {
  const { id, ev } = req.params; if (!['curtir', 'descurtir'].includes(ev)) return res.status(400).end();
  const c = get('comentarios', id); if (!c || c.status !== 'aprovado') return res.status(404).end();
  c.curtidas = Math.max(0, (+c.curtidas || 0) + (ev === 'curtir' ? 1 : -1)); put('comentarios', c); res.json({ curtidas: c.curtidas });
});
app.post('/api/musicas', limit(5), (req, res) => {
  const { nome, texto } = req.body || {}; if (!texto) return res.status(400).json({ error: 'Escreva o pedido' });
  put('musicas', { id: uid(), nome: String(nome || 'Ouvinte').slice(0, 80), texto: String(texto).slice(0, 600), origem: 'site', lido: false, data: now() });
  res.json({ ok: true });
});
app.post('/api/oracoes', limit(5), (req, res) => {
  const { nome, cidade, texto, noAr } = req.body || {};
  if (!nome || !texto) return res.status(400).json({ error: 'Preencha nome e pedido' });
  put('oracoes', { id: uid(), nome: String(nome).slice(0, 80), cidade: String(cidade || '').slice(0, 60), texto: String(texto).slice(0, 1200), noAr: !!noAr, lido: false, data: now() });
  res.json({ ok: true });
});

/* checkout */
app.post('/api/checkout', limit(10), ok(async (req, res) => {
  if (settings().lojaAtiva === false) return res.status(403).json({ error: 'A loja está fechada no momento.' });
  const { itens, cupom, entrega, metodo, cliente = {}, card } = req.body || {};
  if (!['pix', 'credito', 'debito'].includes(metodo)) throw new Error('Forma de pagamento inválida');
  for (const k of ['nome', 'email', 'tel', 'cpf']) if (!cliente[k]) throw new Error('Dados do cliente incompletos');
  if (entrega !== 'retirada') for (const k of ['cep', 'rua', 'num', 'bairro', 'cidade', 'uf']) if (!cliente[k]) throw new Error('Endereço incompleto');
  const s = settings(); const t = quote({ itens, cupom, entrega, metodo });
  const o = { id: 'FF' + Date.now().toString().slice(-8) + crypto.randomBytes(1).toString('hex').toUpperCase(), data: now(), cliente, entrega: entrega === 'retirada' ? 'retirada' : 'entrega', ...t, metodo, status: 'aguardando', historico: [{ d: now(), s: 'Pedido criado' }] };
  const cpf = String(cliente.cpf).replace(/\D/g, ''); const [first, ...rest] = String(cliente.nome).trim().split(' ');
  const payer = { email: cliente.email, first_name: first, last_name: rest.join(' ') || first, identification: { type: 'CPF', number: cpf } };

  if (metodo === 'pix') {
    if (MP_ACCESS_TOKEN) {
      const pay = await mp('POST', '/v1/payments', {
        transaction_amount: o.total, description: `Pedido ${o.id} - ${s.nome || 'Farol FM'}`, payment_method_id: 'pix', payer,
        external_reference: o.id, notification_url: `${PUBLIC_URL}/api/webhooks/mercadopago`,
        date_of_expiration: new Date(Date.now() + 30 * 60e3).toISOString().replace('Z', '-00:00'),
      }, o.id);
      const td = pay.point_of_interaction?.transaction_data || {};
      o.mpId = pay.id; o.pixData = { qr_code: td.qr_code, qr_code_base64: td.qr_code_base64, ticket_url: td.ticket_url };
      o.historico.push({ d: now(), s: 'PIX gerado (Mercado Pago) — válido por 30 min' });
    } else {
      if (!s.pixChave) throw new Error('Chave PIX não configurada');
      o.pix = pixPayload({ chave: s.pixChave, nome: s.pixNome, cidade: s.pixCidade, valor: o.total, txid: o.id });
      o.historico.push({ d: now(), s: 'PIX gerado (baixa manual)' });
    }
    put('pedidos', o); return res.json(o);
  }

  // Crédito/débito: o token vem do Card Payment Brick (dados do cartão nunca chegam aqui)
  if (!MP_ACCESS_TOKEN) throw new Error('Pagamento com cartão indisponível no momento');
  if (!card || !card.token) throw new Error('Dados do cartão ausentes');
  const pay = await mp('POST', '/v1/payments', {
    transaction_amount: o.total, token: card.token, installments: metodo === 'debito' ? 1 : Math.max(1, +card.installments || 1),
    payment_method_id: card.payment_method_id, issuer_id: card.issuer_id || undefined,
    description: `Pedido ${o.id} - ${s.nome || 'Farol FM'}`, external_reference: o.id,
    notification_url: `${PUBLIC_URL}/api/webhooks/mercadopago`, statement_descriptor: ascii(s.nome || 'FAROL').slice(0, 13),
    payer: { ...payer, email: card.payer?.email || payer.email, identification: card.payer?.identification || payer.identification },
  }, o.id);
  o.cartao = { bandeira: pay.payment_method_id, final: pay.card?.last_four_digits || '', parcelas: pay.installments || 1 };
  put('pedidos', o); applyMpStatus(o, pay);
  res.json(o);
}));

app.get('/api/orders/:id', (req, res) => {
  const o = get('pedidos', req.params.id);
  if (!o || String(o.cliente.email).toLowerCase() !== String(req.query.email || '').toLowerCase()) return res.status(404).json({ error: 'Pedido não encontrado' });
  res.json(o);
});

/* webhook Mercado Pago */
app.post('/api/webhooks/mercadopago', ok(async (req, res) => {
  const dataId = req.query['data.id'] || req.body?.data?.id;
  if (MP_WEBHOOK_SECRET) {
    const sig = String(req.headers['x-signature'] || ''); const parts = Object.fromEntries(sig.split(',').map((x) => x.trim().split('=')));
    const manifest = `id:${String(dataId).toLowerCase()};request-id:${req.headers['x-request-id'] || ''};ts:${parts.ts};`;
    const h = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');
    if (!parts.v1 || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(String(parts.v1).padEnd(h.length).slice(0, h.length)))) return res.status(401).end();
  }
  const type = req.body?.type || req.query.type || req.query.topic;
  if (type === 'payment' && dataId && MP_ACCESS_TOKEN) {
    const pay = await mp('GET', `/v1/payments/${dataId}`); // consulta direta: nunca confiar só no corpo
    const o = get('pedidos', pay.external_reference);
    if (o && Math.abs(+pay.transaction_amount - +o.total) < 0.01) applyMpStatus(o, pay);
  }
  res.status(200).json({ ok: true });
}));

/* admin */
app.post('/api/login', limit(8), ok(async (req, res) => {
  const { email, senha } = req.body || {}; const em = String(email || '').toLowerCase().trim();
  let user = null;
  if (em === ADMIN_EMAIL.toLowerCase()) {
    const passOk = ADMIN_PASSWORD_HASH ? await bcrypt.compare(String(senha), ADMIN_PASSWORD_HASH) : (ADMIN_PASSWORD && senha === ADMIN_PASSWORD);
    if (passOk) user = { id: 'root', email: em, nome: 'Administrador', papel: 'admin', cargo: 'Administrador principal' };
  } else {
    const u = all('usuarios').find((x) => x.email.toLowerCase() === em);
    if (u && await bcrypt.compare(String(senha), u.hash)) {
      if (u.ativo === false) throw new Error('Usuário desativado. Fale com o administrador.');
      u.ultimoAcesso = now(); put('usuarios', u); user = userPub(u);
    }
  }
  if (!user) throw new Error('E-mail ou senha incorretos');
  res.json({ token: jwt.sign({ sub: user.email, id: user.id, nome: user.nome, papel: user.papel }, JWT_SECRET, { expiresIn: '12h' }), user: { ...user, modulos: modsDe(user), publicar: pubDe(user) }, nome: user.nome, papel: user.papel });
}));
const userPub = ({ hash, ...u }) => u;
app.put('/api/admin/me', auth(), ok(async (req, res) => {
  if (req.user.id === 'root') throw new Error('A senha do administrador principal é definida no arquivo .env do servidor');
  const u = get('usuarios', req.user.id); if (!u || !(await bcrypt.compare(String(req.body.senhaAtual || ''), u.hash))) throw new Error('Senha atual incorreta');
  const sen = String(req.body.senha || ''); if (sen.length < 8 || !/[a-zA-Z]/.test(sen) || !/\d/.test(sen)) throw new Error('Senha fraca: mínimo 8 caracteres, com letras e números');
  u.hash = await bcrypt.hash(sen, 10); put('usuarios', u); res.json({ ok: true });
}));
app.put('/api/admin/usuarios/:id', auth('admin'), ok(async (req, res) => {
  const b = req.body || {}; const old = get('usuarios', req.params.id) || {};
  const papel = papelOk(b.papel); if (!PERFIS[papel]) throw new Error('Perfil inválido');
  const email = String(b.email || '').toLowerCase().trim(); if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new Error('E-mail inválido');
  if (String(b.nome || '').trim().length < 3) throw new Error('Informe o nome completo');
  if (email === ADMIN_EMAIL.toLowerCase()) throw new Error('Este e-mail é do administrador principal (.env)');
  const sen = String(b.senha || '');
  if (sen && (sen.length < 8 || !/[a-zA-Z]/.test(sen) || !/\d/.test(sen))) throw new Error('Senha fraca: mínimo 8 caracteres, com letras e números');
  if (!old.hash && !sen) throw new Error('Defina uma senha inicial');
  if (all('usuarios').some((u) => u.email.toLowerCase() === email && u.id !== req.params.id)) throw new Error('E-mail já cadastrado');
  if (req.params.id === req.user.id && b.ativo === false) throw new Error('Você não pode desativar o próprio acesso');
  const u = put('usuarios', { ...old, id: req.params.id, nome: String(b.nome).trim().slice(0, 80), email, tel: String(b.tel || '').slice(0, 20), cargo: String(b.cargo || '').slice(0, 60), papel,
    modulos: Array.isArray(b.modulos) ? b.modulos.filter((m) => TODOS_MODULOS.includes(m)) : [], publicar: b.publicar === undefined ? PERFIS[papel].pub : !!b.publicar, ativo: b.ativo !== false,
    hash: sen ? await bcrypt.hash(sen, 10) : old.hash, criado: old.criado || now() });
  res.json(userPub(u));
}));
app.delete('/api/admin/usuarios/:id', auth('admin'), (req, res) => { if (req.params.id === req.user.id) return res.status(400).json({ error: 'Você não pode excluir o próprio acesso' }); q.del.run('usuarios', req.params.id); res.json({ ok: true }); });
app.get('/api/admin/bootstrap', auth(), (req, res) => {
  const LEITURA = { posts: ['posts', 'redacao'], videos: ['videos', 'redes'], oracoes: ['oracoes'], musicas: ['oracoes'], produtos: ['produtos', 'estoque', 'loja', 'pedidos', 'promocoes', 'publicidade', 'campanhas', 'atendimento'], cupons: ['cupons', 'campanhas', 'loja'], promocoes: ['promocoes', 'loja', 'produtos'], pedidos: ['pedidos', 'loja', 'financeiro', 'clientes', 'atendimento'], conversas: ['atendimento'], anuncios: ['publicidade'], comentarios: ['comentarios'] };
  const o = {}; for (const c of COLS) o[c] = can(req.user, LEITURA[c] || COL_MOD[c]) ? all(c) : (c === 'posts' ? all(c).filter((p) => p.status === 'publicado') : []);
  o.conversas.forEach((c) => delete c.k);
  if (papelOk(req.user.papel) === 'admin') o.usuarios = all('usuarios').map(userPub);
  o.me = { ...req.user, modulos: modsDe(req.user), publicar: pubDe(req.user) };
  o.pedidos.sort((a, b) => b.data.localeCompare(a.data)); o.oracoes.sort((a, b) => b.data.localeCompare(a.data));
  const s = { ...settings() }; delete s.id; o.settings = s; res.json(o);
});
app.put('/api/admin/settings', auth(), (req, res) => {
  const body = { ...req.body }; delete body.senhaAdmin;
  if (!can(req.user, 'aparencia')) { const m = modsDe(req.user); const ok = Object.entries(SETTINGS_MOD).filter(([mod]) => m.includes(mod)).flatMap(([, ks]) => ks); for (const k of Object.keys(body)) if (!ok.includes(k)) delete body[k]; }
  const s = { ...settings(), ...body, id: 'main' }; put('settings', s); res.json(s);
});
app.post('/api/admin/orders/:id/status', auth('pedidos'), ok((req, res) => {
  const o = get('pedidos', req.params.id); if (!o) throw new Error('Pedido não encontrado');
  const st = req.body.status; const LBL = { separacao: 'Em separação', enviado: 'Enviado', entregue: 'Entregue', cancelado: 'Cancelado', estornado: 'Estornado' };
  if (st === 'pago') return res.json(markPaid(o, 'Pagamento confirmado manualmente no painel'));
  if (!LBL[st]) throw new Error('Status inválido');
  if (['cancelado', 'estornado'].includes(st) && ['pago', 'separacao', 'enviado', 'entregue'].includes(o.status)) restock(o);
  o.status = st; o.historico.push({ d: now(), s: 'Status: ' + LBL[st] }); put('pedidos', o); res.json(o);
}));
app.put('/api/admin/:col/:id', auth(), (req, res) => {
  const { col, id } = req.params; if (!COLS.includes(col)) return res.status(404).end();
  if (!can(req.user, COL_MOD[col])) return res.status(403).json({ error: 'Seu perfil não tem acesso a esta área.' });
  const doc = { ...req.body, id };
  if (col === 'posts' && !pubDe(req.user)) { // jornalista/colunista: só as próprias matérias, sempre para revisão
    const old = get('posts', id);
    if (old && (old.autorId !== req.user.id || old.status === 'publicado')) return res.status(403).json({ error: 'Somente o editor pode alterar esta matéria.' });
    doc.autorId = req.user.id; if (doc.status === 'publicado') doc.status = 'revisao';
  }
  if (col === 'posts' && !doc.autorId) doc.autorId = req.user.id;
  if (col === 'anuncios') { const old = get('anuncios', id) || {}; doc.views = +old.views || 0; doc.clicks = +old.clicks || 0; }
  res.json(put(col, doc));
});
app.delete('/api/admin/:col/:id', auth(), (req, res) => {
  const { col, id } = req.params; if (!COLS.includes(col) || col === 'pedidos') return res.status(400).json({ error: 'Não permitido' });
  if (!can(req.user, COL_MOD[col])) return res.status(403).json({ error: 'Seu perfil não tem acesso a esta área.' });
  if (col === 'posts' && !pubDe(req.user)) { const old = get('posts', id); if (old && (old.autorId !== req.user.id || old.status === 'publicado')) return res.status(403).json({ error: 'Somente o editor pode excluir esta matéria.' }); }
  q.del.run(col, id); res.json({ ok: true });
});



/* ------------------------------------------------ CONTAS DE CLIENTES + E-MAIL */
const mailer = SMTP_HOST ? nodemailer.createTransport({ host: SMTP_HOST, port: +SMTP_PORT, secure: +SMTP_PORT === 465, auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined }) : null;
const SITE = () => (SITE_URL || PUBLIC_URL).replace(/\/$/, '');
async function sendMail(to, subject, html, headers) {
  if (!mailer) { const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.endsWith('#loja')); console.log(`[e-mail não configurado — configure SMTP no .env] Para: ${to} | ${subject}${links.length ? '\n  Links: ' + links.join('  ') : ''}`); return false; }
  await mailer.sendMail({ from: SMTP_FROM || SMTP_USER, to, subject, html, headers }); return true;
}
const escH = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function mailLayout(corpo, rodape = '') {
  const logo = `${SITE()}/assets/logo-farol-fm.png`;
  return `<!doctype html><html><body style="margin:0;background:#f4f1ef;font-family:Arial,Helvetica,sans-serif;color:#23141A">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table width="100%" style="max-width:600px;background:#fff;border-radius:14px;overflow:hidden" cellpadding="0" cellspacing="0">
  <tr><td style="background:#B5162E;background:linear-gradient(120deg,#F39A30,#B5162E);padding:22px;text-align:center"><img src="${logo}" alt="FAROL FM" height="34" style="height:34px"></td></tr>
  <tr><td style="padding:26px 28px;font-size:15px;line-height:1.6">${corpo}</td></tr></table>
  <p style="font-size:11.5px;color:#8a7a7e;max-width:560px;margin:14px auto 0;line-height:1.5">${rodape}Farol FM · ${escH(settings().cidade || '')}</p></td></tr></table></body></html>`;
}
const btnMail = (href, txt) => `<p style="text-align:center;margin:24px 0"><a href="${href}" style="background:#B5162E;color:#fff;text-decoration:none;padding:13px 24px;border-radius:8px;font-weight:bold;display:inline-block">${txt}</a></p>`;

// validação de e-mail (formato, erros comuns, descartáveis, regras do Gmail e domínio com servidor de e-mail)
const EMAIL_RE = /^(?=.{6,254}$)(?=.{1,64}@)[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const DESCARTAVEIS = new Set(['mailinator.com', '10minutemail.com', 'guerrillamail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'throwawaymail.com', 'emailondeck.com', 'mintemail.com', 'mohmal.com', 'tempail.com', 'moakt.com', 'tempmailo.com', 'emailfake.com', 'spamgourmet.com', 'mailnesia.com', 'burnermail.io', 'tmail.ws']);
const TYPOS = { 'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gnail.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.com.br': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'outlok.com': 'outlook.com', 'yaho.com.br': 'yahoo.com.br', 'bol.com': 'bol.com.br', 'uol.com': 'uol.com.br' };
const mxCache = new Map();
async function validarEmail(e) {
  e = String(e || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new Error('E-mail com formato inválido');
  const [l, d] = e.split('@');
  if (/^\.|\.$|\.\./.test(l)) throw new Error('E-mail inválido');
  if (TYPOS[d]) throw new Error(`Você quis dizer ${l}@${TYPOS[d]}?`);
  if (DESCARTAVEIS.has(d)) throw new Error('E-mails temporários não são aceitos');
  if ((d === 'gmail.com' || d === 'googlemail.com') && !/^[a-z0-9]{6,30}$/.test(l.split('+')[0].replace(/\./g, ''))) throw new Error('Endereço Gmail inválido');
  const CONHECIDOS = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com', 'proton.me', 'protonmail.com', 'zoho.com'];
  if (CONHECIDOS.includes(d)) return e;
  if (!mxCache.has(d)) {
    let ok = false;
    const tmo = (pr) => Promise.race([pr, new Promise((_, r) => setTimeout(() => r(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 4000))]);
    try { ok = (await tmo(dns.resolveMx(d))).length > 0; }
    catch (err) {
      if (err.code === 'ENOTFOUND') { try { await tmo(dns.resolveMx('gmail.com')); ok = false; } catch { ok = true; } } // domínio não existe (se o DNS do servidor estiver fora, não bloqueia)
      else if (err.code === 'ENODATA') { try { ok = (await tmo(dns.resolve4(d))).length > 0; } catch { ok = false; } } // sem MX: aceita se tiver endereço (RFC 5321)
      else ok = true;                                                                    // DNS fora do ar/lento: não bloqueia o cliente
    }
    mxCache.set(d, ok);
  }
  if (!mxCache.get(d)) throw new Error(`O domínio “${d}” não recebe e-mails. Confira o endereço.`);
  return e;
}
const senhaOk = (p) => String(p || '').length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p);
const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const contaPub = (c) => ({ id: c.id, nome: c.nome, email: c.email, tel: c.tel || '', optin: !!c.optin, interesses: c.interesses || [], status: c.status, origem: c.origem, criado: c.criado });
const findConta = (email) => all('contas').find((c) => c.email === String(email || '').toLowerCase().trim());
const tokenCliente = (c) => jwt.sign({ sub: c.id, tipo: 'cliente' }, JWT_SECRET, { expiresIn: '60d' });
const authCliente = (req, res, next) => {
  try { const t = jwt.verify(String(req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); if (t.tipo !== 'cliente') throw 0; req.conta = get('contas', t.sub); if (!req.conta) throw 0; next(); }
  catch { res.status(401).json({ error: 'Sessão expirada. Entre novamente.' }); }
};
async function enviarConfirmacao(c) {
  const t = crypto.randomBytes(24).toString('hex'); c.confToken = tokenHash(t); c.confExp = Date.now() + 48 * 3600e3; put('contas', c);
  const link = `${PUBLIC_URL}/api/conta/confirmar?t=${t}`;
  const cupom = settings().cupomBoasVindas;
  return sendMail(c.email, 'Confirme seu e-mail — Farol FM', mailLayout(`<h2 style="color:#B5162E;margin-top:0">Olá, ${escH(c.nome.split(' ')[0])}! 👋</h2><p>Falta só um passo para ativar sua conta na loja da Farol FM. Clique no botão para confirmar que este e-mail é seu:</p>${btnMail(link, 'Confirmar meu e-mail')}${cupom ? `<p style="text-align:center">Depois de confirmar, use o cupom de boas-vindas <b style="font-size:18px;letter-spacing:2px">${escH(cupom)}</b> 🎁</p>` : ''}<p style="font-size:12.5px;color:#8a7a7e">O link vale por 48 horas. Se você não criou esta conta, ignore esta mensagem.</p>`));
}
app.post('/api/conta/cadastro', limit(8, 10 * 60e3), ok(async (req, res) => {
  const { nome, email, senha, tel, optin, interesses } = req.body || {};
  if (String(nome || '').trim().length < 3) throw new Error('Informe seu nome completo');
  const em = await validarEmail(email);
  if (!senhaOk(senha)) throw new Error('Senha fraca: mínimo 8 caracteres, com letras e números');
  const old = findConta(em);
  if (old && old.status === 'ativo') throw new Error('Já existe uma conta com este e-mail. Faça login.');
  const c = { ...(old || { id: uid(), criado: now() }), nome: String(nome).trim().slice(0, 80), email: em, hash: await bcrypt.hash(senha, 10), tel: String(tel || '').replace(/\D/g, '').slice(0, 11), optin: !!optin, optinData: optin ? now() : null, optinIp: optin ? req.ip : null, interesses: Array.isArray(interesses) ? interesses.slice(0, 10).map(String) : [], status: 'pendente', origem: 'email', unsub: crypto.randomBytes(16).toString('hex') };
  put('contas', c); await enviarConfirmacao(c);
  res.json({ ok: true, pendente: true });
}));
app.get('/api/conta/confirmar', (req, res) => {
  const h = tokenHash(req.query.t || ''); const c = all('contas').find((x) => x.confToken === h);
  if (!c || c.confExp < Date.now()) return res.status(400).send(mailLayout('<h2>Link inválido ou expirado</h2><p>Faça login na loja para receber um novo link de confirmação.</p>'));
  c.status = 'ativo'; c.confirmado = now(); delete c.confToken; delete c.confExp; put('contas', c);
  res.redirect(`${SITE()}/#conta-confirmada`);
});
app.post('/api/conta/reenviar', limit(3, 10 * 60e3), ok(async (req, res) => { const c = findConta(req.body.email); if (c && c.status === 'pendente') await enviarConfirmacao(c); res.json({ ok: true }); }));
app.post('/api/conta/login', limit(10, 10 * 60e3), ok(async (req, res) => {
  const c = findConta(req.body.email);
  if (!c || !c.hash || !(await bcrypt.compare(String(req.body.senha || ''), c.hash))) throw new Error(c && !c.hash ? 'Esta conta usa o login do Google' : 'E-mail ou senha incorretos');
  if (c.status !== 'ativo') { const e = new Error('Confirme seu e-mail para entrar'); e.code = 'pendente'; return res.status(403).json({ error: e.message, code: 'pendente' }); }
  res.json({ token: tokenCliente(c), me: contaPub(c) });
}));
app.post('/api/conta/google', limit(10), ok(async (req, res) => {
  const cid = GOOGLE_CLIENT_ID || settings().googleClientId; if (!cid) throw new Error('Login com Google não configurado');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(req.body.credential || ''));
  const g = await r.json();
  if (!r.ok || g.aud !== cid || !['accounts.google.com', 'https://accounts.google.com'].includes(g.iss) || String(g.email_verified) !== 'true' || +g.exp * 1000 < Date.now()) throw new Error('Não foi possível validar sua conta Google');
  let c = findConta(g.email); const novo = !c;
  if (!c) c = { id: uid(), criado: now(), nome: g.name || g.email.split('@')[0], email: g.email.toLowerCase(), tel: '', optin: false, interesses: [], origem: 'google', unsub: crypto.randomBytes(16).toString('hex') };
  c.status = 'ativo'; c.googleSub = g.sub; if (!c.confirmado) c.confirmado = now(); put('contas', c);
  res.json({ token: tokenCliente(c), me: contaPub(c), novo });
}));
app.get('/api/conta/me', authCliente, (req, res) => res.json({ me: contaPub(req.conta), pedidos: all('pedidos').filter((o) => String(o.cliente?.email).toLowerCase() === req.conta.email).sort((a, b) => b.data.localeCompare(a.data)) }));
app.put('/api/conta/me', authCliente, (req, res) => {
  const c = req.conta; const b = req.body || {};
  if (b.nome && String(b.nome).trim().length >= 3) c.nome = String(b.nome).trim().slice(0, 80);
  if (b.tel !== undefined) c.tel = String(b.tel).replace(/\D/g, '').slice(0, 11);
  if (b.optin !== undefined) { c.optin = !!b.optin; c.optinData = now(); c.optinIp = req.ip; }
  if (Array.isArray(b.interesses)) c.interesses = b.interesses.slice(0, 10).map(String);
  put('contas', c); res.json(contaPub(c));
});
app.delete('/api/conta/me', authCliente, (req, res) => { q.del.run('contas', req.conta.id); res.json({ ok: true }); });
app.post('/api/conta/esqueci', limit(3, 10 * 60e3), ok(async (req, res) => {
  const c = findConta(req.body.email);
  if (c && c.hash) { const t = crypto.randomBytes(24).toString('hex'); c.resetToken = tokenHash(t); c.resetExp = Date.now() + 3600e3; put('contas', c);
    await sendMail(c.email, 'Criar nova senha — Farol FM', mailLayout(`<h2 style="margin-top:0">Esqueceu a senha?</h2><p>Clique para criar uma nova senha (o link vale por 1 hora):</p>${btnMail(`${SITE()}/#conta-redefinir-${t}`, 'Criar nova senha')}<p style="font-size:12.5px;color:#8a7a7e">Se não foi você, ignore este e-mail — sua senha continua a mesma.</p>`)); }
  res.json({ ok: true }); // resposta igual exista ou não a conta (não revela e-mails cadastrados)
}));
app.post('/api/conta/redefinir', limit(5, 10 * 60e3), ok(async (req, res) => {
  const h = tokenHash(req.body.t || ''); const c = all('contas').find((x) => x.resetToken === h);
  if (!c || c.resetExp < Date.now()) throw new Error('Link inválido ou expirado');
  if (!senhaOk(req.body.senha)) throw new Error('Senha fraca: mínimo 8 caracteres, com letras e números');
  c.hash = await bcrypt.hash(req.body.senha, 10); delete c.resetToken; delete c.resetExp; if (c.status === 'pendente') c.status = 'ativo'; put('contas', c);
  res.json({ ok: true });
}));
app.get('/api/conta/descadastrar', (req, res) => {
  const c = all('contas').find((x) => x.unsub && x.unsub === req.query.t);
  if (c) { c.optin = false; c.optinData = now(); put('contas', c); }
  res.send(mailLayout(c ? `<h2 style="margin-top:0">Pronto, ${escH(c.nome.split(' ')[0])}.</h2><p>Você não vai mais receber promoções da Farol FM por e-mail. Se mudar de ideia, é só ativar em <a href="${SITE()}/#conta">Minha conta</a>.</p>` : '<h2>Link inválido</h2>'));
});

// Painel: contas e campanhas
app.get('/api/admin/contas', auth(['clientes', 'campanhas']), (req, res) => res.json(all('contas').map(contaPub).sort((a, b) => String(b.criado).localeCompare(a.criado))));
app.get('/api/admin/campanhas', auth('campanhas'), (req, res) => res.json(all('campanhas').sort((a, b) => b.data.localeCompare(a.data))));
function mailCampanha(cp, c) {
  const ps = (cp.prods || []).slice(0, 6).map((id) => get('produtos', id)).filter((p) => p && p.ativo);
  const nome = c ? escH(c.nome.split(' ')[0]) : 'cliente';
  const titulo = escH(cp.titulo || 'Olá, {nome}!').replace(/\{nome\}/g, nome);
  const cards = ps.map((p) => `<td width="33%" style="padding:6px;vertical-align:top;text-align:center"><a href="${SITE()}/#produto-${p.id}" style="text-decoration:none;color:#23141A">${/^https?:/.test(p.imagem || '') ? `<img src="${p.imagem}" width="160" style="width:100%;border-radius:8px">` : ''}<div style="font-size:13px;font-weight:bold;margin-top:6px">${escH(p.nome)}</div><div style="color:#B5162E;font-weight:bold">R$ ${priceOf(p).toFixed(2).replace('.', ',')}</div></a></td>`);
  const rows = []; for (let i = 0; i < cards.length; i += 3) rows.push(`<tr>${cards.slice(i, i + 3).join('')}</tr>`);
  const unsub = c ? `${PUBLIC_URL}/api/conta/descadastrar?t=${c.unsub}` : '#';
  return { unsub, html: mailLayout(`<h2 style="color:#B5162E;margin-top:0">${titulo}</h2><p style="white-space:pre-wrap">${escH(cp.texto || '').replace(/\{nome\}/g, nome)}</p>${cp.cupom ? `<div style="border:2px dashed #F39A30;border-radius:10px;padding:12px;text-align:center;margin:16px 0">Use o cupom <b style="font-size:20px;letter-spacing:2px">${escH(cp.cupom)}</b></div>` : ''}${rows.length ? `<table width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>` : ''}${btnMail(`${SITE()}/#loja`, 'Ver ofertas na loja')}`, `Você recebe este e-mail porque autorizou promoções da Farol FM. <a href="${unsub}" style="color:#8a7a7e">Não quero mais receber</a>.<br>`) };
}
app.post('/api/admin/campanhas/teste', auth('campanhas'), ok(async (req, res) => {
  const { html } = mailCampanha(req.body, { nome: req.user.nome, unsub: '' });
  const ok = await sendMail(req.user.sub, '[TESTE] ' + (req.body.assunto || ''), html);
  if (!ok) throw new Error('Envio de e-mail não configurado (SMTP no .env)'); res.json({ ok: true });
}));
app.post('/api/admin/campanhas', auth('campanhas'), ok(async (req, res) => {
  if (!mailer) throw new Error('Configure o envio de e-mail (SMTP) no .env antes de disparar campanhas');
  const cp = { id: uid(), assunto: String(req.body.assunto || '').slice(0, 150), titulo: req.body.titulo, texto: req.body.texto, cupom: req.body.cupom, prods: req.body.prods || [], seg: req.body.seg || '', data: now(), por: req.user.nome, enviados: 0, falhas: 0, status: 'enviando' };
  if (!cp.assunto) throw new Error('Escreva o assunto');
  const alvo = all('contas').filter((c) => c.status === 'ativo' && c.optin && (!cp.seg || (c.interesses || []).includes(cp.seg)));
  cp.total = alvo.length; put('campanhas', cp); res.json(cp);
  for (const c of alvo) { // envio em ritmo controlado (≈ 5/s) para não ser marcado como spam
    try { const { html, unsub } = mailCampanha(cp, c); await sendMail(c.email, cp.assunto, html, { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }); cp.enviados++; }
    catch (e) { cp.falhas++; console.error('Campanha:', c.email, e.message); }
    if ((cp.enviados + cp.falhas) % 10 === 0) put('campanhas', cp);
    await new Promise((r) => setTimeout(r, 200));
  }
  cp.status = 'concluida'; put('campanhas', cp);
}));
// One-click unsubscribe (RFC 8058) usado pelo Gmail
app.post('/api/conta/descadastrar', (req, res) => { const c = all('contas').find((x) => x.unsub && x.unsub === req.query.t); if (c) { c.optin = false; c.optinData = now(); put('contas', c); } res.json({ ok: true }); });

/* ------------------------------------------------ ATENDIMENTO (robô → humano) */
const pubConv = (c) => { const o = { ...c }; delete o.k; return o; };
const touch = (c) => { c.atualizado = now(); return put('conversas', c); };
const MENU_ROWS = [['loja', '🛍️ Comprar na loja', 'Produtos, ofertas e preços'], ['pedido', '📦 Meu pedido', 'Status e rastreio'], ['musica', '🎶 Pedir música', 'Seu pedido vai ao estúdio'], ['oracao', '🙏 Pedido de oração', 'Nossa equipe ora por você'], ['anunciar', '📢 Anunciar na Farol', 'Fale com o comercial'], ['humano', '👤 Falar com vendedor', 'Atendimento com uma pessoa']];

// Chat do site (modo servidor): o navegador manda as mensagens do cliente e do robô; o atendente responde pelo painel
app.post('/api/chat/:id', limit(60), ok((req, res) => {
  const id = String(req.params.id).slice(0, 40); const b = req.body || {};
  let c = get('conversas', id);
  if (!c) c = { id, k: String(b.k || '').slice(0, 64), canal: 'site', msgs: [], modo: 'bot', criado: now() };
  if (!b.k || c.k !== b.k) return res.status(403).json({ error: 'Conversa inválida' });
  for (const m of (b.msgs || []).slice(0, 20)) if (['cliente', 'bot', 'sys'].includes(m.de)) c.msgs.push({ d: now(), de: m.de, txt: String(m.txt || '').slice(0, 2000), op: m.op, prods: m.prods });
  c.msgs = c.msgs.slice(-300);
  Object.assign(c, { nome: String(b.nome || c.nome || '').slice(0, 60), contato: String(b.contato || c.contato || '').replace(/\D/g, '').slice(0, 15), setor: b.setor || c.setor || '', motivo: String(b.motivo || c.motivo || '').slice(0, 300), protocolo: b.protocolo || c.protocolo });
  if (b.modo === 'fila' && c.modo === 'bot') { c.modo = 'fila'; notifyVendedores(c); }
  if (b.modo === 'bot' && c.modo !== 'bot') c.modo = 'bot';
  res.json(pubConv(touch(c)));
}));
app.get('/api/chat/:id', (req, res) => { const c = get('conversas', req.params.id); if (!c || c.k !== req.query.k) return res.status(404).end(); res.json(pubConv(c)); });
app.post('/api/chat/:id/ia', limit(20), ok(async (req, res) => {
  const c = get('conversas', req.params.id); if (!c || c.k !== req.body.k) return res.status(404).end();
  const r = await aiReply(c); if (!r) return res.status(404).json({ error: 'IA desligada' });
  c.msgs.push({ d: now(), de: 'bot', txt: r.resposta }); touch(c);
  res.json({ resposta: r.resposta, humano: r.humano, conv: pubConv(c) });
}));

// Painel: inbox
app.get('/api/admin/conversas', auth('atendimento'), (req, res) => res.json(all('conversas').map(pubConv).sort((a, b) => String(b.atualizado).localeCompare(a.atualizado)).slice(0, 300)));
app.post('/api/admin/conversas/:id/reply', auth('atendimento'), ok(async (req, res) => {
  const c = get('conversas', req.params.id); if (!c) throw new Error('Conversa não encontrada');
  const txt = String(req.body.texto || '').trim().slice(0, 4000); if (!txt) throw new Error('Mensagem vazia');
  if (c.modo !== 'humano') { c.modo = 'humano'; c.atendente = req.user.nome; }
  if (c.canal === 'whatsapp') await waText(c.contato, `*${req.user.nome} · Farol FM*\n${txt}`);
  c.msgs.push({ d: now(), de: 'atendente', txt, por: req.user.nome }); res.json(pubConv(touch(c)));
}));
app.post('/api/admin/conversas/:id/:acao', auth('atendimento'), ok(async (req, res) => {
  const c = get('conversas', req.params.id); if (!c) throw new Error('Conversa não encontrada');
  if (req.params.acao === 'assumir') { c.modo = 'humano'; c.atendente = req.user.nome; c.msgs.push({ d: now(), de: 'sys', txt: `${req.user.nome} entrou no atendimento` }); }
  else if (req.params.acao === 'encerrar') {
    c.modo = 'bot'; c.estado = 'menu'; c.msgs.push({ d: now(), de: 'sys', txt: 'Atendimento encerrado' });
    const txt = 'Obrigado pelo contato! 💛 Se precisar de algo mais, é só escolher uma opção:';
    c.msgs.push({ d: now(), de: 'bot', txt, op: MENU_ROWS.map(([id, t]) => [id, t]) });
    if (c.canal === 'whatsapp') await waList(c.contato, txt, 'Ver opções', MENU_ROWS).catch(() => {});
  } else throw new Error('Ação inválida');
  res.json(pubConv(touch(c)));
}));

/* IA opcional: responde perguntas livres usando só o catálogo e as regras da loja */
async function aiReply(c) {
  if (!AI_API_KEY) return null;
  const s = settings();
  const prods = all('produtos').filter((p) => p.ativo).map((p) => `- ${p.nome} (${p.categoria}): R$ ${priceOf(p).toFixed(2)}${+p.estoque > 0 ? '' : ' [esgotado]'}${p.variacoes ? ` · opções: ${p.variacoes}` : ''}`).join('\n');
  const system = `Você é o ${s.botNome || 'assistente'}, atendente virtual da ${s.nome || 'Farol FM'} (rádio cristã, portal de notícias e loja) em ${s.cidade || ''}. Responda em português do Brasil, com no máximo 3 frases curtas, cordial e respeitoso. Use SOMENTE as informações abaixo; nunca invente preços, prazos, estoques ou políticas. Para comprar, oriente a usar o site ${SITE_URL || ''}. Se o cliente quiser negociar, comprar em quantidade, reclamar, falar de pagamento já feito ou pedir algo fora destas informações, diga que vai chamar um vendedor e termine com a marca [HUMANO].
Pagamento: PIX com ${s.pixDesconto || 0}% de desconto; cartão em até ${s.parcelasMax}x (${s.parcelasSemJuros}x sem juros). Frete R$ ${s.frete} (grátis acima de R$ ${s.freteGratisAcima}). Retirada: ${s.retirada ? s.enderecoRetirada : 'não disponível'}. Vendedores: ${s.horarioAtendimento}.
Produtos:
${prods}`;
  const msgs = [];
  for (const m of c.msgs.slice(-12)) {
    if (m.de === 'sys') continue; const role = m.de === 'cliente' ? 'user' : 'assistant';
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + m.txt; else msgs.push({ role, content: m.txt });
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': AI_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: AI_MODEL, max_tokens: 350, system, messages: msgs }) });
    const j = await r.json(); const txt = (j.content || []).map((x) => x.text || '').join('').trim(); if (!txt) return null;
    return { resposta: txt.replace(/\[HUMANO\]/g, '').trim(), humano: /\[HUMANO\]/.test(txt) };
  } catch (e) { console.error('IA:', e.message); return null; }
}

/* WhatsApp Cloud API (oficial da Meta) */
async function waSend(to, payload) {
  if (!WA_TOKEN || !WA_PHONE_ID || !to) return;
  const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }) });
  if (!r.ok) console.error('WhatsApp envio:', await r.text());
}
const waText = (to, body) => waSend(to, { type: 'text', text: { body: body.slice(0, 4096), preview_url: true } });
const waButtons = (to, body, btns) => waSend(to, { type: 'interactive', interactive: { type: 'button', body: { text: body.slice(0, 1024) }, action: { buttons: btns.slice(0, 3).map(([id, t]) => ({ type: 'reply', reply: { id, title: t.slice(0, 20) } })) } } });
const waList = (to, body, button, rows) => waSend(to, { type: 'interactive', interactive: { type: 'list', body: { text: body.slice(0, 1024) }, action: { button: button.slice(0, 20), sections: [{ title: 'Opções', rows: rows.slice(0, 10).map(([id, t, d]) => ({ id: id.slice(0, 200), title: t.slice(0, 24), description: (d || '').slice(0, 72) })) }] } } });
function notifyVendedores(c) {
  const nums = WA_VENDEDORES.split(',').map((x) => x.replace(/\D/g, '')).filter(Boolean);
  // Observação: mensagem livre só chega se o vendedor falou com o número da empresa nas últimas 24h; para garantir, use um modelo (template) aprovado.
  for (const n of nums) waText(n, `🔔 *Novo cliente na fila* (${c.setor || 'vendas'})\n${c.nome || 'Cliente'} · ${c.canal === 'whatsapp' ? '+' + c.contato : 'chat do site'}\nProtocolo #${c.protocolo}\n📝 ${c.motivo || '-'}\nResponda pelo painel: Atendimento WhatsApp.`).catch(() => {});
}
const normTxt = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
function intentOf(t) {
  t = normTxt(t);
  if (/atendente|humano|vendedor|pessoa|falarcom|consultor/.test(t)) return 'humano';
  if (/pedido|entrega|rastre|comprei|chegou/.test(t)) return 'pedido';
  if (/comprar|loja|produto|preco|camis|biblia|livro|oferta|promo|quanto/.test(t)) return 'loja';
  if (/musica|louvor|tocar|cantor|hino/.test(t)) return 'musica';
  if (/oracao|orar|oremos|prece/.test(t)) return 'oracao';
  if (/anunci|propaganda|patrocin|comercial|publicidade/.test(t)) return 'anunciar';
  if (/^(oi|ola|opa|bomdia|boatarde|boanoite|menu|inicio|eai|paz|0)$/.test(t) || t.length <= 3) return 'menu';
  return '';
}

async function waBot(c, v, t) {
  const to = c.contato; const s = settings(); const site = (SITE_URL || PUBLIC_URL).replace(/\/$/, '');
  const say = async (txt, send) => { c.msgs.push({ d: now(), de: 'bot', txt }); touch(c); await send(); };
  const menu = (pre) => { c.estado = 'menu'; const txt = pre || `Olá${c.nome ? ', ' + c.nome.split(' ')[0] : ''}! 👋 Eu sou o *${s.botNome || 'Assistente Farol'}*, assistente virtual da Farol FM.\nComo posso te ajudar?`; return say(txt, () => waList(to, txt, 'Ver opções', MENU_ROWS)); };
  if (c.modo === 'fila' || c.modo === 'humano') { if (v === 'voltarbot') { c.modo = 'bot'; return menu('Tudo bem! Voltei a te atender. 🤖'); } return; } // atendente humano responde pelo painel
  const cats = String(s.catLoja || '').split(',').map((x) => x.trim()).filter(Boolean);
  const it = v || (c.estado && c.estado !== 'menu' ? '' : intentOf(t));
  if (it === 'menu') return menu();
  if (it === 'loja') { c.estado = 'loja'; const txt = 'Que bom! 😍 Escolha uma categoria:'; return say(txt, () => waList(to, txt, 'Categorias', [['ofertas', '🔥 Ofertas', 'Promoções da semana'], ...cats.map((x, i) => ['cat:' + i, x, ''])])); }
  if (it === 'ofertas' || it.startsWith('cat:')) {
    const cat = it === 'ofertas' ? null : cats[+it.slice(4)];
    const ps = all('produtos').filter((p) => p.ativo && +p.estoque > 0 && (cat ? p.categoria === cat : priceOf(p) < +p.preco || p.destaque)).slice(0, 10);
    if (!ps.length) return menu('Ops, não temos itens disponíveis aí agora. 😕 Posso ajudar em algo mais?');
    const txt = `Separei ${ps.length} opção(ões) 👇${s.pixDesconto ? `\n💚 PIX com ${s.pixDesconto}% de desconto!` : ''}`;
    return say(txt, () => waList(to, txt, 'Ver produtos', ps.map((p) => ['p:' + p.id, p.nome, `R$ ${priceOf(p).toFixed(2).replace('.', ',')}`])));
  }
  if (it.startsWith('p:')) {
    const p = get('produtos', it.slice(2)); if (!p) return menu();
    const txt = `*${p.nome}*\n💰 R$ ${priceOf(p).toFixed(2).replace('.', ',')}${s.pixDesconto ? ` (no PIX: R$ ${(priceOf(p) * (1 - s.pixDesconto / 100)).toFixed(2).replace('.', ',')})` : ''}\n${p.variacoes ? `Opções: ${p.variacoes}\n` : ''}${p.descricao || ''}\n\n🛒 Comprar agora: ${site}/#add-${p.id}`;
    if (/^https?:/.test(p.imagem || '')) await waSend(to, { type: 'image', image: { link: p.imagem } });
    return say(txt, () => waButtons(to, txt, [['humano', '👤 Falar c/ vendedor'], ['loja', '🔎 Ver mais'], ['menu', '🏠 Menu']]));
  }
  if (it === 'pedido') { c.estado = 'pedido'; const txt = 'Me diga o *número do pedido* (ex.: FF12345678) 📦'; return say(txt, () => waText(to, txt)); }
  if (it === 'musica') { c.estado = 'musica'; const txt = '🎶 Qual música e cantor você quer ouvir? Mande também sua cidade e um recado!'; return say(txt, () => waText(to, txt)); }
  if (it === 'oracao') { c.estado = 'oracao'; const txt = '🙏 Escreva seu pedido de oração. Nossa equipe vai orar por você.'; return say(txt, () => waText(to, txt)); }
  if (it === 'anunciar' || it === 'humano') { c.setor = it === 'anunciar' ? 'comercial' : 'vendas'; c.estado = 'h_motivo'; const txt = `Vou te passar para a equipe de ${c.setor === 'comercial' ? 'anúncios' : 'vendas'}! 🙌 Em poucas palavras, *o que você precisa?*`; return say(txt, () => waText(to, txt)); }
  // etapas com texto livre
  if (c.estado === 'pedido') {
    const id = String(t).toUpperCase().replace(/[^A-Z0-9]/g, ''); const o = get('pedidos', id);
    const tel = String(o?.cliente?.tel || '').replace(/\D/g, '');
    if (o && tel && to.endsWith(tel.slice(-8))) {
      c.estado = 'menu'; const ST = { aguardando: 'Aguardando pagamento', pago: 'Pago', separacao: 'Em separação', enviado: 'Enviado', entregue: 'Entregue', cancelado: 'Cancelado', recusado: 'Pagamento recusado', estornado: 'Estornado' };
      const txt = `📦 Pedido *#${o.id}*\nStatus: *${ST[o.status] || o.status}*\nTotal: R$ ${o.total.toFixed(2).replace('.', ',')}\n${o.itens.map((i) => `• ${i.qty}× ${i.nome}`).join('\n')}${o.rastreio ? `\nRastreio: *${o.rastreio}*` : ''}`;
      return say(txt, () => waButtons(to, txt, [['humano', '👤 Falar c/ vendedor'], ['menu', '🏠 Menu']]));
    }
    c.estado = 'menu'; const txt = 'Não encontrei um pedido com esse número ligado a este WhatsApp. 🤔 Quer falar com um vendedor?';
    return say(txt, () => waButtons(to, txt, [['humano', '👤 Falar c/ vendedor'], ['menu', '🏠 Menu']]));
  }
  if (c.estado === 'musica') { put('musicas', { id: uid(), nome: c.nome || 'Ouvinte', texto: String(t).slice(0, 600), origem: 'WhatsApp +' + to, lido: false, data: now() }); c.estado = 'menu'; const txt = 'Anotado! 📻 Seu pedido já está no estúdio. Fique ligado na Farol FM!'; return say(txt, () => waButtons(to, txt, [['menu', '🏠 Menu']])); }
  if (c.estado === 'oracao') { put('oracoes', { id: uid(), nome: c.nome || 'Ouvinte', cidade: '', texto: String(t).slice(0, 1200), noAr: false, lido: false, data: now() }); c.estado = 'menu'; const txt = 'Recebemos seu pedido. 🙏 Estamos orando por você e sua família!'; return say(txt, () => waButtons(to, txt, [['menu', '🏠 Menu']])); }
  if (c.estado === 'h_motivo') {
    c.motivo = String(t).slice(0, 300); c.modo = 'fila'; c.estado = 'fila'; c.protocolo = 'AT' + Date.now().toString().slice(-6);
    c.msgs.push({ d: now(), de: 'sys', txt: `Conversa transferida para ${c.setor} · protocolo #${c.protocolo}` });
    const txt = `✅ Prontinho! Protocolo *#${c.protocolo}*.\nVocê está na fila de ${c.setor === 'comercial' ? 'anúncios' : 'vendas'} e um atendente vai responder *aqui mesmo* (${s.horarioAtendimento}).`;
    notifyVendedores(c); return say(txt, () => waButtons(to, txt, [['voltarbot', '🤖 Voltar ao robô']]));
  }
  // texto livre sem etapa: IA (se ligada) ou menu
  const ai = await aiReply(c);
  if (ai) { await say(ai.resposta, () => waText(to, ai.resposta)); if (ai.humano) { c.setor = 'vendas'; c.estado = 'h_motivo'; const txt = 'Para eu te passar ao vendedor: em poucas palavras, o que você precisa?'; return say(txt, () => waText(to, txt)); } return; }
  return menu('Desculpe, não entendi muito bem. 😅 Escolha uma opção (ou digite *atendente*):');
}

// Webhook do WhatsApp: verificação (GET) e mensagens recebidas (POST)
app.get('/api/whatsapp/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === WA_VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.status(403).end();
});
app.post('/api/whatsapp/webhook', ok(async (req, res) => {
  if (WA_APP_SECRET) {
    const sig = String(req.headers['x-hub-signature-256'] || ''); const h = 'sha256=' + crypto.createHmac('sha256', WA_APP_SECRET).update(req.rawBody || '').digest('hex');
    if (sig.length !== h.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(h))) return res.status(401).end();
  }
  res.status(200).json({ ok: true }); // responde logo; o processamento segue
  for (const entry of req.body.entry || []) for (const ch of entry.changes || []) {
    const val = ch.value || {}; const names = Object.fromEntries((val.contacts || []).map((x) => [x.wa_id, x.profile?.name]));
    for (const m of val.messages || []) {
      const from = m.from; const id = 'wa' + from;
      const c = get('conversas', id) || { id, canal: 'whatsapp', contato: from, nome: names[from] || '', modo: 'bot', estado: 'menu', msgs: [], criado: now() };
      if (c.msgIds?.includes(m.id)) continue; c.msgIds = [...(c.msgIds || []), m.id].slice(-30);
      if (!c.nome && names[from]) c.nome = names[from];
      let v = '', t = '';
      if (m.type === 'text') t = m.text.body;
      else if (m.type === 'interactive') { const r = m.interactive.button_reply || m.interactive.list_reply || {}; v = r.id || ''; t = r.title || ''; }
      else t = `[${m.type}]`;
      c.msgs.push({ d: now(), de: 'cliente', txt: t }); c.msgs = c.msgs.slice(-300); touch(c);
      // após 12h sem conversa, volta ao robô
      if (c.modo === 'encerrada') c.modo = 'bot';
      if (WA_TOKEN && WA_PHONE_ID) fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: m.id }) }).catch(() => {});
      await waBot(c, v, t).catch((e) => console.error('Bot:', e.message));
    }
  }
}));

/* site estático (opcional: servir o front pelo mesmo domínio) */
const SITE_DIR = path.join(__dirname, '..', 'site');
app.get(['/', '/index.html'], (req, res) => {
  const html = fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8')
    .replace('<script>\n/* =', `<script>window.FAROL_API=location.origin;</script>\n<script>\n/* =`);
  res.type('html').send(html);
});
// imagem da matéria para a prévia: a foto enviada no painel (ou a capa gerada no deploy)
app.get('/n/:id/capa.jpg', (req, res, next) => {
  const p = get('posts', req.params.id); const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec((p && p.imagem) || '');
  if (!m) return next();
  res.type(m[1]).set('Cache-Control', 'public, max-age=3600').send(Buffer.from(m[2], 'base64'));
});
// prévia de compartilhamento de cada notícia (WhatsApp, Facebook, X): /n/<id>/ com os metadados da matéria
app.get(['/n/:id', '/n/:id/'], (req, res, next) => {
  const p = get('posts', req.params.id); if (!p || p.status !== 'publicado') return next();
  const base = `${req.protocol}://${req.get('host')}`; const E = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const temCapa = /^data:image\//.test(p.imagem || '') || fs.existsSync(path.join(SITE_DIR, 'n', p.id, 'capa.jpg'));
  const img = /^https?:/.test(p.imagem || '') ? p.imagem : temCapa ? `${base}/n/${encodeURIComponent(p.id)}/capa.jpg` : `${base}/assets/og-farol.jpg`;
  const t = p.titulo || 'Farol FM'; const r = p.resumo || String(p.corpo || '').slice(0, 180); const alvo = `/#post-${encodeURIComponent(p.id)}`;
  res.type('html').send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${E(t)} — Farol FM</title><meta name="description" content="${E(r)}">
<meta property="og:site_name" content="Farol FM"><meta property="og:locale" content="pt_BR"><meta property="og:type" content="article"><meta property="og:title" content="${E(t)}"><meta property="og:description" content="${E(r)}">
<meta property="og:url" content="${base}/n/${E(p.id)}/"><meta property="og:image" content="${E(img)}"><meta property="og:image:alt" content="${E(t)}"><meta property="article:published_time" content="${E(p.data)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${E(t)}"><meta name="twitter:description" content="${E(r)}"><meta name="twitter:image" content="${E(img)}">
<meta http-equiv="refresh" content="0;url=${E(alvo)}"><script>location.replace(${JSON.stringify(alvo)})</script></head><body><a href="${E(alvo)}">Abrir a notícia na Farol FM</a></body></html>`);
});
app.use(express.static(SITE_DIR));


/* ------------------------------------------------ RDS: música tocando agora */
// Lê o título do próprio streaming (metadados ICY do Shoutcast/Icecast) ou de um JSON do painel do streaming.
const npCache = { at: 0, data: null }; const capaCache = new Map();
async function lerICY(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': 'FarolFM-RDS/1.0' }, signal: ctl.signal });
    const metaint = +r.headers.get('icy-metaint'); if (!metaint || !r.body) return '';
    const reader = r.body.getReader(); let buf = Buffer.alloc(0);
    while (buf.length < metaint + 1 + 255 * 16) {
      const { value, done } = await reader.read(); if (done) break; buf = Buffer.concat([buf, Buffer.from(value)]);
      if (buf.length > metaint) { const len = buf[metaint] * 16; if (buf.length >= metaint + 1 + len) { const meta = buf.slice(metaint + 1, metaint + 1 + len).toString('utf8'); ctl.abort(); const m = meta.match(/StreamTitle='([^']*)'/); return m ? m[1] : ''; } }
    }
    ctl.abort(); return '';
  } catch { return ''; } finally { clearTimeout(t); }
}
async function lerJSONRDS(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'FarolFM-RDS/1.0' } }); const tx = await r.text(); let j; try { j = JSON.parse(tx); } catch { return tx.trim().slice(0, 200); }
    const src = j.icestats ? [].concat(j.icestats.source || [])[0] : null;
    if (src) return src.artist && src.title ? `${src.artist} - ${src.title}` : (src.title || '');
    if (j.songtitle) return j.songtitle;                                                   // Shoutcast v2 (/stats?sid=1&json=1)
    if (j.now_playing?.song) return `${j.now_playing.song.artist} - ${j.now_playing.song.title}`; // AzuraCast
    if (j.title) return j.artist ? `${j.artist} - ${j.title}` : j.title;
    return '';
  } catch { return ''; }
}
const tituloRDS = (t) => String(t || '').trim().toLowerCase().replace(/(^|[\s\-–—(\/"'“.&])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
async function capaDe(artista, musica) {
  const k = (artista + '|' + musica).toLowerCase(); if (capaCache.has(k)) return capaCache.get(k);
  let capa = '';
  try {
    const r = await fetch(`https://itunes.apple.com/search?country=BR&media=music&entity=song&limit=1&term=${encodeURIComponent(`${artista} ${musica}`.trim())}`);
    const j = await r.json(); const u = j.results?.[0]?.artworkUrl100; if (u) capa = u.replace('100x100bb', '400x400bb');
  } catch {}
  capaCache.set(k, capa); if (capaCache.size > 500) capaCache.delete(capaCache.keys().next().value);
  return capa;
}
app.get('/api/nowplaying', async (req, res) => {
  const s = settings(); if (s.rdsAtivo === false) return res.json({});
  if (Date.now() - npCache.at < 15e3 && npCache.data) return res.json(npCache.data);
  const raw = (s.rdsUrl ? await lerJSONRDS(s.rdsUrl) : s.streamUrl ? await lerICY(s.streamUrl) : '').replace(/\s+/g, ' ').trim();
  let data = {};
  // vinhetas, spots e textos vazios não viram "música"
  if (raw && !/^(-|n\/a|unknown|desconhecido|null)$/i.test(raw)) {
    const parts = raw.split(/\s+[-–—]\s+/); const artista = parts.length > 1 ? tituloRDS(parts[0]) : ''; const musica = tituloRDS(parts.length > 1 ? parts.slice(1).join(' - ') : raw);
    data = { raw, artista, musica, capa: artista ? await capaDe(artista, musica) : '' };
  }
  npCache.at = Date.now(); npCache.data = data; res.json(data);
});

/* ------------------------------------------------ REDES: YouTube + Instagram */
const social = { yt: [], ytAt: 0, ig: [], igAt: 0, igErr: '' };
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; FarolFM/1.0)', 'Accept-Language': 'pt-BR' };
const decode = (t) => String(t || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Últimos vídeos pelo feed RSS público do canal (não usa cota de API)
async function refreshYouTube() {
  const id = settings().ytChannelId; if (!id) return;
  try {
    const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`, { headers: UA })).text();
    social.yt = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
      id: (e.match(/<yt:videoId>([^<]+)/) || [])[1], titulo: decode((e.match(/<title>([^<]*)/) || [])[1]),
      data: (e.match(/<published>([^<]+)/) || [])[1], views: +((e.match(/views="(\d+)"/) || [])[1] || 0),
    })).filter((v) => v.id).slice(0, 15);
    social.ytAt = Date.now();
  } catch (e) { console.error('YouTube RSS:', e.message); }
}

// Detecção de live: com YT_API_KEY usa a API oficial; sem chave, consulta a página /live do canal
async function checkLive() {
  const s = settings(); if (!s.ytChannelId) return;
  let live = false, vid = '';
  try {
    if (YT_API_KEY) {
      const j = await (await fetch(`https://www.googleapis.com/youtube/v3/search?part=id&channelId=${encodeURIComponent(s.ytChannelId)}&eventType=live&type=video&key=${YT_API_KEY}`)).json();
      vid = j.items?.[0]?.id?.videoId || ''; live = !!vid;
    } else {
      const html = await (await fetch(`https://www.youtube.com/channel/${encodeURIComponent(s.ytChannelId)}/live`, { headers: UA })).text();
      live = /"isLiveNow":true/.test(html) || /"isLive":true/.test(html);
      vid = live ? ((html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})/) || html.match(/"videoId":"([\w-]{11})"/) || [])[1] || '') : '';
    }
  } catch (e) { return console.error('YouTube live:', e.message); }
  if (live !== !!s.aoVivo || (live && vid && vid !== s.ytVideoId)) {
    put('settings', { ...s, aoVivo: live, ytVideoId: live ? vid : '' }); console.log('YouTube ao vivo:', live, vid);
  }
}

// Instagram (API do Instagram com login do Instagram — conta profissional: Criador ou Empresa)
const igToken = () => (get('secrets', 'ig') || {}).token || process.env.IG_ACCESS_TOKEN || '';
async function refreshInstagram() {
  const token = igToken(); if (!token) return;
  try {
    const r = await fetch(`https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=12&access_token=${encodeURIComponent(token)}`);
    const j = await r.json(); if (j.error) throw new Error(j.error.message);
    social.ig = (j.data || []).map(({ id, caption, media_type, media_url, thumbnail_url, permalink, timestamp }) => ({ id, caption, media_type, media_url, thumbnail_url, permalink, timestamp }));
    social.igAt = Date.now(); social.igErr = '';
  } catch (e) { social.igErr = e.message; social.igAt = Date.now(); console.error('Instagram:', e.message); }
}
// O token de longa duração vale 60 dias: renovamos a cada 7 dias e guardamos no banco
// painel › Redes sociais: conectar o Instagram colando o token (fica só no servidor, nunca vai para o site)
app.get('/api/admin/instagram', auth('redes'), (req, res) => res.json({ conectado: !!igToken(), origem: get('secrets', 'ig') ? 'painel' : (process.env.IG_ACCESS_TOKEN ? 'servidor' : ''), posts: social.ig.length, atualizado: social.igAt || null, erro: social.igErr || '' }));
app.put('/api/admin/instagram', auth('redes'), ok(async (req, res) => {
  const t = String((req.body || {}).token || '').trim();
  if (!t) { q.del.run('secrets', 'ig'); social.ig = []; social.igErr = ''; return res.json({ ok: true, conectado: !!igToken() }); }
  put('secrets', { id: 'ig', token: t, renewed: Date.now() }); social.igAt = 0; await refreshInstagram();
  if (social.igErr) { q.del.run('secrets', 'ig'); return res.status(400).json({ error: 'O Instagram recusou o token: ' + social.igErr }); }
  res.json({ ok: true, posts: social.ig.length });
}));
async function renewInstagramToken() {
  const token = igToken(); if (!token) return;
  const meta = get('secrets', 'ig') || {}; if (meta.renewed && Date.now() - meta.renewed < 7 * 864e5) return;
  try {
    const j = await (await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`)).json();
    if (j.access_token) { put('secrets', { id: 'ig', token: j.access_token, renewed: Date.now() }); console.log('Token do Instagram renovado'); }
  } catch (e) { console.error('Instagram token:', e.message); }
}

app.get('/api/social', async (req, res) => {
  if (Date.now() - social.ytAt > 15 * 60e3) await refreshYouTube();
  if (Date.now() - social.igAt > 30 * 60e3) await refreshInstagram();
  const s = settings();
  res.json({ youtube: social.yt, instagram: social.ig, live: !!s.aoVivo, liveVideoId: s.ytVideoId || '' });
});

const LIVE_MIN = +process.env.YT_CHECK_MIN || (YT_API_KEY ? 15 : 3); // a API oficial custa 100 unidades/consulta
setInterval(checkLive, LIVE_MIN * 60e3); checkLive();
setInterval(refreshYouTube, 15 * 60e3); refreshYouTube();
setInterval(() => renewInstagramToken().then(refreshInstagram), 6 * 3600e3); renewInstagramToken().then(refreshInstagram);

app.listen(PORT, () => console.log(`Farol FM rodando em http://localhost:${PORT}  (MP: ${MP_ACCESS_TOKEN ? 'ativo' : 'desligado'})`));
