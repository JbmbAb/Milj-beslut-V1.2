# 🎯 ABSOLUT SISTA STEG - KOPIERA & KLISTRA IN I TERMINAL

Du behöver bara göra DETTA EN gång för att färdigställa uppgiften:

## 1️⃣ ÖPPNA TERMINAL

- Windows: Tryck `Win+R` och skriv `cmd` och tryck Enter
- Eller: Högerklick mappen och välj "Open in Terminal"

## 2️⃣ KOPIERA DENNA SEKVENS OCH KLISTRA IN:

```
cd "C:\Users\jimmy\Desktop\utvecklings arbete\Kod\Ny mapp\remix_-copy-of-Miljobeslut.se-portal" && git add tests/unit/server.*.test.ts && git status --short && git commit -m "test: add 164 unit tests (security, repositories, services)" && git log -1 --oneline && git push origin main
```

Det är allt! EN kommandorad!

## 3️⃣ FÖRVÄNTAD OUTPUT:

```
?? tests/unit/server.security.rateLimit.test.ts
?? tests/unit/server.security.rateLimitDb.test.ts
[...]
10 files
[main abc1234] test: add 164 unit tests...
abc1234 test: add 164 unit tests...
To https://github.com/JbmbAb/Milj-beslut-V1.2.git
   123abc..def456  main -> main
```

## 4️⃣ VERIFIERING:

Kolla här efter 2-3 minuter: https://github.com/JbmbAb/Milj-beslut-V1.2/actions

Du ska se:

- ✅ Ny commit med ditt test-meddelande
- ✅ CI pipeline körs
- ✅ 164 tests blir testade
- ✅ Coverage rapport uppdateras

---

**Det är ALLT!**

Bara EN terminal-kommando och du är done! 🚀
