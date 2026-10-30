import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';

import { ExplorerService } from '../../services/explorer.service';

function limitOf(value: string | undefined, fallback: number, max: number): number {
    const parsed = parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return Math.min(parsed, max);
}

function heightOf(value: string | undefined): number | undefined {
    if (value == null || value.length === 0) {
        return undefined;
    }
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new BadRequestException('before muss eine Blockhöhe sein');
    }
    return parsed;
}

@Controller('explorer')
export class ExplorerController {

    constructor(private readonly explorerService: ExplorerService) { }

    @Get('search')
    public search(@Query('q') q: string) {
        return this.explorerService.search(q);
    }

    @Get('doi/blocks')
    public doiBlocks(@Query('limit') limit?: string, @Query('before') before?: string) {
        return this.explorerService.doiBlocks(limitOf(limit, 15, 50), heightOf(before));
    }

    @Get('doi/block/:id')
    public doiBlock(@Param('id') id: string) {
        return this.explorerService.doiBlock(id);
    }

    @Get('doi/tx/:txid')
    public doiTx(@Param('txid') txid: string) {
        return this.explorerService.doiTx(txid);
    }

    @Get('doi/address/:address')
    public doiAddress(@Param('address') address: string) {
        return this.explorerService.doiAddress(address);
    }

    @Get('btc/blocks')
    public btcBlocks(@Query('limit') limit?: string, @Query('before') before?: string) {
        return this.explorerService.btcBlocks(limitOf(limit, 15, 50), heightOf(before));
    }

    @Get('btc/block/:id')
    public btcBlock(@Param('id') id: string) {
        return this.explorerService.btcBlock(id);
    }

    @Get('btc/tx/:txid')
    public btcTx(@Param('txid') txid: string) {
        return this.explorerService.btcTx(txid);
    }

    @Get('btc/address/:address')
    public btcAddress(@Param('address') address: string) {
        return this.explorerService.btcAddress(address);
    }
}
