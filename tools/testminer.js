#!/usr/bin/env node
/*
 * Minimaler Stratum-V1-CPU-Miner für Tests im Regtest. Kein echter Miner: er sucht mit Node-Crypto Nonces
 * für die vom Pool vorgeschlagene Share-Difficulty und reicht sie ein. Im Regtest reicht das, um Bitcoin-
 * und Doichain-Blöcke zu finden.
 *
 *   node tools/testminer.js --user <btc-adresse>.<worker> --pass <doi-adresse> [--host 127.0.0.1] [--port 3333]
 *                           [--diff 0.001] [--shares 3] [--timeout 300]
 */
const net = require('net');
const crypto = require('crypto');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
};

const host = opt('host', '127.0.0.1');
const port = parseInt(opt('port', '3333'), 10);
const user = opt('user', null);
const pass = opt('pass', 'x');
const suggestedDiff = parseFloat(opt('diff', '0.001'));
const wantedShares = parseInt(opt('shares', '3'), 10);
const timeoutSeconds = parseInt(opt('timeout', '300'), 10);

if (user == null) {
    console.error('Aufruf: node tools/testminer.js --user <btc-adresse>.<worker> --pass <doi-adresse> [--diff 0.001] [--shares 3]');
    process.exit(2);
}

const MAX_TARGET = BigInt('0xffff') << BigInt(208);

function sha256d(buffer) {
    return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buffer).digest()).digest();
}

function reverseWords(hex) {
    // Stratum liefert prevhash als 8 Wörter zu 4 Byte, jedes Wort umgedreht; zweimal umdrehen ergibt die Header-Bytes.
    const out = Buffer.alloc(32);
    const src = Buffer.from(hex, 'hex');
    for (let i = 0; i < 32; i += 4) {
        out[i] = src[i + 3];
        out[i + 1] = src[i + 2];
        out[i + 2] = src[i + 1];
        out[i + 3] = src[i];
    }
    return out;
}

function hashToBigIntLE(hash) {
    return BigInt('0x' + Buffer.from(hash).reverse().toString('hex'));
}

let extranonce1 = null;
let extranonce2Size = 4;
let shareDifficulty = suggestedDiff;
let shareTarget = MAX_TARGET / BigInt(Math.round(1 / suggestedDiff));
let currentJob = null;
let jobCounter = 0;
let sharesSubmitted = 0;
let sharesAccepted = 0;
let hashes = 0;
let nextId = 1;
const pending = new Map();
const startedAt = Date.now();

const socket = net.createConnection({ host, port }, () => {
    console.log(`verbunden mit ${host}:${port}`);
    send('mining.subscribe', ['nerdpool-testminer/0.1'], 'subscribe');
});

function send(method, params, tag) {
    const id = nextId++;
    pending.set(id, tag);
    socket.write(JSON.stringify({ id, method, params }) + '\n');
    return id;
}

function setDifficulty(diff) {
    shareDifficulty = diff;
    // Ziel = maxTarget / diff, mit Festkommaskalierung für Difficulties unter 1
    const scale = BigInt(1_000_000_000);
    shareTarget = (MAX_TARGET * scale) / BigInt(Math.round(diff * 1_000_000_000));
    console.log(`Share-Difficulty ${diff}`);
}

let buffer = '';
socket.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
        if (line.trim().length === 0) continue;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch (e) {
            console.error('kaputte Zeile', line);
            continue;
        }
        handle(msg);
    }
});

socket.on('error', (e) => {
    console.error('Socket-Fehler', e.message);
    process.exit(1);
});

socket.on('close', () => {
    console.log('Verbindung geschlossen');
    process.exit(sharesAccepted >= wantedShares ? 0 : 1);
});

function handle(msg) {
    if (msg.id != null && pending.has(msg.id)) {
        const tag = pending.get(msg.id);
        pending.delete(msg.id);
        if (tag === 'subscribe') {
            if (msg.error) {
                console.error('subscribe abgelehnt', msg.error);
                process.exit(1);
            }
            extranonce1 = msg.result[1];
            extranonce2Size = msg.result[2];
            console.log(`extranonce1 ${extranonce1}, extranonce2 ${extranonce2Size} Byte`);
            send('mining.suggest_difficulty', [suggestedDiff], 'suggest');
            send('mining.authorize', [user, pass], 'authorize');
        } else if (tag === 'authorize') {
            if (msg.error || msg.result !== true) {
                console.error('authorize abgelehnt', msg.error);
                process.exit(1);
            }
            console.log(`autorisiert als ${user}`);
        } else if (tag === 'submit') {
            if (msg.error) {
                console.log(`Share abgelehnt: ${JSON.stringify(msg.error)}`);
            } else {
                sharesAccepted++;
                console.log(`Share akzeptiert (${sharesAccepted}/${wantedShares})`);
                if (sharesAccepted >= wantedShares) {
                    console.log(`fertig: ${sharesAccepted} Shares akzeptiert, ${hashes} Hashes in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
                    socket.end();
                }
            }
        }
        return;
    }

    switch (msg.method) {
        case 'mining.set_difficulty':
            setDifficulty(Number(msg.params[0]));
            break;
        case 'mining.notify': {
            const [jobId, prevhash, coinb1, coinb2, merkleBranch, version, nbits, ntime, cleanJobs] = msg.params;
            currentJob = { jobId, prevhash, coinb1, coinb2, merkleBranch, version, nbits, ntime, cleanJobs, serial: ++jobCounter };
            console.log(`Job ${jobId} (clean ${cleanJobs}, ${merkleBranch.length} Merkle-Zweige, coinbase ${(coinb1.length + coinb2.length) / 2 + 4 + extranonce2Size} Byte)`);
            if (!mining) {
                mine();
            }
            break;
        }
        case 'mining.set_extranonce':
            extranonce1 = msg.params[0];
            extranonce2Size = msg.params[1];
            break;
        default:
            break;
    }
}

let mining = false;

async function mine() {
    mining = true;
    while (socket.writable && sharesAccepted < wantedShares) {
        if ((Date.now() - startedAt) / 1000 > timeoutSeconds) {
            console.error(`Zeitüberschreitung nach ${timeoutSeconds} s`);
            process.exit(1);
        }
        const job = currentJob;
        if (job == null) {
            await new Promise(r => setTimeout(r, 100));
            continue;
        }

        const extranonce2 = crypto.randomBytes(extranonce2Size).toString('hex');
        const coinbase = Buffer.from(job.coinb1 + extranonce1 + extranonce2 + job.coinb2, 'hex');
        let merkleRoot = sha256d(coinbase);
        for (const branch of job.merkleBranch) {
            merkleRoot = sha256d(Buffer.concat([merkleRoot, Buffer.from(branch, 'hex')]));
        }

        const header = Buffer.alloc(80);
        header.writeInt32LE(parseInt(job.version, 16), 0);
        reverseWords(job.prevhash).copy(header, 4);
        merkleRoot.copy(header, 36);
        header.writeUInt32LE(parseInt(job.ntime, 16), 68);
        header.writeUInt32LE(parseInt(job.nbits, 16), 72);

        let found = false;
        for (let nonce = 0; nonce < 0x7fffffff && !found; nonce++) {
            header.writeUInt32LE(nonce, 76);
            const hash = sha256d(header);
            hashes++;
            if (hash[31] === 0 && hash[30] === 0 && hashToBigIntLE(hash) <= shareTarget) {
                found = true;
                const nonceHex = nonce.toString(16).padStart(8, '0');
                sharesSubmitted++;
                console.log(`Share gefunden: Job ${job.jobId}, nonce ${nonceHex}, Hash ${Buffer.from(hash).reverse().toString('hex')}`);
                send('mining.submit', [user, job.jobId, extranonce2, job.ntime, nonceHex], 'submit');
                break;
            }
            // Job gewechselt (clean) oder Event-Loop atmen lassen
            if ((nonce & 0xffff) === 0) {
                await new Promise(r => setImmediate(r));
                if (currentJob !== job && currentJob.cleanJobs) {
                    break;
                }
            }
        }
        // kurze Pause, damit die Antwort des Pools verarbeitet wird
        await new Promise(r => setTimeout(r, 50));
    }
    mining = false;
}
