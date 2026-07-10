#!/usr/bin/env node
// tools/cf-security-headers.mjs
//
// Configura os CABEÇALHOS DE SEGURANÇA do vozen.org na Cloudflare via API (Rota A do
// docs/SECURITY-HEADERS-SETUP.md). Idempotente: podes correr as vezes que quiseres.
//
// PRÉ-REQUISITOS (feitos pelo dono do domínio, uma vez):
//   1. Adicionar vozen.org à Cloudflare + mudar os nameservers no registrar (zona 'active').
//   2. Criar um API token SCOPED à zona vozen.org com as permissões:
//        Zone > DNS > Edit · Zone > Zone Settings > Edit · Zone > Transform Rules > Edit
//
// USO:
//   CF_API_TOKEN=xxxxx node tools/cf-security-headers.mjs             # configura + verifica
//   CF_API_TOKEN=xxxxx node tools/cf-security-headers.mjs --verify-only  # só verifica
//
// O token NUNCA é impresso, logado nem gravado. Passa-o só por ambiente.

const TOKEN = process.env.CF_API_TOKEN;
if (!TOKEN) {
  console.error('ERRO: falta CF_API_TOKEN no ambiente. Ver o cabeçalho deste ficheiro.');
  process.exit(1);
}

const ZONE_NAME = 'vozen.org';
const API = 'https://api.cloudflare.com/client/v4';
const VERIFY_ONLY = process.argv.includes('--verify-only');

// Valores VERIFICADOS contra os recursos reais do site (ver SECURITY-HEADERS-SETUP.md).
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https://cdn.discordapp.com; " +
    "connect-src 'self' https://api.vozen.org; media-src 'self'; " +
    "form-action 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), ' +
    'microphone=(), payment=(), usb=()',
};

async function cf(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    throw new Error(`${opts.method || 'GET'} ${path} -> ${JSON.stringify(json.errors || json)}`);
  }
  return json.result;
}

async function main() {
  // 1. Resolver a zona.
  const zones = await cf(`/zones?name=${ZONE_NAME}`);
  if (!zones.length) {
    throw new Error(
      `Zona ${ZONE_NAME} não existe na Cloudflare. Adiciona o domínio e muda os nameservers primeiro.`,
    );
  }
  const zoneId = zones[0].id;
  console.log(`zona: ${ZONE_NAME} (${zoneId}) status=${zones[0].status}`);
  if (zones[0].status !== 'active') {
    console.warn(
      "AVISO: a zona ainda não está 'active' (nameservers a propagar). A regra fica criada, " +
        'mas os cabeçalhos só saem quando ficar active e o DNS estiver proxied.',
    );
  }

  if (!VERIFY_ONLY) {
    // 2. Garantir que os registos do apex/www estão PROXIED (senão o tráfego não passa pela CF).
    const recs = await cf(`/zones/${zoneId}/dns_records?per_page=100`);
    for (const r of recs) {
      const proxiable = r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME';
      const target = r.name === ZONE_NAME || r.name === `www.${ZONE_NAME}`;
      if (proxiable && target && !r.proxied) {
        await cf(`/zones/${zoneId}/dns_records/${r.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ proxied: true }),
        });
        console.log(`DNS proxied ON: ${r.type} ${r.name}`);
      }
    }

    // 3. HTTPS: modo Full + Always Use HTTPS.
    await cf(`/zones/${zoneId}/settings/ssl`, {
      method: 'PATCH',
      body: JSON.stringify({ value: 'full' }),
    });
    await cf(`/zones/${zoneId}/settings/always_use_https`, {
      method: 'PATCH',
      body: JSON.stringify({ value: 'on' }),
    });
    console.log('SSL=full · always_use_https=on');

    // 4. Transform Rule: injetar os 6 cabeçalhos na resposta (phase http_response_headers_transform).
    const headers = {};
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      headers[name] = { operation: 'set', value };
    }
    await cf(`/zones/${zoneId}/rulesets/phases/http_response_headers_transform/entrypoint`, {
      method: 'PUT',
      body: JSON.stringify({
        rules: [
          {
            action: 'rewrite',
            action_parameters: { headers },
            expression: 'true',
            description: 'Vozen security headers',
            enabled: true,
          },
        ],
      }),
    });
    console.log(`Transform Rule aplicada (${Object.keys(SECURITY_HEADERS).length} cabeçalhos).`);
  }

  // 5. Verificar o que sai mesmo em https://vozen.org/.
  try {
    const res = await fetch(`https://${ZONE_NAME}/`, { method: 'HEAD', redirect: 'manual' });
    console.log(`\nVerificação de https://${ZONE_NAME}/ (HTTP ${res.status}):`);
    const names = Object.keys(SECURITY_HEADERS);
    const missing = names.filter((h) => !res.headers.get(h));
    for (const h of names) console.log(`  ${res.headers.get(h) ? 'OK   ' : 'FALTA'} ${h}`);
    console.log(
      missing.length
        ? `\n${missing.length} em falta — DNS a propagar, registo não-proxied, ou regra por aplicar.`
        : '\nOs 6 cabeçalhos presentes ✅ — confirma o A/A+ em securityheaders.com.',
    );
  } catch (e) {
    console.log(
      `\n(verificação HTTP falhou: ${e.message} — provavelmente o DNS ainda a propagar.)`,
    );
  }
}

main().catch((e) => {
  console.error(`FALHOU: ${e.message}`);
  process.exit(1);
});
