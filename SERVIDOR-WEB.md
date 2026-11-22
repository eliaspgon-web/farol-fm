# Backend da Farol FM num servidor na web (sem computador ligado)

O site (farolradiotv.com.br) continua no GitHub Pages. O **backend** (painel com logins da equipe, pedidos, PIX/cartão, WhatsApp, comentários, contas de clientes) passa a rodar na nuvem, no endereço **api.farolradiotv.com.br**.

## Opção recomendada: Render (render.com)
O repositório já tem o arquivo `render.yaml`, que configura tudo sozinho: Node 20, banco de dados num disco permanente de 1 GB, segredo de login gerado automaticamente e liberação do domínio do site.

Custo: plano **Starter** (sempre ligado, cerca de US$ 7 por mês) + disco de 1 GB (cerca de US$ 0,25 por mês). O plano gratuito do Render **não serve**: ele desliga após 15 minutos parado e não aceita disco, então os dados seriam perdidos.

### 1. Criar a conta
1. Acesse **render.com** › **Get Started** › entre com a conta do **GitHub** (eliaspgon-web).
2. Em **Billing**, cadastre um cartão de crédito.

### 2. Publicar com um clique
1. Abra: **https://render.com/deploy?repo=https://github.com/eliaspgon-web/farol-fm**
2. O Render lê o `render.yaml` e mostra o serviço **farol-api**. Preencha:
   - `ADMIN_EMAIL`: o e-mail do administrador (ex.: admin@farolradiotv.com.br)
   - `ADMIN_PASSWORD`: a senha do administrador (forte, com letras e números)
   - `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET`: do Mercado Pago. Pode deixar em branco agora e preencher depois em **Environment**.
3. Clique em **Apply** / **Deploy Blueprint** e aguarde o build (2 a 5 minutos).
4. Teste: abra **https://farol-api.onrender.com/api/bootstrap** (o endereço exato aparece no topo do serviço). Precisa mostrar um texto JSON.

### 3. Usar o domínio api.farolradiotv.com.br
1. No Render: serviço **farol-api** › **Settings** › **Custom Domains** › **Add Custom Domain** › `api.farolradiotv.com.br`.
2. No Cloudflare › **DNS** › **Records** › **Add record**:
   - Tipo **CNAME**, Nome **api**, Destino: o endereço `farol-api.onrender.com` que o Render mostrar
   - Proxy: **DNS only** (nuvem cinza)
3. Volte ao Render e clique em **Verify**. O certificado HTTPS sai sozinho em alguns minutos.
4. Teste: **https://api.farolradiotv.com.br/api/bootstrap**

> Se você já criou o registro `api` para o Cloudflare Tunnel, apague-o antes de criar o CNAME.

### 4. Ligar o site ao backend
1. No GitHub, edite `site/config.js`:
   ```js
   window.FAROL_API = window.FAROL_API || 'https://api.farolradiotv.com.br';
   ```
2. Em **Settings › Secrets and variables › Actions › Variables**, crie `FAROL_API` = `https://api.farolradiotv.com.br` (atualiza a cada hora as prévias de compartilhamento das notícias novas).
3. Entre em **farolradiotv.com.br/#gestao** com o e-mail e a senha do passo 2. O aviso “Modo demonstração” some.
4. Em **Usuários e permissões**, cadastre a equipe (jornalistas, vendedores etc.).

> O que foi feito no modo demonstração fica só no navegador onde foi feito. As 14 notícias reais já entram no servidor automaticamente na primeira vez.

### 5. Depois
- **Mercado Pago:** em *Webhooks*, cadastre `https://api.farolradiotv.com.br/api/webhooks/mercadopago` (evento Pagamentos).
- **WhatsApp, e-mail (SMTP), YouTube, Instagram, IA:** preencha as variáveis em **farol-api › Environment** (lista completa em `server/.env.example`). Cada alteração reinicia o serviço sozinho.
- **Atualizações:** todo envio ao repositório publica o backend de novo automaticamente.
- **Backup:** o banco é o arquivo `/var/data/farol.db`. Em **farol-api › Shell**, `cp /var/data/farol.db /var/data/backup-$(date +%F).db` faz uma cópia.

## Outras opções
- **Railway (railway.com):** plano Hobby de US$ 5 por mês (inclui US$ 5 de uso). Crie um projeto a partir do repositório, defina a pasta `server` (usa o `Dockerfile`), adicione um **Volume** montado em `/data` e as mesmas variáveis do passo 2.
- **VPS** (Hostinger, DigitalOcean, Oracle Cloud etc.): `cd server && docker build -t farol-api . && docker run -d --restart=always -p 3000:3000 -v farol-dados:/data --env-file .env farol-api`, com o Cloudflare apontando `api` para o IP do servidor.
- **Computador da rádio + Cloudflare Tunnel:** veja `CLOUDFLARE.md`, Parte 5.
- **Hospedagem do francesfm.com.br:** é PHP (cPanel). Só serve se o painel tiver **“Setup Node.js App”**; nesse caso, confirme com a empresa de hospedagem.
