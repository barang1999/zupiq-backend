/**
 * Multilingual Content Moderation Keyword Extensions
 *
 * This file EXTENDS the base keyword lists in moderation.service.ts.
 * Import and spread these arrays into BLOCKED_KEYWORDS and BLOCKED_KEYWORDS_UNICODE
 * respectively, or consume them in a separate moderation pass.
 *
 * Design rules:
 *  - No word with common legitimate academic usage is included.
 *  - Every entry is commented with its language, meaning, and category rationale.
 *  - Latin list: all lowercase (matched via toLowerCase()).
 *  - Unicode list: matched against original text (case irrelevant for these scripts).
 */

import type { ModerationCategory } from './moderation.service.js';

// ─── Latin-script additions (lowercased, matched with toLowerCase()) ───────────
// These EXTEND the existing BLOCKED_KEYWORDS array in moderation.service.ts

export const LATIN_KEYWORDS_EXTENDED: string[] = [

  // ── English expansions ──────────────────────────────────────────────────────

  // Profanity variants and compounds
  "fucker",           // profanity — fuck + -er
  "fucked",           // profanity
  "fucking",          // profanity
  "fuckwit",          // profanity — UK slang for idiot
  "fuckhead",         // profanity
  "fuckface",         // profanity
  "motherf",          // profanity — motherfucker short form
  "crap",             // mild profanity
  "ass",              // profanity (standalone)
  "arse",             // British spelling of ass
  "arsehole",         // British profanity
  "shithead",         // profanity compound
  "shithole",         // profanity compound
  "shitstain",        // profanity compound
  "shitter",          // profanity
  "prick",            // profanity — penis / general insult
  "twat",             // profanity — British vulgar slang
  "wanker",           // British profanity — masturbator / idiot
  "wank",             // British profanity — to masturbate
  "bellend",          // British profanity — glans penis / idiot
  "tosser",           // British profanity — masturbator / idiot
  "numpty",           // mild British insult — idiot (borderline, but used as direct attack)
  "pillock",          // British insult — stupid person
  "muppet",           // British insult — idiot (only blocked as a direct attack prefix? kept conservative)
  "git",              // British insult — foolish/unpleasant person
  "bollocks",         // British profanity — nonsense / testicles
  "bloody hell",      // British mild profanity

  // Adult / explicit English expansions
  "boobs",            // adult — informal for breasts (used in explicit requests)
  "tits",             // adult — vulgar for breasts
  "titties",          // adult — vulgar for breasts
  "dick pic",         // adult — unsolicited genital image
  "send nudes",       // adult — soliciting explicit content
  "nudes",            // adult — explicit images
  "cam girl",         // adult — live sex worker
  "camgirl",          // adult — live sex worker
  "sexting",          // adult — sending sexual messages
  "sext me",          // adult — soliciting sexual messages
  "jerk off",         // adult — masturbation
  "jerk me",          // adult
  "cum",              // adult — ejaculate (as explicit term)
  "cumshot",          // adult — pornographic term
  "blowjob",          // adult — oral sex
  "blow job",         // adult — oral sex
  "handjob",          // adult — manual stimulation
  "hand job",         // adult — manual stimulation
  "fingering",        // adult — sexual act (context-dependent; blocked as explicit slang)
  "deepthroat",       // adult — pornographic act
  "anal sex",         // adult — explicit act
  "anal porn",        // adult — explicit content type
  "gangbang",         // adult — pornographic term
  "threesome",        // adult — sexual act (in solicitation context)
  "orgy",             // adult — group sexual activity
  "strip club",       // adult — adult entertainment venue solicitation
  "stripper",         // adult — adult entertainer (in solicitation context)
  "escort service",   // adult — euphemism for prostitution
  "prostitut",        // adult — prostitution (stem matches prostitute/prostitution)
  "whore",            // adult/harassment — sex worker as insult
  "slut",             // adult/harassment — sexual slur against women
  "slutty",           // adult/harassment — sexualising insult
  "bdsm",             // adult — bondage/discipline kink acronym
  "fetish video",     // adult — explicit fetish content
  "rule 34",          // adult — internet slang for pornographic content of anything
  "loli",             // adult — sexualised minors (anime)
  "shota",            // adult — sexualised male minors (anime)
  "cp",               // adult/violence — child pornography abbreviation (high false positive risk; kept due to severity)
  "child porn",       // adult — CSAM
  "csam",             // adult — child sexual abuse material acronym
  "underage",         // adult — soliciting/producing illegal content
  "jailbait",         // adult — sexualised depiction of minors

  // Hate speech — English slurs and dehumanisation
  "wetback",          // hate_speech — anti-Latino slur
  "beaner",           // hate_speech — anti-Latino slur
  "spook",            // hate_speech — anti-Black slur
  "coon",             // hate_speech — anti-Black slur
  "porch monkey",     // hate_speech — anti-Black slur
  "jungle bunny",     // hate_speech — anti-Black slur
  "cotton picker",    // hate_speech — anti-Black slur
  "nig",              // hate_speech — nigger abbreviation
  "nig nog",          // hate_speech — anti-Black slur
  "sand nigger",      // hate_speech — anti-Arab slur
  "sand n",           // hate_speech — anti-Arab slur short form
  "towelhead",        // hate_speech — anti-Muslim slur
  "raghead",          // hate_speech — anti-Muslim slur
  "camel jockey",     // hate_speech — anti-Arab slur
  "gook",             // hate_speech — anti-Asian slur (Vietnam War era)
  "slant eye",        // hate_speech — anti-Asian slur
  "zipperhead",       // hate_speech — anti-Asian slur
  "chink eye",        // hate_speech — anti-Asian slur compound
  "jap",              // hate_speech — anti-Japanese slur
  "nip",              // hate_speech — anti-Japanese slur (nipponese)
  "kraut",            // hate_speech — anti-German slur
  "frog",             // hate_speech — anti-French slur (context: derogatory use)
  "hymie",            // hate_speech — anti-Jewish slur
  "heeb",             // hate_speech — anti-Jewish slur
  "yid",              // hate_speech — anti-Jewish slur (pejorative use)
  "dyke",             // hate_speech — anti-lesbian slur
  "lesbo",            // hate_speech — derogatory term for lesbian
  "homo",             // hate_speech — derogatory term for gay person
  "queer bait",       // hate_speech — homophobic slur compound
  "fag",              // hate_speech — homophobic slur (short form of faggot)
  "shemale",          // hate_speech — derogatory term for trans women
  "troon",            // hate_speech — anti-trans slur
  "he-she",           // hate_speech — derogatory for non-binary/trans
  "it pronoun",       // hate_speech — dehumanising trans persons
  "retard",           // hate_speech — ableist slur
  "retarded",         // hate_speech — ableist slur
  "spastic",          // hate_speech — ableist slur (UK)
  "spaz",             // hate_speech — ableist slur
  "cripple",          // hate_speech — ableist slur when directed at a person
  "white power",      // hate_speech — white supremacist phrase
  "white pride",      // hate_speech — white supremacist phrase
  "heil hitler",      // hate_speech — Nazi salutation
  "sieg heil",        // hate_speech — Nazi phrase
  "14 words",         // hate_speech — white supremacist slogan
  "1488",             // hate_speech — white supremacist numeric code
  "gas the",          // hate_speech — Nazi extermination reference
  "jew down",         // hate_speech — antisemitic phrase (to bargain stereotypically)
  "jewish conspiracy",// hate_speech — antisemitic conspiracy phrase
  "black monkey",     // hate_speech — racist dehumanisation
  "n-word",           // hate_speech — soft reference to racial slur
  "kill all",         // violence — incitement phrase

  // Violence / self-harm / threats — English expansions
  "i want to kill",   // violence — threat
  "i'm going to kill",// violence — threat
  "shoot you",        // violence — threat
  "shoot him",        // violence — threat
  "stab you",         // violence — threat
  "stab him",         // violence — threat
  "beat you up",      // violence — threat
  "beat him up",      // violence — threat
  "rape you",         // violence — sexual violence threat
  "rape him",         // violence — threat
  "rape her",         // violence — threat
  "murder you",       // violence — threat
  "murder him",       // violence — threat
  "bomb threat",      // violence — threat
  "school shooting",  // violence — mass violence reference in threat context
  "mass shooter",     // violence — threat/glorification
  "suicide hotline hack",   // violence — self-harm workaround
  "how to end my life",     // violence — self-harm
  "ways to kill myself",    // violence — self-harm
  "painless suicide",       // violence — self-harm method
  "overdose on pills",      // violence — self-harm method
  "slit my wrists",         // violence — self-harm method
  "hang myself",            // violence — self-harm method
  "jump off a bridge",      // violence — self-harm method
  "self harm tips",         // violence — self-harm promotion
  "cutting tutorial",       // violence — self-harm tutorial
  "pro ana",                // violence — pro-anorexia (self-harm)
  "pro mia",                // violence — pro-bulimia (self-harm)
  "thinspiration",          // violence — anorexia promotion
  "thinspo",                // violence — anorexia promotion short form

  // Spam / drug solicitation — English expansions
  "buy heroin",       // spam/violence — drug solicitation
  "buy fentanyl",     // spam/violence — drug solicitation
  "buy pills",        // spam — drug solicitation
  "buy xanax",        // spam — drug solicitation
  "buy adderall",     // spam — drug solicitation
  "buy oxycodone",    // spam — drug solicitation
  "buy oxy",          // spam — drug solicitation
  "order drugs",      // spam — drug solicitation
  "drug plug",        // spam — drug dealer reference
  "dm for drugs",     // spam — drug solicitation
  "venmo me",         // spam — financial solicitation
  "cashapp me",       // spam — financial solicitation
  "paypal me",        // spam — financial solicitation
  "get rich quick",   // spam — financial scam
  "make money fast",  // spam — financial scam
  "work from home scam", // spam
  "invest now",       // spam — financial scam
  "click the link",   // spam
  "link in bio",      // spam — social media spam pattern
  "drop your ig",     // spam — off-platform solicitation
  "drop your snap",   // spam — off-platform solicitation
  "add me on snap",   // spam — off-platform solicitation
  "follow me on ig",  // spam
  "sub4sub",          // spam — subscription exchange
  "like for like",    // spam — engagement farming
  "comment for comment", // spam

  // ── Spanish ─────────────────────────────────────────────────────────────────

  "puta",             // harassment — whore / bitch (very common Spanish profanity)
  "puto",             // harassment — whore / bastard (male form)
  "putа madre",       // harassment — motherfucker (common Mexican/Latin American)
  "puta madre",       // harassment — motherfucker
  "hijo de puta",     // harassment — son of a bitch
  "hdp",              // harassment — hijo de puta acronym
  "mierda",           // harassment — shit
  "me cago",          // harassment — I shit (profanity expression)
  "coño",             // adult — cunt (Spain/Caribbean profanity)
  "cono",             // adult — coño without tilde
  "verga",            // adult — penis / fuck (Mexican slang)
  "vergón",           // adult — large penis (boastful/offensive)
  "pene",             // adult — penis (clinical but used offensively)
  "chingar",          // adult — to fuck (Mexican Spanish)
  "chinga tu madre",  // harassment — fuck your mother
  "chingada",         // harassment — fucking (fem.) / motherfucker (Mexican)
  "chingado",         // harassment — fucking (masc.) (Mexican)
  "a la chingada",    // harassment — fuck off (Mexican)
  "culero",           // harassment — asshole (Mexican/Central American)
  "culo",             // adult — ass / buttocks (vulgar)
  "mamón",            // harassment — sycophant / jerk (vulgar)
  "mamona",           // harassment — female form of mamón
  "pendejo",          // harassment — pubic hair / idiot (common Latin American)
  "pendeja",          // harassment — female form
  "güey",             // harassment — guy / dude (offensive when directed aggressively)
  "wey",              // harassment — güey alternate spelling
  "cabrón",           // harassment — cuckold / bastard / asshole
  "cabron",           // harassment — without tilde
  "cabrona",          // harassment — female form
  "joder",            // harassment — to fuck / damn (Spain)
  "cojonudo",         // harassment — balls-related insult (Spain)
  "gilipollas",       // harassment — asshole / jerk (Spain)
  "imbécil",          // harassment — imbecile / idiot
  "imbecil",          // harassment — without tilde
  "idiota",           // harassment — idiot
  "estúpido",         // harassment — stupid
  "estupido",         // harassment — without tilde
  "tonto",            // harassment — dumb / stupid
  "bobo",             // harassment — dumb / idiot
  "maricón",          // hate_speech — homophobic slur (fag/queer)
  "maricon",          // hate_speech — without tilde
  "marica",           // hate_speech — homophobic slur (softer)
  "joto",             // hate_speech — anti-gay slur (Mexican)
  "puto gay",         // hate_speech — homophobic compound
  "indio",            // hate_speech — anti-Indigenous slur (context-dependent; aggressive use)
  "mata gente",       // violence — kill people
  "mátate",           // violence — kill yourself
  "suicídate",        // violence — kill yourself (imperative)
  "me quiero matar",  // violence — I want to kill myself
  "metanfetaminas",   // spam — methamphetamine
  "comprar droga",    // spam — buy drugs
  "vender droga",     // spam — sell drugs
  "drogas en venta",  // spam — drugs for sale
  "tráfico de drogas",// spam — drug trafficking
  "pornografía",      // adult — pornography in Spanish
  "video porno",      // adult — porn video in Spanish
  "contenido sexual", // adult — sexual content in Spanish

  // ── French ──────────────────────────────────────────────────────────────────

  "putain",           // harassment — whore / fuck (common French profanity)
  "pute",             // harassment — whore
  "fils de pute",     // harassment — son of a bitch
  "fdp",              // harassment — fils de pute acronym
  "merde",            // harassment — shit
  "ta gueule",        // harassment — shut up (lit. your snout)
  "ferme ta gueule",  // harassment — shut your mouth
  "con",              // harassment — idiot / cunt (French)
  "conne",            // harassment — female form of con
  "connard",          // harassment — asshole
  "connasse",         // harassment — female asshole / bitch
  "enculé",           // adult — butt-fucked / asshole
  "encule",           // adult — without accent
  "nique ta mère",    // harassment — fuck your mother
  "ntm",              // harassment — nique ta mère acronym
  "nique",            // harassment — to fuck (verlan slang)
  "baise",            // adult — to fuck / sex
  "baiseur",          // adult — fucker
  "salope",           // harassment — slut / bitch
  "salaud",           // harassment — bastard
  "va te faire foutre",// harassment — fuck off
  "va te faire",      // harassment — fuck off (shorter trigger)
  "foutre",           // adult — to fuck / cum
  "bite",             // adult — penis (French slang)
  "queue",            // adult — penis slang (lit. tail — context needed; kept as known slang trigger)
  "chatte",           // adult — vagina (French vulgar slang; lit. female cat)
  "cul",              // adult — ass / buttocks
  "anus",             // adult — explicit anatomical term in insult context
  "nichons",          // adult — tits (French vulgar)
  "nibard",           // adult — boob (French slang)
  "pénis",            // adult — penis (clinical, blocked in explicit context triggers)
  "pédale",           // hate_speech — homophobic slur (bicycle / fag)
  "tapette",          // hate_speech — homophobic slur (fly swatter / fag)
  "fiotte",           // hate_speech — homophobic slur / coward
  "bougnoul",         // hate_speech — anti-Arab/North African slur
  "bougnoule",        // hate_speech — anti-Arab/North African slur (variant)
  "bicot",            // hate_speech — anti-Arab slur
  "bico",             // hate_speech — anti-Arab slur short form
  "raton",            // hate_speech — anti-Arab slur
  "bamboula",         // hate_speech — anti-Black slur
  "nègre",            // hate_speech — n-word equivalent (French)
  "negre",            // hate_speech — without accent
  "saloperie",        // harassment — piece of filth / junk (used as insult)
  "idiot",            // harassment — idiot (also English; repeated here for French context)
  "imbécile",         // harassment — imbecile
  "crétin",           // harassment — cretin / moron
  "abruti",           // harassment — moron / dullard
  "débile",           // harassment — moron (lit. debilitated)
  "va mourir",        // violence — go die
  "tue-toi",          // violence — kill yourself
  "je vais te tuer",  // violence — I'm going to kill you
  "suicide mode",     // violence — self-harm method
  "acheter de la drogue", // spam — buy drugs (French)
  "vendre de la drogue",  // spam — sell drugs (French)
  "pornographie",     // adult — pornography in French
  "contenu adulte",   // adult — adult content

  // ── Portuguese (Brazilian + European) ───────────────────────────────────────

  "porra",            // harassment — cum / damn (common BR profanity)
  "caralho",          // adult — cock / damn (very common Brazilian)
  "puta que pariu",   // harassment — son of a bitch / motherfucker (BR)
  "vai se foder",     // harassment — fuck you / fuck off (BR)
  "se foda",          // harassment — fuck off (BR)
  "fdp",              // harassment — filho da puta acronym (also FR; double duty)
  "filho da puta",    // harassment — son of a bitch
  "sua mãe",          // harassment — your mother (used in insults)
  "cuzão",            // harassment — big ass / asshole
  "cuzao",            // harassment — without diacritic
  "cu",               // adult — ass / anus (Brazilian vulgar)
  "boceta",           // adult — vagina (Brazilian vulgar)
  "buceta",           // adult — vagina (alternate spelling — very common BR)
  "xereca",           // adult — vagina (BR slang)
  "piroca",           // adult — penis (BR slang)
  "rola",             // adult — penis (BR slang)
  "foder",            // adult — to fuck
  "tomar no cu",      // adult — take it up the ass (BR insult)
  "arrombado",        // harassment — asshole (lit. broken open, BR)
  "merda",            // harassment — shit (PT/BR)
  "puta merda",       // harassment — fucking shit
  "viado",            // hate_speech — anti-gay slur (BR)
  "bicha",            // hate_speech — anti-gay slur (BR; lit. worm)
  "veado",            // hate_speech — anti-gay slur (deer; used derogatorily for gay men)
  "sapatão",          // hate_speech — anti-lesbian slur
  "boiola",           // hate_speech — anti-gay slur (BR)
  "macaco",           // hate_speech — monkey (anti-Black racist slur in BR context)
  "negro macaco",     // hate_speech — racist compound (BR)
  "idiota",           // harassment — idiot (also Spanish; relevant here)
  "imbecil",          // harassment — imbecile
  "burro",            // harassment — donkey / stupid
  "babaca",           // harassment — jerk / idiot (BR slang)
  "vá morrer",        // violence — go die (BR)
  "se mata",          // violence — kill yourself (BR)
  "quero me matar",   // violence — I want to kill myself
  "como se matar",    // violence — how to kill oneself
  "droga à venda",    // spam — drugs for sale (PT/BR)
  "comprar cocaína",  // spam — buy cocaine (PT/BR)
  "vender droga",     // spam — sell drugs (PT/BR)
  "pornô",            // adult — pornography (BR shorthand)
  "porno",            // adult — pornography

  // ── German ──────────────────────────────────────────────────────────────────

  "scheiße",          // harassment — shit (German)
  "scheisse",         // harassment — without ß
  "scheiß",           // harassment — shit prefix
  "fick dich",        // harassment — fuck you
  "verpiss dich",     // harassment — fuck off (lit. piss off)
  "halt die fresse",  // harassment — shut your face
  "halt die klappe",  // harassment — shut up
  "arschloch",        // harassment — asshole
  "arsch",            // adult — ass / buttocks
  "wichser",          // adult — wanker / masturbator
  "wichsen",          // adult — to wank
  "hurensohn",        // harassment — son of a whore
  "hurenbock",        // harassment — whore's goat / bastard
  "hure",             // adult/harassment — whore
  "nutte",            // adult — prostitute (German slang)
  "möse",             // adult — vagina (German vulgar)
  "mose",             // adult — without umlaut
  "votze",            // adult — cunt (German)
  "schwanz",          // adult — penis (lit. tail; German slang)
  "pimmel",           // adult — penis (German childish/vulgar)
  "titten",           // adult — tits (German)
  "wixer",            // adult — wanker (German)
  "bastard",          // harassment — bastard (also English; German usage)
  "idiot",            // harassment — idiot (German usage)
  "blödmann",         // harassment — blockhead / moron
  "blöder",           // harassment — stupid (adjective form)
  "trottel",          // harassment — twit / dimwit
  "vollidiot",        // harassment — complete idiot
  "depp",             // harassment — moron / twit
  "dummkopf",         // harassment — blockhead / dumbass
  "schwuchtel",       // hate_speech — homophobic slur (German)
  "schwuler",         // hate_speech — fag / gay (derogatory use)
  "kanake",           // hate_speech — ethnic slur for foreign workers (Turkish/Arab)
  "kanak",            // hate_speech — variant spelling
  "bimbo",            // hate_speech — anti-Black slur (German usage)
  "negerkuss",        // hate_speech — racist product name / slur
  "judensau",         // hate_speech — antisemitic slur / Nazi insult
  "nazischwein",      // hate_speech — could be harassment; sometimes used as insult
  "verpiss dich",     // harassment — piss off (German)
  "ich bringe dich um",  // violence — I will kill you
  "bring dich um",    // violence — kill yourself (imperative)
  "töte dich",        // violence — kill yourself
  "drogen kaufen",    // spam — buy drugs (German)
  "drogen verkaufen", // spam — sell drugs
  "pornografie",      // adult — pornography (German)
  "pornos",           // adult — pornography (German colloquial)

  // ── Italian ─────────────────────────────────────────────────────────────────

  "cazzo",            // adult — cock / damn (most common Italian profanity)
  "minchia",          // adult — cock (Sicilian; very common profanity)
  "stronzo",          // harassment — turd / asshole
  "stronza",          // harassment — female form of stronzo
  "vaffanculo",       // harassment — fuck off / fuck you (very common)
  "vaffa",            // harassment — short form of vaffanculo
  "porco dio",        // harassment — pig god (common Italian blasphemous profanity)
  "porco",            // harassment — pig (used in blasphemous compounds)
  "figlio di puttana",// harassment — son of a bitch
  "figlio di",        // harassment — son of (insult prefix)
  "puttana",          // adult/harassment — whore / bitch
  "troia",            // harassment — slut / whore
  "fanculo",          // harassment — fuck (shortened)
  "culo",             // adult — ass / buttocks (Italian)
  "figa",             // adult — vagina (Italian slang)
  "fregna",           // adult — vagina (Roman dialect)
  "pirla",            // harassment — jerk / idiot (Northern Italian)
  "coglione",         // harassment — idiot / testicle
  "coglioni",         // harassment — plural of coglione
  "idiota",           // harassment — idiot (Italian)
  "stupido",          // harassment — stupid
  "imbecille",        // harassment — imbecile
  "ritardato",        // hate_speech — ableist slur (retarded in Italian)
  "frocio",           // hate_speech — homophobic slur (Italian)
  "checca",           // hate_speech — anti-gay slur (Italian)
  "recchione",        // hate_speech — anti-gay slur (Southern Italian)
  "negro",            // hate_speech — n-word equivalent (Italian)
  "sporco negro",     // hate_speech — dirty negro (Italian racist)
  "ammazzati",        // violence — kill yourself (Italian)
  "ti ammazzo",       // violence — I'll kill you
  "comprare droga",   // spam — buy drugs (Italian)
  "pornografia",      // adult — pornography (Italian)

  // ── Dutch ───────────────────────────────────────────────────────────────────

  "godverdomme",      // harassment — goddamn (Dutch; very common profanity)
  "godver",           // harassment — shortened godverdomme
  "kutwijf",          // harassment — cunt woman (Dutch compound insult)
  "kut",              // adult — cunt / damn (Dutch; extremely common)
  "klootzak",         // harassment — scrotum / asshole (Dutch)
  "lul",              // adult — dick / cock (Dutch)
  "pik",              // adult — penis (Dutch slang)
  "eikel",            // harassment — acorn / dickhead (Dutch)
  "hoer",             // adult/harassment — whore (Dutch)
  "slet",             // adult/harassment — slut (Dutch)
  "rotmof",           // hate_speech — anti-German slur (Dutch historical)
  "mof",              // hate_speech — anti-German slur
  "nikker",           // hate_speech — n-word equivalent (Dutch)
  "neger",            // hate_speech — negro (Dutch; highly offensive)
  "kankerlijer",      // harassment — cancer sufferer (Dutch — used as extreme insult)
  "kanker",           // harassment — cancer (used as intensifier/profanity in Dutch)
  "tyfuslijer",       // harassment — typhus sufferer (Dutch insult)
  "flikker",          // hate_speech — anti-gay slur (Dutch)
  "nicht",            // hate_speech — niece / fag (Dutch derogatory)
  "vuile",            // harassment — dirty (insult prefix in Dutch)
  "domkop",           // harassment — blockhead / stupid
  "idioot",           // harassment — idiot (Dutch)
  "debiel",           // hate_speech — imbecile (Dutch ableist)
  "maak jezelf af",   // violence — kill yourself (Dutch)
  "drugs kopen",      // spam — buy drugs (Dutch)

  // ── Indonesian ──────────────────────────────────────────────────────────────

  "anjing",           // harassment — dog (extremely common Indonesian insult; lit. dog)
  "anjir",            // harassment — anjing euphemism
  "anj",              // harassment — anjing short form
  "babi",             // harassment — pig (common insult)
  "bangsat",          // harassment — louse / scoundrel (strong insult)
  "bajingan",         // harassment — bastard / scoundrel
  "kampret",          // harassment — idiot / little bat (insult)
  "goblok",           // harassment — stupid / moron
  "tolol",            // harassment — stupid / dense
  "bodoh",            // harassment — stupid / dumb
  "brengsek",         // harassment — bastard / jerk
  "keparat",          // harassment — bastard / scoundrel (strong)
  "tai",              // harassment — shit (Indonesian)
  "kentut",           // harassment — fart (used as insult)
  "kontol",           // adult — penis (Indonesian vulgar)
  "memek",            // adult — vagina (Indonesian vulgar)
  "toket",            // adult — breasts (Indonesian vulgar slang)
  "ngentot",          // adult — to fuck (Indonesian)
  "entot",            // adult — fuck (short form)
  "jancok",           // adult — fuck (Javanese profanity; used widely)
  "jancuk",           // adult — variant of jancok
  "ngewe",            // adult — to have sex (Indonesian slang)
  "ngaceng",          // adult — to have an erection (Indonesian slang)
  "pelacur",          // adult — prostitute (Indonesian)
  "psk",              // adult — pekerja seks komersial (sex worker acronym; used in solicitation)
  "homo",             // hate_speech — derogatory for gay (Indonesian context)
  "bencong",          // hate_speech — derogatory for transgender women (Indonesian)
  "banci",            // hate_speech — derogatory for effeminate men / transgender (Indonesian)
  "waria",            // hate_speech — transgender (used derogatorily in attack context)
  "kafir",            // hate_speech — infidel (used aggressively as slur toward non-Muslims)
  "bunuh diri",       // violence — suicide / kill oneself (Indonesian)
  "mati kamu",        // violence — you die (Indonesian threat)
  "beli narkoba",     // spam — buy drugs (Indonesian)
  "jual narkoba",     // spam — sell drugs (Indonesian)
  "video porno",      // adult — porn video (Indonesian)
  "konten dewasa",    // adult — adult content (Indonesian)

  // ── Malay ───────────────────────────────────────────────────────────────────

  "pukimak",          // adult — cunt / motherfucker (strongest Malay profanity)
  "puki",             // adult — vagina (Malay vulgar)
  "babi",             // harassment — pig (shared with Indonesian; insult)
  "celaka",           // harassment — damn / bad luck (Malay profanity)
  "sial",             // harassment — unlucky / damn (Malay)
  "bodoh",            // harassment — stupid (shared Malay/Indonesian)
  "gila",             // harassment — crazy / insane (when directed as insult)
  "lancau",           // adult — penis (Malay vulgar)
  "butuh",            // adult — penis (Malay vulgar)
  "pantat",           // adult — ass / buttocks (Malay vulgar)
  "romen",            // adult — to have sex (Malay slang)
  "pelacur",          // adult — prostitute (Malay; shared with Indonesian)
  "bunuh diri",       // violence — suicide (Malay; shared with Indonesian)
  "nak mati",         // violence — want to die (Malay)
  "mati kau",         // violence — you die (Malay threat)
  "dadah",            // spam — drugs (Malay)
  "beli dadah",       // spam — buy drugs (Malay)
  "benda lucah",      // adult — pornographic material (Malay)

  // ── Vietnamese ──────────────────────────────────────────────────────────────

  "đụ",              // adult — to fuck (Vietnamese)
  "đụ má",           // harassment — fuck your mother
  "đéo",             // harassment — penis / damn (Vietnamese profanity)
  "cặc",             // adult — penis (Vietnamese vulgar)
  "lồn",             // adult — vagina (Vietnamese vulgar)
  "đĩ",              // adult/harassment — prostitute / whore (Vietnamese)
  "chó",             // harassment — dog (insult in Vietnamese)
  "con chó",         // harassment — son of a dog / you dog
  "đồ chó",          // harassment — you dog (insult)
  "ngu",             // harassment — stupid (Vietnamese)
  "đồ ngu",          // harassment — stupid one (insult)
  "thằng ngu",       // harassment — stupid guy
  "con ngu",         // harassment — stupid (child/creature form)
  "khốn nạn",        // harassment — bastard / scoundrel (Vietnamese)
  "đồ khốn",         // harassment — scoundrel / bastard
  "mẹ mày",          // harassment — your mother (used in insults)
  "địt mẹ",          // harassment — fuck your mother (Vietnamese)
  "vãi",             // harassment — expression of shock / mild profanity
  "thô tục",         // adult — vulgar / dirty
  "tự tử",           // violence — suicide (Vietnamese)
  "muốn chết",       // violence — want to die
  "đi chết",         // violence — go die (Vietnamese)
  "giết mày",        // violence — kill you (Vietnamese threat)
  "mua ma túy",      // spam — buy drugs (Vietnamese)
  "bán ma túy",      // spam — sell drugs (Vietnamese)
  "nội dung người lớn", // adult — adult content (Vietnamese)

  // ── Polish ──────────────────────────────────────────────────────────────────

  "kurwa",            // harassment — whore / fuck (most common Polish profanity)
  "kurwa mać",        // harassment — fucking hell / motherfucker
  "chuj",             // adult — cock / penis (Polish vulgar)
  "chuj ci w dupę",   // adult — cock in your ass (Polish insult)
  "pierdolić",        // adult — to fuck (Polish)
  "pierdol się",      // harassment — fuck off
  "pierdolony",       // harassment — fucking (adjective)
  "spierdalaj",       // harassment — fuck off / get lost
  "jebać",            // adult — to fuck (Polish)
  "jebany",           // harassment — fucked / fucking
  "dupa",             // adult — ass / buttocks (Polish)
  "dupek",            // harassment — asshole
  "skurwysyn",        // harassment — son of a whore
  "skurwiel",         // harassment — bastard / son of a whore
  "morda",            // harassment — snout / ugly face (directed insult)
  "gówno",            // harassment — shit (Polish)
  "fiut",             // adult — cock (Polish vulgar slang)
  "cipa",             // adult — vagina (Polish vulgar)
  "pizda",            // adult — cunt (Polish/Russian shared vulgar)
  "pojeb",            // harassment — crazy bastard / jerk
  "głupek",           // harassment — dumbass / fool
  "idiota",           // harassment — idiot (Polish)
  "pedał",            // hate_speech — homophobic slur (Polish)
  "pedal",            // hate_speech — without diacritic
  "ciapaty",          // hate_speech — anti-South Asian slur (Polish)
  "czarnuch",         // hate_speech — n-word equivalent (Polish)
  "zabij się",        // violence — kill yourself (Polish)
  "chcę się zabić",   // violence — I want to kill myself
  "kupić narkotyki",  // spam — buy drugs (Polish)
  "pornografia",      // adult — pornography (Polish)

  // ── Turkish ─────────────────────────────────────────────────────────────────

  "siktir",           // harassment — fuck off (Turkish; extremely common)
  "siktir git",       // harassment — fuck off and go
  "orospu",           // adult/harassment — prostitute / whore
  "orospu çocuğu",    // harassment — son of a whore
  "göt",              // adult — ass / buttocks (Turkish vulgar)
  "amk",              // adult — amına koyayım acronym (I'll fuck your mother)
  "amına koyayım",    // adult — I'll fuck your mother (Turkish)
  "amcık",            // adult — vagina (Turkish vulgar)
  "yarrak",           // adult — cock / penis (Turkish vulgar)
  "sik",              // adult — penis (Turkish)
  "sikmek",           // adult — to fuck (Turkish)
  "götü",             // adult — his/her ass (Turkish)
  "ibne",             // hate_speech — passive gay / sissy (Turkish derogatory)
  "kaltak",           // harassment — bitch / slut (Turkish)
  "piç",              // harassment — bastard (Turkish)
  "pezevenk",         // harassment — pimp / bastard
  "bok",              // harassment — shit (Turkish)
  "mal",              // harassment — idiot / moron (Turkish slang)
  "gerizekalı",       // harassment — retard / idiot (Turkish)
  "aptal",            // harassment — stupid / foolish (Turkish)
  "salak",            // harassment — stupid / idiot (Turkish)
  "ahmak",            // harassment — stupid / idiot (Arabic loanword used in Turkish)
  "götveren",         // hate_speech — one who gives ass / gay slur (Turkish)
  "zenci",            // hate_speech — Black person (often used as slur in Turkish)
  "gavur",            // hate_speech — infidel (used aggressively)
  "kendi kendini öldür", // violence — kill yourself (Turkish)
  "intihar",          // violence — suicide (in self-harm context)
  "uyuşturucu sat",   // spam — sell drugs (Turkish)
  "uyuşturucu al",    // spam — buy drugs (Turkish)
  "porno",            // adult — pornography (Turkish)
  "seks videosu",     // adult — sex video (Turkish)

  // ── Tagalog / Filipino ───────────────────────────────────────────────────────

  "putang ina",       // harassment — son of a whore / fuck your mother (most common Filipino profanity)
  "putangina",        // harassment — putang ina merged
  "puta",             // harassment — whore (shared with Spanish; Filipino usage)
  "gago",             // harassment — idiot / stupid asshole
  "gaga",             // harassment — female gago
  "ulol",             // harassment — crazy / idiot (Filipino)
  "bobo",             // harassment — stupid / dumb (Filipino; shared with Spanish)
  "tanga",            // harassment — stupid / idiot (Filipino)
  "tarantado",        // harassment — idiot / bastard (Filipino)
  "hayop",            // harassment — animal (used as insult; lit. animal)
  "hayup",            // harassment — variant spelling of hayop
  "anak ng puta",     // harassment — son of a whore
  "leche",            // harassment — damn / milk (used as mild profanity in Filipino)
  "lintik",           // harassment — damn / bastard (Filipino)
  "pakyu",            // harassment — fuck you (Filipino transliteration)
  "pakyu na",         // harassment — fuck you already
  "bilat",            // adult — vagina (Filipino vulgar)
  "tite",             // adult — penis (Filipino vulgar)
  "kantot",           // adult — to fuck (Filipino)
  "kantotero",        // adult — fucker (Filipino)
  "pokpok",           // adult — prostitute / promiscuous person (Filipino)
  "bading",           // hate_speech — anti-gay slur (Filipino)
  "bakla",            // hate_speech — gay / effeminate male (used derogatorily)
  "bayot",            // hate_speech — anti-gay slur (Visayan dialect)
  "patay ka",         // violence — you die / you're dead (Filipino threat)
  "mamatay ka",       // violence — die (Filipino)
  "magpakamatay",     // violence — kill yourself (Filipino)
  "droga na ibenta",  // spam — drugs for sale (Filipino)
  "bibili ng droga",  // spam — will buy drugs (Filipino)
  "pornong video",    // adult — porn video (Filipino)

];

// ─── Unicode keyword additions ─────────────────────────────────────────────────
// These EXTEND the existing BLOCKED_KEYWORDS_UNICODE array

export const UNICODE_KEYWORDS_EXTENDED: { kw: string; category: ModerationCategory }[] = [

  // ── Khmer expansions ────────────────────────────────────────────────────────
  // (Base set already in moderation.service.ts; this extends it significantly)

  // Profanity / sexual — Khmer
  { kw: "ចុយម៉ែ",       category: "adult" },        // fuck your mother
  { kw: "ចុយមាស់",      category: "adult" },        // fuck the owner (sexual profanity)
  { kw: "ស្រីខូច",      category: "adult" },        // bad/loose woman (sexual slur)
  { kw: "ត្រូតអាន",     category: "adult" },        // sexual act slang
  { kw: "ក្ដីស",        category: "adult" },        // sexual slang (genitalia)
  { kw: "ព្រួញ",        category: "adult" },        // penis (vulgar slang; lit. arrow)
  { kw: "ង្វែង",        category: "adult" },        // sexual slang for penis
  { kw: "ភ្លោះ",        category: "adult" },        // sexual slang
  { kw: "ផ្ទៃក្រោម",   category: "adult" },        // below the waist (euphemism used in explicit requests)
  { kw: "ភេទ",          category: "adult" },        // sex / gender (used in explicit solicitation context)
  { kw: "សិចស",         category: "adult" },        // sex (transliteration — explicit context)
  { kw: "វីដេអូអាសអាភាស",category: "adult" },       // pornographic video
  { kw: "រូបអាសអាភាស",  category: "adult" },        // pornographic image
  { kw: "អាសអាភាស",     category: "adult" },        // pornographic / obscene
  { kw: "លេងផ្លូវភេទ",  category: "adult" },        // engage in sexual acts
  { kw: "ស្រីលក់ខ្លួន", category: "adult" },        // woman selling herself (prostitution)
  { kw: "ស្ត្រីសំណាញ់", category: "adult" },        // prostitute / sex worker (lit. net woman)
  { kw: "ថ្ងៃជំនួសម",   category: "adult" },        // suggestive slang

  // Insults / harassment — Khmer expansions
  { kw: "អាឆ្កែ",       category: "harassment" },   // you dog (intensified insult)
  { kw: "អាជ្រូក",      category: "harassment" },   // you pig (intensified)
  { kw: "អាស្វា",       category: "harassment" },   // you monkey (intensified)
  { kw: "ប្រខ្មោច",     category: "harassment" },   // you rat (insult)
  { kw: "ប្រដ្តិះ",     category: "harassment" },   // monkey/inferior (insult)
  { kw: "ទោចិត្ត",      category: "harassment" },   // vile heart / contemptible
  { kw: "ថោកទាប",       category: "harassment" },   // lowlife / cheap
  { kw: "ពួកថោក",       category: "harassment" },   // lowlife group
  { kw: "មនុស្សបោក",    category: "harassment" },   // cheating / deceiving person
  { kw: "អ្នកបោក",      category: "harassment" },   // cheater / liar
  { kw: "ឆ្លើបរ",       category: "harassment" },   // impudent / shameless (insult)
  { kw: "ពូកែ​ឆ្ងុយ",   category: "harassment" },   // full of yourself / arrogant (directed)
  { kw: "ងោះ",          category: "harassment" },   // foolish / simple-minded (Khmer insult)
  { kw: "ក្រោប",        category: "harassment" },   // ignorant / uncultured (insult)
  { kw: "ហ្ងង",         category: "harassment" },   // stupid / slow (Khmer slang)
  { kw: "ខ្លៀ",         category: "harassment" },   // look down on / contempt
  { kw: "គ្រប",         category: "harassment" },   // cover (used derogatorily of women)
  { kw: "ខ្ញីខ្ញរ",     category: "harassment" },   // worthless / good for nothing
  { kw: "ខ្ញុំស្អប់",   category: "harassment" },   // I hate (directed hatred statement)
  { kw: "ញ៉ាំទូ",       category: "harassment" },   // ridicule/mock (slang)
  { kw: "ជើងស្ងើច",     category: "harassment" },   // looking down on others
  { kw: "ពួកសុីល",      category: "harassment" },   // ethnic derogatory grouping
  { kw: "ជនជាតិថ្ម",    category: "hate_speech" },  // stone-age ethnic (derogatory)
  { kw: "ខ្មែររក",      category: "hate_speech" },  // Khmer ethnic slur compound

  // Violence / self-harm — Khmer expansions
  { kw: "ស្លាប់ទៅ",     category: "violence" },     // go die (imperative)
  { kw: "ឲ្យស្លាប់",    category: "violence" },     // let die / cause to die
  { kw: "ខ្ញុំចង់ស្លាប់",category: "violence" },    // I want to die
  { kw: "នឹងសម្លាប់",   category: "violence" },     // will kill
  { kw: "ចង់សម្លាប់",   category: "violence" },     // want to kill
  { kw: "ស្លាប់ខ្លួន",  category: "violence" },     // die oneself / self-harm
  { kw: "ហូបថ្នាំស្លាប់",category: "violence" },    // take medicine to die (overdose)
  { kw: "ចង់ក្ស័យ",     category: "violence" },     // want to be ruined / destroyed (self-harm context)
  { kw: "ធ្វើឲ្យឈឺ",    category: "violence" },     // make hurt / cause pain (threat)
  { kw: "ភ្ជាប់ខ្សែ",   category: "violence" },     // hang with rope (self-harm method)
  { kw: "ប្រើកាំបិត",   category: "violence" },     // use a knife (threat/self-harm)
  { kw: "ចង់វាយ",       category: "violence" },     // want to beat (threat)
  { kw: "ចង់ចាប",       category: "violence" },     // want to stab
  { kw: "ចង់បាញ់",      category: "violence" },     // want to shoot
  { kw: "គំរាម",        category: "violence" },     // threaten / intimidate
  { kw: "គំរាមកំហែង",   category: "violence" },     // threat / intimidation
  { kw: "យ៉ាក់ស",       category: "violence" },     // violence / assault

  // Spam / drug — Khmer
  { kw: "ថ្នាំញៀន",     category: "spam" },         // drugs / narcotics (Khmer)
  { kw: "ទិញថ្នាំ",     category: "spam" },         // buy drugs
  { kw: "លក់ថ្នាំ",     category: "spam" },         // sell drugs
  { kw: "ហ្វែរ",        category: "spam" },         // amphetamine (ya-maa drug in Khmer slang)
  { kw: "ថ្នាំហ្វែរ",   category: "spam" },         // drug type (yaba/meth)
  { kw: "គ្រឿងញៀន",     category: "spam" },         // narcotic substances
  { kw: "ស្ប៉ែម",       category: "spam" },         // spam (transliteration)

  // ── Thai expansions ─────────────────────────────────────────────────────────

  // Profanity / sexual — Thai
  { kw: "หี",           category: "adult" },        // vagina (Thai vulgar)
  { kw: "หน้าหี",       category: "adult" },        // vagina-face (compound insult)
  { kw: "ควย",          category: "adult" },        // penis (Thai vulgar)
  { kw: "จิ๋ม",         category: "adult" },        // vagina (Thai childish/vulgar)
  { kw: "เย็ด",         category: "adult" },        // to fuck (Thai vulgar)
  { kw: "เย็ดแม่",      category: "adult" },        // fuck your mother
  { kw: "สาวโป๊",       category: "adult" },        // naked woman / porn
  { kw: "โป๊",          category: "adult" },        // naked / pornographic (Thai)
  { kw: "คลิปโป๊",      category: "adult" },        // sex clip / porn clip
  { kw: "หนังโป๊",      category: "adult" },        // porn movie (Thai)
  { kw: "อมควย",        category: "adult" },        // fellatio (Thai vulgar)
  { kw: "เอาควย",       category: "adult" },        // take the cock / sexual act
  { kw: "นมใหญ่",       category: "adult" },        // big breasts (used in porn solicitation)
  { kw: "นม",           category: "adult" },        // breasts / milk (in explicit solicitation context — short stem)
  { kw: "โสเภณี",       category: "adult" },        // prostitute (Thai)
  { kw: "กะหรี่",       category: "adult" },        // prostitute (Thai vulgar slang)
  { kw: "อีกะหรี่",     category: "adult" },        // female prostitute (intensified)
  { kw: "แม่ง",         category: "harassment" },   // already in base list — extended context
  { kw: "อีดอก",        category: "adult" },        // prostitute (Thai)
  { kw: "ไอ้หน้าหี",    category: "adult" },        // male with vagina-face (heavy insult)

  // Insults / harassment — Thai expansions
  { kw: "ไอ้โง่",       category: "harassment" },   // you stupid (male)
  { kw: "อีโง่",        category: "harassment" },   // you stupid (female)
  { kw: "ไอ้ขี้",       category: "harassment" },   // you piece of shit (male)
  { kw: "อีขี้",        category: "harassment" },   // you piece of shit (female)
  { kw: "ไอ้บ้า",       category: "harassment" },   // you crazy (male)
  { kw: "อีบ้า",        category: "harassment" },   // you crazy (female)
  { kw: "ไอ้โกง",       category: "harassment" },   // you cheat / liar
  { kw: "อีโกง",        category: "harassment" },   // female you cheat
  { kw: "หน้าหมา",      category: "harassment" },   // dog face (Thai insult)
  { kw: "หัวควาย",      category: "harassment" },   // buffalo head (stupid insult)
  { kw: "มึง",          category: "harassment" },   // you (rude/aggressive pronoun)
  { kw: "กู",           category: "harassment" },   // I / me (rude first person)
  { kw: "มึงโง่",       category: "harassment" },   // you're stupid (rude)
  { kw: "แดก",          category: "harassment" },   // eat (rude form — insulting)
  { kw: "สัตว์นรก",     category: "harassment" },   // hellish animal (Thai insult)
  { kw: "ไอ้บัดซบ",     category: "harassment" },   // jerk / idiot (Thai)
  { kw: "อีดอก",        category: "harassment" },   // derogatory for woman

  // Hate speech — Thai
  { kw: "ไอ้นิ",        category: "hate_speech" },  // n-word equivalent (Thai racial slur for Black people)
  { kw: "เขมรขี้",      category: "hate_speech" },  // shitty Khmer (anti-Cambodian slur)
  { kw: "แขกขี้",       category: "hate_speech" },  // shitty Indian/Muslim (anti-South Asian slur)
  { kw: "กะเทยสัตว์",   category: "hate_speech" },  // transgender animal (anti-trans hate)
  { kw: "กะเทยห่า",     category: "hate_speech" },  // trans + curse word

  // Violence / self-harm — Thai expansions
  { kw: "ฆ่าตัวตาย",    category: "violence" },     // suicide / kill oneself
  { kw: "อยากตาย",      category: "violence" },     // want to die
  { kw: "จะตาย",        category: "violence" },     // going to die (self-harm context)
  { kw: "ฆ่าแกง",       category: "violence" },     // kill (lit. kill and cook — slang for murdering)
  { kw: "ฆ่า",          category: "violence" },     // kill (stem — short; used in threats)
  { kw: "จะฆ่า",        category: "violence" },     // will kill (threat)
  { kw: "จะฆ่าแก",      category: "violence" },     // will kill you (threat)
  { kw: "ยิงหัว",       category: "violence" },     // shoot in the head
  { kw: "แทงมีด",       category: "violence" },     // stab with a knife
  { kw: "ผูกคอตาย",     category: "violence" },     // hang oneself to death
  { kw: "กินยาตาย",     category: "violence" },     // take medicine to die (overdose)
  { kw: "กรีดข้อมือ",   category: "violence" },     // cut wrists (self-harm)

  // Spam / drugs — Thai
  { kw: "ขายยาเสพติด",  category: "spam" },         // sell drugs (Thai)
  { kw: "ซื้อยาเสพติด", category: "spam" },         // buy drugs (Thai)
  { kw: "ยาบ้า",        category: "spam" },         // methamphetamine (Thai; lit. crazy medicine)
  { kw: "ยาไอซ์",       category: "spam" },         // ice / crystal meth (Thai)
  { kw: "กัญชา",        category: "spam" },         // cannabis (in solicitation context)
  { kw: "เฮโรอีน",      category: "spam" },         // heroin (Thai)

  // ── Arabic expansions ────────────────────────────────────────────────────────

  // Profanity / sexual — Arabic
  { kw: "كس أمك",       category: "adult" },        // your mother's vagina (extremely common Arabic insult)
  { kw: "كسمك",         category: "adult" },        // your vagina (abbreviated insult form)
  { kw: "أمك",          category: "harassment" },   // your mother (insult prefix)
  { kw: "زب",           category: "adult" },        // penis (Arabic vulgar; short form)
  { kw: "زبي",          category: "adult" },        // my penis (insult use)
  { kw: "أير",          category: "adult" },        // penis (Arabic vulgar; Egyptian dialect)
  { kw: "نيك",          category: "adult" },        // to fuck (Arabic)
  { kw: "نيكك",         category: "adult" },        // fuck you
  { kw: "ينيك",         category: "adult" },        // he fucks
  { kw: "أنيك",         category: "adult" },        // I fuck (threat form)
  { kw: "شرموطة",       category: "adult" },        // whore / slut (Arabic)
  { kw: "عاهرة",        category: "adult" },        // prostitute (Arabic)
  { kw: "مومس",         category: "adult" },        // prostitute (Arabic)
  { kw: "قحبة",         category: "adult" },        // prostitute (Arabic)
  { kw: "سكس",          category: "adult" },        // sex (transliteration — in explicit context)
  { kw: "بورن",         category: "adult" },        // porn (Arabic transliteration)
  { kw: "إباحي",        category: "adult" },        // pornographic (Arabic)
  { kw: "صور إباحية",   category: "adult" },        // pornographic images
  { kw: "مقاطع إباحية", category: "adult" },        // pornographic clips

  // Insults / harassment — Arabic expansions
  { kw: "تبًا لك",      category: "harassment" },   // damn you (Arabic)
  { kw: "عليك لعنة",    category: "harassment" },   // curse on you
  { kw: "ابن العاهرة",  category: "harassment" },   // son of a whore
  { kw: "ابن الكلب",    category: "harassment" },   // son of a dog
  { kw: "يابن الكلب",   category: "harassment" },   // you son of a dog
  { kw: "كلب ابن كلب",  category: "harassment" },   // dog son of a dog
  { kw: "حيوان",        category: "harassment" },   // animal (Arabic; insult toward person)
  { kw: "قرد",          category: "harassment" },   // monkey (Arabic; racist/insult)
  { kw: "خنزير",        category: "harassment" },   // pig (Arabic; strong insult)
  { kw: "تفو عليك",     category: "harassment" },   // I spit on you
  { kw: "لا تعيش",      category: "harassment" },   // may you not live
  { kw: "روح انقتل",    category: "violence" },     // go get killed (Arabic)
  { kw: "مجنون",        category: "harassment" },   // crazy / insane (when directed as insult)
  { kw: "تفو",          category: "harassment" },   // ptoo / spit (expression of disgust at person)
  { kw: "نذل",          category: "harassment" },   // scoundrel / vile person
  { kw: "وسخ",          category: "harassment" },   // filthy / dirty (as directed insult)
  { kw: "حقير",         category: "harassment" },   // despicable / vile (as insult)
  { kw: "فاسق",         category: "harassment" },   // immoral / depraved (as slur)
  { kw: "عبيط",         category: "harassment" },   // idiot (Egyptian dialect)
  { kw: "متخلف",        category: "harassment" },   // backward / retarded (Arabic)
  { kw: "منيوك",        category: "harassment" },   // fucked one (Arabic insult)
  { kw: "خول",          category: "hate_speech" },  // derogatory for gay men (Arabic)
  { kw: "مخنث",         category: "hate_speech" },  // effeminate man / trans insult (Arabic)
  { kw: "عبد",          category: "hate_speech" },  // slave (used as anti-Black slur in Arabic context)
  { kw: "زنجي",         category: "hate_speech" },  // n-word equivalent (Arabic)
  { kw: "أسود",         category: "hate_speech" },  // Black (used derogatorily in insult context)

  // Violence / self-harm — Arabic
  { kw: "روح موت",      category: "violence" },     // go die (Arabic)
  { kw: "اقتل نفسك",    category: "violence" },     // kill yourself
  { kw: "سأقتلك",       category: "violence" },     // I will kill you
  { kw: "هأقتلك",       category: "violence" },     // I will kill you (Egyptian)
  { kw: "بقتلك",        category: "violence" },     // I'll kill you (Levantine)
  { kw: "انتحار",       category: "violence" },     // suicide (Arabic)
  { kw: "طرق الانتحار", category: "violence" },     // methods of suicide
  { kw: "أريد أن أموت", category: "violence" },     // I want to die
  { kw: "جرح نفسي",     category: "violence" },     // hurt myself / self-harm
  { kw: "أذى نفسي",     category: "violence" },     // harm myself (Arabic)

  // Spam / drugs — Arabic
  { kw: "شراء مخدرات",  category: "spam" },         // buy drugs (Arabic)
  { kw: "بيع مخدرات",   category: "spam" },         // sell drugs (Arabic)
  { kw: "كوكايين",      category: "spam" },         // cocaine (Arabic transliteration)
  { kw: "هيروين",       category: "spam" },         // heroin (Arabic transliteration)
  { kw: "مخدرات للبيع", category: "spam" },         // drugs for sale (Arabic)

  // ── Chinese Simplified expansions ───────────────────────────────────────────

  // Profanity / sexual — Chinese Simplified
  { kw: "操你妈",        category: "adult" },        // fuck your mother
  { kw: "操你全家",      category: "adult" },        // fuck your whole family
  { kw: "日你妈",        category: "adult" },        // fuck your mother (variant)
  { kw: "我操",          category: "adult" },        // holy fuck / damn (profanity)
  { kw: "狗操",          category: "adult" },        // dog fuck (profanity)
  { kw: "干你",          category: "adult" },        // fuck you (Mandarin)
  { kw: "干你妈",        category: "adult" },        // fuck your mother (Mandarin)
  { kw: "干你娘",        category: "adult" },        // fuck your mom (variant)
  { kw: "妈卖批",        category: "adult" },        // motherfucker variant (Sichuan)
  { kw: "屌你",          category: "adult" },        // fuck you (Cantonese origin in Mainland use)
  { kw: "鸡巴",          category: "adult" },        // penis (Chinese vulgar)
  { kw: "屌",            category: "adult" },        // penis / damn (Chinese; short — contextual)
  { kw: "屄",            category: "adult" },        // vagina (Chinese; also the origin of 傻逼)
  { kw: "逼",            category: "adult" },        // vagina (simplified character used in profanity)
  { kw: "傻屄",          category: "adult" },        // stupid cunt (variant of 傻逼)
  { kw: "淫妇",          category: "adult" },        // lewd woman / slut (Chinese)
  { kw: "骚货",          category: "adult" },        // slut / loose woman (Chinese)
  { kw: "骚逼",          category: "adult" },        // slutty cunt (Chinese)
  { kw: "妓女",          category: "adult" },        // prostitute (Chinese)
  { kw: "卖淫",          category: "adult" },        // prostitution / to sell sex
  { kw: "嫖娼",          category: "adult" },        // patronize prostitutes
  { kw: "色情",          category: "adult" },        // pornographic / erotic (Chinese)
  { kw: "黄片",          category: "adult" },        // pornographic video (lit. yellow film)
  { kw: "A片",           category: "adult" },        // porn (A-movie — Chinese internet slang)
  { kw: "a片",           category: "adult" },        // porn (lowercase variant)
  { kw: "毛片",          category: "adult" },        // porn (lit. hairy film — Chinese slang)
  { kw: "做爱",          category: "adult" },        // make love / have sex (explicit solicitation context)
  { kw: "口交",          category: "adult" },        // oral sex
  { kw: "肛交",          category: "adult" },        // anal sex

  // Insults / harassment — Chinese Simplified
  { kw: "滚你妈",        category: "harassment" },   // roll (fuck off) your mother
  { kw: "死狗",          category: "harassment" },   // dead dog (insult)
  { kw: "贱人",          category: "harassment" },   // cheap/lowly person / bitch
  { kw: "废物",          category: "harassment" },   // trash / waste of space
  { kw: "垃圾",          category: "harassment" },   // garbage / trash (directed at person)
  { kw: "白痴",          category: "harassment" },   // idiot / imbecile
  { kw: "脑残",          category: "harassment" },   // brain damaged / idiot (internet slang)
  { kw: "智障",          category: "harassment" },   // intellectually disabled (used as slur)
  { kw: "弱智",          category: "harassment" },   // mentally weak / idiot
  { kw: "蠢货",          category: "harassment" },   // stupid person / fool
  { kw: "蠢猪",          category: "harassment" },   // stupid pig (insult)
  { kw: "死胖子",        category: "harassment" },   // dead fatty (body-shaming insult)
  { kw: "猪",            category: "harassment" },   // pig (used as insult directed at person)
  { kw: "狗东西",        category: "harassment" },   // dog thing (Chinese insult)
  { kw: "狗杂种",        category: "harassment" },   // dog bastard
  { kw: "操蛋",          category: "harassment" },   // eggs to fuck / bastard (profanity)
  { kw: "臭不要脸",      category: "harassment" },   // shameless bastard
  { kw: "没脸没皮",      category: "harassment" },   // shameless / thick-skinned (insult)
  { kw: "去你妈的",      category: "harassment" },   // fuck your mother / fuck off
  { kw: "你大爷",        category: "harassment" },   // your grandfather (profanity use)
  { kw: "他妈的",        category: "harassment" },   // his mother's / fucking (common Chinese profanity)
  { kw: "你妈死了",      category: "harassment" },   // your mother died (curse)
  { kw: "杂种",          category: "harassment" },   // bastard / hybrid (Chinese insult)
  { kw: "土狗",          category: "harassment" },   // local dog / country bumpkin (insult)

  // Hate speech — Chinese Simplified
  { kw: "黑鬼",          category: "hate_speech" },  // black ghost / n-word equivalent (Chinese)
  { kw: "鬼佬",          category: "hate_speech" },  // foreign ghost / white person slur (Cantonese-origin)
  { kw: "白猪",          category: "hate_speech" },  // white pig (anti-white slur)
  { kw: "弯的",          category: "hate_speech" },  // bent / gay (derogatory; lit. bent)
  { kw: "死基佬",        category: "hate_speech" },  // dead gay guy (anti-gay slur)
  { kw: "基佬",          category: "hate_speech" },  // gay (derogatory Cantonese-origin slur)
  { kw: "死gay",         category: "hate_speech" },  // dead gay (anti-gay slur mixed script)
  { kw: "娘炮",          category: "hate_speech" },  // sissy / effeminate man (derogatory)
  { kw: "人妖",          category: "hate_speech" },  // transgender (derogatory; lit. human monster)

  // Violence / self-harm — Chinese Simplified
  { kw: "我要杀你",      category: "violence" },     // I want to kill you
  { kw: "我要杀了你",    category: "violence" },     // I will kill you
  { kw: "杀了他",        category: "violence" },     // kill him
  { kw: "去死吧",        category: "violence" },     // go die (imperative)
  { kw: "你去死",        category: "violence" },     // you go die
  { kw: "死吧",          category: "violence" },     // just die
  { kw: "自杀",          category: "violence" },     // suicide
  { kw: "自杀方法",      category: "violence" },     // suicide methods
  { kw: "想死",          category: "violence" },     // want to die
  { kw: "不想活了",      category: "violence" },     // don't want to live anymore
  { kw: "割腕",          category: "violence" },     // cut wrists (self-harm)
  { kw: "上吊",          category: "violence" },     // hang oneself
  { kw: "跳楼",          category: "violence" },     // jump from a building
  { kw: "活不下去",      category: "violence" },     // can't live on / suicidal

  // Spam / drugs — Chinese Simplified
  { kw: "买毒品",        category: "spam" },         // buy drugs (Chinese)
  { kw: "卖毒品",        category: "spam" },         // sell drugs
  { kw: "毒品出售",      category: "spam" },         // drugs for sale
  { kw: "冰毒",          category: "spam" },         // methamphetamine (crystal meth — lit. ice drug)
  { kw: "海洛因",        category: "spam" },         // heroin (Chinese)
  { kw: "大麻出售",      category: "spam" },         // cannabis for sale (Chinese)
  { kw: "可卡因",        category: "spam" },         // cocaine (Chinese)

  // ── Chinese Traditional expansions ──────────────────────────────────────────

  // Profanity / sexual — Traditional Chinese
  { kw: "操你媽",        category: "adult" },        // fuck your mother (Traditional)
  { kw: "操你全家",      category: "adult" },        // fuck your whole family (Traditional — same characters)
  { kw: "你媽的",        category: "harassment" },   // your mother's / damn (Traditional)
  { kw: "幹你娘",        category: "adult" },        // fuck your mother (Taiwanese Mandarin)
  { kw: "幹你",          category: "adult" },        // fuck you (Traditional)
  { kw: "幹",            category: "adult" },        // fuck / damn (Traditional character)
  { kw: "屌你",          category: "adult" },        // fuck you (Cantonese/Traditional)
  { kw: "雞巴",          category: "adult" },        // penis (Traditional)
  { kw: "屌",            category: "adult" },        // penis / damn (Traditional; already in simplified — safe duplicate for Traditional text)
  { kw: "婊子",          category: "adult" },        // bitch / prostitute (Chinese — works in both scripts)
  { kw: "妓女",          category: "adult" },        // prostitute (Traditional — same characters)
  { kw: "色情",          category: "adult" },        // pornographic (Traditional — same characters)
  { kw: "黃片",          category: "adult" },        // porn video (Traditional — 黃 vs 黄)
  { kw: "A片",           category: "adult" },        // porn (Traditional — same)
  { kw: "做愛",          category: "adult" },        // make love (Traditional — 愛 vs 爱)
  { kw: "口交",          category: "adult" },        // oral sex (same in both)
  { kw: "肛交",          category: "adult" },        // anal sex (same in both)

  // Insults / harassment — Traditional Chinese
  { kw: "廢物",          category: "harassment" },   // trash / waste (Traditional — 廢 vs 废)
  { kw: "垃圾",          category: "harassment" },   // garbage (same characters)
  { kw: "白痴",          category: "harassment" },   // idiot (same)
  { kw: "腦殘",          category: "harassment" },   // brain damaged (Traditional — 腦 vs 脑)
  { kw: "智障",          category: "harassment" },   // intellectually disabled slur (same)
  { kw: "賤人",          category: "harassment" },   // cheap lowly person (Traditional — 賤 vs 贱)
  { kw: "雜種",          category: "harassment" },   // bastard (Traditional — 雜 vs 杂)
  { kw: "他媽的",        category: "harassment" },   // fucking (Traditional — 媽 vs 妈)
  { kw: "去你媽的",      category: "harassment" },   // fuck your mother (Traditional)
  { kw: "你媽死了",      category: "harassment" },   // your mother died (Traditional)
  { kw: "滾",            category: "harassment" },   // get lost / fuck off (Traditional — same as 滚 simplified)
  { kw: "臭",            category: "harassment" },   // stinky insult prefix (Traditional — same character)

  // Hate speech — Traditional Chinese
  { kw: "黑鬼",          category: "hate_speech" },  // n-word equivalent (Traditional — same)
  { kw: "死基佬",        category: "hate_speech" },  // dead gay guy (Traditional — same)
  { kw: "人妖",          category: "hate_speech" },  // transgender slur (Traditional — same)
  { kw: "娘炮",          category: "hate_speech" },  // sissy (Traditional — same)
  { kw: "彎的",          category: "hate_speech" },  // bent / gay (Traditional — 彎 vs 弯)

  // Violence — Traditional Chinese
  { kw: "去死吧",        category: "violence" },     // go die (same as simplified)
  { kw: "自殺",          category: "violence" },     // suicide (Traditional — 殺 vs 杀)
  { kw: "想死",          category: "violence" },     // want to die (same)
  { kw: "不想活了",      category: "violence" },     // don't want to live (same)
  { kw: "割腕",          category: "violence" },     // cut wrists (same)
  { kw: "上吊",          category: "violence" },     // hang oneself (same)
  { kw: "跳樓",          category: "violence" },     // jump from building (Traditional — 樓 vs 楼)
  { kw: "我要殺你",      category: "violence" },     // I want to kill you (Traditional — 殺 vs 杀)
  { kw: "殺了他",        category: "violence" },     // kill him (Traditional)

  // Spam — Traditional Chinese
  { kw: "買毒品",        category: "spam" },         // buy drugs (Traditional — 買 vs 买)
  { kw: "賣毒品",        category: "spam" },         // sell drugs (Traditional)
  { kw: "冰毒",          category: "spam" },         // crystal meth (same)
  { kw: "海洛因",        category: "spam" },         // heroin (same)

  // ── Japanese ────────────────────────────────────────────────────────────────

  // Profanity / sexual — Japanese
  { kw: "クソ",          category: "harassment" },   // shit / crap (Japanese; extremely common)
  { kw: "くそ",          category: "harassment" },   // shit (hiragana form)
  { kw: "クソが",        category: "harassment" },   // you piece of shit
  { kw: "くそが",        category: "harassment" },   // you piece of shit (hiragana)
  { kw: "うんこ",        category: "harassment" },   // poop / shit (childish but used as insult)
  { kw: "ちんぽ",        category: "adult" },        // penis (Japanese vulgar)
  { kw: "チンポ",        category: "adult" },        // penis (katakana form)
  { kw: "ちんちん",      category: "adult" },        // penis (childish/vulgar — used explicitly)
  { kw: "まんこ",        category: "adult" },        // vagina (Japanese vulgar; extremely offensive)
  { kw: "マンコ",        category: "adult" },        // vagina (katakana)
  { kw: "おっぱい",      category: "adult" },        // breasts (Japanese; used in explicit solicitation)
  { kw: "おっぱい見せて",category: "adult" },        // show me your breasts
  { kw: "おちんちん",    category: "adult" },        // penis (childish but used explicitly)
  { kw: "セックス",      category: "adult" },        // sex (katakana — in explicit context)
  { kw: "セクロス",      category: "adult" },        // sex (Japanese slang/typo variant)
  { kw: "やらせて",      category: "adult" },        // let me do it / let me have sex (solicitation)
  { kw: "エロ",          category: "adult" },        // erotic (Japanese abbreviation)
  { kw: "エロ動画",      category: "adult" },        // erotic/porn video
  { kw: "エロ画像",      category: "adult" },        // erotic/porn image
  { kw: "ポルノ",        category: "adult" },        // pornography (katakana)
  { kw: "アダルト動画",  category: "adult" },        // adult video (AV)
  { kw: "援助交際",      category: "adult" },        // compensated dating / enjo kōsai (teen prostitution)
  { kw: "売春",          category: "adult" },        // prostitution
  { kw: "風俗",          category: "adult" },        // sex industry / adult entertainment (in solicitation context)
  { kw: "ロリ",          category: "adult" },        // loli (sexualised minors)
  { kw: "ショタ",        category: "adult" },        // shota (sexualised male minors)

  // Insults / harassment — Japanese
  { kw: "死ね",          category: "violence" },     // die / go die (extremely common online insult/threat in Japanese)
  { kw: "氏ね",          category: "violence" },     // die (alternate kanji used to evade filters)
  { kw: "消えろ",        category: "harassment" },   // disappear / get lost
  { kw: "失せろ",        category: "harassment" },   // get lost / fuck off (formal register)
  { kw: "うざい",        category: "harassment" },   // annoying / shut up (Japanese)
  { kw: "うぜー",        category: "harassment" },   // annoying (slang contraction)
  { kw: "キモい",        category: "harassment" },   // gross / disgusting (directed)
  { kw: "きもい",        category: "harassment" },   // gross (hiragana)
  { kw: "バカ",          category: "harassment" },   // idiot / stupid (Japanese)
  { kw: "馬鹿",          category: "harassment" },   // idiot (kanji form)
  { kw: "アホ",          category: "harassment" },   // idiot (Kansai dialect)
  { kw: "ボケ",          category: "harassment" },   // senile / idiot (Kansai)
  { kw: "カス",          category: "harassment" },   // scum / dregs (insult)
  { kw: "ゴミ",          category: "harassment" },   // garbage / trash (directed at person)
  { kw: "クズ",          category: "harassment" },   // scum / trash (directed at person)
  { kw: "ブス",          category: "harassment" },   // ugly woman (body-shaming insult)
  { kw: "デブ",          category: "harassment" },   // fat person (body-shaming)
  { kw: "チビ",          category: "harassment" },   // shorty / midget (body-shaming)
  { kw: "ハゲ",          category: "harassment" },   // baldie / bald (body-shaming)
  { kw: "きさま",        category: "harassment" },   // you (extremely rude, aggressive)
  { kw: "てめえ",        category: "harassment" },   // you (very rude — lower than kisama)
  { kw: "このクソ",      category: "harassment" },   // this piece of shit
  { kw: "ぶっ殺す",      category: "violence" },     // I'll kill you / kill the fuck out of you
  { kw: "殺すぞ",        category: "violence" },     // I'll kill you (threat)
  { kw: "殺してやる",    category: "violence" },     // I'll kill you
  { kw: "ぶっ飛ばす",    category: "violence" },     // I'll knock you out
  { kw: "ぶっ壊す",      category: "violence" },     // I'll destroy you

  // Hate speech — Japanese
  { kw: "チョン",        category: "hate_speech" },  // anti-Korean slur (Japanese)
  { kw: "朝鮮人",        category: "hate_speech" },  // Korean person (used as slur in hate context)
  { kw: "シナ人",        category: "hate_speech" },  // Shina-jin — anti-Chinese slur
  { kw: "チャンコロ",    category: "hate_speech" },  // anti-Chinese slur (Japanese WWII era)
  { kw: "クロンボ",      category: "hate_speech" },  // n-word equivalent (Japanese)
  { kw: "オカマ",        category: "hate_speech" },  // gay / transgender slur (Japanese)
  { kw: "オネエ",        category: "hate_speech" },  // feminine gay man slur (contextual)
  { kw: "部落",          category: "hate_speech" },  // Burakumin (used as discriminatory label)
  { kw: "在日",          category: "hate_speech" },  // Zainichi Koreans (used in hate speech)

  // Self-harm — Japanese
  { kw: "自殺",          category: "violence" },     // suicide (Japanese)
  { kw: "自殺方法",      category: "violence" },     // suicide methods
  { kw: "死にたい",      category: "violence" },     // I want to die
  { kw: "消えたい",      category: "violence" },     // I want to disappear (self-harm context)
  { kw: "リスカ",        category: "violence" },     // wrist cutting / self-harm (Japanese internet slang)
  { kw: "リストカット",  category: "violence" },     // wrist cutting
  { kw: "首吊り",        category: "violence" },     // hanging (self-harm method)
  { kw: "飛び降り",      category: "violence" },     // jumping from height (self-harm)
  { kw: "薬物過剰摂取",  category: "violence" },     // drug overdose

  // Spam / drugs — Japanese
  { kw: "麻薬",          category: "spam" },         // narcotics / drugs (in solicitation context)
  { kw: "覚醒剤",        category: "spam" },         // stimulants / meth (Japanese)
  { kw: "大麻",          category: "spam" },         // cannabis (in solicitation context)
  { kw: "コカイン",      category: "spam" },         // cocaine (Japanese)
  { kw: "ヘロイン",      category: "spam" },         // heroin (Japanese)
  { kw: "薬売ります",    category: "spam" },         // drugs for sale (Japanese)

  // ── Korean ──────────────────────────────────────────────────────────────────

  // Profanity / sexual — Korean
  { kw: "씨발",          category: "harassment" },   // fuck (most common Korean profanity; shibal)
  { kw: "씨발놈",        category: "harassment" },   // fucking bastard
  { kw: "씨발년",        category: "harassment" },   // fucking bitch
  { kw: "시발",          category: "harassment" },   // variant spelling of 씨발
  { kw: "ㅅㅂ",          category: "harassment" },   // 씨발 abbreviation (Korean internet)
  { kw: "개새끼",        category: "harassment" },   // son of a bitch / bastard (lit. dog offspring)
  { kw: "개놈",          category: "harassment" },   // dog bastard
  { kw: "새끼",          category: "harassment" },   // bastard / little shit (lit. offspring)
  { kw: "ㅅㄲ",          category: "harassment" },   // 새끼 abbreviation
  { kw: "미친",          category: "harassment" },   // crazy / insane (strong insult when directed)
  { kw: "미친놈",        category: "harassment" },   // crazy bastard
  { kw: "미친년",        category: "harassment" },   // crazy bitch
  { kw: "ㅁㅊ",          category: "harassment" },   // 미친 abbreviation
  { kw: "지랄",          category: "harassment" },   // bullshit / what the hell (Korean profanity)
  { kw: "지랄하네",      category: "harassment" },   // what the hell are you doing
  { kw: "존나",          category: "harassment" },   // fucking / very (Korean vulgar intensifier)
  { kw: "ㅈㄴ",          category: "harassment" },   // 존나 abbreviation
  { kw: "抹없",          category: "harassment" },   // purposeful misspelling for profanity
  { kw: "꺼져",          category: "harassment" },   // get lost / fuck off
  { kw: "닥쳐",          category: "harassment" },   // shut up (Korean)
  { kw: "거지같은",      category: "harassment" },   // like a beggar / worthless (insult)
  { kw: "병신",          category: "harassment" },   // retard / stupid (ableist slur; extremely common insult)
  { kw: "ㅂㅅ",          category: "harassment" },   // 병신 abbreviation
  { kw: "창녀",          category: "adult" },        // prostitute / whore (Korean)
  { kw: "창녀년",        category: "adult" },        // fucking whore
  { kw: "보지",          category: "adult" },        // vagina (Korean vulgar)
  { kw: "보지년",        category: "adult" },        // vagina-bitch (compound insult)
  { kw: "자지",          category: "adult" },        // penis (Korean vulgar)
  { kw: "보지자지",      category: "adult" },        // genitalia compound (Korean)
  { kw: "씹",            category: "adult" },        // cunt (Korean vulgar; also intensifier)
  { kw: "씹년",          category: "adult" },        // cunt-woman
  { kw: "야동",          category: "adult" },        // porn / adult video (Korean internet slang)
  { kw: "야동보여줘",    category: "adult" },        // show me porn
  { kw: "포르노",        category: "adult" },        // pornography (Korean)
  { kw: "원나잇",        category: "adult" },        // one-night stand (solicitation context)
  { kw: "원나이트",      category: "adult" },        // one-night stand (variant)
  { kw: "섹스",          category: "adult" },        // sex (Korean transliteration)
  { kw: "섹파",          category: "adult" },        // friends with benefits (sexual partner — solicitation)
  { kw: "성매매",        category: "adult" },        // prostitution / sexual transaction
  { kw: "조건만남",      category: "adult" },        // compensated meeting / transactional sex

  // Hate speech — Korean
  { kw: "짱깨",          category: "hate_speech" },  // anti-Chinese slur (Korean)
  { kw: "쪽발이",        category: "hate_speech" },  // anti-Japanese slur (Korean)
  { kw: "흑인새끼",      category: "hate_speech" },  // fucking Black person (racist)
  { kw: "게이새끼",      category: "hate_speech" },  // gay bastard (homophobic)
  { kw: "호모새끼",      category: "hate_speech" },  // homo bastard (homophobic slur)
  { kw: "트랜스새끼",    category: "hate_speech" },  // trans bastard (transphobic)
  { kw: "보슬아치",      category: "hate_speech" },  // feminist slur / sexist term (Korean)
  { kw: "한남",          category: "hate_speech" },  // Korean male (used as hate slur in certain communities)

  // Violence / self-harm — Korean
  { kw: "죽어",          category: "violence" },     // die (imperative — Korean)
  { kw: "죽어버려",      category: "violence" },     // just die already
  { kw: "죽여버린다",    category: "violence" },     // I'll kill (them)
  { kw: "죽이겠다",      category: "violence" },     // I will kill
  { kw: "죽이다",        category: "violence" },     // to kill (in threat context)
  { kw: "자살",          category: "violence" },     // suicide (Korean)
  { kw: "자살방법",      category: "violence" },     // suicide methods
  { kw: "죽고싶다",      category: "violence" },     // I want to die
  { kw: "손목긋기",      category: "violence" },     // wrist cutting
  { kw: "목매",          category: "violence" },     // hang oneself
  { kw: "투신",          category: "violence" },     // jump to death (from building)
  { kw: "자해",          category: "violence" },     // self-harm

  // Spam / drugs — Korean
  { kw: "마약",          category: "spam" },         // drugs / narcotics (Korean)
  { kw: "마약삽니다",    category: "spam" },         // I'll buy drugs
  { kw: "마약팝니다",    category: "spam" },         // drugs for sale
  { kw: "필로폰",        category: "spam" },         // methamphetamine (Korean; philopon brand name)
  { kw: "대마초",        category: "spam" },         // cannabis (Korean)
  { kw: "코카인",        category: "spam" },         // cocaine (Korean)
  { kw: "헤로인",        category: "spam" },         // heroin (Korean)

  // ── Russian / Cyrillic ───────────────────────────────────────────────────────

  // Mat (Russian obscene vocabulary) — profanity / sexual
  { kw: "блядь",         category: "adult" },        // whore / fuck (most common Russian mat)
  { kw: "блять",         category: "adult" },        // variant/euphemism of блядь
  { kw: "блядина",       category: "adult" },        // big whore
  { kw: "шлюха",         category: "adult" },        // slut / whore (Russian)
  { kw: "сука",          category: "harassment" },   // bitch (female dog; extremely common Russian insult)
  { kw: "сука блядь",    category: "harassment" },   // bitch-whore (compound)
  { kw: "пизда",         category: "adult" },        // vagina / fuck (also Polish; Russian mat — primary)
  { kw: "пиздец",        category: "adult" },        // fucked up / disaster (derived from пизда)
  { kw: "пиздатый",      category: "adult" },        // fucking awesome / great (vulgar — contextual)
  { kw: "хуй",           category: "adult" },        // cock / penis (Russian mat)
  { kw: "хуйло",         category: "harassment" },   // dickhead (insult derived from хуй)
  { kw: "хуеплёт",       category: "harassment" },   // braggart / bullshitter (derived)
  { kw: "ёбаный",        category: "harassment" },   // fucking (adjective — Russian mat)
  { kw: "ёб твою мать",  category: "harassment" },   // fuck your mother
  { kw: "ёб твою",       category: "harassment" },   // fuck your (insult prefix)
  { kw: "ёбать",         category: "adult" },        // to fuck (Russian)
  { kw: "ёбнутый",       category: "harassment" },   // crazy / fucked up
  { kw: "иди нахуй",     category: "harassment" },   // go fuck yourself
  { kw: "нахуй",         category: "harassment" },   // fuck off / go to hell
  { kw: "пошёл нахуй",   category: "harassment" },   // fuck off (lit. go to the cock)
  { kw: "пошёл на хуй",  category: "harassment" },   // fuck off (spaced variant)
  { kw: "залупа",        category: "adult" },        // glans penis / dickhead (insult)
  { kw: "мудак",         category: "harassment" },   // asshole (lit. scrotum — Russian insult)
  { kw: "мудила",        category: "harassment" },   // big asshole
  { kw: "мудило",        category: "harassment" },   // asshole variant
  { kw: "пиздобол",      category: "harassment" },   // bullshitter / liar (derived from пизда)
  { kw: "залупон",       category: "harassment" },   // dickhead variant
  { kw: "ёбаный в рот",  category: "adult" },        // fucked in the mouth
  { kw: "отсоси",        category: "adult" },        // suck it off (sexual demand)
  { kw: "отсоси у",      category: "adult" },        // suck off (from someone)
  { kw: "поделись голой",category: "adult" },        // share nude
  { kw: "порно",         category: "adult" },        // pornography (Russian)
  { kw: "порнуха",       category: "adult" },        // porn (colloquial Russian)

  // Insults / harassment — Russian
  { kw: "урод",          category: "harassment" },   // freak / ugly bastard
  { kw: "урода",         category: "harassment" },   // female form
  { kw: "тупой",         category: "harassment" },   // stupid (Russian)
  { kw: "тупица",        category: "harassment" },   // moron / dumbass
  { kw: "идиот",         category: "harassment" },   // idiot (Russian)
  { kw: "дурак",         category: "harassment" },   // fool / idiot
  { kw: "дура",          category: "harassment" },   // female fool
  { kw: "кретин",        category: "harassment" },   // cretin / moron
  { kw: "ублюдок",       category: "harassment" },   // bastard / mongrel
  { kw: "скотина",       category: "harassment" },   // beast / swine (directed at person)
  { kw: "свинья",        category: "harassment" },   // pig (insult)
  { kw: "тварь",         category: "harassment" },   // creature / bastard (strong insult)
  { kw: "мразь",         category: "harassment" },   // scum / filth
  { kw: "мразота",       category: "harassment" },   // scum (stronger variant)
  { kw: "заткнись",      category: "harassment" },   // shut up (Russian)
  { kw: "пошёл вон",     category: "harassment" },   // get out / fuck off
  { kw: "отвяжись",      category: "harassment" },   // get off me / leave me alone (aggressive)
  { kw: "подонок",       category: "harassment" },   // scoundrel / bastard
  { kw: "негодяй",       category: "harassment" },   // scoundrel / villain
  { kw: "ты чмо",        category: "harassment" },   // you are scum / loser (ЧМО — acronym insult)
  { kw: "чмо",           category: "harassment" },   // scum / loser (Russian insult)

  // Hate speech — Russian
  { kw: "чёрный",        category: "hate_speech" },  // Black person (used as racial slur in Russian context)
  { kw: "чурка",         category: "hate_speech" },  // ethnic slur for Central Asians / people from Caucasus
  { kw: "чурбан",        category: "hate_speech" },  // variant of чурка
  { kw: "хач",           category: "hate_speech" },  // anti-Caucasian slur (from Khachkar)
  { kw: "хачик",         category: "hate_speech" },  // anti-Armenian/Caucasian slur
  { kw: "жид",           category: "hate_speech" },  // anti-Jewish slur (Russian equivalent of yid)
  { kw: "жидяра",        category: "hate_speech" },  // intensified anti-Jewish slur
  { kw: "пидор",         category: "hate_speech" },  // homophobic slur (derived from педераст)
  { kw: "пидорас",       category: "hate_speech" },  // homophobic slur (full form)
  { kw: "гомик",         category: "hate_speech" },  // gay (derogatory Russian)
  { kw: "педрила",       category: "hate_speech" },  // gay slur (Russian)
  { kw: "трансгендер",   category: "hate_speech" },  // transgender (used aggressively in slur context)

  // Violence / self-harm — Russian
  { kw: "убью тебя",     category: "violence" },     // I'll kill you
  { kw: "я тебя убью",   category: "violence" },     // I will kill you
  { kw: "иди умри",      category: "violence" },     // go die
  { kw: "убей себя",     category: "violence" },     // kill yourself
  { kw: "самоубийство",  category: "violence" },     // suicide (Russian)
  { kw: "методы суицида",category: "violence" },     // suicide methods
  { kw: "хочу умереть",  category: "violence" },     // I want to die
  { kw: "порезать вены", category: "violence" },     // cut veins (self-harm)
  { kw: "вскрыть вены",  category: "violence" },     // open / slash veins
  { kw: "повеситься",    category: "violence" },     // to hang oneself

  // Spam / drugs — Russian
  { kw: "купить наркотики",  category: "spam" },     // buy drugs (Russian)
  { kw: "продать наркотики", category: "spam" },     // sell drugs
  { kw: "наркотики на продажу", category: "spam" },  // drugs for sale
  { kw: "героин",        category: "spam" },         // heroin (Russian)
  { kw: "кокаин",        category: "spam" },         // cocaine (Russian)
  { kw: "метамфетамин",  category: "spam" },         // methamphetamine

  // ── Hindi / Devanagari ───────────────────────────────────────────────────────

  // Gaali (Hindi abuses) — profanity / sexual
  { kw: "मादरचोद",       category: "adult" },        // motherfucker (most severe Hindi gaali)
  { kw: "भड़वा",          category: "adult" },        // pimp / asshole (Hindi)
  { kw: "भड़वे",          category: "adult" },        // pimp (plural/vocative)
  { kw: "रंडी",           category: "adult" },        // prostitute / whore (Hindi)
  { kw: "रंडी की औलाद",  category: "adult" },        // son of a whore
  { kw: "चुदाई",          category: "adult" },        // fucking / sex act (Hindi)
  { kw: "चोद",            category: "adult" },        // fuck (stem — Hindi)
  { kw: "चोदना",          category: "adult" },        // to fuck (Hindi)
  { kw: "चोदो",           category: "adult" },        // fuck (imperative)
  { kw: "लंड",            category: "adult" },        // penis (Hindi vulgar)
  { kw: "लण्ड",           category: "adult" },        // penis (variant spelling)
  { kw: "लुण्ड",          category: "adult" },        // penis (variant)
  { kw: "चूत",            category: "adult" },        // vagina (Hindi vulgar)
  { kw: "चूतिया",         category: "harassment" },  // idiot (derived from चूत — extremely common)
  { kw: "चूतियापा",       category: "harassment" },  // stupidity / nonsense
  { kw: "गांड",           category: "adult" },        // ass / anus (Hindi)
  { kw: "गांडू",          category: "harassment" },  // asshole / ass-man (very common Hindi insult)
  { kw: "गाण्डू",         category: "harassment" },  // variant of गांडू
  { kw: "हरामी",          category: "harassment" },  // bastard / illegitimate (very common Hindi insult)
  { kw: "हरामज़ादा",      category: "harassment" },  // bastard (lit. born of haram)
  { kw: "हरामज़ादी",      category: "harassment" },  // female bastard
  { kw: "कमीना",          category: "harassment" },  // scoundrel / vile person
  { kw: "कमीनी",          category: "harassment" },  // female scoundrel
  { kw: "कुत्ता",          category: "harassment" },  // dog (insult)
  { kw: "कुत्ते",          category: "harassment" },  // you dog (vocative)
  { kw: "कुतिया",          category: "harassment" },  // bitch (female dog — insult)
  { kw: "सूअर",            category: "harassment" },  // pig (insult)
  { kw: "साला",            category: "harassment" },  // brother-in-law (used as mild-strong profanity)
  { kw: "बेहनचोद",         category: "adult" },       // sister-fucker
  { kw: "बहनचोद",          category: "adult" },       // sister-fucker (variant)
  { kw: "बेटी चोद",        category: "adult" },       // daughter-fucker
  { kw: "माँ की आँख",      category: "harassment" },  // your mother's eye (profanity; lit.)
  { kw: "तेरी माँ की",     category: "harassment" },  // your mother's (profanity prefix)
  { kw: "पोर्न",           category: "adult" },       // porn (Hindi transliteration)
  { kw: "अश्लील",          category: "adult" },       // obscene / pornographic (Hindi)
  { kw: "अश्लील वीडियो",   category: "adult" },       // obscene video

  // Insults / harassment — Hindi
  { kw: "बेवकूफ",          category: "harassment" },  // fool / idiot (Hindi)
  { kw: "मूर्ख",           category: "harassment" },  // fool / stupid
  { kw: "उल्लू का पट्ठा",  category: "harassment" },  // son of an owl / idiot
  { kw: "गधा",             category: "harassment" },  // donkey / idiot (Hindi)
  { kw: "पागल",            category: "harassment" },  // crazy / mad (as directed insult)
  { kw: "अंधा",            category: "harassment" },  // blind (ableist directed insult)
  { kw: "लंगड़ा",          category: "harassment" },  // lame/cripple (ableist directed insult)

  // Hate speech — Hindi
  { kw: "काला",            category: "hate_speech" }, // Black (used as racial slur in Hindi context)
  { kw: "काले",            category: "hate_speech" }, // Black people (plural slur use)
  { kw: "भिखारी",          category: "hate_speech" }, // beggar (used as ethnic slur)
  { kw: "नीची जाति",       category: "hate_speech" }, // low caste (casteist discrimination)
  { kw: "अछूत",            category: "hate_speech" }, // untouchable (caste discrimination)
  { kw: "दलित गंदे",       category: "hate_speech" }, // dirty Dalit (casteist hate)
  { kw: "मुल्ला",           category: "hate_speech" }, // Muslim slur (derogatory use of mullah)
  { kw: "मुल्ले",           category: "hate_speech" }, // Muslim slur (plural)
  { kw: "काफिर",           category: "hate_speech" }, // infidel (used aggressively as slur)

  // Violence / self-harm — Hindi
  { kw: "मर जा",           category: "violence" },    // go die (Hindi)
  { kw: "मर जाओ",          category: "violence" },    // you go die
  { kw: "खुद को मार",      category: "violence" },    // kill yourself
  { kw: "आत्महत्या",       category: "violence" },    // suicide (Hindi)
  { kw: "आत्महत्या कैसे",  category: "violence" },    // how to commit suicide
  { kw: "मरना चाहता हूँ",  category: "violence" },    // I want to die (male)
  { kw: "मरना चाहती हूँ",  category: "violence" },    // I want to die (female)
  { kw: "खुद को नुकसान",   category: "violence" },    // harm oneself (Hindi)
  { kw: "तेरे को जान से मारूँगा", category: "violence" }, // I will kill you (Hindi threat)
  { kw: "जान से मार दूँगा",category: "violence" },    // I'll kill you

  // Spam / drugs — Hindi
  { kw: "नशा बेचना",       category: "spam" },        // sell drugs (Hindi)
  { kw: "नशा खरीदना",      category: "spam" },        // buy drugs (Hindi)
  { kw: "चरस",             category: "spam" },        // hashish/cannabis (Hindi)
  { kw: "गांजा",           category: "spam" },        // cannabis (Hindi)
  { kw: "हेरोइन",          category: "spam" },        // heroin (Hindi)
  { kw: "कोकीन",           category: "spam" },        // cocaine (Hindi)
  { kw: "स्मैक",           category: "spam" },        // smack/heroin (Hindi slang)

  // ── Burmese (Myanmar) ────────────────────────────────────────────────────────

  // Profanity / insults — Burmese
  { kw: "မင်းမေ့",         category: "harassment" }, // your mother (used in insults — Burmese)
  { kw: "ကောင်မ",          category: "harassment" }, // girl/woman (derogatory when directed aggressively)
  { kw: "ခွေး",            category: "harassment" }, // dog (Burmese insult)
  { kw: "ဝက်",             category: "harassment" }, // pig (Burmese insult)
  { kw: "မိုက်",           category: "harassment" }, // stupid / ignorant (Burmese)
  { kw: "ပုပ်",            category: "harassment" }, // rotten / worthless (Burmese)
  { kw: "ညစ်",            category: "harassment" }, // dirty / filthy (directed at person)
  { kw: "ညစ်ညစ်",        category: "harassment" }, // very dirty (intensified insult)
  { kw: "သစ်မ",            category: "harassment" }, // bastard (Burmese)
  { kw: "မင်းအမေ",        category: "harassment" }, // your mother (explicit Burmese insult form)
  { kw: "ဂျာနယ်",         category: "adult" },       // erotic / adult (contextual — Burmese slang for porn)
  { kw: "ညောင်း",          category: "adult" },       // sexual slang (Burmese vulgar)
  { kw: "အောကား",         category: "adult" },       // pornographic film (Burmese; lit. moaning film)
  { kw: "ကာမ",             category: "adult" },       // sexual / lust (Burmese; in explicit solicitation)
  { kw: "ချောင်းကြည့်",   category: "adult" },       // voyeurism / peeping (Burmese)

  // Violence / self-harm — Burmese
  { kw: "သေပါ",            category: "violence" },   // please die (polite but lethal — Burmese)
  { kw: "သေ",              category: "violence" },   // die (Burmese — short; in threat context)
  { kw: "သတ်မည်",         category: "violence" },   // will kill (Burmese)
  { kw: "ကိုယ်ကိုသတ်",   category: "violence" },   // kill oneself (Burmese)
  { kw: "သေချင်",         category: "violence" },   // want to die (Burmese)
  { kw: "ကိုယ်ကိုညှဉ်း",  category: "violence" },   // self-harm (Burmese)

  // Hate speech — Burmese
  { kw: "ကလား",            category: "hate_speech" }, // anti-Muslim/South Asian slur (Burmese; extremely offensive)
  { kw: "ဘင်္ဂါလီ",       category: "hate_speech" }, // Bengali (used as ethnic slur against Rohingya)
  { kw: "စစ်မြန်မာ",      category: "hate_speech" }, // ethnic nationalist hate phrase (pure Myanmar)
  { kw: "မြောင်",          category: "hate_speech" }, // derogatory term for minority groups
  { kw: "ဟိန္ဒူ",          category: "hate_speech" }, // Hindu (used as ethnic slur in Burma in hate speech context)
  { kw: "ခရစ်ယာန်ကျွန်",  category: "hate_speech" }, // Christian slave (religious hate phrase Burmese)

  // Spam / drugs — Burmese
  { kw: "မူးယစ်ဆေးဝါးရောင်း", category: "spam" },  // sell drugs (Burmese)
  { kw: "ဆေးဝါးဝယ်",       category: "spam" },      // buy drugs (Burmese)
  { kw: "ယာဘာ",            category: "spam" },       // yaba / methamphetamine (Burmese)
  { kw: "ဘိန်း",           category: "spam" },       // opium (Burmese)

];
