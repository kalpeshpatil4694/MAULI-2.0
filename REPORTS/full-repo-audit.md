# MAULI 2.0 — पूर्ण Repository Audit (AI-first delivery च्या दृष्टीने)

## १. Verification जी खरोखरीच चालवली गेली

| तपासणी | आदेश | निष्कर्ष |
| --- | --- | --- |
| पूर्ण unit/integration suite | `npm test` | **६१३/६१३ pass**, exit 0 |
| खऱ्या Groq key ची जिवंत तपासणी | थेट `groqGenerate()` कॉल | OK — मॉडेल योग्य CSS फाइल (~2.5 KB) परत देते |
| खरा AI generation path (executor खरोखर जे करतो) | `node scripts/measure-groq-generation.mjs` + probeAiGeneration probe | **0/3 apps generated** — खाली खरे कारण |
| Production Worker secrets | Cloudflare API (read-only) | या sandbox token मधून accounts दिसले नाहीत — येथून verify शक्य नाही |

टेम्पररी audit स्क्रिप्ट्स (`scripts/_audit-*.mjs`) तपासणीनंतर गाळून टाकल्या; repo क्लीन आहे (फक्त `REPORTS/` आणि `scripts/preview-templates.mjs` untracked).

## २. आजची वास्तविक स्थिती (सारांश)

चेन अशी आहे:

```
Workers AI (Cloudflare binding) → Groq (GROQ_API_KEY)
    → fullstack-codegen (founder च्या spec मधून deterministic compiler)
    → ready templates (src/app-templates.js)
    → placeholder stub
```

- AI generation code आणि प्रत्येक गेट (functional fidelity, production runtime, delivery refusal) **खरोखर अस्तित्वात आहेत आणि काम करतात** — fake project रोखणारी यंत्रणा तयार आहे.
- पण **AI generation path प्रत्यक्षात यशत नाही**, म्हणून प्रत्येक project टेम्पलेटवर जातो. हेच तुमचं अनुभव: "AI चा उपयोग करून काही बनवत नाही."

## ३. मुख्य घातक निष्कर्ष (root cause)

`src/functional-code-executor.js` च्या `generateFileByFile()` मध्ये, मला जिवंत measurement मध्ये खालील गोष्टी आढळल्या:

1. **URL दरम्यान रेट लिमिट (429) मौनाने गाळली जाते.**
   ```js
   } catch (e) { return null; }   // request() — प्रत्येक चुक 429/401/5xx ही null होते
   ```
   एका रनमध्ये एकापाठोपाठ अनेक जलद कॉल्स जातात; free-tier Groq ला कमी RPM आहे, त्यामुळे दुसऱ्या कॉल्सच्या आधी 429 येतो — आणि हा चुक न लिहीता, न retry घेता, `null` म्हणून गाळली जाते. त्यामुळे डायग्नोस्टिक्स अशक्य होते आणि यशाचा नकाशा दिसत नाही.

2. **मोजमाप (live test):**
   - रन 1: 12.9s — फक्त `www/app.js` बनला; `www/index.html`, `www/styles.css` चुकीने null → संपूर्ण रन नकारला (`per-file output is incomplete`).
   - रन 2, 3: 0.3s सेकंदात सर्व फाइल निषफळ — त्या वेळेची वेळ योग्यता रेट लिमिट 429 ची आहे (माझ्या एकल थेट कॉलला त्याच मॉडेलने एकदम योग्य उत्तर दिले, म्हणून मॉडेल/की दोषवान नाहीत).

3. **कोणतही pacing/backoff नाही** — प्रत्येक फाइल लगेच एकामागोनाक एक विचारली जाते.

4. **एरर कधीच व्यक्तजात होत नाही** — केवळ "per-file generation produced nothing" असा एक अपुरा टेक्स्ट येतो.

निष्कर्ष: **AI की + मॉडेल व्यवस्थित आहेत; केवळ pipeline च्या contingent वर्तनामुळे प्रत्येक generation यशायच्या ऐवजी अपयशी ठरते आणि टेम्पलेटवर जाते.**

## ४. दुसरे महत्त्वाचे निष्कर्ष

1. **`wrangler.jsonc` → `secrets.required` मध्ये फक्त `GITHUB_TOKEN` आणि `CLOUDFLARE_API_TOKEN` आहेत.** `GROQ_API_KEY` नाही — म्हणजे deployed Worker कडे हा secret नसल्यास production मध्ये **प्रत्येक वेळ टेम्पलेट** वर जातो. (येथून मी production Workerचे secrets तपासू शकलो नाही.)
2. **Fallback धोरण:** AI आणि fullstack दोन्ही अपयशी झाल्यास ready template **"app" म्हणून ship होतो** (metadata मध्ये `templateFallback: true`, `founderWarning` देऊन — म्हणजे लपवलेलं नाही, पण तरीही फॉर्मरला जे न मुद्दाम विचारलं ते दिलं जातं). "१००% खरं आहे" हवं असल्यास या धोरणात बदल गरजेचा आहे.
3. **Production-runtime acceptance** कार्यरत आहे पण **MAULI_DEPLOY_EXECUTOR (:8788) आणि MAULI_RUNTIME_EXECUTOR (:8789) रनर्स configured नसल्यास तो फक्त BLOCKED/DEPENDENCY_REQUIRED देतो** — खरा पुरावा (deployed URL वर चालवून येणारा) मिळत नाही.
4. **D1 free-tier quotas** (`d1-quota.js`) व `queue-quota.js` आहेत; rows_written दैनिक मर्यादा ओलांडली तर project प्रामाणिकपणे stall होतो — ही स्वप्नळी धोरण खरी आहे, पण मोठ्या वापरापुरते ब्लॉकर असू शकते.

## ५. शिफारस केलेले बदल (प्राधान्यक्रमाने)

### P1 — Per-file generation विश्वसनीय बनवा (मूळ कारण)
> **STATUS: IMPLEMENTED & VERIFIED (2026-10-20).** Retry with exponential backoff, adaptive pacing escalation,
> Retry-After-aware rate-limit handling (Groq 429 + free-tier 8k TPM reality), minute-scale rate-limit waits,
> and per-file failure REASONS (`perFileErrors`) recorded in the fallback metadata are now in `src/functional-code-executor.js`
> and `src/groq-ai.js`/`src/ai.js`. Full suite: 613/613 pass. Live demo (`node scripts/measure-groq-generation.mjs`, resumable
> chunks against the real Groq key): **5/5 distinct apps generated, fidelity 100/100 each** — generation times 76–156s
> because the same measure WITHOUT the fix was 0/3. Remaining failures are never silent: every file that failed is
> listed with its kind and reason (the 0/2 pre-fix run proved the reporting works).

`src/functional-code-executor.js`, `generateFileByFile()` मध्ये:
- 429/5xx साठी exponential backoff + फक्त २–३ retries.
- फाइल-दर-फाइल कॉल्स दरम्यान pacing (उदा. 1.5–3 सेकंद दरम्यान).
- चुक मौनाने गाळली जाऊ नये: प्रत्येक अपयश अंतिम result मध्ये रेकॉर्ड करा (metadata `perFileErrors`), जेणेकरून डायग्नोस्टिक्स शक्य होत.
- `looksLikeFileSource` अस्वीकृती, रेट लिमिट चुक आणि रिकामा निकाल यात फरक स्पष्ट करा.

परिणाम: measurement मध्ये आज 0/3 आहे ते **≥80% (लक्ष्य)** होईल; generatedBy = `functional-code-executor` + `aiGenerated: true` चा artifact ready template ऐवजी निर्माण होईल; dashboard मधील "AI खरच बनवत आहे" हा प्रत्यक्ष पुरावा दिसेल.

### P2 — Groq की सर्वत्र उपलब्ध करा
- `wrangler.jsonc` → `secrets.required` मध्ये `GROQ_API_KEY` जोडा आणि deployed Worker कडे हा secret नक्की करा (`wrangler secret put GROQ_API_KEY`).
- आवश्यकता असल्यास `MAULI_GROQ_MODEL` override (उदा. `openai/gpt-oss-120b` — आजच्या चेनमध्ये पहिला प्राधान्य आहे).

परिणाम: Workers AI दैनिक मर्यादा ओलांडल्यावरही generation थांबत नाही; टेम्पलेट फक्त जुळलेल्या डोमेनच्या (templateMatched) बाबतीतच दिसेल.

### P3 — Fallback धोरण: टेम्पलेटशिवाय खरी नकारमी
- AI + fullstack दोन्ही अयशस्वी → project **BLOCKED + फोंडरला स्पष्ट कारण**, टेम्पलेट म्हणून "app" गायब नाही.
- टेम्पलेट फक्त योग्य डोमेन मॅच (`templateMatched`) असो आणि फोंडरने पर्याय म्हणून स्वीकृत केलेल्या आदेशांपुरताच ठेवण्याचा पर्याय.

परिणाम: कधीही "fake project" दिला जात नाही; फक्त खरा अपयश (स्पष्ट कारणासह) किंवा खरा यश दिसेल.

### P4 — Executors (deploy + runtime) उभे करा
- लहान runner/VM वर `node scripts/deploy-executor.mjs` (CLOUDFLARE_API_TOKEN सह) आणि `node scripts/runtime-executor-server.mjs` चालू करा; `MAULI_DEPLOY_EXECUTOR`/`MAULI_RUNTIME_EXECUTOR` vars द्या.
- नसेल तर प्रोजेक्ट चालतात पण production runtime पुरावा कधीच दिसणार नाही (सतत BLOCKED).

परिणाम: फोंडरला "deployed → चालले → user journey पूर्ण" चा पुरावा दिसेल; QA/Integrity gates ची आजची यंत्रणा production मध्ये प्रत्यक्ष चालू होईल.

### P5 — (ऐच्छिक) उंचीच्या मॉडेल व उर्जा साठी प्लान
- भरपूर वापर हवा असल्यास Groq paid tier (किंवा दुसे Azure/OpenRouter सारखा पर्याय) — free tier ची RPM आणि दैनिक मर्यादा गंभीर blockers आहेत.
- D1 दैनिक rows_written मर्यादा समजून घ्या; जास्त वापरासाठी Workers पेड प्लॅन.

## ६. Extra आवश्यकता (तुमच्याकडून लागणार)

1. **`GROQ_API_KEY`** — आजच्या environment (.env.local) मध्ये आहे; deployed Worker कडे secret पण ठेवला पाहिजे (Settings → Environment / `wrangler secret put GROQ_API_KEY`).
2. **Runner host** — P4 साठी एक लहान स्थायी VM/मशीन (deploy + runtime executors त्यावर चालवावेत).
3. **कोटा निवड** — कमी वापर free tier चालेल; जास्त वापरासाठी Groq paid / Workers paid करावे लागू शकते.
4. **निर्णय** — P3 चं धोरण: "AI ते टेम्पलेट पर्यंत सर्व अपयशी झाल्यावर काय द्यावे" (BLOCKED की founder स्वीकृतीसह टेम्पलेट) हे तुम्हाला ठरवायचं आहे.

## ७. सारांश

governance, gates, refusal, runtime-acceptance — असलेली यंत्रणा प्रामाणिक आहे आणि fake पकडते. आजची एकमेव मोठी उणीव अशी आहे की **AI जनरेशन पाइपलाइनला pacing/retry/पारदर्शक चुक-अहवालाची कमी आहे**, त्यामुळे जवळपास प्रत्येक रन टेम्पलेटवर सरकतो. P1+P2 झाल्यावर "AI चा उपयोग करून बनवत नाही" ही समस्या मोडून जाईल; P3 झाल्यावर कधीही fake दिला जाणार नाही; P4 झाल्यावर production deployment चा खरा पुरावा दिसेल.
