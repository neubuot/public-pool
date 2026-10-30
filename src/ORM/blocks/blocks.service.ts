import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { BlocksEntity } from './blocks.entity';


@Injectable()
export class BlocksService {

    constructor(

        private dataSource: DataSource,
        @InjectRepository(BlocksEntity)
        private blocksRepository: Repository<BlocksEntity>,
    ) {

    }


    public async save(block: Partial<BlocksEntity>) {
        await this.blocksRepository.save(block);
    }

    public async getFoundBlocks() {
        return await this.blocksRepository.find({
            select: {
                height: true,
                minerAddress: true,
                worker: true,
                sessionId: true,
                chain: true,
                blockHash: true,
                result: true,
                createdAt: true
            }
        });
    }

    public async getFoundBlocksByAddress(address: string) {
        return await this.blocksRepository.find({
            select: {
                height: true,
                minerAddress: true,
                worker: true,
                sessionId: true,
                chain: true,
                blockHash: true,
                result: true
            },
            where: {
                minerAddress: address
            }
        });
    }

    public async findBlock(chain: string, height: number) {
        return await this.blocksRepository.findOne({ where: { chain, height }, order: { id: 'DESC' } });
    }

    /** Blocks the node accepted (result empty, SUCCESS! or accepted) for one chain. */
    public async countAccepted(chain: string): Promise<number> {
        return await this.blocksRepository.createQueryBuilder('block')
            .where('block.chain = :chain', { chain })
            .andWhere("(block.result IS NULL OR LOWER(block.result) IN ('success!', 'accepted', 'null'))")
            .getCount();
    }

    /** Newest blocks first, with the time they were found (for the dashboard and the explorer). */
    public async getRecentBlocks(limit: number) {
        return await this.blocksRepository.find({
            select: {
                id: true,
                height: true,
                minerAddress: true,
                worker: true,
                sessionId: true,
                chain: true,
                blockHash: true,
                result: true,
                createdAt: true
            },
            order: { id: 'DESC' },
            take: limit
        });
    }

    public async getRecentBlocksByAddress(address: string, limit: number) {
        return await this.blocksRepository.find({
            select: {
                id: true,
                height: true,
                minerAddress: true,
                worker: true,
                sessionId: true,
                chain: true,
                blockHash: true,
                result: true,
                createdAt: true
            },
            where: { minerAddress: address },
            order: { id: 'DESC' },
            take: limit
        });
    }
}