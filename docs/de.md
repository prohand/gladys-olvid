# Olvid für Gladys Assistant

Diese Integration fügt [Olvid](https://olvid.io) als Chat-Kanal in Gladys
hinzu, genau wie die Telegram-Integration: Stellen Sie Ihrem Zuhause eine Frage
aus Olvid, Gladys antwortet in der Unterhaltung, und Ihre Szenen können Ihnen
über denselben Kanal Benachrichtigungen senden — Ende-zu-Ende-verschlüsselt,
ohne Firmenverzeichnis, mit einem **persönlichen Olvid-Profil („particulier“)**.

## So funktioniert es

Olvid bietet keine Bot-API in der Cloud: Es gibt kein Gegenstück zu Telegrams
BotFather. Ein Olvid-Bot besteht aus zwei Hälften:

- dem **Olvid-Daemon** (`olvid/bot-daemon`): ein vollständiger Olvid-Client,
  der die kryptografische Engine enthält, Ihr Profil verwaltet und eine
  gRPC-API bereitstellt;
- dem **Bot**: dieser Integration. Sie steuert den Daemon, leitet die
  Nachrichten an Gladys weiter und sendet die Antworten zurück.

**Gladys betreibt den Daemon für Sie**: Er ist im Manifest der Integration
deklariert, daher startet ihn der Gladys-Supervisor in einem eigenen Container,
im privaten Netzwerk der Integration. Keine `docker-compose`-Datei zu
schreiben, keine Befehlszeile einzutippen, kein Schlüssel herumzukopieren.

Kein zusätzlicher Drittanbieterdienst sieht Ihre Nachrichten: Der Daemon ist
ein Olvid-Client, genau wie Ihr Telefon, und seine gRPC-API wird auf keinem
Port veröffentlicht — nur die Integration kann mit ihm sprechen.

## 1. Die Integration installieren

Installieren Sie die Olvid-Integration aus dem Gladys-Store. Der
Installationsbildschirm zeigt Ihnen, was sie außer sich selbst ausführt
(`olvid/bot-daemon`, sein Speicherlimit und die Tatsache, dass kein Port
veröffentlicht wird): Das ist der Vertrag, den Sie akzeptieren.

Beim ersten Start, ohne dass etwas auszufüllen ist, erledigt die Integration
Folgendes:

1. Sie erzeugt den Admin-Schlüssel des Daemons (Sie sehen und tippen ihn nie)
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
„Olvid-Daemon wird gestartet…“ zu verbunden. Klicken Sie auf **Verbindung
testen**, um es zu prüfen: Gladys antwortet mit der Version des Daemons und dem
Namen des Profils.

Anschließend können Sie bei Bedarf Folgendes anpassen:

| Feld               | Wert                                                              |
| ------------------ | ----------------------------------------------------------------- |
| Vor- / Nachname    | der Name, der Ihren Kontakten angezeigt wird („Gladys Assistant“) |
| Nummer des Profils | `0` (Gladys nimmt das erste Profil oder erstellt eines)           |

> Ihre **Olvid-Identität** (Profil, Kontakte, Nachrichten) liegt im Volume des
> Daemon-Containers, das Gladys zusammen mit den Daten der Integration
> verwaltet. Die Deinstallation der Integration löscht dieses Profil: Ihre
> Kontakte müssen Sie dann erneut einladen. Denken Sie daran, bevor Sie
> deinstallieren, und sichern Sie Ihre Gladys-Daten wie gewohnt.

## 2. Gladys zu Ihren Olvid-Kontakten hinzufügen

Das ist der übliche Olvid-Ablauf für Privatpersonen: eine Einladung, dann ein
4-stelliger Code, der zwischen den beiden Geräten ausgetauscht wird. Olvid
automatisiert diesen Schritt nie — er beweist, dass Sie wirklich mit Ihrem
eigenen Zuhause sprechen.

1. Klicken Sie auf **Einladungslink anzeigen**: Gladys zeigt einen Link
   `https://invitation.olvid.io/…` an;
2. öffnen Sie diesen Link auf dem Telefon, auf dem Olvid installiert ist, und
   senden Sie die Einladung;
3. Gladys nimmt sie automatisch an (wenn Sie diese Option deaktiviert haben,
   klicken Sie auf **Ausstehende Einladungen annehmen**). Ihre App zeigt dann
   einen 4-stelligen Code an und wartet auf einen anderen;
4. klicken Sie in Gladys auf **Laufende Einladungen**: Dort wird der Code
   angezeigt, den Sie in Olvid eingeben müssen. Übertragen Sie ihn in die App;
5. geben Sie den von Olvid angezeigten Code in die Aktion **Einladung
   bestätigen** von Gladys ein.

Sobald der Austausch abgeschlossen ist, erscheint „Gladys Assistant“ in Ihren
Olvid-Kontakten.

## 3. Ihr Olvid-Konto mit Ihrem Gladys-Benutzer verknüpfen

Kontakt zu sein genügt nicht: Gladys muss wissen, **welcher Benutzer** spricht,
denn eine eingehende Nachricht steuert das Zuhause mit den Rechten dieses
Benutzers.

1. Klicken Sie in Gladys auf der Seite der Olvid-Integration auf **Mein Konto
   verknüpfen**: Ein kurzer Code wird angezeigt (15 Minuten gültig);
2. senden Sie diesen Code in der Olvid-Unterhaltung an Gladys;
3. Gladys antwortet „Konto mit … verknüpft“. Fertig.

Solange ein Kontakt nicht verknüpft ist, leitet Gladys nichts an ihr Gehirn
weiter: Sie antwortet einfach mit den Anweisungen. Ein nicht verknüpfter Kontakt
hat **5 Nachrichten pro 15 Minuten**: Nach einer fünften Nachricht ohne gültigen
Code sagt Gladys es und ignoriert diese Unterhaltung dann (kein
Verknüpfungsversuch, keine Antwort), bis die 15 Minuten vorbei sind — wer den
Einladungslink besitzt, kann also keine Codes in einer Schleife ausprobieren.
Sie können eine Verknüpfung jederzeit auf derselben Seite widerrufen.

## Verwendung

- Fragen Sie in natürlicher Sprache: „Wie warm ist es im Wohnzimmer?“, „Schalte
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

Wenn Sie **bereits** einen Olvid-Daemon betreiben — weil Sie ihn für andere Bots
nutzen oder weil Sie seine Version und seine Sicherungen selbst kontrollieren
möchten —, stellen Sie das Feld **Olvid-Daemon** auf „Mein eigener Daemon“ um
und füllen Sie dann Folgendes aus:

| Feld                   | Wert                                         |
| ---------------------- | -------------------------------------------- |
| URL des Olvid-Daemons  | `http://olvid-daemon:50051`                  |
| Admin-Client-Schlüssel | der Wert von `OLVID_ADMIN_CLIENT_KEY_GLADYS` |

Gladys stoppt dann den Daemon, den sie verwaltet hat, damit nie zwei
Olvid-Clients parallel laufen. Der Daemon muss vom Container der Integration
aus erreichbar sein: Teilen Sie ein Docker-Netzwerk (der Container ist dann
über seinen Namen erreichbar), oder veröffentlichen Sie Port 50051 und
verwenden Sie die IP-Adresse des Hosts.

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

> In diesem Modus liegt die Olvid-Identität in Ihrem Ordner `./daemon-data`:
> Die Sicherung liegt in Ihrer Verantwortung.

## Fehlerbehebung

| Symptom                                               | Wahrscheinliche Ursache                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| „Olvid-Daemon wird gestartet…“ bleibt stehen          | Der Download des Images läuft noch oder ist fehlgeschlagen: Prüfen Sie die Protokolle der Integration.                                                                                                                                                                                                                                                       |
| „Der Container des Olvid-Daemons wurde gestoppt“      | Der Daemon hat sich beim Start beendet: Seine eigenen Protokolle in Gladys nennen den Grund.                                                                                                                                                                                                                                                                 |
| „Olvid-Daemon nicht erreichbar“                       | Der Daemon ist noch nicht fertig gestartet (die Integration versucht es von selbst erneut). Mit Ihrem eigenen Daemon: URL oder Docker-Netzwerk.                                                                                                                                                                                                              |
| `unauthenticated` beim Verbindungstest                | Mit Ihrem eigenen Daemon: Der Admin-Client-Schlüssel stimmt nicht mit dem des Daemon-Containers überein.                                                                                                                                                                                                                                                     |
| Die Einladung hängt fest                              | Der 4-stellige Code wurde nicht in beide Richtungen ausgetauscht (Aktionen „Laufende Einladungen“ und „Einladung bestätigen“).                                                                                                                                                                                                                               |
| „Ihr Olvid-Konto ist noch nicht mit Gladys verknüpft“ | Der Verknüpfungscode wurde nie gesendet oder ist abgelaufen (15 Minuten).                                                                                                                                                                                                                                                                                    |
| Nach einem Neustart kommt nichts an                   | Offline empfangene Nachrichten werden beim Start erneut verarbeitet; prüfen Sie die Protokolle der Integration.                                                                                                                                                                                                                                              |
| Eine Szenen-Benachrichtigung ist nie angekommen       | Sie wurde gesendet, während der Daemon nicht lief, und hat länger als 5 Minuten gewartet, oder es haben sich mehr als 20 Nachrichten angestaut: Die Protokolle der Integration sagen es.                                                                                                                                                                     |
| Ab und zu „Verbindung zum Olvid-Daemon verloren“      | Der Daemon-Container wurde gestoppt — meistens, weil Gladys selbst neu gestartet wurde. Die Integration bemerkt es sofort, startet ihn bei Bedarf neu und verbindet sich innerhalb von Sekunden wieder; ein bereits laufender Daemon wird nie neu gestartet. Warum ein einzelner Stopp passiert ist, steht in den Protokollen des Containers `olvid-daemon`. |

Die Protokolle der Integration (`LOG_LEVEL=debug` für Details) zeigen jeden
Schritt: Bereitstellung des Profils, Einladungen, eingehende Nachrichten.
