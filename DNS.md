# DNS — farolradiotv.com.br

Como fica a hospedagem:

| Endereço | O que é | Onde roda |
|---|---|---|
| `farolradiotv.com.br` e `www.farolradiotv.com.br` | Site (portal, rádio, loja) | GitHub Pages (grátis, HTTPS automático) |
| `api.farolradiotv.com.br` | Backend (pagamentos, painel, WhatsApp, e-mails) | Servidor da rádio via Cloudflare Tunnel |

## 1) Recomendado: DNS no Cloudflare (o mesmo esquema do RádioGestor)
1. No Cloudflare: **Add a site** › `farolradiotv.com.br` › plano Free. O Cloudflare mostra **2 nameservers** (ex.: `xxx.ns.cloudflare.com`).
2. No **registro.br** › domínio › **Alterar servidores DNS**: troque pelos 2 nameservers do Cloudflare. A troca leva de minutos a algumas horas.
3. No Cloudflare › **DNS › Records**, crie:

| Tipo | Nome | Conteúdo | Proxy |
|---|---|---|---|
| A | `@` | `185.199.108.153` | Somente DNS (nuvem cinza) |
| A | `@` | `185.199.109.153` | Somente DNS |
| A | `@` | `185.199.110.153` | Somente DNS |
| A | `@` | `185.199.111.153` | Somente DNS |
| AAAA | `@` | `2606:50c0:8000::153` | Somente DNS |
| AAAA | `@` | `2606:50c0:8001::153` | Somente DNS |
| AAAA | `@` | `2606:50c0:8002::153` | Somente DNS |
| AAAA | `@` | `2606:50c0:8003::153` | Somente DNS |
| CNAME | `www` | `eliaspgon-web.github.io` | Somente DNS |
| CNAME | `api` | criado sozinho pelo comando `cloudflared tunnel route dns farol-api api.farolradiotv.com.br` (aponta para `<ID>.cfargotunnel.com`) | Com proxy (nuvem laranja) |
| TXT | `_github-pages-challenge-eliaspgon-web` | código que o GitHub mostra em *Settings › Pages › Add a verified domain* | — |

> Deixe os registros do site em **Somente DNS** (nuvem cinza). Com o proxy laranja, o GitHub não consegue emitir o certificado HTTPS.

## 2) Alternativa: DNS no próprio registro.br (sem Cloudflare)
Use os mesmos registros **A**, **AAAA**, **CNAME www** e **TXT** da tabela acima, no modo de DNS do registro.br. Para o `api`, crie um **A** `api` apontando para o **IP público fixo** do servidor do backend, com HTTPS no servidor (ex.: Caddy ou Nginx + Let's Encrypt). O Cloudflare Tunnel só funciona com o DNS no Cloudflare.

## 3) E-mail (confirmação de conta e campanhas)
Ao escolher o serviço de envio (Brevo, Amazon SES, etc.), ele mostra os valores exatos. Crie:

| Tipo | Nome | Conteúdo |
|---|---|---|
| TXT | `@` | SPF, ex.: `v=spf1 include:spf.brevo.com ~all` (se já existir um SPF, **junte** os `include:` numa linha só) |
| TXT ou CNAME | (indicado pelo serviço) | **DKIM**, a assinatura do serviço de e-mail |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@farolradiotv.com.br` (depois de 2–4 semanas sem problemas, troque `p=none` por `p=quarantine`) |

Se vocês já têm caixas de e-mail no domínio (ex.: contato@), **não apague os registros MX** existentes.

## 4) No GitHub (uma vez)
*Repositório › Settings › Pages*:
- **Source: GitHub Actions** (o workflow já publica a pasta `site/`);
- **Custom domain:** `farolradiotv.com.br`;
- marque **Enforce HTTPS** assim que liberar (alguns minutos depois do DNS propagar).

## 5) Ligar o site ao backend
Quando `https://api.farolradiotv.com.br` estiver no ar, edite `site/config.js`:
```js
window.FAROL_API = window.FAROL_API || 'https://api.farolradiotv.com.br';
```
Enquanto ficar vazio, o site funciona em **modo demonstração** (dados no navegador de quem acessa).
