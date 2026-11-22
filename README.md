# Farol FM — Portal cristão + Rádio ao vivo + Loja

Ecossistema completo inspirado no francesnews.com.br, com editorial cristão:

- **Portal de notícias:** editorias, manchete com "chapéu", faixa de últimas notícias, mais lidas, busca, compartilhamento (WhatsApp/Facebook/X), vídeos, versículo do dia e pedido de oração.
- **Rádio Farol FM:** player fixo (áudio ao vivo) e botão **Assistir** para a live do YouTube. A página da rádio mostra a grade de programação e destaca o programa no ar.
- **Loja:** catálogo, promoções e cupons, carrinho, frete ou retirada, checkout com **PIX, crédito e débito**.
- **Painel administrativo:** visão geral, pedidos, financeiro, produtos, promoções, cupons, notícias, vídeos, orações, rádio, pagamentos e aparência.
- **Visual de portal moderno:** header com a cor da logo, menu lateral (MENU), carrossel das 5 principais notícias (quantidade ajustável no painel e botão Expandir), feed de notícias, animações nos botões.
- **3 modelos de layout × 6 paletas** — padrão: Portal + paleta da logo Farol.
- **Logos:** `assets/logo-farol-circulo.png` (ícone/favicon/player) e `assets/logo-farol-fm.png` (nome FAROL FM); nunca aparecem juntas.

```
site/index.html      → o site inteiro (HTML/CSS/JS, sem build)
site/assets/         → logos em PNG
server/              → backend Node (API, banco SQLite, Mercado Pago, webhook, YouTube)
```

> **Publicação e DNS:** veja [DNS.md](DNS.md) — domínio farolradiotv.com.br.

## 1) Modo demonstração (sem servidor)
Abra `site/index.html` ou publique no GitHub Pages. Os dados ficam salvos no navegador.
- Gestão: `#gestao` (sem link no site). Na demonstração, escolha o perfil e use a senha **farol2026**.
- PIX: gera um QR Code e um copia-e-cola **reais** com a chave cadastrada em *Pagamentos & frete*. A baixa do pagamento é manual, no painel (botão "Confirmar pagamento").
- Cartão: é só uma simulação. Use 4111 1111 1111 1111 para aprovar e um número terminado em 0002 para recusar.

## 2) Produção (vendas reais)
```bash
cd server
cp .env.example .env        # preencha as variáveis
npm install
npm run hash -- "SuaSenhaForte"   # cole o resultado em ADMIN_PASSWORD_HASH
npm start                   # http://localhost:3000 já serve o site ligado à API
```
- **Mercado Pago:** em *Suas integrações › Credenciais*, copie o **Access Token** para o `.env` e cole a **Public Key** em Painel › Pagamentos.
  - O **PIX** é gerado pelo Mercado Pago, vale 30 minutos e é confirmado sozinho pelo webhook.
  - **Crédito e débito** usam o *Card Payment Brick*: os dados do cartão são tokenizados pelo Mercado Pago e não passam pelo seu servidor (nem entram no escopo PCI).
  - Em *Webhooks*, cadastre `https://SEU-BACKEND/api/webhooks/mercadopago` (evento **Pagamentos**) e copie a assinatura secreta para `MP_WEBHOOK_SECRET`.
  - Faça a homologação com as credenciais `TEST-...` antes de trocar pelas de produção.
- **Segurança:** o servidor recalcula preços, promoções, cupons, frete e estoque. O valor que vem do navegador é ignorado.
- **Hospedagem:** VPS ou máquina na rede da rádio com Node 18+, exposta via **Cloudflare Tunnel** (ex.: `api.farolradiotv.com.br`). Se o site ficar em outro domínio (ex.: GitHub Pages), coloque antes do script principal do `index.html`:
  `<script>window.FAROL_API='https://api.farolradiotv.com.br'</script>`
- Backup: basta copiar o arquivo `server/farol.db`.

## 3) Rádio e TV
Painel › Rádio & TV:
- **URL do streaming:** precisa ser HTTPS (Shoutcast, Icecast, Zeno etc.).
- **ID do canal do YouTube:** começa com `UC…`. Ligue "AO VIVO" quando a transmissão começar, e o botão **Assistir** aparece no player, na capa e na página da rádio.
- **Automático:** com `YT_API_KEY` no `.env`, o servidor verifica a cada 15 minutos se há live no canal e liga/desliga o "AO VIVO" sozinho.
- **Grade de programação:** uma linha por programa, no formato `seg-sex|07:00|09:00|Despertar com Fé|Pr. Fulano`.

## 4) TV & Redes (YouTube + Instagram)
- Página **TV & Redes** (`#redes`) e seção **Farol nas redes** na capa.
- **YouTube — Farol Radio TV (@FarolRadioTV, canal UCB3fJwRKWK6EZ3l7FRq3E6w):** o "Assistir ao vivo" abre a live do canal. Com o backend:
  - os vídeos mais recentes vêm do feed público do canal, sem chave;
  - a live é detectada sozinha a cada 3 minutos, sem chave (ou pela YouTube Data API, se houver `YT_API_KEY`).
- **Instagram — @radiotvfarol:**
  - Para o feed automático (últimas 12 publicações), a conta precisa ser **profissional (Criador ou Empresa)**. Gere um token na "API do Instagram com login do Instagram" (developers.facebook.com) e coloque em `IG_ACCESS_TOKEN`. O servidor renova o token sozinho.
  - Sem token, aparece uma grade com link para o perfil. Também dá para colar links de posts e reels em Painel › Redes sociais para incorporá-los.

## 5) Área administrativa (só para a equipe)
- Não há link para ela no site: acesse **seusite/#gestao**. Ela abre com visual próprio, sem player, menu do site ou botão de WhatsApp.
- **Perfis:**
  - **Administrador:** tudo.
  - **Redação:** painel da redação, notícias e colunas, vídeos, orações e músicas, rádio, redes.
  - **Loja e vendas:** painel da loja, pedidos, clientes, produtos, estoque, promoções, cupons, financeiro, pagamentos e o **Atendimento WhatsApp**.
- O servidor também confere o perfil em cada operação: Redação não consegue alterar preço nem a chave PIX, e Loja não altera notícias.
- Logins da equipe: Painel › Equipe e acessos. O administrador principal fica no `.env`.

## 6) Redação × Loja
- **Redação:**
  - status editorial: rascunho → em revisão → publicado (data futura = agendado);
  - tipos de conteúdo: Notícia, Coluna, Artigo, Entrevista, Agenda;
  - autor/colunista, tags, legenda e crédito da foto, fonte, faixa vermelha **ÚLTIMA HORA** por 24h;
  - página **Colunas**, páginas de tag e painel com fila de revisão, agendadas, mais lidas e publicações por editoria.
- **Loja:**
  - barra própria (busca de produtos, Meus pedidos, carrinho com total);
  - produtos com opções (ex.: tamanhos P/M/G/GG);
  - página **Meus pedidos** com consulta por número + e-mail;
  - no painel: clientes (com WhatsApp e exportação), estoque com entradas/saídas e motivo, e o painel da loja.

## 7) Agente de WhatsApp (robô → vendedor)
- **No site:** botão verde com chat no estilo WhatsApp.
  - O robô atende 24h: comprar (categorias, produtos com "Quero", carrinho e checkout), status de pedido, pedido de música, pedido de oração e anúncios.
  - "Falar com vendedor": o robô pede nome, WhatsApp e motivo, gera um **protocolo** e coloca o cliente na **fila**.
  - O vendedor vê a fila em Painel › Atendimento WhatsApp, clica em **Assumir**, responde (respostas rápidas e envio de produto com link de compra) e **Encerra**, devolvendo o cliente ao robô.
  - O cliente também pode seguir pelo WhatsApp de vendas, com o resumo da conversa já preenchido.
- **No WhatsApp de verdade (Cloud API oficial da Meta):** com `WA_TOKEN`/`WA_PHONE_ID` e o webhook cadastrado, o mesmo robô responde no número da Farol, com menus de lista e botões.
  - A passagem para o vendedor funciona igual, e o vendedor responde pelo painel (a mensagem chega ao cliente no WhatsApp).
  - Os vendedores em `WA_VENDEDORES` recebem aviso de cliente na fila. Observação da Meta: avisos fora da janela de 24h exigem um modelo (template) aprovado.
- **IA (opcional, `AI_API_KEY`):** perguntas livres ("tem bíblia de letra grande?", "entrega em Arapiraca?") são respondidas com base só no catálogo e nas regras da loja. Pedidos de negociação, compras em quantidade ou dúvidas fora do catálogo vão para um vendedor.

## 8) Contas de clientes e promoções por e-mail
- **No site:** "Minha conta" na barra da loja, no menu e no rodapé, além de convites na loja e no carrinho.
- **Cadastro com e-mail** (Gmail e qualquer provedor), com validações:
  - formato do endereço;
  - correção de erros de digitação ("gmial.com → gmail.com?");
  - bloqueio de e-mails temporários;
  - regras do Gmail (6 a 30 letras/números);
  - no servidor, checagem de que o domínio recebe e-mails;
  - senha forte (8+ caracteres, letras e números) e confirmação **obrigatória** por link (48h).
- **Continuar com o Google:** cria a conta já verificada, sem senha.
- **Consentimento (LGPD):** caixa separada "Quero receber promoções", aceite da política de privacidade, registro de data/IP do aceite, descadastro em 1 clique em todo e-mail, exclusão da conta pelo cliente.
- **Painel › Clientes:** contas (confirmadas, aceitam promoções, via Google).
- **Painel › Campanhas de e-mail:** assunto, mensagem, cupom, até 6 produtos, público por interesse, pré-visualização, e-mail de teste, envio e histórico.

### O que o administrador precisa fazer
1. **Envio de e-mails (obrigatório para confirmar contas e mandar campanhas)** — preencha `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` no `.env`.
   - Para campanhas, use um serviço de e-mail transacional/marketing (ex.: Brevo, Amazon SES, Mailgun, SendGrid).
   - Uma conta Gmail com "senha de app" serve só para testes ou volume pequeno, porque o Gmail limita os envios diários.
2. **DNS do domínio (para não cair no spam)** — no registro.br/Cloudflare, crie os registros **SPF**, **DKIM** e **DMARC** que o serviço de e-mail indicar. Envie de um endereço do domínio (ex.: promocoes@farolradiotv.com.br).
3. **Login com o Google** — no Google Cloud Console:
   - crie um projeto;
   - configure a **Tela de consentimento OAuth** (nome "Farol FM", logo, e-mail de suporte, link da política de privacidade `seusite/#privacidade`) e publique o app;
   - crie uma **Credencial › ID do cliente OAuth › Aplicativo da Web** e, em **Origens JavaScript autorizadas**, coloque `https://farolradiotv.com.br` (e `https://www.farolradiotv.com.br`, se usar);
   - copie o Client ID para `GOOGLE_CLIENT_ID` no `.env` **e** em Painel › Campanhas de e-mail › Configurações das contas.
4. **Endereços** — `SITE_URL` (site) e `PUBLIC_URL` (backend) corretos e com HTTPS. Os links de confirmação, de nova senha e de descadastro usam esses endereços.
5. **Política de privacidade** — revise o texto em Painel › Campanhas › Configurações (ou Aparência), com o CNPJ e o contato do responsável pelos dados (LGPD).
6. **Cupom de boas-vindas** — confirme que o cupom configurado (padrão `BEMVINDO10`) existe e está ativo em Painel › Cupons.
7. **Teste** — crie uma conta com um Gmail seu, confirme pelo link, use "Enviar teste para mim" na campanha e veja se chega na caixa de entrada (e não no spam).
- Sem SMTP configurado, o servidor mostra os links de confirmação no log, o que é útil para testar antes de configurar o envio.

## 9) Antes de publicar
- Troque as notícias, vídeos e produtos de exemplo pelos reais (Painel).
- Revise os versículos em *Aparência & site*, conferindo o texto com a tradução bíblica que vocês usam.
- Desligue o botão "Modelos" para visitantes e defina o layout/paleta padrão.
- Preencha a chave PIX, o frete e as redes sociais.
