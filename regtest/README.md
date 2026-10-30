# Phase 0: AuxPoW im Regtest

Ziel von Phase 0: Ein Stratum-Miner findet über den public-pool-Fork einen Doichain-Block im Regtest,
`submitauxblock` nimmt ihn an. Damit ist das AuxPoW-Modul (Aux-Tag im Coinbase, Beweis-Serialisierung,
Einreichung) nachgewiesen.

## Aufbau

| Teil | Wo | Was |
| --- | --- | --- |
| Bitcoin Core 29.5 (regtest) | Container `nerdpool-bitcoind`, RPC 127.0.0.1:18443, ZMQ 28332 | Parent-Kette, liefert `getblocktemplate` |
| Doichain Core 31.1.6 (regtest) | Container `nerdpool-doichaind`, RPC 127.0.0.1:18445, ZMQ 28334 | Aux-Kette, `createauxblock` und `submitauxblock` |
| Pool | dieses Repository (Fork von public-pool, läuft auf dem Host) | Stratum 3333, API 3334 |
| Test-Miner | `tools/testminer.js` | CPU-Miner für Shares niedriger Difficulty |

Im Regtest liegt das Ziel beider Ketten bei `7fff…` (Difficulty praktisch 0). Jeder akzeptierte Share ist
deshalb zugleich ein Bitcoin- und ein Doichain-Block, das macht den Test schnell und deterministisch.

## Ablauf

Voraussetzungen: Docker Desktop läuft, Node 22 oder neuer, `npm install` im Repository ist gelaufen.

Alles in einem Lauf (Nodes starten, Pool starten, Test-Miner laufen lassen, Doichain-Block prüfen):

```bash
bash regtest/e2e.sh
```

Oder Schritt für Schritt:

```bash
cd regtest
bash setup.sh
```

`setup.sh` startet beide Nodes (Docker, oder ohne Docker in WSL-Ubuntu mit den statischen Release-Binaries,
Prüfsummen geprüft; Auswahl über `REGTEST_BACKEND=docker|wsl`, Standard: automatisch), legt die Wallets
`pool` an, mint 101 Bitcoin- und 17 Doichain-Blöcke und schreibt die `.env` des Pools aus
`pool.env.template` (nur wenn noch keine `.env` existiert). Die Adressen stehen danach in
`regtest/generated.env`.

Warum 17 Doichain-Blöcke: Doichain Core 31.1.6 baut in `createauxblock` bei Höhen bis 16 einen
1-Byte-Coinbase-scriptSig (OP_1 bis OP_16 als Höhe) und lehnt den eigenen Block mit `bad-cb-length` ab.
Ab Höhe 17 ist der Höhen-Push 2 Byte lang. Mainnet und Testnet sind davon nicht betroffen.

Das statische Doichain-Binary ist ohne ZMQ gebaut; der Pool erkennt neue Doichain-Blöcke deshalb per
Polling (`DOICHAIN_POLL_INTERVAL_MS`).

Pool starten (eigenes Terminal, im Repository-Wurzelverzeichnis):

```bash
npm run start
```

Im Log muss `Doichain RPC connected (chain regtest, …)` und `Bitcoin RPC connected` erscheinen. Der
Stratum-Port öffnet erst zehn Sekunden nach dem Start.

Test-Miner starten (Adressen aus `generated.env`):

```bash
node tools/testminer.js --user <BTC_ADDRESS>.test --pass <DOI_ADDRESS> --shares 3
```

Erwartetes Ergebnis im Pool-Log je Share:

```
!!! DOICHAIN BLOCK FOUND !!! height 2, aux block …
DOICHAIN AUXPOW SUBMISSION RESPONSE: true
!!! BLOCK FOUND !!!
BLOCK SUBMISSION RESPONSE: SUCCESS!
```

Gegenprobe an der Doichain-Node:

```bash
docker exec nerdpool-doichaind doichain-cli -regtest -rpcuser=pool -rpcpassword=pool -rpcport=18445 getblockcount
docker exec nerdpool-doichaind doichain-cli -regtest -rpcuser=pool -rpcpassword=pool -rpcport=18445 getblock $(docker exec nerdpool-doichaind doichain-cli -regtest -rpcuser=pool -rpcpassword=pool -rpcport=18445 getbestblockhash)
```

Der Block trägt ein `auxpow`-Objekt, dessen Coinbase-Transaktion den Tag `fabe6d6d` plus Aux-Hash enthält,
und zahlt 12,5 DOI (Regtest-Subsidy kann abweichen) an die Adresse aus dem Stratum-Passwort.

Die gefundenen Blöcke beider Ketten stehen auch in der Pool-API: `http://127.0.0.1:3334/api/pool/blocks`
(Spalte `chain` = `BTC` oder `DOI`).

## Was das AuxPoW-Modul tut

1. `DoichainRpcService` holt per `createauxblock <DOI-Adresse>` einen vorbereiteten Doichain-Block je Adresse
   und hält ihn bis zum nächsten Doichain-Block oder 10 Sekunden im Cache.
2. `MiningJob` schreibt den 44-Byte-Tag `fabe6d6d | Aux-Hash | Größe 1 | Nonce 0` hinter die Pool-Kennung in
   das scriptSig des Bitcoin-Coinbase (bleibt unter 100 Byte).
3. `StratumV1Client` prüft jeden akzeptierten Share zusätzlich gegen das Doichain-Ziel aus `bits`. Trifft er,
   wird der Beweis (Coinbase mit Witness, Merkle-Zweig, 80-Byte-Header) serialisiert und per `submitauxblock`
   eingereicht. Der Fund landet mit `chain = DOI` in der Tabelle `blocks_entity`.
4. Die Doichain-Adresse kommt aus dem Stratum-Passwort (`dc1q…` oder `doi=dc1q…`, kombinierbar mit `d=…`),
   sonst aus `DOICHAIN_DEFAULT_ADDRESS`.

## Aufräumen

```bash
docker compose down -v
```
