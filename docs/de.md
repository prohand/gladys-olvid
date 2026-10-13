# Olvid für Gladys Assistant

Diese Integration fügt [Olvid](https://olvid.io) als Chat-Kanal in Gladys
hinzu, genau wie die Telegram-Integration: Stelle deinem Zuhause eine Frage
aus Olvid, Gladys antwortet in der Unterhaltung, und deine Szenen können dir
über denselben Kanal Benachrichtigungen senden — Ende-zu-Ende-verschlüsselt,
ohne Firmenverzeichnis, mit einem **persönlichen Olvid-Profil („particulier“)**.

## So funktioniert es

Olvid bietet keine Bot-API in der Cloud: Es gibt kein Gegenstück zu Telegrams
BotFather. Ein Olvid-Bot besteht aus zwei Hälften:

- dem **Olvid-Daemon** (`olvid/bot-daemon`): ein vollständiger Olvid-Client,
  der die kryptografische Engine enthält, dein Profil verwaltet und eine
  gRPC-API bereitstellt;
- dem **Bot**: dieser Integration. Sie steuert den Daemon, leitet die
  Nachrichten an Gladys weiter und sendet die Antworten zurück.

**Gladys betreibt den Daemon für dich**: Er ist im Manifest der Integration
deklariert, daher startet ihn der Gladys-Supervisor in einem eigenen Container,
im privaten Netzwerk der Integration. Keine `docker-compose`-Datei zu
schreiben, keine Befehlszeile einzutippen, kein Schlüssel herumzukopieren.

Kein zusätzlicher Drittanbieterdienst sieht deine Nachrichten: Der Daemon ist
ein Olvid-Client, genau wie dein Telefon, und seine gRPC-API wird auf keinem
Port veröffentlicht — nur die Integration kann mit ihm sprechen.

## 1. Die Integration installieren

Installiere die Olvid-Integration aus dem Gladys-Store. Der
Installationsbildschirm zeigt dir, was sie außer sich selbst ausführt
(`olvid/bot-daemon`, sein Speicherlimit und die Tatsache, dass kein Port
veröffentlicht wird): Das ist der Vertrag, den du akzeptierst.

Beim ersten Start, ohne dass etwas auszufüllen ist, erledigt die Integration
Folgendes:

1. Sie erzeugt den Admin-Schlüssel des Daemons (du siehst und tippst ihn nie)
   und startet den Container des Daemons;
2. sie erstellt ein persönliches Olvid-Profil, da der Daemon leer ist;
3. sie erstellt ihren eigenen Client-Schlüssel, beschränkt auf dieses Profil
   (der Admin-Schlüssel dient nur dazu);
4. sie aktiviert die automatische Annahme eingehender Einladungen;
5. sie legt eine Aufbewahrungsrichtlinie fest: Der Daemon löscht Nachrichten,
   die älter als 30 Tage sind (Feld **Aufbewahrung der Nachrichten**, 0 behält
   alles).

Der Start des Daemons dauert beim ersten Mal einige zehn Sekunden (einschließlich
Download des Images): Der Status der Integration wechselt von selbst von
„Olvid-Daemon wird gestartet…“ zu verbunden. Klicke auf **Verbindung
testen**, um es zu prüfen: Gladys antwortet mit der Version des Daemons und dem
Namen des Profils.

Anschließend kannst du bei Bedarf Folgendes anpassen:

| Feld               | Wert                                                               |
| ------------------ | ------------------------------------------------------------------ |
| Vor- / Nachname    | der Name, der deinen Kontakten angezeigt wird („Gladys Assistant“) |
| Nummer des Profils | `0` (Gladys nimmt das erste Profil oder erstellt eines)            |

> Deine **Olvid-Identität** (Profil, Kontakte, Nachrichten) liegt im Volume des
> Daemon-Containers, das Gladys zusammen mit den Daten der Integration
> verwaltet. Die Deinstallation der Integration löscht dieses Profil: Deine
> Kontakte musst du dann erneut einladen. Denke daran, bevor du
> deinstallierst, und sichere deine Gladys-Daten wie gewohnt.

## 2. Gladys zu deinen Olvid-Kontakten hinzufügen

Das ist der übliche Olvid-Ablauf für Privatpersonen: eine Einladung, dann ein
4-stelliger Code, der zwischen den beiden Geräten ausgetauscht wird. Olvid
automatisiert diesen Schritt nie — er beweist, dass du wirklich mit deinem
eigenen Zuhause sprechen.

1. Klicke auf **Einladungslink anzeigen**: Gladys zeigt einen Link
   `https://invitation.olvid.io/…` an;
2. öffne diesen Link auf dem Telefon, auf dem Olvid installiert ist, und
   sende die Einladung;
3. Gladys nimmt sie automatisch an (wenn du diese Option deaktiviert hast,
   klicke auf **Ausstehende Einladungen annehmen**). Deine App zeigt dann
   einen 4-stelligen Code an und wartet auf einen anderen;
4. klicke in Gladys auf **Laufende Einladungen**: Dort wird der Code
   angezeigt, den du in Olvid eingeben musst. Übertrage ihn in die App;
5. gib den von Olvid angezeigten Code in die Aktion **Einladung
   bestätigen** von Gladys ein.

Sobald der Austausch abgeschlossen ist, erscheint „Gladys Assistant“ in deinen
Olvid-Kontakten.

## 3. Dein Olvid-Konto mit deinem Gladys-Benutzer verknüpfen

Kontakt zu sein genügt nicht: Gladys muss wissen, **welcher Benutzer** spricht,
denn eine eingehende Nachricht steuert das Zuhause mit den Rechten dieses
Benutzers.

1. Klicke in Gladys auf der Seite der Olvid-Integration auf **Mein Konto
   verknüpfen**: Ein kurzer Code wird angezeigt (15 Minuten gültig);
2. sende diesen Code in der Olvid-Unterhaltung an Gladys;
3. Gladys antwortet „Konto mit … verknüpft“. Fertig.

Solange ein Kontakt nicht verknüpft ist, leitet Gladys nichts an ihr Gehirn
weiter: Sie antwortet einfach mit den Anweisungen. Ein nicht verknüpfter Kontakt
hat **5 Nachrichten pro 15 Minuten**: Nach einer fünften Nachricht ohne gültigen
Code sagt Gladys es und ignoriert diese Unterhaltung dann (kein
Verknüpfungsversuch, keine Antwort), bis die 15 Minuten vorbei sind — wer den
Einladungslink besitzt, kann also keine Codes in einer Schleife ausprobieren.
Du kannst eine Verknüpfung jederzeit auf derselben Seite widerrufen.

## Verwendung

- Frage in natürlicher Sprache: „Wie warm ist es im Wohnzimmer?“, „Schalte
  das Licht im Büro ein“;
- Szenen, die eine Nachricht senden, können den Olvid-Kanal wählen;
- von Gladys gesendete Bilder (ein Kamera-Schnappschuss) kommen als Anhang an;
- lange Antworten werden auf mehrere Nachrichten aufgeteilt;
- alte Nachrichten werden vom Daemon nach der im Feld **Aufbewahrung der
  Nachrichten** festgelegten Dauer gelöscht (standardmäßig 30 Tage), aus
  Gründen des Datenschutzes und des Speicherplatzes.

**Gruppen**unterhaltungen werden bewusst ignoriert: Eine eingehende Nachricht
spricht mit der Autorität des verknüpften Benutzers, was nur unter vier Augen
sinnvoll ist.

## Einen eigenen Daemon verwenden (fortgeschritten)

Wenn du **bereits** einen Olvid-Daemon betreibst — weil du ihn für andere Bots
nutzt oder weil du seine Version und seine Sicherungen selbst kontrollieren
möchtest —, stelle das Feld **Olvid-Daemon** auf „Mein eigener Daemon“ um
und fülle dann Folgendes aus:

| Feld                   | Wert                                         |
| ---------------------- | -------------------------------------------- |
| URL des Olvid-Daemons  | `http://olvid-daemon:50051`                  |
| Admin-Client-Schlüssel | der Wert von `OLVID_ADMIN_CLIENT_KEY_GLADYS` |

Gladys stoppt dann den Daemon, den sie verwaltet hat, damit nie zwei
Olvid-Clients parallel laufen. Der Daemon muss vom Container der Integration
aus erreichbar sein: Teile ein Docker-Netzwerk (der Container ist dann
über seinen Namen erreichbar), oder veröffentliche Port 50051 und
verwende die IP-Adresse des Hosts.

Eine minimale `docker-compose.yml` für diesen Fall:

```yaml
services:
  olvid-daemon:
    image: olvid/bot-daemon:2.0.1
    container_name: olvid-daemon
    restart: unless-stopped
    environment:
      # A long random value (openssl rand -hex 32): this is the key you paste
      # into Gladys. It grants full control over the daemon.
      - OLVID_ADMIN_CLIENT_KEY_GLADYS=replace-me-with-a-random-value
    volumes:
      - ./daemon-data:/daemon/data
```

> In diesem Modus liegt die Olvid-Identität in deinem Ordner `./daemon-data`:
> Die Sicherung liegt in deiner Verantwortung.

## Fehlerbehebung

| Symptom                                                | Wahrscheinliche Ursache                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| „Olvid-Daemon wird gestartet…“ bleibt stehen           | Der Download des Images läuft noch oder ist fehlgeschlagen: Prüfe die Protokolle der Integration.                                                                                                                                                                                                                                                            |
| „Der Container des Olvid-Daemons wurde gestoppt“       | Der Daemon hat sich beim Start beendet: Seine eigenen Protokolle in Gladys nennen den Grund.                                                                                                                                                                                                                                                                 |
| „Olvid-Daemon nicht erreichbar“                        | Der Daemon ist noch nicht fertig gestartet (die Integration versucht es von selbst erneut). Mit deinem eigenen Daemon: URL oder Docker-Netzwerk.                                                                                                                                                                                                             |
| `unauthenticated` beim Verbindungstest                 | Mit deinem eigenen Daemon: Der Admin-Client-Schlüssel stimmt nicht mit dem des Daemon-Containers überein.                                                                                                                                                                                                                                                    |
| Die Einladung hängt fest                               | Der 4-stellige Code wurde nicht in beide Richtungen ausgetauscht (Aktionen „Laufende Einladungen“ und „Einladung bestätigen“).                                                                                                                                                                                                                               |
| „Dein Olvid-Konto ist noch nicht mit Gladys verknüpft“ | Der Verknüpfungscode wurde nie gesendet oder ist abgelaufen (15 Minuten).                                                                                                                                                                                                                                                                                    |
| Nach einem Neustart kommt nichts an                    | Offline empfangene Nachrichten werden beim Start erneut verarbeitet; prüfe die Protokolle der Integration.                                                                                                                                                                                                                                                   |
| Eine Szenen-Benachrichtigung ist nie angekommen        | Sie wurde gesendet, während der Daemon nicht lief, und hat länger als 5 Minuten gewartet, oder es haben sich mehr als 20 Nachrichten angestaut: Die Protokolle der Integration sagen es.                                                                                                                                                                     |
| Ab und zu „Verbindung zum Olvid-Daemon verloren“       | Der Daemon-Container wurde gestoppt — meistens, weil Gladys selbst neu gestartet wurde. Die Integration bemerkt es sofort, startet ihn bei Bedarf neu und verbindet sich innerhalb von Sekunden wieder; ein bereits laufender Daemon wird nie neu gestartet. Warum ein einzelner Stopp passiert ist, steht in den Protokollen des Containers `olvid-daemon`. |

Die Protokolle der Integration (`LOG_LEVEL=debug` für Details) zeigen jeden
Schritt: Bereitstellung des Profils, Einladungen, eingehende Nachrichten.
