/* Vozen — dashboard web de configuração da guild.
   OAuth: reutiliza o redirect /account (o único registado no portal) com scope
   `identify guilds`; o main.js guarda o token no sessionStorage e salta de volta a
   /dashboard (via `vozen.returnTo`). Aqui lemos o token e falamos com a API do bot
   (/api/dashboard/*). A autorização real (MANAGE_GUILD + bot presente) é no servidor.

   HUD v3: formulário agrupado por secções (Reading/Voice/Community/Limits), toggle
   switches em vez de checkboxes nativas, campo de língua (locale — a API já o aceita),
   e save com estado (só ativo quando há alterações). CSP: zero handlers inline, tudo
   por addEventListener; CSS injetado num <style> (style-src tem 'unsafe-inline'). */
(function () {
  "use strict";
  var CLIENT_ID = "1523826014935842997";
  var API = "https://api.vozen.org";
  var REDIRECT = new URL("/account", location.href).href;
  var TOK_KEY = "vozen.dtoken";
  var STATE_KEY = "vozen.oauthstate";
  var RETURN_KEY = "vozen.returnTo";
  var LS_LANG = "vozen.lang";

  var root = document.getElementById("dashRoot");
  if (!root) return;

  /* Re-localização ao vivo: o seletor de idioma do site (main-v27 applyLang) escreve o
     código no <html lang>. Observamos esse atributo e re-localizamos a vista atual — assim
     as definições deixam de ficar presas na língua anterior. Cada render regista aqui o seu
     re-localizador; para o form é in-place (não toca nos inputs nem no estado "por guardar"). */
  var onLang = null;

  /* ── i18n do dashboard: as 10 línguas do site (en base; resto cai no en) ──
     NOTA: é um 2º dicionário, separado do window.VOZEN_I18N do site — mantê-los
     alinhados é manual (risco de drift). Chaves com placeholder que TÊM de sobreviver:
     {n} em saveN (é `.replace("{n}", n)`'d). /sound e 🔥 também são literais a preservar. */
  var STR = {
    en: {
      loginTitle: "Log in to manage your servers",
      loginSub: "You'll be asked to share the list of servers you manage. We only touch servers where you're an admin and Vozen is present.",
      loginBtn: "Log in with Discord",
      loading: "Loading…",
      pick: "Pick a server",
      pickHint: "Servers where you're an admin and Vozen is added.",
      none: "No servers to manage",
      noneHint: "You need Manage Server permission on a server that has Vozen. Add Vozen, then reload.",
      expired: "Your login expired — please log in again.",
      forbidden: "You can't manage that server.",
      error: "Something went wrong. Try again in a moment.",
      save: "Save changes",
      save1: "Save 1 change",
      saveN: "Save {n} changes",
      saving: "Saving…",
      saved: "Saved ✓",
      saveFail: "Couldn't save — try again.",
      back: "← Choose another server",
      sec_reading: "Reading",
      sec_voice: "Voice",
      sec_community: "Community",
      sec_limits: "Limits",
      f_autoread: "Auto-read the set channel",
      d_autoread: "Speak messages sent in the channel you set.",
      f_readBots: "Read other bots' messages",
      d_readBots: "Also speak messages posted by other bots.",
      f_textInVoice: "Read the voice channel's text chat",
      d_textInVoice: "Speak the chat built into the voice channel.",
      f_antispam: "Anti-spam filter",
      d_antispam: "Skip spammy or repeated messages.",
      f_xsaid: "Announce who spoke",
      d_xsaid: 'Prefix each message with "{name} said …".',
      f_autojoin: "Join voice automatically",
      d_autojoin: "Vozen joins the voice channel on its own.",
      f_greetOnJoin: "Greet people on join",
      d_greetOnJoin: "Say hello when someone joins the call.",
      f_streakAnnounce: "Daily 🔥 streak notices",
      d_streakAnnounce: "Announce daily activity streaks.",
      f_soundboard: "Soundboard (/sound)",
      d_soundboard: "Let members play sound effects with /sound.",
      f_maxChars: "Max characters per message",
      d_maxChars: "Longer messages get cut off.",
      f_ratePerMin: "Messages per minute (per user)",
      d_ratePerMin: "Throttle how fast one person is read.",
      f_locale: "Server language",
      d_locale: "Language Vozen uses for this server.",
    },
    pt: {
      loginTitle: "Entra para gerir os teus servidores",
      loginSub: "Vais autorizar a partilha da lista de servidores que geres. Só mexemos em servidores onde és admin e o Vozen está presente.",
      loginBtn: "Entrar com o Discord",
      loading: "A carregar…",
      pick: "Escolhe um servidor",
      pickHint: "Servidores onde és admin e o Vozen está adicionado.",
      none: "Sem servidores para gerir",
      noneHint: "Precisas da permissão Gerir Servidor num servidor com o Vozen. Adiciona o Vozen e recarrega.",
      expired: "A tua sessão expirou — entra outra vez.",
      forbidden: "Não podes gerir esse servidor.",
      error: "Algo correu mal. Tenta daqui a pouco.",
      save: "Guardar alterações",
      save1: "Guardar 1 alteração",
      saveN: "Guardar {n} alterações",
      saving: "A guardar…",
      saved: "Guardado ✓",
      saveFail: "Não deu para guardar — tenta outra vez.",
      back: "← Escolher outro servidor",
      sec_reading: "Leitura",
      sec_voice: "Voz",
      sec_community: "Comunidade",
      sec_limits: "Limites",
      f_autoread: "Ler o canal definido",
      d_autoread: "Fala as mensagens enviadas no canal que definiste.",
      f_readBots: "Ler mensagens de outros bots",
      d_readBots: "Fala também mensagens de outros bots.",
      f_textInVoice: "Ler o chat do canal de voz",
      d_textInVoice: "Fala o chat de texto embutido no canal de voz.",
      f_antispam: "Filtro anti-spam",
      d_antispam: "Ignora mensagens spam ou repetidas.",
      f_xsaid: "Anunciar quem falou",
      d_xsaid: 'Diz "{nome} disse …" antes de cada mensagem.',
      f_autojoin: "Entrar na call automaticamente",
      d_autojoin: "O Vozen entra sozinho no canal de voz.",
      f_greetOnJoin: "Saudar quem entra",
      d_greetOnJoin: "Cumprimenta quem entra na call.",
      f_streakAnnounce: "Avisos de streak 🔥",
      d_streakAnnounce: "Anuncia streaks de atividade diária.",
      f_soundboard: "Soundboard (/sound)",
      d_soundboard: "Permite tocar efeitos com /sound.",
      f_maxChars: "Máx. de caracteres por mensagem",
      d_maxChars: "Mensagens mais longas são cortadas.",
      f_ratePerMin: "Mensagens por minuto (por pessoa)",
      d_ratePerMin: "Limita a rapidez de leitura por pessoa.",
      f_locale: "Língua do servidor",
      d_locale: "Língua que o Vozen usa neste servidor.",
    },
    fr: {
      loginTitle: "Connecte-toi pour gérer tes serveurs",
      loginSub:
        "On te demandera de partager la liste des serveurs que tu gères. On ne touche qu'aux serveurs où tu es admin et où Vozen est présent.",
      loginBtn: "Se connecter avec Discord",
      loading: "Chargement…",
      pick: "Choisis un serveur",
      pickHint: "Serveurs où tu es admin et où Vozen est ajouté.",
      none: "Aucun serveur à gérer",
      noneHint:
        "Il te faut la permission Gérer le serveur sur un serveur où Vozen est présent. Ajoute Vozen, puis recharge.",
      expired: "Ta session a expiré — reconnecte-toi.",
      forbidden: "Tu ne peux pas gérer ce serveur.",
      error: "Un problème est survenu. Réessaie dans un instant.",
      save: "Enregistrer",
      save1: "Enregistrer 1 modification",
      saveN: "Enregistrer {n} modifications",
      saving: "Enregistrement…",
      saved: "Enregistré ✓",
      saveFail: "Échec de l'enregistrement — réessaie.",
      back: "← Choisir un autre serveur",
      sec_reading: "Lecture",
      sec_voice: "Voix",
      sec_community: "Communauté",
      sec_limits: "Limites",
      f_autoread: "Lire le salon défini",
      d_autoread: "Lit à voix haute les messages envoyés dans le salon que tu as défini.",
      f_readBots: "Lire les messages des autres bots",
      d_readBots: "Lit aussi les messages postés par d'autres bots.",
      f_textInVoice: "Lire le chat du salon vocal",
      d_textInVoice: "Lit le chat texte intégré au salon vocal.",
      f_antispam: "Filtre anti-spam",
      d_antispam: "Ignore les messages spam ou répétés.",
      f_xsaid: "Annoncer qui a parlé",
      d_xsaid: "Préfixe chaque message par « {nom} a dit … ».",
      f_autojoin: "Rejoindre le vocal automatiquement",
      d_autojoin: "Vozen rejoint le salon vocal tout seul.",
      f_greetOnJoin: "Saluer les arrivants",
      d_greetOnJoin: "Dit bonjour quand quelqu'un rejoint le vocal.",
      f_streakAnnounce: "Annonces de série 🔥 quotidienne",
      d_streakAnnounce: "Annonce les séries d'activité quotidiennes.",
      f_soundboard: "Soundboard (/sound)",
      d_soundboard: "Permet aux membres de jouer des effets sonores avec /sound.",
      f_maxChars: "Caractères max par message",
      d_maxChars: "Les messages plus longs sont coupés.",
      f_ratePerMin: "Messages par minute (par personne)",
      d_ratePerMin: "Limite la vitesse de lecture d'une même personne.",
      f_locale: "Langue du serveur",
      d_locale: "Langue que Vozen utilise pour ce serveur.",
    },
    es: {
      loginTitle: "Inicia sesión para gestionar tus servidores",
      loginSub:
        "Te pediremos compartir la lista de servidores que gestionas. Solo tocamos servidores donde eres administrador y Vozen está presente.",
      loginBtn: "Iniciar sesión con Discord",
      loading: "Cargando…",
      pick: "Elige un servidor",
      pickHint: "Servidores donde eres administrador y Vozen está añadido.",
      none: "No hay servidores que gestionar",
      noneHint:
        "Necesitas el permiso Gestionar servidor en un servidor con Vozen. Añade Vozen y recarga.",
      expired: "Tu sesión ha caducado — inicia sesión de nuevo.",
      forbidden: "No puedes gestionar ese servidor.",
      error: "Algo salió mal. Inténtalo de nuevo en un momento.",
      save: "Guardar cambios",
      save1: "Guardar 1 cambio",
      saveN: "Guardar {n} cambios",
      saving: "Guardando…",
      saved: "Guardado ✓",
      saveFail: "No se pudo guardar — inténtalo de nuevo.",
      back: "← Elegir otro servidor",
      sec_reading: "Lectura",
      sec_voice: "Voz",
      sec_community: "Comunidad",
      sec_limits: "Límites",
      f_autoread: "Leer el canal definido",
      d_autoread: "Lee en voz alta los mensajes enviados en el canal que definiste.",
      f_readBots: "Leer mensajes de otros bots",
      d_readBots: "También lee los mensajes de otros bots.",
      f_textInVoice: "Leer el chat del canal de voz",
      d_textInVoice: "Lee el chat de texto integrado en el canal de voz.",
      f_antispam: "Filtro anti-spam",
      d_antispam: "Ignora mensajes de spam o repetidos.",
      f_xsaid: "Anunciar quién habló",
      d_xsaid: 'Antepone a cada mensaje "{nombre} dijo …".',
      f_autojoin: "Unirse a la voz automáticamente",
      d_autojoin: "Vozen entra solo al canal de voz.",
      f_greetOnJoin: "Saludar a quien entra",
      d_greetOnJoin: "Saluda cuando alguien entra a la llamada.",
      f_streakAnnounce: "Avisos de racha 🔥 diaria",
      d_streakAnnounce: "Anuncia las rachas de actividad diaria.",
      f_soundboard: "Soundboard (/sound)",
      d_soundboard: "Permite a los miembros reproducir efectos de sonido con /sound.",
      f_maxChars: "Máx. de caracteres por mensaje",
      d_maxChars: "Los mensajes más largos se recortan.",
      f_ratePerMin: "Mensajes por minuto (por persona)",
      d_ratePerMin: "Limita la rapidez de lectura de una misma persona.",
      f_locale: "Idioma del servidor",
      d_locale: "Idioma que Vozen usa para este servidor.",
    },
    de: {
      loginTitle: "Melde dich an, um deine Server zu verwalten",
      loginSub:
        "Du wirst gebeten, die Liste der von dir verwalteten Server zu teilen. Wir berühren nur Server, auf denen du Admin bist und Vozen vorhanden ist.",
      loginBtn: "Mit Discord anmelden",
      loading: "Lädt…",
      pick: "Wähle einen Server",
      pickHint: "Server, auf denen du Admin bist und Vozen hinzugefügt ist.",
      none: "Keine Server zu verwalten",
      noneHint:
        "Du brauchst die Berechtigung „Server verwalten“ auf einem Server mit Vozen. Füge Vozen hinzu und lade neu.",
      expired: "Deine Sitzung ist abgelaufen — bitte melde dich erneut an.",
      forbidden: "Du kannst diesen Server nicht verwalten.",
      error: "Etwas ist schiefgelaufen. Versuch es gleich noch mal.",
      save: "Änderungen speichern",
      save1: "1 Änderung speichern",
      saveN: "{n} Änderungen speichern",
      saving: "Speichern…",
      saved: "Gespeichert ✓",
      saveFail: "Speichern fehlgeschlagen — versuch es noch mal.",
      back: "← Anderen Server wählen",
      sec_reading: "Vorlesen",
      sec_voice: "Stimme",
      sec_community: "Community",
      sec_limits: "Limits",
      f_autoread: "Festgelegten Kanal vorlesen",
      d_autoread: "Liest Nachrichten aus dem festgelegten Kanal laut vor.",
      f_readBots: "Nachrichten anderer Bots vorlesen",
      d_readBots: "Liest auch Nachrichten anderer Bots vor.",
      f_textInVoice: "Text-Chat des Sprachkanals vorlesen",
      d_textInVoice: "Liest den in den Sprachkanal integrierten Text-Chat vor.",
      f_antispam: "Anti-Spam-Filter",
      d_antispam: "Überspringt Spam- oder wiederholte Nachrichten.",
      f_xsaid: "Ansagen, wer geschrieben hat",
      d_xsaid: 'Stellt jeder Nachricht „{name} sagte …“ voran.',
      f_autojoin: "Automatisch dem Sprachkanal beitreten",
      d_autojoin: "Vozen tritt dem Sprachkanal von selbst bei.",
      f_greetOnJoin: "Beitretende begrüßen",
      d_greetOnJoin: "Begrüßt, wenn jemand dem Call beitritt.",
      f_streakAnnounce: "Tägliche 🔥-Serien-Hinweise",
      d_streakAnnounce: "Kündigt tägliche Aktivitätsserien an.",
      f_soundboard: "Soundboard (/sound)",
      d_soundboard: "Lässt Mitglieder mit /sound Soundeffekte abspielen.",
      f_maxChars: "Max. Zeichen pro Nachricht",
      d_maxChars: "Längere Nachrichten werden abgeschnitten.",
      f_ratePerMin: "Nachrichten pro Minute (pro Person)",
      d_ratePerMin: "Begrenzt, wie schnell eine Person vorgelesen wird.",
      f_locale: "Serversprache",
      d_locale: "Sprache, die Vozen für diesen Server verwendet.",
    },
    tr: {
      loginTitle: "Sunucularını yönetmek için giriş yap",
      loginSub:
        "Yönettiğin sunucuların listesini paylaşman istenecek. Yalnızca yönetici olduğun ve Vozen'in bulunduğu sunuculara dokunuruz.",
      loginBtn: "Discord ile giriş yap",
      loading: "Yükleniyor…",
      pick: "Bir sunucu seç",
      pickHint: "Yönetici olduğun ve Vozen'in eklendiği sunucular.",
      none: "Yönetilecek sunucu yok",
      noneHint:
        "Vozen'in bulunduğu bir sunucuda Sunucuyu Yönet iznine ihtiyacın var. Vozen'i ekle ve yeniden yükle.",
      expired: "Oturumun sona erdi — lütfen tekrar giriş yap.",
      forbidden: "Bu sunucuyu yönetemezsin.",
      error: "Bir şeyler ters gitti. Birazdan tekrar dene.",
      save: "Değişiklikleri kaydet",
      save1: "1 değişikliği kaydet",
      saveN: "{n} değişikliği kaydet",
      saving: "Kaydediliyor…",
      saved: "Kaydedildi ✓",
      saveFail: "Kaydedilemedi — tekrar dene.",
      back: "← Başka sunucu seç",
      sec_reading: "Okuma",
      sec_voice: "Ses",
      sec_community: "Topluluk",
      sec_limits: "Sınırlar",
      f_autoread: "Belirlenen kanalı oku",
      d_autoread: "Belirlediğin kanala gönderilen mesajları sesli okur.",
      f_readBots: "Diğer botların mesajlarını oku",
      d_readBots: "Diğer botların gönderdiği mesajları da okur.",
      f_textInVoice: "Ses kanalının metin sohbetini oku",
      d_textInVoice: "Ses kanalına gömülü metin sohbetini okur.",
      f_antispam: "Anti-spam filtresi",
      d_antispam: "Spam veya tekrarlanan mesajları atlar.",
      f_xsaid: "Kimin konuştuğunu duyur",
      d_xsaid: 'Her mesajın başına "{ad} dedi …" ekler.',
      f_autojoin: "Sese otomatik katıl",
      d_autojoin: "Vozen ses kanalına kendi kendine katılır.",
      f_greetOnJoin: "Katılanları selamla",
      d_greetOnJoin: "Biri aramaya katıldığında selam verir.",
      f_streakAnnounce: "Günlük 🔥 seri bildirimleri",
      d_streakAnnounce: "Günlük etkinlik serilerini duyurur.",
      f_soundboard: "Soundboard (/sound)",
      d_soundboard: "Üyelerin /sound ile ses efekti çalmasına izin verir.",
      f_maxChars: "Mesaj başına maks. karakter",
      d_maxChars: "Daha uzun mesajlar kesilir.",
      f_ratePerMin: "Dakikada mesaj (kişi başına)",
      d_ratePerMin: "Bir kişinin ne kadar hızlı okunacağını sınırlar.",
      f_locale: "Sunucu dili",
      d_locale: "Vozen'in bu sunucuda kullandığı dil.",
    },
    ru: {
      loginTitle: "Войди, чтобы управлять своими серверами",
      loginSub:
        "Тебя попросят поделиться списком серверов, которыми ты управляешь. Мы затрагиваем только серверы, где ты администратор и присутствует Vozen.",
      loginBtn: "Войти через Discord",
      loading: "Загрузка…",
      pick: "Выбери сервер",
      pickHint: "Серверы, где ты администратор и добавлен Vozen.",
      none: "Нет серверов для управления",
      noneHint:
        "Нужно право «Управление сервером» на сервере с Vozen. Добавь Vozen и обнови страницу.",
      expired: "Сессия истекла — войди снова.",
      forbidden: "Ты не можешь управлять этим сервером.",
      error: "Что-то пошло не так. Попробуй через мгновение.",
      save: "Сохранить изменения",
      save1: "Сохранить 1 изменение",
      saveN: "Сохранить изменений: {n}",
      saving: "Сохранение…",
      saved: "Сохранено ✓",
      saveFail: "Не удалось сохранить — попробуй ещё раз.",
      back: "← Выбрать другой сервер",
      sec_reading: "Чтение",
      sec_voice: "Голос",
      sec_community: "Сообщество",
      sec_limits: "Ограничения",
      f_autoread: "Читать заданный канал",
      d_autoread: "Озвучивает сообщения из канала, который ты задал.",
      f_readBots: "Читать сообщения других ботов",
      d_readBots: "Также озвучивает сообщения других ботов.",
      f_textInVoice: "Читать текст-чат голосового канала",
      d_textInVoice: "Озвучивает текстовый чат, встроенный в голосовой канал.",
      f_antispam: "Антиспам-фильтр",
      d_antispam: "Пропускает спам и повторяющиеся сообщения.",
      f_xsaid: "Объявлять, кто написал",
      d_xsaid: 'Добавляет перед каждым сообщением «{имя} сказал(а) …».',
      f_autojoin: "Автоматически заходить в голосовой",
      d_autojoin: "Vozen сам заходит в голосовой канал.",
      f_greetOnJoin: "Приветствовать вошедших",
      d_greetOnJoin: "Здоровается, когда кто-то заходит в звонок.",
      f_streakAnnounce: "Уведомления о ежедневной серии 🔥",
      d_streakAnnounce: "Объявляет о ежедневных сериях активности.",
      f_soundboard: "Soundboard (/sound)",
      d_soundboard: "Позволяет участникам проигрывать звуки через /sound.",
      f_maxChars: "Макс. символов в сообщении",
      d_maxChars: "Более длинные сообщения обрезаются.",
      f_ratePerMin: "Сообщений в минуту (на человека)",
      d_ratePerMin: "Ограничивает, как быстро озвучивается один человек.",
      f_locale: "Язык сервера",
      d_locale: "Язык, который Vozen использует для этого сервера.",
    },
    ar: {
      loginTitle: "سجّل الدخول لإدارة خوادمك",
      loginSub:
        "سيُطلب منك مشاركة قائمة الخوادم التي تديرها. نتعامل فقط مع الخوادم التي تكون فيها مشرفًا ويكون Vozen موجودًا.",
      loginBtn: "تسجيل الدخول عبر Discord",
      loading: "جارٍ التحميل…",
      pick: "اختر خادمًا",
      pickHint: "الخوادم التي تكون فيها مشرفًا وأُضيف إليها Vozen.",
      none: "لا توجد خوادم لإدارتها",
      noneHint: "تحتاج إلى صلاحية «إدارة الخادم» في خادم يوجد به Vozen. أضِف Vozen ثم أعِد التحميل.",
      expired: "انتهت جلستك — يُرجى تسجيل الدخول من جديد.",
      forbidden: "لا يمكنك إدارة هذا الخادم.",
      error: "حدث خطأ ما. حاول بعد لحظات.",
      save: "حفظ التغييرات",
      save1: "حفظ تغيير واحد",
      saveN: "حفظ {n} تغييرات",
      saving: "جارٍ الحفظ…",
      saved: "تم الحفظ ✓",
      saveFail: "تعذّر الحفظ — حاول مرة أخرى.",
      back: "← اختيار خادم آخر",
      sec_reading: "القراءة",
      sec_voice: "الصوت",
      sec_community: "المجتمع",
      sec_limits: "الحدود",
      f_autoread: "قراءة القناة المحددة",
      d_autoread: "يقرأ بصوت عالٍ الرسائل المُرسلة في القناة التي حددتها.",
      f_readBots: "قراءة رسائل البوتات الأخرى",
      d_readBots: "يقرأ أيضًا الرسائل التي تنشرها بوتات أخرى.",
      f_textInVoice: "قراءة دردشة القناة الصوتية النصية",
      d_textInVoice: "يقرأ الدردشة النصية المدمجة في القناة الصوتية.",
      f_antispam: "مرشّح مكافحة السبام",
      d_antispam: "يتجاهل الرسائل المزعجة أو المكررة.",
      f_xsaid: "الإعلان عمّن تحدّث",
      d_xsaid: "يسبق كل رسالة بـ «{الاسم} قال …».",
      f_autojoin: "الانضمام إلى الصوت تلقائيًا",
      d_autojoin: "ينضم Vozen إلى القناة الصوتية من تلقاء نفسه.",
      f_greetOnJoin: "الترحيب بالمنضمّين",
      d_greetOnJoin: "يُرحّب عندما ينضم أحدهم إلى المكالمة.",
      f_streakAnnounce: "إشعارات سلسلة 🔥 اليومية",
      d_streakAnnounce: "يُعلن عن سلاسل النشاط اليومية.",
      f_soundboard: "لوحة الأصوات (/sound)",
      d_soundboard: "يتيح للأعضاء تشغيل مؤثرات صوتية عبر /sound.",
      f_maxChars: "أقصى عدد أحرف للرسالة",
      d_maxChars: "الرسائل الأطول تُقتطع.",
      f_ratePerMin: "رسائل في الدقيقة (لكل شخص)",
      d_ratePerMin: "يحدّ من سرعة قراءة الشخص نفسه.",
      f_locale: "لغة الخادم",
      d_locale: "اللغة التي يستخدمها Vozen لهذا الخادم.",
    },
    zh: {
      loginTitle: "登录以管理你的服务器",
      loginSub: "系统会请求分享你管理的服务器列表。我们只处理你是管理员且已添加 Vozen 的服务器。",
      loginBtn: "使用 Discord 登录",
      loading: "加载中…",
      pick: "选择一个服务器",
      pickHint: "你是管理员且已添加 Vozen 的服务器。",
      none: "没有可管理的服务器",
      noneHint: "你需要在已添加 Vozen 的服务器上拥有「管理服务器」权限。添加 Vozen 后重新加载。",
      expired: "你的登录已过期——请重新登录。",
      forbidden: "你无法管理该服务器。",
      error: "出了点问题。请稍后再试。",
      save: "保存更改",
      save1: "保存 1 项更改",
      saveN: "保存 {n} 项更改",
      saving: "保存中…",
      saved: "已保存 ✓",
      saveFail: "保存失败——请重试。",
      back: "← 选择其他服务器",
      sec_reading: "朗读",
      sec_voice: "语音",
      sec_community: "社区",
      sec_limits: "限制",
      f_autoread: "朗读指定频道",
      d_autoread: "朗读你所指定频道中发送的消息。",
      f_readBots: "朗读其他机器人的消息",
      d_readBots: "也朗读其他机器人发布的消息。",
      f_textInVoice: "朗读语音频道的文字聊天",
      d_textInVoice: "朗读语音频道内嵌的文字聊天。",
      f_antispam: "反刷屏过滤",
      d_antispam: "跳过刷屏或重复的消息。",
      f_xsaid: "播报是谁说的",
      d_xsaid: '在每条消息前加上「{名字} 说 …」。',
      f_autojoin: "自动加入语音",
      d_autojoin: "Vozen 会自行加入语音频道。",
      f_greetOnJoin: "问候加入的人",
      d_greetOnJoin: "有人加入通话时打招呼。",
      f_streakAnnounce: "每日 🔥 连续提醒",
      d_streakAnnounce: "播报每日活跃连续记录。",
      f_soundboard: "音效板 (/sound)",
      d_soundboard: "让成员用 /sound 播放音效。",
      f_maxChars: "每条消息最大字符数",
      d_maxChars: "过长的消息会被截断。",
      f_ratePerMin: "每分钟消息数（每人）",
      d_ratePerMin: "限制同一人被朗读的速度。",
      f_locale: "服务器语言",
      d_locale: "Vozen 在该服务器使用的语言。",
    },
    ko: {
      loginTitle: "로그인하여 서버를 관리하세요",
      loginSub:
        "관리 중인 서버 목록 공유를 요청받게 됩니다. 관리자이면서 Vozen이 있는 서버만 다룹니다.",
      loginBtn: "Discord로 로그인",
      loading: "불러오는 중…",
      pick: "서버 선택",
      pickHint: "관리자이면서 Vozen이 추가된 서버입니다.",
      none: "관리할 서버가 없습니다",
      noneHint:
        "Vozen이 있는 서버에서 서버 관리하기 권한이 필요합니다. Vozen을 추가한 뒤 새로고침하세요.",
      expired: "세션이 만료되었습니다 — 다시 로그인하세요.",
      forbidden: "이 서버는 관리할 수 없습니다.",
      error: "문제가 발생했습니다. 잠시 후 다시 시도하세요.",
      save: "변경 사항 저장",
      save1: "변경 1개 저장",
      saveN: "변경 {n}개 저장",
      saving: "저장 중…",
      saved: "저장됨 ✓",
      saveFail: "저장하지 못했습니다 — 다시 시도하세요.",
      back: "← 다른 서버 선택",
      sec_reading: "읽기",
      sec_voice: "음성",
      sec_community: "커뮤니티",
      sec_limits: "제한",
      f_autoread: "지정한 채널 읽기",
      d_autoread: "지정한 채널에 올라온 메시지를 소리 내어 읽습니다.",
      f_readBots: "다른 봇의 메시지 읽기",
      d_readBots: "다른 봇이 올린 메시지도 읽습니다.",
      f_textInVoice: "음성 채널의 텍스트 채팅 읽기",
      d_textInVoice: "음성 채널에 내장된 텍스트 채팅을 읽습니다.",
      f_antispam: "스팸 방지 필터",
      d_antispam: "스팸이나 반복된 메시지를 건너뜁니다.",
      f_xsaid: "누가 말했는지 알리기",
      d_xsaid: '각 메시지 앞에 "{이름} 님이 말함 …"을 붙입니다.',
      f_autojoin: "음성에 자동 참여",
      d_autojoin: "Vozen이 알아서 음성 채널에 참여합니다.",
      f_greetOnJoin: "들어온 사람 인사",
      d_greetOnJoin: "누군가 통화에 참여하면 인사합니다.",
      f_streakAnnounce: "일일 🔥 연속 알림",
      d_streakAnnounce: "일일 활동 연속 기록을 알립니다.",
      f_soundboard: "사운드보드 (/sound)",
      d_soundboard: "멤버가 /sound로 효과음을 재생할 수 있게 합니다.",
      f_maxChars: "메시지당 최대 글자 수",
      d_maxChars: "더 긴 메시지는 잘립니다.",
      f_ratePerMin: "분당 메시지 (인당)",
      d_ratePerMin: "한 사람이 읽히는 속도를 제한합니다.",
      f_locale: "서버 언어",
      d_locale: "Vozen이 이 서버에서 사용하는 언어입니다.",
    },
  };
  function lang() {
    try {
      var l = localStorage.getItem(LS_LANG) || "en";
      return STR[l] ? l : "en";
    } catch (e) {
      return "en";
    }
  }
  function t(k) {
    var l = lang();
    return (STR[l] && STR[l][k]) || STR.en[k] || k;
  }

  /* Estrutura do formulário: campos agrupados por tema. A whitelist de escrita é no
     backend (DASHBOARD_FIELDS em src/premium/dashboardApi.ts) — isto é só a vista. */
  var SECTIONS = [
    { id: "reading", fields: ["autoread", "readBots", "textInVoice", "antispam"] },
    { id: "voice", fields: ["xsaid", "autojoin", "greetOnJoin"] },
    { id: "community", fields: ["streakAnnounce", "soundboard"] },
    { id: "limits", fields: ["maxChars", "ratePerMin", "locale"] },
  ];
  var FIELD = {
    autoread: { type: "toggle" },
    readBots: { type: "toggle" },
    textInVoice: { type: "toggle" },
    antispam: { type: "toggle" },
    xsaid: { type: "toggle" },
    autojoin: { type: "toggle" },
    greetOnJoin: { type: "toggle" },
    streakAnnounce: { type: "toggle" },
    soundboard: { type: "toggle" },
    maxChars: { type: "num", min: 1, max: 2000 },
    ratePerMin: { type: "num", min: 1, max: 120 },
    locale: { type: "select" },
  };

  /* Línguas do servidor. Espelho de SUPPORTED_LOCALES (src/i18n/index.ts) com nomes
     legíveis. Se divergir, o backend valida na mesma (sanitizePatch descarta locales
     desconhecidos), por isso drift degrada para "opção em falta", nunca para erro. */
  var LOCALES = [
    ["en", "English"], ["pt", "Português"], ["es", "Español"], ["fr", "Français"],
    ["de", "Deutsch"], ["nl", "Nederlands"], ["pl", "Polski"], ["tr", "Türkçe"],
    ["cs", "Čeština"], ["sv", "Svenska"], ["fi", "Suomi"], ["da", "Dansk"],
    ["ro", "Română"], ["hu", "Magyar"], ["cy", "Cymraeg"], ["is", "Íslenska"],
    ["lb", "Lëtzebuergesch"], ["lv", "Latviešu"], ["sk", "Slovenčina"],
    ["sl", "Slovenščina"], ["sw", "Kiswahili"], ["vi", "Tiếng Việt"],
    ["ca", "Català"], ["it", "Italiano"], ["el", "Ελληνικά"], ["ru", "Русский"],
    ["uk", "Українська"], ["kk", "Қазақ"], ["sr", "Српски"], ["ar", "العربية"],
    ["fa", "فارسی"], ["ka", "ქართული"], ["ne", "नेपाली"], ["zh", "中文"], ["ja", "日本語"],
  ];

  function eachField(fn) {
    for (var s = 0; s < SECTIONS.length; s++) {
      var f = SECTIONS[s].fields;
      for (var i = 0; i < f.length; i++) fn(f[i], FIELD[f[i]]);
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function token() {
    try {
      return sessionStorage.getItem(TOK_KEY);
    } catch (e) {
      return null;
    }
  }
  function clearToken() {
    try {
      sessionStorage.removeItem(TOK_KEY);
    } catch (e) {}
  }
  function authHeaders() {
    return { Authorization: "Bearer " + token() };
  }

  /* ── OAuth: pede identify+guilds via o redirect /account; volta a /dashboard ── */
  function randState() {
    var a = new Uint8Array(16);
    var c = window.crypto || window.msCrypto;
    if (!c || typeof c.getRandomValues !== "function") throw new Error("no-csprng");
    c.getRandomValues(a);
    return [].map
      .call(a, function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
  }
  function login() {
    var state;
    try {
      state = randState();
    } catch (e) {
      alert("Your browser can't generate a secure login token. Please update it.");
      return;
    }
    try {
      sessionStorage.setItem(STATE_KEY, state);
      sessionStorage.setItem(RETURN_KEY, "/dashboard");
    } catch (e) {}
    var u = new URL("https://discord.com/oauth2/authorize");
    u.searchParams.set("client_id", CLIENT_ID);
    u.searchParams.set("redirect_uri", REDIRECT);
    u.searchParams.set("response_type", "token");
    u.searchParams.set("scope", "identify guilds");
    u.searchParams.set("state", state);
    location.href = u.toString();
  }

  /* ── estilos inline (CSP permite; usam as vars do tema do site) ── */
  var CARD =
    "background:var(--panel-2,#12121c);border:1px solid var(--line-2,#23233a);border-radius:16px;padding:22px;margin-top:18px";
  var BTN = "btn btn--primary";
  var MUTED = "color:var(--text-2,#9a9ab0)";

  /* Seletor cai um SVG chevron via data: (img-src permite data:). %23 = # (cor). */
  var SEL_ARROW =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239a9ab0' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E";

  /* Classes precisam de :hover/:focus/::after — impossível em style="" inline;
     injetamos um <style> uma vez. */
  var CSS = [
    /* picker de servidores */
    ".dash-guilds{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:14px;margin-top:16px}",
    ".dash-guild{display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px 10px;background:var(--bg-0,#0a0a12);border:1px solid var(--line-2,#23233a);border-radius:14px;cursor:pointer;font:inherit;color:var(--text-1,#e9e9f2);transition:border-color .15s ease,transform .15s ease}",
    ".dash-guild:hover,.dash-guild:focus-visible{border-color:var(--aqua,#38e0c8);transform:translateY(-2px)}",
    ".dash-guild:active{transform:scale(.97)}",
    ".dash-guild__img,.dash-guild__ph{width:64px;height:64px;border-radius:50%;flex:none}",
    ".dash-guild__img{object-fit:cover;background:var(--panel-2,#12121c)}",
    ".dash-guild__ph{display:flex;align-items:center;justify-content:center;background:var(--panel-2,#12121c);border:1px solid var(--line-2,#23233a);font-weight:700;font-size:1.05rem;color:var(--aqua,#38e0c8)}",
    ".dash-guild__name{font-size:.92rem;line-height:1.3;text-align:center;overflow-wrap:anywhere}",
    /* formulário */
    ".dash-form{background:var(--panel-2,#12121c);border:1px solid var(--line-2,#23233a);border-radius:16px;padding:22px;margin-top:18px}",
    ".dash-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:4px}",
    ".dash-head__ic,.dash-head__ph{width:44px;height:44px;border-radius:50%;flex:none}",
    ".dash-head__ic{object-fit:cover;background:var(--bg-0,#0a0a12)}",
    ".dash-head__ph{display:flex;align-items:center;justify-content:center;background:var(--bg-0,#0a0a12);border:1px solid var(--line-2,#23233a);font-weight:700;color:var(--aqua,#38e0c8)}",
    ".dash-head__name{margin:0;font-size:1.2rem;font-family:var(--f-display,inherit);flex:1;min-width:120px;overflow-wrap:anywhere}",
    ".dash-back{margin-left:auto}",
    ".dash-sec{margin-top:22px}",
    ".dash-sec__t{font-family:var(--f-mono,inherit);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--aqua,#38e0c8);margin:0 0 2px}",
    ".dash-row{display:flex;align-items:center;gap:16px;padding:13px 10px;margin:0 -10px;border-radius:10px;border-bottom:1px solid var(--line-2,#23233a);cursor:pointer}",
    ".dash-sec .dash-row:last-child{border-bottom:0}",
    ".dash-row:hover{background:var(--glass,rgba(255,255,255,.03))}",
    ".dash-row__txt{flex:1;min-width:0}",
    ".dash-row__l{display:block;font-size:.98rem;color:var(--text-1,#e9e9f2)}",
    ".dash-row__d{display:block;font-size:.82rem;color:var(--text-2,#9a9ab0);margin-top:2px}",
    /* toggle switch */
    ".dash-sw{position:relative;flex:none;width:44px;height:24px}",
    ".dash-sw input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}",
    ".dash-sw__tr{position:absolute;inset:0;border-radius:999px;background:var(--line-2,#23233a);transition:background .15s ease;pointer-events:none}",
    ".dash-sw__tr::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s ease}",
    ".dash-sw input:checked+.dash-sw__tr{background:var(--aqua,#38e0c8)}",
    ".dash-sw input:checked+.dash-sw__tr::after{transform:translateX(20px)}",
    ".dash-sw input:focus-visible+.dash-sw__tr{outline:2px solid var(--aqua,#38e0c8);outline-offset:2px}",
    /* número + select */
    ".dash-num,.dash-sel{background:var(--bg-0,#0a0a12);color:var(--text-1,#e9e9f2);border:1px solid var(--line-2,#23233a);border-radius:10px;font:inherit;transition:border-color .15s ease}",
    ".dash-num{width:92px;padding:9px 10px;font-family:var(--f-mono,inherit);text-align:right}",
    ".dash-sel{max-width:180px;padding:9px 30px 9px 11px;cursor:pointer;-webkit-appearance:none;-moz-appearance:none;appearance:none;background-image:url(\"" + SEL_ARROW + "\");background-repeat:no-repeat;background-position:right 10px center}",
    ".dash-num:focus,.dash-sel:focus{outline:none;border-color:var(--aqua,#38e0c8)}",
    /* barra de guardar */
    ".dash-savebar{display:flex;align-items:center;gap:14px;margin-top:22px;padding-top:18px;border-top:1px solid var(--line-2,#23233a)}",
    ".dash-save[disabled]{opacity:.45;cursor:not-allowed}",
    ".dash-status{font-size:.9rem;color:var(--text-2,#9a9ab0)}",
    ".dash-status--ok{color:var(--aqua,#38e0c8)}",
    ".dash-status--err{color:var(--amber,#e6b34d)}",
    /* mobile: barra de guardar colada ao fundo (forms longos) */
    "@media(max-width:720px){.dash-savebar{position:sticky;bottom:0;margin:22px -22px -22px;padding:14px 22px;background:var(--panel-2,#12121c);border-top:1px solid var(--line-2,#23233a)}.dash-sel{max-width:150px}}",
    "@media(prefers-reduced-motion:reduce){.dash-guild,.dash-sw__tr,.dash-sw__tr::after,.dash-num,.dash-sel{transition:none}}",
  ].join("\n");
  var styleEl = document.createElement("style");
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  function view(html) {
    root.innerHTML = html;
  }

  function renderLogin(msg) {
    view(
      '<div style="' +
        CARD +
        '">' +
        (msg ? '<p style="color:var(--amber,#e6b34d);margin:0 0 12px">' + esc(msg) + "</p>" : "") +
        '<h2 style="margin:0 0 6px;font-size:1.25rem">' +
        esc(t("loginTitle")) +
        '</h2><p style="' +
        MUTED +
        ';margin:0 0 18px">' +
        esc(t("loginSub")) +
        '</p><button type="button" class="' +
        BTN +
        '" id="dashLogin">' +
        esc(t("loginBtn")) +
        "</button></div>",
    );
    var b = document.getElementById("dashLogin");
    if (b) b.addEventListener("click", login);
    onLang = function () {
      renderLogin(msg);
    };
  }

  function renderMessage(title, hint, opts) {
    opts = opts || {};
    view(
      '<div style="' +
        CARD +
        '"><h2 style="margin:0 0 6px;font-size:1.25rem">' +
        esc(title) +
        '</h2><p style="' +
        MUTED +
        ';margin:0">' +
        esc(hint) +
        "</p>" +
        (opts.retry
          ? '<button type="button" class="' +
            BTN +
            '" id="dashRetry" style="margin-top:16px">' +
            esc(t("loginBtn")) +
            "</button>"
          : "") +
        "</div>",
    );
    if (opts.retry) {
      var r = document.getElementById("dashRetry");
      if (r) r.addEventListener("click", login);
    }
    // title/hint chegam já resolvidos; re-render mantém-nos, mas re-traduz o botão de retry.
    onLang = function () {
      renderMessage(title, hint, opts);
    };
  }

  /* CDN de ícones da Discord (img-src já permite cdn.discordapp.com no CSP).
     Ícones animados têm hash "a_..." e servem-se como .gif. */
  function guildIconUrl(g) {
    if (!g.icon) return null;
    var ext = String(g.icon).indexOf("a_") === 0 ? "gif" : "png";
    return "https://cdn.discordapp.com/icons/" + g.id + "/" + g.icon + "." + ext + "?size=128";
  }
  function guildInitials(name) {
    var parts = String(name).trim().split(/\s+/).slice(0, 2);
    var out = "";
    for (var i = 0; i < parts.length; i++) out += parts[i].charAt(0);
    return out.toUpperCase() || "?";
  }
  // Liga o fallback de um <img> de ícone: se falhar, troca por placeholder de iniciais.
  function wireIconFallback(img, name, phClass) {
    if (!img) return;
    img.addEventListener("error", function () {
      var ph = document.createElement("span");
      ph.className = phClass;
      ph.setAttribute("aria-hidden", "true");
      ph.textContent = guildInitials(name || "?");
      if (img.parentNode) img.parentNode.replaceChild(ph, img);
    });
  }

  function renderPicker(guilds) {
    var cards = guilds
      .map(function (g, i) {
        var url = guildIconUrl(g);
        var art = url
          ? '<img class="dash-guild__img" src="' + esc(url) + '" alt="">'
          : '<span class="dash-guild__ph" aria-hidden="true">' +
            esc(guildInitials(g.name)) +
            "</span>";
        return (
          '<button type="button" class="dash-guild" data-i="' +
          i +
          '">' +
          art +
          '<span class="dash-guild__name">' +
          esc(g.name) +
          "</span></button>"
        );
      })
      .join("");
    view(
      '<div style="' +
        CARD +
        '"><h2 style="margin:0 0 6px;font-size:1.25rem">' +
        esc(t("pick")) +
        '</h2><p style="' +
        MUTED +
        ';margin:0">' +
        esc(t("pickHint")) +
        '</p><div class="dash-guilds">' +
        cards +
        "</div></div>",
    );
    var btns = root.querySelectorAll(".dash-guild");
    function onPick(ev) {
      var g = guilds[Number(ev.currentTarget.getAttribute("data-i"))];
      if (g) loadForm(g, guilds);
    }
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", onPick);
      var g = guilds[i];
      wireIconFallback(btns[i].querySelector(".dash-guild__img"), g && g.name, "dash-guild__ph");
    }
    onLang = function () {
      renderPicker(guilds);
    };
  }

  /* ── construção das linhas do formulário ── */
  function swHtml(key, on) {
    return (
      '<span class="dash-sw"><input type="checkbox" data-k="' +
      key +
      '"' +
      (on ? " checked" : "") +
      '><span class="dash-sw__tr"></span></span>'
    );
  }
  function numHtml(key, f, val) {
    return (
      '<input class="dash-num" type="number" data-k="' +
      key +
      '" min="' +
      f.min +
      '" max="' +
      f.max +
      '" value="' +
      esc(val) +
      '">'
    );
  }
  function selHtml(key, val) {
    var opts = "";
    for (var i = 0; i < LOCALES.length; i++) {
      var code = LOCALES[i][0];
      opts +=
        '<option value="' +
        esc(code) +
        '"' +
        (code === val ? " selected" : "") +
        ">" +
        esc(LOCALES[i][1]) +
        "</option>";
    }
    return '<select class="dash-sel" data-k="' + key + '">' + opts + "</select>";
  }
  function rowHtml(key, cfg) {
    var f = FIELD[key];
    var control;
    var desc = t("d_" + key);
    if (f.type === "toggle") control = swHtml(key, !!cfg[key]);
    else if (f.type === "num") {
      control = numHtml(key, f, cfg[key]);
      desc += " (" + f.min + "–" + f.max + ")";
    } else control = selHtml(key, cfg[key]);
    return (
      '<label class="dash-row"><span class="dash-row__txt"><span class="dash-row__l">' +
      esc(t("f_" + key)) +
      '</span><span class="dash-row__d">' +
      esc(desc) +
      "</span></span>" +
      control +
      "</label>"
    );
  }
  function headHtml(guild) {
    var url = guildIconUrl(guild);
    var art = url
      ? '<img class="dash-head__ic" src="' + esc(url) + '" alt="">'
      : '<span class="dash-head__ph" aria-hidden="true">' + esc(guildInitials(guild.name)) + "</span>";
    return (
      '<div class="dash-head">' +
      art +
      '<h2 class="dash-head__name">' +
      esc(guild.name) +
      '</h2><button type="button" id="dashBack" class="btn btn--ghost btn--sm dash-back">' +
      esc(t("back")) +
      "</button></div>"
    );
  }

  function loadForm(guild, guilds) {
    renderMessage(t("loading"), "");
    fetch(API + "/api/dashboard/guild/" + guild.id, { headers: authHeaders() })
      .then(function (res) {
        if (res.status === 401) {
          clearToken();
          renderLogin(t("expired"));
          return null;
        }
        if (res.status === 403) {
          renderMessage(t("forbidden"), t("noneHint"));
          return null;
        }
        if (!res.ok) {
          renderMessage(t("error"), "");
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (data && data.config) renderForm(guild, data.config, guilds);
      })
      .catch(function () {
        renderMessage(t("error"), "");
      });
  }

  // Valor normalizado de um campo (bool/num/string) a partir de um objeto de config.
  function fieldValue(key, src) {
    var f = FIELD[key];
    if (f.type === "toggle") return !!src[key];
    if (f.type === "num") return Number(src[key]);
    return String(src[key] || "en");
  }
  // Lê o valor atual do controlo no DOM.
  function domValue(key) {
    var el = root.querySelector('[data-k="' + key + '"]');
    if (!el) return undefined;
    var f = FIELD[key];
    if (f.type === "toggle") return el.checked;
    if (f.type === "num") return Number(el.value);
    return el.value;
  }

  function renderForm(guild, cfg, guilds) {
    // Baseline para dirty-tracking: o botão só fica ativo quando algo muda.
    var baseline = {};
    eachField(function (key) {
      baseline[key] = fieldValue(key, cfg);
    });

    var sections = SECTIONS.map(function (sec) {
      var rows = sec.fields
        .map(function (k) {
          return rowHtml(k, cfg);
        })
        .join("");
      return (
        '<div class="dash-sec"><p class="dash-sec__t">' + esc(t("sec_" + sec.id)) + "</p>" + rows + "</div>"
      );
    }).join("");

    var savebar =
      '<div class="dash-savebar"><button type="button" class="' +
      BTN +
      ' dash-save" id="dashSave" disabled>' +
      esc(t("save")) +
      '</button><span class="dash-status" id="dashStatus" aria-live="polite"></span></div>';

    view('<div class="dash-form">' + headHtml(guild) + sections + savebar + "</div>");
    wireIconFallback(root.querySelector(".dash-head__ic"), guild.name, "dash-head__ph");

    var formEl = root.querySelector(".dash-form");
    var saveBtn = document.getElementById("dashSave");
    var statusEl = document.getElementById("dashStatus");

    function countChanges() {
      var n = 0;
      eachField(function (key) {
        if (domValue(key) !== baseline[key]) n++;
      });
      return n;
    }
    function setStatus(msg, cls) {
      statusEl.textContent = msg || "";
      statusEl.className = "dash-status" + (cls ? " dash-status--" + cls : "");
    }
    function refresh() {
      var n = countChanges();
      saveBtn.disabled = n === 0;
      saveBtn.textContent =
        n === 0 ? t("save") : n === 1 ? t("save1") : t("saveN").replace("{n}", n);
      if (n > 0) setStatus(""); // limpa "Guardado ✓" assim que se volta a mexer
    }

    document.getElementById("dashBack").addEventListener("click", function () {
      renderPicker(guilds);
    });
    // Listeners no próprio form (substituído a cada render -> morrem com ele; sem leaks).
    formEl.addEventListener("input", refresh);
    formEl.addEventListener("change", refresh);

    saveBtn.addEventListener("click", function () {
      if (saveBtn.disabled) return;
      var patch = {};
      eachField(function (key) {
        var v = domValue(key);
        if (v === baseline[key]) return;
        if (FIELD[key].type === "num" && !isFinite(v)) return; // campo vazio -> não envia
        patch[key] = v;
      });
      saveBtn.disabled = true;
      saveBtn.textContent = t("saving");
      setStatus("");
      fetch(API + "/api/dashboard/guild/" + guild.id, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
        body: JSON.stringify(patch),
      })
        .then(function (res) {
          if (res.status === 401) {
            clearToken();
            renderLogin(t("expired"));
            return;
          }
          if (res.status === 403) {
            renderMessage(t("forbidden"), t("noneHint"));
            return;
          }
          if (!res.ok) {
            setStatus(t("saveFail"), "err");
            refresh();
            return;
          }
          // Guardado: a baseline passa a ser o estado atual (voltar a mexer reativa).
          eachField(function (key) {
            baseline[key] = domValue(key);
          });
          refresh();
          setStatus(t("saved"), "ok");
        })
        .catch(function () {
          setStatus(t("saveFail"), "err");
          refresh();
        });
    });

    refresh(); // estado inicial: sem alterações -> desativado

    // Re-localizador in-place: reescreve só os text-nodes traduzíveis (títulos de secção,
    // nomes/descrições dos campos, botão voltar) e deixa o refresh() recalcular o rótulo do
    // Guardar com a contagem de alterações atual. Não toca nos inputs -> preserva valores e
    // o estado "por guardar". Registado como re-localizador enquanto o form está visível.
    onLang = function relocalizeForm() {
      var secEls = root.querySelectorAll(".dash-sec");
      SECTIONS.forEach(function (sec, i) {
        var tEl = secEls[i] && secEls[i].querySelector(".dash-sec__t");
        if (tEl) tEl.textContent = t("sec_" + sec.id);
      });
      eachField(function (key) {
        var ctrl = root.querySelector('[data-k="' + key + '"]');
        var row = ctrl && ctrl.closest ? ctrl.closest(".dash-row") : null;
        if (!row) return;
        var lEl = row.querySelector(".dash-row__l");
        var dEl = row.querySelector(".dash-row__d");
        if (lEl) lEl.textContent = t("f_" + key);
        if (dEl) {
          var desc = t("d_" + key);
          if (FIELD[key].type === "num") desc += " (" + FIELD[key].min + "–" + FIELD[key].max + ")";
          dEl.textContent = desc;
        }
      });
      var back = document.getElementById("dashBack");
      if (back) back.textContent = t("back");
      refresh(); // recomputa o rótulo do Guardar (usa a baseline/contagem do closure)
    };
  }

  function boot() {
    var tok = token();
    if (!tok) {
      renderLogin("");
      return;
    }
    renderMessage(t("loading"), "");
    fetch(API + "/api/dashboard/guilds", { headers: authHeaders() })
      .then(function (res) {
        if (res.status === 401) {
          clearToken();
          renderLogin(t("expired"));
          return null;
        }
        if (!res.ok) {
          renderMessage(t("error"), "", { retry: true });
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        var guilds = data.guilds || [];
        if (!guilds.length) {
          renderMessage(t("none"), t("noneHint"));
          return;
        }
        renderPicker(guilds);
      })
      .catch(function () {
        renderMessage(t("error"), "", { retry: true });
      });
  }

  // Observa a troca de idioma (o applyLang do site atualiza <html lang>) e re-localiza a
  // vista atual sem reload nem novo fetch. attributeFilter garante que só reage a `lang`.
  var _obsLang = document.documentElement.getAttribute("lang");
  new MutationObserver(function () {
    var l = document.documentElement.getAttribute("lang");
    if (l === _obsLang) return;
    _obsLang = l;
    if (typeof onLang === "function") onLang();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  boot();
})();
