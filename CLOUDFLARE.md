# Passo a passo no Cloudflare — farolradiotv.com.br

Use a mesma conta do Cloudflare do RádioGestor (gestaofrancesfm.com.br).

## Parte 1 — Colocar o domínio no Cloudflare
1. Acesse **dash.cloudflare.com** e entre.
2. Clique em **+ Adicionar** › **Domínio existente** (ou "Add a domain").
3. Digite `farolradiotv.com.br`, deixe **"Verificar rapidamente os registros DNS"** marcado e clique em **Continuar**.
4. Escolha o plano **Free** (gratuito) › **Continuar**.
5. O Cloudflare mostra os registros que encontrou. **Se houver registros MX (e-mail), mantenha.** Clique em **Continuar**.
6. A tela seguinte mostra **2 servidores de nomes** (nameservers), algo como `nome1.ns.cloudflare.com` e `nome2.ns.cloudflare.com`. **Copie os dois.**

## Parte 2 — Apontar o registro.br para o Cloudflare
1. Acesse **registro.br** › entre › clique em **farolradiotv.com.br**.
2. Se aparecer **DNSSEC ativado**, desative primeiro (senão o Cloudflare não ativa).
3. Em **DNS**, clique em **Alterar servidores DNS**.
4. Apague os servidores atuais e cole os **2 do Cloudflare** (um em cada campo) › **Salvar**.
5. Volte ao Cloudflare e clique em **Verificar servidores de nomes agora**. A ativação costuma levar de **alguns minutos a 2 horas**, e o Cloudflare manda um e-mail quando o domínio ficar **Ativo**.

## Parte 3 — Registros do site (GitHub Pages)
No Cloudflare › **farolradiotv.com.br** › **DNS** › **Registros** › **Adicionar registro**. Crie um por um e **deixe o proxy DESLIGADO (nuvem cinza, "Somente DNS")**:

| Tipo | Nome | Conteúdo / Endereço IPv4 ou IPv6 |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `eliaspgon-web.github.io` |

> Se o Cloudflare importou registros **A** antigos para `@` ou `www` (de outra hospedagem), **apague-os**. Só podem ficar os desta tabela.

Depois, em **SSL/TLS** › **Visão geral**, deixe o modo **Completo (Full)**.

## Parte 4 — No GitHub (o site)
1. No repositório **eliaspgon-web/farol-fm** › **Settings** › **Pages**:
   - **Source:** GitHub Actions;
   - **Custom domain:** `farolradiotv.com.br` › **Save**.
2. Aguarde o "DNS check successful" e marque **Enforce HTTPS** (o certificado pode levar de 15 minutos a 1 hora).
3. (Recomendado) Em **github.com/settings/pages** › **Add a domain** › `farolradiotv.com.br`: o GitHub mostra um registro **TXT** (`_github-pages-challenge-eliaspgon-web`). Crie-o no Cloudflare e clique em **Verify**. Isso protege o domínio contra uso por terceiros.

✅ Teste: abra **https://farolradiotv.com.br** — o site aparece em modo demonstração.

## Parte 5 — Backend (api.farolradiotv.com.br) pelo Cloudflare Tunnel
No computador/servidor da rádio que vai rodar o backend (Node 18+ instalado, `npm install` e `.env` preenchido):
1. Cloudflare › **Zero Trust** › **Redes** › **Tunnels** › **Criar um túnel** › **Cloudflared**.
2. Nome: `farol-api` › **Salvar túnel**.
3. Escolha o sistema do servidor (Windows, Linux…) e **copie o comando de instalação** que aparece. Ele já contém o token. Rode-o no servidor (no Windows, num Prompt de Comando como administrador). O túnel fica **Conectado**.
4. Clique em **Avançar** e configure o **Nome de host público**:
   - Subdomínio: `api`
   - Domínio: `farolradiotv.com.br`
   - Tipo de serviço: **HTTP**
   - URL: `localhost:3000`
   - › **Salvar**. O Cloudflare cria sozinho o registro `api` (CNAME, nuvem laranja).
5. No servidor, inicie o backend: `cd server && npm start`. Para iniciar sozinho, use o serviço em `server/deploy/farol-api.service` (Linux) ou o **PM2** (`npm i -g pm2 && pm2 start server.js --name farol-api && pm2 save`).

✅ Teste: **https://api.farolradiotv.com.br/api/bootstrap** precisa mostrar um texto JSON.

6. Ligue o site ao backend: edite `site/config.js` no repositório:
   ```js
   window.FAROL_API = window.FAROL_API || 'https://api.farolradiotv.com.br';
   ```
   O GitHub publica sozinho em 1–2 minutos.

## Parte 6 — E-mail (depois de escolher o serviço de envio)
Em **DNS › Registros**, crie o **SPF**, o **DKIM** e o **DMARC** com os valores que o serviço (Brevo, Amazon SES…) mostrar. Veja os modelos no [DNS.md](DNS.md).

## Problemas comuns
- **"Domínio pendente" no Cloudflare por muito tempo:** confira no registro.br se os 2 nameservers estão certos e se o DNSSEC está desligado.
- **GitHub diz "certificado não disponível":** os registros do site estão com a nuvem laranja. Troque para cinza e aguarde.
- **api não abre (erro 502/1033):** o túnel está desconectado ou o backend não está rodando na porta 3000.
