import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Raw, Repository } from 'typeorm';
import { Community } from './community.entity';

@Injectable()
export class CommunitiesService {
  constructor(
    @InjectRepository(Community)
    private communitiesRepository: Repository<Community>,
  ) {}

  findAll(): Promise<Community[]> {
    return this.communitiesRepository.find({
      where: {
        visible: true,
      },
    });
  }

  findOne(id: number): Promise<Community> {
    return this.communitiesRepository.findOne(id, {
      relations: ['auctions'],
      where: { visible: true },
    });
  }

  findByAddress(address: string): Promise<Community> {
    return this.communitiesRepository.findOne({
      where: {
        contractAddress: address,
        visible: true,
      },
      relations: ['auctions'],
    });
  }

  findByName(name: string): Promise<Community> {
    return this.communitiesRepository.findOne({
      where: `"name" ILIKE '${name}'`, // case insensitive comparison
      relations: ['auctions'],
    });
  }

  async remove(id: number): Promise<void> {
    await this.communitiesRepository.delete(id);
  }

  async store(community: Community): Promise<Community> {
    return await this.communitiesRepository.save(community, { reload: true });
  }
}