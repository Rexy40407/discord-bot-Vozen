# Plano 034 — "Cola o link do recibo" (copy do claim pós-tolerância)

Escrito 2026-07-17, contra o commit `5dde1d0`. Planeamento apenas — execução por ordem
explícita.

## Objetivo

O servidor já aceita, desde `5dde1d0` (deployado e verificado em produção), qualquer
forma que o comprador cole: o código solto, o código com `&mode=g` agarrado, o URL
mensal completo (`ko-fi.com/home/coffeeshop?txid=<código>&mode=g`) ou o URL da Shop
completo (`ko-fi.com/summary/<código>`). Ver `extractReceiptCode` em
`src/premium/claim.ts` e os 6 testes em `tests/claim.test.ts`.

Falta a camada visível dizer isso. A copy atual (i18n v26) ainda manda o comprador
extrair o código à mão do URL — instrução que ficou obsoleta no momento em que o campo
passou a aceitar o URL inteiro. Objetivo: em todo o funil, a instrução passa a ser
**"cola o link do recibo (ou o código, se preferires)"**.

## Scope

### In

- As 4 chaves de copy do claim (`claim.hint`, `claim.placeholder`,
  `claim.useReceiptCode`, `claim.notfound`) reescritas nas 10 línguas do site.
- O teste `names both Ko-fi receipt URL shapes in every language` em
  `tests/operationalHardening.test.ts`, que hoje **exige** a copy antiga
  (`/summary/` e `txid=` em todas as línguas) — tem de ser reescrito PRIMEIRO,
  senão o CI fica vermelho ao mudar a copy.
- Cache-bust `i18n-v26.js` → `i18n-v27.js` (+ refs em `site/*.html` e no teste).
- Gate completo, deploy do site, verificação live (v27 → 200, v26 → 404).
- Blocos de texto prontos-a-colar para o Diogo atualizar no Ko-fi: descrições dos
  3 produtos anuais + mensagens pós-compra + as 3 tiers mensais (que ainda dizem
  "enter the email you paid with", coisa que o sistema recusa desde o plano 021).

### Out

- **Qualquer alteração a `src/`** — a lógica já está em produção; mexer agora obriga
  a um restart do bot sem ganho nenhum.
- Auto-match pelo email verificado do Discord (o fix estrutural que elimina o código
  de vez; `listUnclaimedPendingByEmailHash` + `hashKofiEmail` já existem — fica como
  próximo grande passo, fora deste plano).
- Auto-preenchimento do código via query param no redirect pós-compra — não sabemos
  se o Ko-fi acrescenta o txid ao Redirect URL; seria um spike separado.
- O vídeo demonstrativo (handoff próprio em `docs/HANDOFF-ACTIVATION-VIDEO.md`).

## Fases

### Fase 1 — Teste primeiro (RED)

- [ ] Reescrever o teste de copy em `tests/operationalHardening.test.ts`: em vez de
      exigir `/summary/` e `txid=` em todas as línguas, exigir que **nenhuma** língua
      contém `txid=` (a instrução de cirurgia desapareceu) e que as 4 chaves existem
      e são não-vazias nas 10 línguas.
- [ ] **Done:** `npx vitest run tests/operationalHardening.test.ts` FALHA contra a
      copy atual (prova que o teste morde).

### Fase 2 — Copy nova ×10 (GREEN)

- [ ] Reescrever as 4 chaves nas 10 línguas: "cola o link do recibo do Ko-fi — ou só
      o código, se preferires" (hint); placeholder "Cola aqui o link do recibo";
      mensagens de erro coerentes.
- [ ] Cache-bust v26 → v27 + atualizar refs (3 HTML + teste).
- [ ] **Done:** teste da fase 1 verde; paridade de chaves igual nas 10 línguas;
      `npm run check` verde.

### Fase 3 — Verificação e deploy

- [ ] Preview no browser: strings novas renderizam no cartão de ativação; caixa de
      consentimento intacta.
- [ ] `npm run build:site` + push + live check (v27 → 200, v26 → 404, copy nova no
      ficheiro servido).
- [ ] **Done:** `curl` ao vozen.org confirma a copy nova; deploys verdes.

### Fase 4 — Ko-fi [needs Diogo]

- [ ] Entregar blocos prontos: 3 descrições anuais + 3 mensagens pós-compra + 3 tiers
      mensais, todos a dizer "paste your receipt link".
- [ ] **Done:** Diogo confirma que colou; site e Ko-fi dizem a mesma coisa.

## Riscos

- **O teste atual está acoplado à copy antiga.** É o risco nº 1 e é a razão da ordem
  das fases: teste primeiro, copy depois. Fora de ordem = CI vermelho.
- **Validar semântica em 10 línguas é frágil.** Não se tenta afirmar "diz para colar
  o link" em chinês; usa-se a asserção negativa (sem `txid=`) + paridade de chaves.
- **Os textos do Ko-fi dependem do Diogo** e podem divergir do site; mitigação:
  blocos prontos-a-colar entregues na fase 4, colagem no próprio dia.
- Nota, sem ação: a extração assume tx ids em forma de UUID (os do Ko-fi são);
  ids não-UUID caem no fallback e continuam a funcionar como antes — coberto por
  teste.

## MVP

Fases 1–3: o site em produção a dizer "cola o link". A fase 4 fecha a coerência do
funil do lado do Ko-fi.

**Próxima ação concreta:** reescrever o teste `names both Ko-fi receipt URL shapes in
every language` em `tests/operationalHardening.test.ts` para a asserção nova e vê-lo
falhar (RED).
