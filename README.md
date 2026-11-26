# Trening – wersja na iPhone'a (Safari)

Dziennik jedzenia do programu **Trening**, otwierany w Safari i dodawany do ekranu początkowego.
Działa bez internetu w ciągu dnia; **Update** wysyła wpisy przez domowe Wi-Fi do programu na komputerze.

Adres aplikacji: **https://rustymoonshiner.github.io/trening-web/**

W tym repozytorium jest tylko kod aplikacji – żadnych danych. Jedzenie zostaje w telefonie i w programie
na komputerze. Wersja na Androida powstaje z tego samego kodu w osobnym repozytorium.

## Pierwsze ustawienie (raz)

1. Program Trening (wersja 4.1+) na komputerze: **Ustawienia → 📱 Telefon przez Wi-Fi…** → zaznacz odbiór.
   Okienko pokaże adres dla iPhone'a, np. `192.168.1.20:8766`.
2. Na iPhonie w **Safari** otwórz `http://192.168.1.20:8765/iphone` (adres z programu) i zrób kroki ze strony:
   pobierz certyfikat → zainstaluj profil → włącz zaufanie → test połączenia.
3. Otwórz **https://rustymoonshiner.github.io/trening-web/** → **Udostępnij → Do ekranu początkowego**.
4. W aplikacji ⚙ → adres `192.168.1.20:8766` i PIN z programu („🔑 Sparuj telefon”).

Certyfikat programu działa wyłącznie dla adresów sieci domowej – nie da się nim podrobić żadnej strony
w internecie.
