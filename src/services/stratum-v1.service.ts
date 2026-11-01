import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'net';
import { monitorEventLoopDelay } from 'perf_hooks';
import { createServer as createTlsServer, Server as TlsServer } from 'tls';

import { StratumV1Client } from '../models/StratumV1Client';
import { AddressSettingsService } from '../ORM/address-settings/address-settings.service';
import { BlocksService } from '../ORM/blocks/blocks.service';
import { ClientStatisticsService } from '../ORM/client-statistics/client-statistics.service';
import { ClientService } from '../ORM/client/client.service';
import { domainOf, loadTlsMaterial, TlsMaterial, TlsSource } from '../utils/tls-certs';
import { BitcoinRpcService } from './bitcoin-rpc.service';
import { DoichainRpcService } from './doichain-rpc.service';
import { ExternalSharesService } from './external-shares.service';
import { NotificationService } from './notification.service';
import { PoolEventsService } from './pool-events.service';
import { TopSharesService } from '../ORM/top-shares/top-shares.service';
import { StratumV1JobsService } from './stratum-v1-jobs.service';

interface StratumListenerState {
    port: number;
    server: Server | null;
    paused: boolean;
    /** stratum+ssl: a TLS server with the pool's certificate in front of the same protocol */
    tls: boolean;
}

const DEFAULT_BACKPRESSURE_CHECK_INTERVAL_MS = 5000;
const DEFAULT_BACKPRESSURE_EVENT_LOOP_P95_MS = 2000;
const DEFAULT_BACKPRESSURE_EVENT_LOOP_RESUME_P95_MS = 250;
const DEFAULT_BACKPRESSURE_RSS_MB = 2500;
const DEFAULT_BACKPRESSURE_RESUME_RSS_MB = 2000;
const DEFAULT_BACKPRESSURE_HEALTHY_CHECKS = 3;
const DEFAULT_MAX_CONNECTIONS_PER_LISTENER = 10000;
const DEFAULT_TLS_CERT_DIR = '/certs/caddy/certificates';
/** how often the certificate files are read again (Caddy renews them in place) */
const TLS_REFRESH_MS = 10 * 60 * 1000;
const TLS_RETRY_MS = 60 * 1000;


@Injectable()
export class StratumV1Service implements OnModuleInit {

    private readonly listeners: StratumListenerState[] = [];
    private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
    private backpressureMonitor: NodeJS.Timeout | null = null;
    private healthyBackpressureChecks = 0;
    private tlsMaterial: TlsMaterial | null = null;
    private lastTlsClientErrorLog = 0;

    constructor(
        private readonly bitcoinRpcService: BitcoinRpcService,
        private readonly clientService: ClientService,
        private readonly clientStatisticsService: ClientStatisticsService,
        private readonly notificationService: NotificationService,
        private readonly blocksService: BlocksService,
        private readonly configService: ConfigService,
        private readonly stratumV1JobsService: StratumV1JobsService,
        private readonly addressSettingsService: AddressSettingsService,
        private readonly externalSharesService: ExternalSharesService,
        private readonly doichainRpcService?: DoichainRpcService,
        private readonly poolEventsService?: PoolEventsService,
        private readonly topSharesService?: TopSharesService
    ) {

    }

    async onModuleInit(): Promise<void> {

        // single process (no NODE_APP_INSTANCE) or the first cluster instance: no client can be connected yet, so
        // rows left from the previous run are gone, otherwise the dashboard counts ghosts for five minutes
        if (process.env.NODE_APP_INSTANCE == null || process.env.NODE_APP_INSTANCE == '0' || process.env.MASTER == 'true') {
            await this.clientService.deleteAll();
        }

        if (process.env.MASTER == 'true') {
            console.log('Master process skipping Stratum socket listeners');
            return;
        }

        setTimeout(() => {
            this.startSocketServer(this.getStratumPort());
            const tlsPort = this.getStratumTlsPort();
            if (tlsPort > 0) {
                this.startTlsServer(tlsPort);
            }
        }, 1000 * 10);

        this.startBackpressureMonitor();

    }

    private startSocketServer(port: number) {
        const listener: StratumListenerState = {
            port,
            server: null,
            paused: false,
            tls: false
        };
        this.listeners.push(listener);
        this.listen(listener);
    }

    /**
     * stratum+ssl on its own port with the certificate Caddy obtained for the dashboard (or explicit files).
     * Without a certificate yet (first start, Caddy still at Let's Encrypt) it tries again every minute; later
     * the files are read again every ten minutes and a renewed certificate is swapped in without a restart.
     */
    private startTlsServer(port: number) {
        const listener: StratumListenerState = { port, server: null, paused: false, tls: true };
        const source = this.tlsSource();
        const describe = source.certPath ? source.certPath : `${source.certDir}/*/${source.domain ?? '?'}`;
        const tryStart = () => {
            this.tlsMaterial = loadTlsMaterial(source);
            if (this.tlsMaterial == null) {
                console.warn(`Stratum TLS: no certificate at ${describe} yet, trying again in a minute`);
                setTimeout(tryStart, TLS_RETRY_MS).unref();
                return;
            }
            console.log(`Stratum TLS: certificate ${this.tlsMaterial.certPath} (${this.tlsMaterial.fingerprint.slice(0, 16)})`);
            this.listeners.push(listener);
            this.listen(listener);
            setInterval(() => this.refreshTlsMaterial(source, listener), TLS_REFRESH_MS).unref();
        };
        tryStart();
    }

    private refreshTlsMaterial(source: TlsSource, listener: StratumListenerState) {
        const fresh = loadTlsMaterial(source);
        if (fresh == null || this.tlsMaterial == null || fresh.fingerprint === this.tlsMaterial.fingerprint) {
            return;
        }
        this.tlsMaterial = fresh;
        const server = listener.server as TlsServer | null;
        if (server != null && typeof server.setSecureContext === 'function') {
            try {
                server.setSecureContext({ key: fresh.key, cert: fresh.cert });
                console.log(`Stratum TLS: certificate renewed (${fresh.fingerprint.slice(0, 16)})`);
            } catch (e) {
                console.error('Stratum TLS: renewed certificate rejected', e?.message ?? e);
            }
        }
    }

    private tlsSource(): TlsSource {
        const certPath = `${this.configService.get('STRATUM_TLS_CERT') ?? ''}`.trim() || null;
        const keyPath = `${this.configService.get('STRATUM_TLS_KEY') ?? ''}`.trim() || null;
        const certDir = `${this.configService.get('STRATUM_TLS_CERT_DIR') ?? ''}`.trim() || DEFAULT_TLS_CERT_DIR;
        const domain = `${this.configService.get('STRATUM_TLS_DOMAIN') ?? ''}`.trim() || domainOf(this.configService.get('POOL_PUBLIC_URL'));
        return { certPath, keyPath, certDir, domain };
    }

    private handleConnection(socket: Socket) {

        //5 min
        socket.setTimeout(1000 * 60 * 5);

        const client = new StratumV1Client(
            socket,
            this.stratumV1JobsService,
            this.bitcoinRpcService,
            this.clientService,
            this.clientStatisticsService,
            this.notificationService,
            this.blocksService,
            this.configService,
            this.addressSettingsService,
            this.externalSharesService,
            this.doichainRpcService,
            this.poolEventsService,
            this.topSharesService
        );


        socket.on('close', async (hadError: boolean) => {
            if (client.extraNonceAndSessionId != null) {
                // Handle socket disconnection
                await client.destroy();
                console.log(`Client ${client.extraNonceAndSessionId} disconnected, hadError?:${hadError}`);
            }
        });

        socket.on('timeout', () => {
            console.log('socket timeout');
            socket.end();
            socket.destroy();
        });

        socket.on('error', async (error: Error) => { });

        //   //console.log(`Client disconnected, socket error,  ${client.extraNonceAndSessionId}`);
    }

    private createSocketServer(tls: boolean): Server {
        let server: Server;
        if (tls) {
            if (this.tlsMaterial == null) {
                throw new Error('Stratum TLS: no certificate loaded');
            }
            const tlsServer = createTlsServer({ key: this.tlsMaterial.key, cert: this.tlsMaterial.cert, minVersion: 'TLSv1.2' }, (socket) => this.handleConnection(socket));
            // a failed handshake (port scanner, plain stratum on the TLS port) is not worth a log line each
            tlsServer.on('tlsClientError', (error) => {
                const now = Date.now();
                if (now - this.lastTlsClientErrorLog > 60_000) {
                    this.lastTlsClientErrorLog = now;
                    console.warn(`Stratum TLS handshake failed: ${error?.message ?? error}`);
                }
            });
            server = tlsServer;
        } else {
            server = new Server((socket: Socket) => this.handleConnection(socket));
        }

        server.on('error', (err) => {
            console.error(`Server error: ${err.message}`);
        });
        this.configureConnectionLimit(server);

        return server;
    }

    private listen(listener: StratumListenerState) {
        if (listener.server != null) {
            return;
        }

        const server = this.createSocketServer(listener.tls);
        listener.server = server;
        listener.paused = false;

        server.listen(listener.port, () => {
            console.log(`Stratum${listener.tls ? ' TLS' : ''} server is listening on port ${listener.port}`);
        });
    }

    private startBackpressureMonitor() {
        if (this.isBackpressureDisabled() || this.backpressureMonitor != null) {
            return;
        }

        this.eventLoopDelay.enable();
        this.backpressureMonitor = setInterval(() => {
            this.checkBackpressure();
        }, this.getBackpressureCheckIntervalMs());
    }

    private checkBackpressure() {
        const eventLoopP95Ms = this.getEventLoopP95Ms();
        const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
        const overloaded = eventLoopP95Ms >= this.getBackpressureEventLoopP95Ms()
            || rssMb >= this.getBackpressureRssMb();
        const paused = this.listeners.some(listener => listener.paused);

        if (overloaded) {
            this.healthyBackpressureChecks = 0;
            if (!paused) {
                this.pauseAccepting(eventLoopP95Ms, rssMb);
            }
            this.eventLoopDelay.reset();
            return;
        }

        if (!paused) {
            this.eventLoopDelay.reset();
            return;
        }

        const healthy = eventLoopP95Ms <= this.getBackpressureResumeEventLoopP95Ms()
            && rssMb <= this.getBackpressureResumeRssMb();
        if (!healthy) {
            this.healthyBackpressureChecks = 0;
            this.eventLoopDelay.reset();
            return;
        }

        this.healthyBackpressureChecks++;
        if (this.healthyBackpressureChecks >= this.getBackpressureHealthyChecks()) {
            this.resumeAccepting(eventLoopP95Ms, rssMb);
            this.healthyBackpressureChecks = 0;
        }

        this.eventLoopDelay.reset();
    }

    private pauseAccepting(eventLoopP95Ms: number, rssMb: number) {
        console.warn(`Pausing Stratum accepts: eventLoopP95Ms=${eventLoopP95Ms}, rssMb=${rssMb}`);
        for (const listener of this.listeners) {
            if (listener.paused || listener.server == null) {
                continue;
            }

            const server = listener.server;
            listener.server = null;
            listener.paused = true;
            server.close((error) => {
                if (error != null) {
                    console.error(`Error while pausing Stratum listener on port ${listener.port}: ${error.message}`);
                }
            });
        }
    }

    private resumeAccepting(eventLoopP95Ms: number, rssMb: number) {
        console.warn(`Resuming Stratum accepts: eventLoopP95Ms=${eventLoopP95Ms}, rssMb=${rssMb}`);
        for (const listener of this.listeners) {
            if (!listener.paused || listener.server != null) {
                continue;
            }

            this.listen(listener);
        }
    }

    private configureConnectionLimit(server: Server) {
        server.maxConnections = this.getMaxConnectionsPerListener();
        (server as Server & { dropMaxConnection: boolean }).dropMaxConnection = true;
    }

    private getEventLoopP95Ms() {
        return Math.round(this.eventLoopDelay.percentile(95) / 1e6);
    }

    private isBackpressureDisabled() {
        return process.env.STRATUM_BACKPRESSURE_ENABLED?.toLowerCase() === 'false';
    }

    private getBackpressureCheckIntervalMs() {
        return this.getPositiveIntegerEnv('STRATUM_BACKPRESSURE_CHECK_INTERVAL_MS', DEFAULT_BACKPRESSURE_CHECK_INTERVAL_MS);
    }

    private getBackpressureEventLoopP95Ms() {
        return this.getPositiveIntegerEnv('STRATUM_BACKPRESSURE_EVENT_LOOP_P95_MS', DEFAULT_BACKPRESSURE_EVENT_LOOP_P95_MS);
    }

    private getBackpressureResumeEventLoopP95Ms() {
        return this.getPositiveIntegerEnv('STRATUM_BACKPRESSURE_EVENT_LOOP_RESUME_P95_MS', DEFAULT_BACKPRESSURE_EVENT_LOOP_RESUME_P95_MS);
    }

    private getBackpressureRssMb() {
        return this.getPositiveIntegerEnv('STRATUM_BACKPRESSURE_RSS_MB', DEFAULT_BACKPRESSURE_RSS_MB);
    }

    private getBackpressureResumeRssMb() {
        return this.getPositiveIntegerEnv('STRATUM_BACKPRESSURE_RESUME_RSS_MB', DEFAULT_BACKPRESSURE_RESUME_RSS_MB);
    }

    private getBackpressureHealthyChecks() {
        return this.getPositiveIntegerEnv('STRATUM_BACKPRESSURE_HEALTHY_CHECKS', DEFAULT_BACKPRESSURE_HEALTHY_CHECKS);
    }

    private getMaxConnectionsPerListener() {
        return this.getPositiveIntegerEnv('STRATUM_MAX_CONNECTIONS_PER_LISTENER', DEFAULT_MAX_CONNECTIONS_PER_LISTENER);
    }

    private getStratumPort() {
        return this.getPositiveIntegerEnv('STRATUM_PORT', 3333);
    }

    /** STRATUM_TLS_PORT, 0 or unset switches stratum+ssl off */
    private getStratumTlsPort() {
        return this.getPositiveIntegerEnv('STRATUM_TLS_PORT', 0);
    }

    private getPositiveIntegerEnv(key: string, fallback: number) {
        const configured = parseInt(process.env[key], 10);
        if (Number.isFinite(configured) && configured > 0) {
            return configured;
        }
        return fallback;

    }

}
