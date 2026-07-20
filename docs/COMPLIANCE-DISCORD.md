# Conformidade com a Política de Desenvolvedor do Discord — Vozen

> Estudo feito a 2026-07-07 cruzando a [Política de Desenvolvedor do Discord](https://support-dev.discord.com/hc/articles/8563934450327-Discord-Developer-Policy)
> (versão em vigor, atualizada pelo Discord em 2026-07-07) e a Política/Requisitos de
> Monetização (incorporados por referência) com um inventário do código do bot.
> **Veredito: o Vozen não viola nenhuma regra de forma ativa.** Havia 4 pontos amarelos;
> a Fase 1 (transparência) fechou os de texto. Os restantes têm plano abaixo.

## 1. O que já está conforme

| Regra da política | Estado no Vozen |
|---|---|
| 15/20/21 — usar Dados da API só para a função declarada; não minerar; não treinar IA com conteúdo de mensagens | ✅ Texto processado em memória para TTS, **nunca persistido**; sem scraping; sem treino de IA. |
| 16–19 — não perfilar, não vender, não partilhar com data brokers/ads | ✅ Só IDs numéricos + preferências; nada vendido/partilhado; sem analytics/trackers. |
| 5–7 — não contactar utilizadores sem permissão; sem DMs/anúncios não solicitados | ✅ O bot **nunca envia DMs**; todas as mensagens são respostas funcionais em canais. |
| 1–3 — não modificar contas sem permissão; respeitar opt-out/remoção | ✅ `/voice optout` respeitado; bot `selfDeaf`; kill-switch e remoção por admins. |
| 4, 8, 10–13 — sem credenciais, atividades ilegais, conteúdo violento/adulto, impersonação, manipulação de engajamento | ✅ Jogos limpos; wordlists com profanidade filtrada; sem NSFW. |
| 9 — não dirigido a menores de 13 | ✅ Idade mínima 13+ declarada nos Termos e na Privacidade (Fase 1). |
| Denúncia/suporte + disponibilidade | ✅ Servidor de suporte no `/help`, na Privacidade e nos Termos (Fase 1). |
| Política de privacidade + Termos publicados | ✅ `PRIVACY.md`, `TERMS.md`, `site/privacy.html`, `site/terms.html`. |

## 2. Pontos amarelos e plano

### 2.1 Monetização (a regra mais importante — "Requisitos de Monetização") — CÓDIGO PRONTO
Quem vende features pagas é obrigado a (i) vendê-las **também via Premium Apps do Discord**
e (ii) com **price parity** (não mais caro no Discord). O Vozen vende via Ko-fi/códigos.
**Ainda não é violação** porque a regra só se aplica "na medida em que os Premium Apps
suportem o locale e o tipo de oferta" — e os Premium Apps exigem app **Verificada** + Team,
o que o Vozen ainda não é. Portugal está nos locales suportados.
- **Fase 3 (feito no código):** `src/premium/entitlements.ts` + `syncDiscordEntitlements()`
  mapeiam subscrições Premium Apps ativas para as tabelas `premium_*` (`source='discord'`),
  reconciliando no ClientReady e em cada evento `Entitlement*`. **INERTE** até
  `PREMIUM_GUILD_SKU_ID`/`PREMIUM_USER_SKU_ID` estarem definidos (hoje é no-op). Paridade de
  preços documentada em `docs/MONETIZATION.md` (SKU USD ≤ preço externo).
- **Passos manuais (só o Diogo, no Developer Portal):** criar Team → verificar a app (~75
  servidores) → onboarding de monetização → criar SKUs (USD) → definir `PREMIUM_*_SKU_ID` na
  env (a sync ativa-se sozinha). Taxa do Discord: 15% (Growth Tier até $1M).

**Atualização 2026-07-11 (estado do portal):** o separador Monetization mostra o onboarding
"Monetize seu aplicativo" com "Comece agora" — ou seja, a app **pode iniciar** o onboarding
de Premium Apps (não está bloqueada). Mas **completá-lo** exige preencher requisitos legais,
**verificar a app + Team**, e configurar pagamentos/impostos (Discord fica com ~15%). É uma
decisão de **negócio**, não só um checkbox. **Decisão (interim):** manter a venda via Ko-fi;
vender só por Ko-fi é um **risco residual baixo** (não uma violação clara) enquanto o
onboarding de Premium Apps não estiver **completo**. **Gate:** completar o onboarding + criar
SKUs com **preço ≤ Ko-fi** quando se formalizar o negócio (ou naturalmente ao verificar a app
aos ~75 servidores). O `.env` já documenta `PREMIUM_GUILD_SKU_ID`/`PREMIUM_USER_SKU_ID`.

### 2.2 Transparência dos dados — FECHADO na Fase 1
`PRIVACY.md` estava desatualizado (faltavam tabelas). Corrigido: todas as tabelas
documentadas, contacto do operador preenchido, idade 13+.

### 2.3 Canal de denúncia — FECHADO na Fase 1
Existe servidor de suporte (`discord.gg/4kYw2WUbNN`). Ligado ao `/help` (env `SUPPORT_URL`),
à Privacidade e aos Termos.

## 3. Notas

- **Licença:** o site dizia "MIT" — corrigido para **AGPL-3.0** (a licença real do repo).
- **gTTS não-oficial:** a instância pública usa o endpoint não-oficial do Google Translate
  TTS. Em regra com o Discord, mas em tensão com os termos da Google; o `router` já cai para
  Piper se a Google fechar a porta. (Risco de terceiros, não do Discord.)
- **Breach:** o ToS de developer (§5) obriga a notificar o Discord e os afetados em caso de
  acesso não autorizado a Dados da API. Documentar o processo antes de escalar.
- **Recompensa por voto (growth loop):** o primeiro voto elegível no top.gg dá **48h de Vozen Plus** grátis,
  limitado a **uma única vez por conta** através de um ledger HMAC persistente. Conforme com
  o top.gg — que **permite** incentivar VOTOS (nunca REVIEWS/ratings, que ficam de fora por
  design; a copy pede sempre "votar"). Sem DM nem ping (hard rule). O ID em claro existe apenas
  durante as 48h; o marcador HMAC anti-abuso e a retenção estão divulgados no PRIVACY.md.
- **Rever:** o artigo da política foi atualizado em 2026-07-07 — reavaliar periodicamente.

## Atualização 2026-07-11 (re-auditoria + novo trabalho)

Re-auditados os 3 documentos (ToS de Desenvolvedor, Política, Termos do SDK Social). O
**SDK Social não se aplica** (é para integrações em jogos). Confirmado o veredito: sem
violações ativas. Plano completo em `docs/PLAN-DISCORD-COMPLIANCE.md`. Deltas fechados:

- **Direito ao esquecimento — `/privacy erase` (NOVO).** Um comando apaga TODOS os dados
  pessoais do utilizador em qualquer servidor, com confirmação por botão. Retém o premium
  pago + histórico financeiro (exceção de contrato/retenção legal).
  `store/dataLifecycle.ts::eraseUser` (testado). Antes a eliminação estava espalhada por
  vários comandos; agora há o "apagar tudo".
- **Retenção limitada — purga de servidores saídos (NOVO).** Os dados de um servidor que
  remove o bot são apagados 30 dias depois se não houver re-convite (`store/guildDeparted.ts`,
  marcado no `GuildDelete` REAL — o guard de outage já existia). Fecha o ToS §5(b)
  ("não reter além do necessário"). Financeiro/entitlement retido.
- **Rot-guard de conformidade (NOVO).** As tabelas apagadas por purga/erase são listas
  explícitas com um teste (`tests/dataLifecycle.test.ts`) que FALHA se uma tabela nova com
  `guild_id`/`user_id` não for categorizada — mantém a purga/erase completas no futuro.
- **Encriptação em repouso (ToS §5(c)) — BD em defer.** **Ainda em claro:** a BD SQLite
  (Discord IDs, prefs, hashes de email) — cifrá-la via SQLCipher é o passo mais arriscado do
  plano e fica em **defer deliberado** (spike + backup + aprovação numa sessão dedicada). O
  disco do VPS não é cifrado ao nível do volume (ext4 puro, verificado).
- **Regra permanente (NOVO).** `CLAUDE.md` tem uma secção "Discord compliance is mandatory"
  que toda a feature futura respeita.
- **Portal (pendente do Diogo):** preencher Privacy/ToS URL; confirmar elegibilidade de
  Premium Apps no separador Monetization (COMPL·1) — desbloqueia a decisão de monetização.

## 4. DISCORD-03 — intents privilegiadas: só `MessageContent` (verificado 2026-07-15)

`src/bot/client.ts:31-34` pede exatamente quatro intents: `Guilds`, `GuildVoiceStates`,
`GuildMessages` e `MessageContent`. **NÃO** pede `GuildMembers` (a lista fecha na linha 35).
Logo, a única intent **privilegiada** que a app usa é `MessageContent` — e é ela (e só ela)
que tem de aparecer coerente com a funcionalidade declarada na revisão de verificação: o bot
lê mensagens em voz alta, por isso precisa do conteúdo das mensagens (justificação simples e
verdadeira). As outras três não são privilegiadas.

Resolução de nome para o TTS: `cleanText.resolveUser` (`messageHandler.ts:241-244`,
`handlers/core.ts:132`) lê `message.guild.members.cache.get(id)?.displayName`. A cache é
populada **oportunisticamente** pelos eventos das intents que a app TEM (mensagens, estados
de voz, interações) — **sem** a intent privilegiada `GuildMembers` e **sem** `members.fetch()`
em massa. Cai em cascata para `users.cache.get(id)?.username` e depois para o literal
`'alguem'`: já degrada bem, nunca rebenta, só diz o username quando o membro mencionado não
está em cache. Auditoria (2026-07-15): zero handlers `GuildMember*`, zero `members.fetch()`.

**Gate de verificação (antes dos ~100 servidores):** há **uma** intent privilegiada a
justificar — `MessageContent`. Não existe `GuildMembers` a escrutinar nem qualquer uso
indevido a limpar. **Sem mudança de código nesta entrada** (a postura de intents já é
mínima; esta entrada corrige uma descrição desatualizada que analisava uma intent inexistente).
