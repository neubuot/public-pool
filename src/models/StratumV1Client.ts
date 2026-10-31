import { ConfigService } from '@nestjs/config';
import * as bitcoinjs from 'bitcoinjs-lib';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError, ValidatorOptions } from 'class-validator';
import * as crypto from 'crypto';
import { Socket } from 'net';
import { firstValueFrom, skip, Subscription } from 'rxjs';
import { clearInterval } from 'timers';

import { AddressSettingsService } from '../ORM/address-settings/address-settings.service';
import { BlocksService } from '../ORM/blocks/blocks.service';
import { ClientStatisticsService } from '../ORM/client-statistics/client-statistics.service';
import { ClientEntity } from '../ORM/client/client.entity';
import { ClientService } from '../ORM/client/client.service';
import { BitcoinRpcService } from '../services/bitcoin-rpc.service';
import { NotificationService } from '../services/notification.service';
import { IJobTemplate, StratumV1JobsService } from '../services/stratum-v1-jobs.service';
import { eRequestMethod } from './enums/eRequestMethod';
import { eResponseMethod } from './enums/eResponseMethod';
import { eStratumErrorCode } from './enums/eStratumErrorCode';
import { MiningJob } from './MiningJob';
import { AuthorizationMessage } from './stratum-messages/AuthorizationMessage';
import { ConfigurationMessage } from './stratum-messages/ConfigurationMessage';
import { MiningSubmitMessage } from './stratum-messages/MiningSubmitMessage';
import { StratumErrorMessage } from './stratum-messages/StratumErrorMessage';
import { SubscriptionMessage } from './stratum-messages/SubscriptionMessage';
import { EXTRANONCE1_SIZE_BYTES } from './stratum.constants';
import { SuggestDifficulty } from './stratum-messages/SuggestDifficultyMessage';
import { StratumV1ClientStatistics } from './StratumV1ClientStatistics';
import { ExternalSharesService } from '../services/external-shares.service';
import { DoichainRpcService } from '../services/doichain-rpc.service';
import { PoolEventsService } from '../services/pool-events.service';
import { TopSharesService } from '../ORM/top-shares/top-shares.service';
import { hashMeetsTarget } from './auxpow';

const TRUE_DIFF_ONE = 2.695953529101131e67;
const BLOCKED_USER_AGENT_LOG_INTERVAL_MS = 60 * 1000;
const VALIDATION_ERROR_LOG_INTERVAL_MS = 60 * 1000;

export class StratumV1Client {
    private static blockedUserAgentLogState = new Map<string, { nextLogAt: number, suppressed: number }>();
    private static validationErrorLogState = new Map<string, { nextLogAt: number, suppressed: number, sample: string }>();

    private clientSubscription: SubscriptionMessage;
    private clientConfiguration: ConfigurationMessage;
    private clientAuthorization: AuthorizationMessage;
    private clientSuggestedDifficulty: SuggestDifficulty;
    private stratumSubscription: Subscription;
    private doiSubscription: Subscription;
    /** Doichain payout address for merged mining, null when this client mines Bitcoin only */
    private doiAddress: string = null;
    private backgroundWork: NodeJS.Timeout[] = [];

    private statistics: StratumV1ClientStatistics;
    private stratumInitialized = false;
    private usedSuggestedDifficulty = false;
    private sessionDifficulty: number = 100000;

    private entity: ClientEntity;
    private creatingEntity: Promise<void>;

    public extraNonceAndSessionId: string;
    public sessionStart: Date;
    public noFee: boolean;
    public hashRate: number = 0;

    private buffer: string = '';
    private connectionClosed = false;
    private lastSentMiningJobTimestamp: number = null;
    /** unix time in milliseconds of the last accepted share */
    private lastShareAt: number | null = null;

    private miningSubmissionHashes = new Set<string>()

    constructor(
        public readonly socket: Socket,
        private readonly stratumV1JobsService: StratumV1JobsService,
        private readonly bitcoinRpcService: BitcoinRpcService,
        private readonly clientService: ClientService,
        private readonly clientStatisticsService: ClientStatisticsService,
        private readonly notificationService: NotificationService,
        private readonly blocksService: BlocksService,
        private readonly configService: ConfigService,
        private readonly addressSettingsService: AddressSettingsService,
        private readonly externalSharesService: ExternalSharesService,
        private readonly doichainRpcService?: DoichainRpcService,
        private readonly poolEventsService?: PoolEventsService,
        private readonly topSharesService?: TopSharesService
    ) {

        this.socket.on('data', (data: Buffer) => {
            this.buffer += data.toString();
            let lines = this.buffer.split('\n');
            this.buffer = lines.pop() || ''; // Save the last part of the data (incomplete line) to the buffer

            (async () => {
                for (const m of lines.filter(l => l.length > 0)) {
                    if (this.connectionClosed || this.socket.destroyed || this.socket.writableEnded) {
                        break;
                    }
                    try {
                        await this.handleMessage(m);
                    } catch (e) {
                        await this.socket.end();
                        console.error(e);
                    }
                }
            })();
        });


    }

    public async destroy() {

        if (this.extraNonceAndSessionId) {
            if (this.clientAuthorization != null) {
                this.poolEventsService?.emit({
                    type: 'disconnect',
                    address: this.clientAuthorization.address,
                    worker: this.clientAuthorization.worker,
                    session: this.extraNonceAndSessionId
                });
            }
            await this.clientService.delete(this.extraNonceAndSessionId);
        }

        if (this.stratumSubscription != null) {
            this.stratumSubscription.unsubscribe();
        }

        if (this.doiSubscription != null) {
            this.doiSubscription.unsubscribe();
        }

        this.backgroundWork.forEach(work => {
            clearInterval(work);
        });
    }

    private getRandomHexString() {
        const randomBytes = crypto.randomBytes(EXTRANONCE1_SIZE_BYTES);
        return randomBytes.toString('hex');
    }


    private async handleMessage(message: string) {
        //console.log(`Received from ${this.extraNonceAndSessionId}`, message);

        // Parse the message and check if it's the initial subscription message
        let parsedMessage = null;
        try {
            parsedMessage = JSON.parse(message);
        } catch (e) {
            //console.log("Invalid JSON");
            await this.socket.end();
            return;
        }



        switch (parsedMessage.method) {
            case eRequestMethod.SUBSCRIBE: {
                const subscriptionMessage = plainToInstance(
                    SubscriptionMessage,
                    parsedMessage,
                );

                const validatorOptions: ValidatorOptions = {
                    whitelist: true,
                    //forbidNonWhitelisted: true,
                };

                const errors = await validate(subscriptionMessage, validatorOptions);

                if (errors.length === 0) {
                    if (this.isBlockedUserAgent(subscriptionMessage.userAgent)) {
                        this.logBlockedUserAgent(subscriptionMessage.userAgent);
                        this.closeSocket();
                        return;
                    }

                    if (this.sessionStart == null) {
                        this.sessionStart = new Date();
                        this.statistics = new StratumV1ClientStatistics(this.clientStatisticsService);
                        this.extraNonceAndSessionId = this.getRandomHexString();
                        console.log(`New client ID: : ${this.extraNonceAndSessionId}, ${this.socket.remoteAddress}:${this.socket.remotePort}`);
                    }

                    this.clientSubscription = subscriptionMessage;
                    const success = await this.write(JSON.stringify(this.clientSubscription.response(this.extraNonceAndSessionId)) + '\n');
                    if (!success) {
                        return;
                    }
                } else {
                    console.error('Subscription validation error');
                    const err = new StratumErrorMessage(
                        subscriptionMessage.id,
                        eStratumErrorCode.OtherUnknown,
                        'Subscription validation error',
                        errors).response();
                    console.error(err);
                    const success = await this.write(err);
                    if (!success) {
                        return;
                    }
                }

                break;
            }
            case eRequestMethod.CONFIGURE: {

                const configurationMessage = plainToInstance(
                    ConfigurationMessage,
                    parsedMessage,
                );

                const validatorOptions: ValidatorOptions = {
                    whitelist: true,
                    //forbidNonWhitelisted: true,
                };

                const errors = await validate(configurationMessage, validatorOptions);

                if (errors.length === 0) {
                    this.clientConfiguration = configurationMessage;
                    //const response = this.buildSubscriptionResponse(configurationMessage.id);
                    const success = await this.write(JSON.stringify(this.clientConfiguration.response()) + '\n');
                    if (!success) {
                        return;
                    }

                } else {
                    console.error('Configuration validation error');
                    const err = new StratumErrorMessage(
                        configurationMessage.id,
                        eStratumErrorCode.OtherUnknown,
                        'Configuration validation error',
                        errors).response();
                    console.error(err);
                    const success = await this.write(err);
                    if (!success) {
                        return;
                    }
                }

                break;
            }
            case eRequestMethod.AUTHORIZE: {

                const authorizationMessage = plainToInstance(
                    AuthorizationMessage,
                    parsedMessage,
                );

                const validatorOptions: ValidatorOptions = {
                    whitelist: true,
                    //forbidNonWhitelisted: true,
                };

                const errors = await validate(authorizationMessage, validatorOptions);

                if (errors.length === 0) {
                    this.clientAuthorization = authorizationMessage;
                    if (this.clientSuggestedDifficulty == null && this.clientAuthorization.startingDiff != null && this.clientAuthorization.startingDiff > this.sessionDifficulty) {
                        this.sessionDifficulty = this.clientAuthorization.startingDiff;
                    }
                    const success = await this.write(JSON.stringify(this.clientAuthorization.response()) + '\n');
                    if (!success) {
                        return;
                    }
                } else {
                    console.error('Authorization validation error');
                    const err = new StratumErrorMessage(
                        authorizationMessage.id,
                        eStratumErrorCode.OtherUnknown,
                        'Authorization validation error',
                        errors).response();
                    console.error(err);
                    const success = await this.write(err);
                    if (!success) {
                        return;
                    }
                }

                break;
            }
            case eRequestMethod.SUGGEST_DIFFICULTY: {
                if (this.usedSuggestedDifficulty == true) {
                    return;
                }

                const suggestDifficultyMessage = plainToInstance(
                    SuggestDifficulty,
                    parsedMessage
                );

                const validatorOptions: ValidatorOptions = {
                    whitelist: true,
                    //forbidNonWhitelisted: true,
                };

                const errors = await validate(suggestDifficultyMessage, validatorOptions);

                if (errors.length === 0) {

                    this.clientSuggestedDifficulty = suggestDifficultyMessage;
                    this.sessionDifficulty = suggestDifficultyMessage.suggestedDifficulty;
                    const success = await this.write(JSON.stringify(this.clientSuggestedDifficulty.response(this.sessionDifficulty)) + '\n');
                    if (!success) {
                        return;
                    }
                    this.usedSuggestedDifficulty = true;
                } else {
                    console.error('Suggest difficulty validation error');
                    const err = new StratumErrorMessage(
                        suggestDifficultyMessage.id,
                        eStratumErrorCode.OtherUnknown,
                        'Suggest difficulty validation error',
                        errors).response();
                    console.error(err);
                    const success = await this.write(err);
                    if (!success) {
                        return;
                    }
                }
                break;
            }
            case eRequestMethod.SUBMIT: {

                if (this.stratumInitialized == false) {
                    console.log('Submit before initalized');
                    await this.socket.end();
                    return;
                }


                const miningSubmitMessage = plainToInstance(
                    MiningSubmitMessage,
                    parsedMessage,
                );

                const validatorOptions: ValidatorOptions = {
                    whitelist: true,
                    //forbidNonWhitelisted: true,
                };

                const errors = await validate(miningSubmitMessage, validatorOptions);

                if (errors.length === 0 && this.stratumInitialized == true) {
                    const result = await this.handleMiningSubmission(miningSubmitMessage);
                    if (result == true) {
                        const success = await this.write(JSON.stringify(miningSubmitMessage.response()) + '\n');
                        if (!success) {
                            return;
                        }
                    }


                } else {
                    this.logValidationError('Mining Submit validation error', errors);
                    const err = new StratumErrorMessage(
                        miningSubmitMessage.id,
                        eStratumErrorCode.OtherUnknown,
                        'Mining Submit validation error',
                        errors).response();
                    const success = await this.write(err);
                    if (!success) {
                        return;
                    }
                    this.closeSocket();
                    return;
                }
                break;
            }
            // default: {
            //     console.log("Invalid message");
            //     console.log(parsedMessage);
            //     await this.socket.end();
            //     return;
            // }
        }


        if (this.clientSubscription != null
            && this.clientAuthorization != null
            && this.stratumInitialized == false) {

            await this.initStratum();

        }
    }

    private async initStratum() {
        this.stratumInitialized = true;

        if (this.isBlockedUserAgent(this.clientSubscription.userAgent)) {
            this.logBlockedUserAgent(this.clientSubscription.userAgent);
            this.closeSocket();
            return;
        }

        switch (this.clientSubscription.userAgent) {
            case 'cpuminer': {
                this.sessionDifficulty = 0.1;
            }
        }

        if (this.clientSuggestedDifficulty == null) {
            //console.log(`Setting difficulty to ${this.sessionDifficulty}`)
            const setDifficulty = JSON.stringify(new SuggestDifficulty().response(this.sessionDifficulty));
            const success = await this.write(setDifficulty + '\n');
            if (!success) {
                return;
            }
        }

        await this.resolveDoiAddress();
        this.poolEventsService?.emit({
            type: 'connect',
            address: this.clientAuthorization.address,
            worker: this.clientAuthorization.worker,
            session: this.extraNonceAndSessionId,
            data: {
                userAgent: this.clientSubscription?.userAgent ?? null,
                difficulty: this.sessionDifficulty,
                mergedMining: this.doiAddress != null,
                doiAddress: this.doiAddress
            }
        });
        // Register the client right away (not only with its first share) so the dashboard shows devices that
        // are connected and waiting, e.g. while Bitcoin Core still syncs and no jobs go out. Not awaited: the
        // insert is batched and must not delay the first job.
        void this.ensureClientEntity().catch(e => console.error('Could not register client', e));

        this.stratumSubscription =this.stratumV1JobsService.newMiningJob$.subscribe(async (jobTemplate) => {
            try {
                if(jobTemplate.blockData.clearJobs){
                    this.miningSubmissionHashes.clear();
                }
                await this.sendNewMiningJob(jobTemplate);
            } catch (e) {
                await this.socket.end();
                console.error(e);
            }
        });

        if (this.doiAddress != null) {
            // A new Doichain block invalidates the aux block in the coinbase: hand out a fresh job (not clean,
            // the Bitcoin work itself is still valid).
            this.doiSubscription = this.doichainRpcService.newBlock$.pipe(skip(1)).subscribe(async () => {
                try {
                    await this.refreshJobForNewAuxBlock();
                } catch (e) {
                    console.error('Could not refresh job after Doichain block', e);
                }
            });
        }

        this.backgroundWork.push(
            setInterval(async () => {
                await this.checkDifficulty();
                await this.idleHeartbeat();
            }, 60 * 1000)
        );

    }

    private async sendNewMiningJob(jobTemplate: IJobTemplate) {

        let payoutInformation;
        const devFeeAddress = this.configService.get('DEV_FEE_ADDRESS');
        //50Th/s
        this.noFee = false;
        if (this.entity) {
            this.hashRate = this.statistics.hashRate;
            this.noFee = this.hashRate != 0 && this.hashRate < 50000000000000;
        }
        if (this.noFee || devFeeAddress == null || devFeeAddress.length < 1) {
            payoutInformation = [
                { address: this.clientAuthorization.address, percent: 100 }
            ];

        } else {
            payoutInformation = [
                { address: devFeeAddress, percent: 1.5 },
                { address: this.clientAuthorization.address, percent: 98.5 }
            ];
        }

        const networkConfig = this.configService.get('NETWORK');
        let network;

        if (networkConfig === 'mainnet') {
            network = bitcoinjs.networks.bitcoin;
        } else if (networkConfig === 'testnet') {
            network = bitcoinjs.networks.testnet;
        } else if (networkConfig === 'regtest') {
            network = bitcoinjs.networks.regtest;
        } else {
            throw new Error('Invalid network configuration');
        }

        let auxBlock = null;
        if (this.doiAddress != null) {
            try {
                auxBlock = await this.doichainRpcService.getAuxBlock(this.doiAddress);
            } catch (e) {
                console.error(`createauxblock failed for ${this.doiAddress}, job without merged mining:`, e?.message ?? e);
            }
        }

        const job = new MiningJob(
            this.configService,
            network,
            this.stratumV1JobsService.getNextId(),
            payoutInformation,
            jobTemplate,
            auxBlock
        );

        this.stratumV1JobsService.addJob(job);


        const success = await this.write(job.response(jobTemplate));
        if (!success) {
            return;
        }
        this.lastSentMiningJobTimestamp = jobTemplate.block.timestamp;


        //console.log(`Sent new job to ${this.clientAuthorization.worker}.${this.extraNonceAndSessionId}. (clearJobs: ${jobTemplate.blockData.clearJobs}, fee?: ${!this.noFee})`)

    }


    private async ensureClientEntity() {
        if (this.entity != null) {
            return;
        }

        if (this.creatingEntity == null) {
            this.creatingEntity = (async () => {
                this.entity = await this.clientService.insert({
                    sessionId: this.extraNonceAndSessionId,
                    address: this.clientAuthorization.address,
                    clientName: this.clientAuthorization.worker,
                    userAgent: this.clientSubscription.userAgent,
                    startTime: new Date(),
                    bestDifficulty: 0,
                    doiAddress: this.doiAddress
                });
            })();
        }

        await this.creatingEntity;
    }

    private async handleMiningSubmission(submission: MiningSubmitMessage) {

        const job = this.stratumV1JobsService.getJobById(submission.jobId);

        // a miner may submit a job that doesn't exist anymore if it was removed by a new block notification (or expired, 5 min)
        if (job == null) {
            const err = new StratumErrorMessage(
                submission.id,
                eStratumErrorCode.JobNotFound,
                'Job not found').response();
            //console.log(err);
            const success = await this.write(err);
            if (!success) {
                return false;
            }
            return false;
        }
        const jobTemplate = this.stratumV1JobsService.getJobTemplateById(job.jobTemplateId);

        if (jobTemplate == null) {
            const err = new StratumErrorMessage(
                submission.id,
                eStratumErrorCode.JobNotFound,
                'Job Template not found').response();
            //console.log(err);
            const success = await this.write(err);
            if (!success) {
                return false;
            }
            return false;
        }

        const submissionHash = [
            submission.jobId,
            submission.extraNonce2,
            submission.ntime,
            submission.nonce,
            submission.versionMask ?? ''
        ].join(':');
        if (this.miningSubmissionHashes.has(submissionHash)) {
            const err = new StratumErrorMessage(
                submission.id,
                eStratumErrorCode.DuplicateShare,
                'Duplicate share').response();
            const success = await this.write(err);
            if (!success) {
                return false;
            }
            return false;
        } else {
            this.miningSubmissionHashes.add(submissionHash);
        }

        const versionMask = parseInt(submission.versionMask, 16);
        const nonce = parseInt(submission.nonce, 16);
        const timestamp = parseInt(submission.ntime, 16);

        const header = job.buildHeaderBuffer(
            jobTemplate,
            versionMask,
            nonce,
            this.extraNonceAndSessionId,
            submission.extraNonce2,
            timestamp
        );
        const { submissionDifficulty, submissionHashBuffer } = this.calculateDifficulty(header);

        //console.log(`DIFF: ${submissionDifficulty} of ${this.sessionDifficulty} from ${this.clientAuthorization.worker + '.' + this.extraNonceAndSessionId}`);


        if (submissionDifficulty >= this.sessionDifficulty) {
            const success = await this.write(JSON.stringify(submission.response()) + '\n');
            if (!success) {
                return false;
            }
            this.lastShareAt = Date.now();
            this.poolEventsService?.emit({
                type: 'share',
                address: this.clientAuthorization.address,
                worker: this.clientAuthorization.worker,
                session: this.extraNonceAndSessionId,
                data: { difficulty: this.sessionDifficulty, shareDifficulty: submissionDifficulty }
            });

            // Merged mining: the same header hash may satisfy the (much lower) Doichain target.
            if (job.auxBlock != null && hashMeetsTarget(submissionHashBuffer, job.auxTarget)) {
                await this.submitAuxPow(job, jobTemplate, versionMask, nonce, submission.extraNonce2, timestamp);
            }

            if (submissionDifficulty >= jobTemplate.blockData.networkDifficulty) {
                console.log('!!! BLOCK FOUND !!!');
                const updatedJobBlock = job.copyAndUpdateBlock(
                    jobTemplate,
                    versionMask,
                    nonce,
                    this.extraNonceAndSessionId,
                    submission.extraNonce2,
                    timestamp
                );
                const blockHex = updatedJobBlock.toHex(false);
                const result = await this.bitcoinRpcService.SUBMIT_BLOCK(blockHex);
                await this.blocksService.save({
                    chain: 'BTC',
                    height: jobTemplate.blockData.height,
                    blockHash: updatedJobBlock.getId(),
                    minerAddress: this.clientAuthorization.address,
                    worker: this.clientAuthorization.worker,
                    sessionId: this.extraNonceAndSessionId,
                    blockData: blockHex,
                    result: typeof result === 'string' ? result : JSON.stringify(result)
                });

                this.poolEventsService?.emit({
                    type: 'block',
                    chain: 'BTC',
                    address: this.clientAuthorization.address,
                    worker: this.clientAuthorization.worker,
                    session: this.extraNonceAndSessionId,
                    data: { height: jobTemplate.blockData.height, hash: updatedJobBlock.getId(), accepted: result == null || result === 'SUCCESS!' }
                });
                await this.notificationService.notifySubscribersBlockFound(this.clientAuthorization.address, jobTemplate.blockData.height, updatedJobBlock, result);
                //success
                if (result == null) {
                    await this.addressSettingsService.resetBestDifficultyAndShares();
                }
            }
            await this.ensureClientEntity();
            try {
                await this.statistics.addShares(this.entity, this.sessionDifficulty);
                const now = new Date();
                // only update every minute
                if (this.entity.updatedAt == null || now.getTime() - this.entity.updatedAt.getTime() > 1000 * 60) {
                    await this.clientService.heartbeat(this.entity.address, this.entity.clientName, this.entity.sessionId, this.hashRate, now);
                    this.entity.updatedAt = now;
                }

            } catch (e) {
                console.log(e);
            }

            if (submissionDifficulty > this.entity.bestDifficulty) {
                await this.clientService.updateBestDifficultyIfHigher(this.extraNonceAndSessionId, submissionDifficulty);
                this.entity.bestDifficulty = submissionDifficulty;
                // the address's best is only beaten when the atomic update changes a row: that is a record worth
                // telling (the previous best is looked up later from the top shares, no read before the update)
                const updated = await this.addressSettingsService.updateBestDifficultyIfHigher(this.clientAuthorization.address, submissionDifficulty, this.entity.userAgent);
                if ((updated?.affected ?? 0) > 0 && typeof this.notificationService?.shareRecord === 'function') {
                    this.notificationService.shareRecord({
                        address: this.clientAuthorization.address,
                        worker: this.clientAuthorization.worker,
                        userAgent: this.entity.userAgent ?? null,
                        difficulty: submissionDifficulty,
                        previous: 0,
                        time: Date.now()
                    });
                }
            }
            if (this.topSharesService != null) {
                try {
                    await this.topSharesService.maybeRecord({
                        address: this.clientAuthorization.address,
                        worker: this.clientAuthorization.worker,
                        sessionId: this.extraNonceAndSessionId,
                        userAgent: this.entity.userAgent ?? null,
                        difficulty: submissionDifficulty,
                        time: Date.now()
                    });
                } catch (e) {
                    console.error('Top share record failed', e?.message ?? e);
                }
            }


            const externalShareSubmissionEnabled: boolean = this.configService.get('EXTERNAL_SHARE_SUBMISSION_ENABLED')?.toLowerCase() == 'true';
            const minimumDifficulty: number = parseFloat(this.configService.get('MINIMUM_DIFFICULTY')) || 1000000000000.0; // 1T
            if (externalShareSubmissionEnabled && submissionDifficulty >= minimumDifficulty) {
                // Submit share to API if enabled
                this.externalSharesService.submitShare({
                    worker: this.clientAuthorization.worker,
                    address: this.clientAuthorization.address,
                    userAgent: this.clientSubscription.userAgent,
                    header: header.toString('hex'),
                    externalPoolName: this.configService.get('POOL_IDENTIFIER') || 'Public-Pool'
                });
            }

        } else {
            const err = new StratumErrorMessage(
                submission.id,
                eStratumErrorCode.LowDifficultyShare,
                'Difficulty too low').response();

            const success = await this.write(err);
            if (!success) {
                return false;
            }

            return false;
        }

        //await this.checkDifficulty();
        return false;

    }

    /**
     * Keeps a connected client visible while it sends no shares (no jobs while Bitcoin Core syncs, idle rig).
     * The hash rate counts as zero once no share arrived for ten minutes.
     */
    private async idleHeartbeat() {
        if (this.entity == null || this.connectionClosed) {
            return;
        }
        const now = new Date();
        if (this.entity.updatedAt != null && now.getTime() - this.entity.updatedAt.getTime() < 60 * 1000) {
            return;
        }
        const recentShare = this.lastShareAt != null && now.getTime() - this.lastShareAt < 10 * 60 * 1000;
        try {
            await this.clientService.heartbeat(this.entity.address, this.entity.clientName, this.entity.sessionId, recentShare ? this.hashRate : 0, now);
            this.entity.updatedAt = now;
        } catch (e) {
            console.error('Idle heartbeat failed', e);
        }
    }

    private async checkDifficulty() {
        // No job handed out yet (e.g. Bitcoin Core still syncing): nothing to measure. Without this guard the
        // difficulty would be lowered every minute for lack of shares and the first jobs would drown the pool.
        if (this.lastSentMiningJobTimestamp == null) {
            return;
        }
        const targetDiff = this.statistics.getSuggestedDifficulty(this.sessionDifficulty);
        if (targetDiff == null) {
            return;
        }

        if (targetDiff != this.sessionDifficulty) {
            //console.log(`Adjusting ${this.extraNonceAndSessionId} difficulty from ${this.sessionDifficulty} to ${targetDiff}`);
            const previousDifficulty = this.sessionDifficulty;
            this.sessionDifficulty = targetDiff;
            this.poolEventsService?.emit({
                type: 'vardiff',
                address: this.clientAuthorization?.address,
                worker: this.clientAuthorization?.worker,
                session: this.extraNonceAndSessionId,
                data: { from: previousDifficulty, to: targetDiff }
            });

            const data = JSON.stringify({
                id: null,
                method: eResponseMethod.SET_DIFFICULTY,
                params: [targetDiff]
            }) + '\n';


            await this.socket.write(data);

            const jobTemplate = await firstValueFrom(this.stratumV1JobsService.newMiningJob$);
            const nextTimestamp = Math.max(
                jobTemplate.block.timestamp,
                Math.floor(Date.now() / 1000),
                (this.lastSentMiningJobTimestamp ?? 0) + 1
            );
            // We need to clear jobs so the difficulty takes effect, but avoid mutating or
            // re-sending the shared cached template with byte-identical work.
            const refreshedJobTemplate: IJobTemplate = {
                ...jobTemplate,
                block: Object.assign(new bitcoinjs.Block(), jobTemplate.block, {
                    timestamp: nextTimestamp
                }),
                blockData: { ...jobTemplate.blockData, clearJobs: true }
            };
            await this.sendNewMiningJob(refreshedJobTemplate);

        }
    }

    /**
     * Picks the Doichain payout address for merged mining: the stratum password (bare address or doi=...),
     * else the pool wide DOICHAIN_DEFAULT_ADDRESS, else no merged mining for this client.
     */
    private async resolveDoiAddress() {
        this.doiAddress = null;
        if (this.doichainRpcService == null || !this.doichainRpcService.enabled) {
            return;
        }

        const candidate = this.clientAuthorization.doiAddress;
        if (candidate != null) {
            if (await this.doichainRpcService.validateAddress(candidate)) {
                this.doiAddress = candidate;
                console.log(`Client ${this.extraNonceAndSessionId} merge mines Doichain to ${candidate}`);
                return;
            }
            console.warn(`Client ${this.extraNonceAndSessionId}: password '${candidate}' is not a Doichain address, using the pool default`);
        }

        const fallback: string = this.configService.get('DOICHAIN_DEFAULT_ADDRESS');
        if (fallback != null && fallback.length > 0 && await this.doichainRpcService.validateAddress(fallback)) {
            this.doiAddress = fallback;
        }
    }

    /** Sends the current Bitcoin work again with a fresh aux block (after a new Doichain block). */
    private async refreshJobForNewAuxBlock() {
        if (this.connectionClosed || this.doiAddress == null) {
            return;
        }
        const jobTemplate = await firstValueFrom(this.stratumV1JobsService.newMiningJob$);
        const nextTimestamp = Math.max(
            jobTemplate.block.timestamp,
            Math.floor(Date.now() / 1000),
            (this.lastSentMiningJobTimestamp ?? 0) + 1
        );
        const refreshedJobTemplate: IJobTemplate = {
            ...jobTemplate,
            block: Object.assign(new bitcoinjs.Block(), jobTemplate.block, {
                timestamp: nextTimestamp
            }),
            blockData: { ...jobTemplate.blockData, clearJobs: false }
        };
        await this.sendNewMiningJob(refreshedJobTemplate);
    }

    private async submitAuxPow(job: MiningJob, jobTemplate: IJobTemplate, versionMask: number, nonce: number, extraNonce2: string, timestamp: number) {
        console.log(`!!! DOICHAIN BLOCK FOUND !!! height ${job.auxBlock.height}, aux block ${job.auxBlock.hash}, worker ${this.clientAuthorization.worker}.${this.extraNonceAndSessionId}`);
        try {
            const auxPowHex = job.buildAuxPowHex(jobTemplate, versionMask, nonce, this.extraNonceAndSessionId, extraNonce2, timestamp);
            const result = await this.doichainRpcService.submitAuxBlock(job.auxBlock.hash, auxPowHex);
            this.poolEventsService?.emit({
                type: 'block',
                chain: 'DOI',
                address: this.clientAuthorization.address,
                worker: this.clientAuthorization.worker,
                session: this.extraNonceAndSessionId,
                data: { height: job.auxBlock.height, hash: job.auxBlock.hash, accepted: result.accepted, message: result.message }
            });
            await this.blocksService.save({
                chain: 'DOI',
                height: job.auxBlock.height,
                blockHash: job.auxBlock.hash,
                minerAddress: this.clientAuthorization.address,
                worker: this.clientAuthorization.worker,
                sessionId: this.extraNonceAndSessionId,
                blockData: auxPowHex,
                result: result.message
            });
            if (!result.accepted) {
                console.error(`Doichain rejected the AuxPoW for aux block ${job.auxBlock.hash}: ${result.message}`);
            }
            await this.notificationService.notifyDoichainBlockFound(
                this.clientAuthorization.address, this.clientAuthorization.worker, job.auxBlock.height, job.auxBlock.hash, result.accepted, result.message);
        } catch (e) {
            console.error('AuxPoW submission failed', e);
        } finally {
            // whatever happened, the next job needs a fresh aux block
            this.doichainRpcService.invalidateAuxBlock(this.doiAddress);
        }
    }

    private calculateDifficulty(header: Buffer): { submissionDifficulty: number, submissionHash: string, submissionHashBuffer: Buffer } {

        const hashResult = bitcoinjs.crypto.hash256(header);

        const target = this.le256todouble(hashResult);
        const submissionDifficulty = target === 0 ? Number.POSITIVE_INFINITY : TRUE_DIFF_ONE / target;
        return { submissionDifficulty, submissionHash: hashResult.toString('hex'), submissionHashBuffer: hashResult };
    }


    private le256todouble(target: Buffer): number {

        let number = 0;
        for (let i = target.length - 1; i >= 0; i--) {
            number = number * 256 + target[i];
        }

        return number;
    }

    private isBlockedUserAgent(userAgent: string): boolean {
        const blockedUserAgents = this.configService.get<string>('NON_COMPLIANT_USER_AGENTS')
            || this.configService.get<string>('BLOCKED_USER_AGENTS')
            || this.configService.get<string>('COMPLIANT_HEADERS');
        if (!blockedUserAgents || blockedUserAgents.trim() === '') {
            return false;
        }

        const blockedList = blockedUserAgents.split(',').map(ua => ua.trim().toLowerCase());
        const userAgentLower = userAgent.toLowerCase();

        return blockedList.some(blocked => blocked.length > 0 && userAgentLower.includes(blocked));
    }

    private logBlockedUserAgent(userAgent: string) {
        const now = Date.now();
        const logState = StratumV1Client.blockedUserAgentLogState.get(userAgent);

        if (logState != null && now < logState.nextLogAt) {
            logState.suppressed += 1;
            return;
        }

        const suppressed = logState?.suppressed ?? 0;
        const suffix = suppressed > 0 ? ` (${suppressed} similar connections suppressed)` : '';
        console.log(`Blocked non-compliant connection from userAgent: ${userAgent}${suffix}`);
        StratumV1Client.blockedUserAgentLogState.set(userAgent, {
            nextLogAt: now + BLOCKED_USER_AGENT_LOG_INTERVAL_MS,
            suppressed: 0
        });
    }

    private logValidationError(label: string, errors: ValidationError[]) {
        const now = Date.now();
        const signature = this.getValidationErrorSignature(errors);
        const sample = this.getValidationErrorSample(errors);
        const key = `${label}:${signature}`;
        const logState = StratumV1Client.validationErrorLogState.get(key);

        if (logState != null && now < logState.nextLogAt) {
            logState.suppressed += 1;
            return;
        }

        const suppressed = logState?.suppressed ?? 0;
        const suffix = suppressed > 0 ? ` (${suppressed} similar validation errors suppressed)` : '';
        console.warn(`${label}: ${signature}${sample}${suffix}`);
        StratumV1Client.validationErrorLogState.set(key, {
            nextLogAt: now + VALIDATION_ERROR_LOG_INTERVAL_MS,
            suppressed: 0,
            sample
        });
    }

    private getValidationErrorSignature(errors: ValidationError[]): string {
        if (errors.length === 0) {
            return 'unknown';
        }

        return errors.map(error => {
            const constraints = Object.keys(error.constraints ?? {}).sort().join('|') || 'invalid';
            return `${error.property}:${constraints}`;
        }).join(';');
    }

    private getValidationErrorSample(errors: ValidationError[]): string {
        const values = errors
            .map(error => error.value)
            .filter(value => value != null)
            .map(value => String(value).replace(/[\r\n]/g, '').slice(0, 64));

        if (values.length === 0) {
            return '';
        }

        return ` sample=${values.join(',')}`;
    }

    private closeSocket() {
        this.connectionClosed = true;
        if (!this.socket.destroyed) {
            this.socket.destroy();
        }
    }

    private async write(message: string): Promise<boolean> {
        try {
            if (!this.socket.destroyed && !this.socket.writableEnded) {

                await new Promise((resolve, reject) => {
                    this.socket.write(message, (error) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(true);
                        }
                    });
                });

                return true;
            } else {
                console.error(`Error: Cannot write to closed or ended socket. ${this.extraNonceAndSessionId} ${message}`);
                this.destroy();
                if (!this.socket.destroyed) {
                    this.socket.destroy();
                }
                return false;
            }
        } catch (error) {
            this.destroy();
            if (!this.socket.writableEnded) {
                await this.socket.end();
            } else if (!this.socket.destroyed) {
                this.socket.destroy();
            }
            console.error(`Error occurred while writing to socket: ${this.extraNonceAndSessionId}`, error);
            return false;
        }
    }

}
