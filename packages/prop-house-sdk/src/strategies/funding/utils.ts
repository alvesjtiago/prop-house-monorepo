import { getTimedFundingRoundInfo } from './timed-funding-round-strategy';
import { FundingHouseStrategy, FundingHouseStrategyType } from './types';
import { Award } from '../../houses';

/**
 * Get the validator and encoded config information for the provided house strategy
 * @param strategy The funding house strategy information
 * @param awards The funding round awards
 */
export const getHouseStrategyInfo = (strategy: FundingHouseStrategy, awards: Award[]) => {
  switch (strategy.strategyType) {
    case FundingHouseStrategyType.TIMED_FUNDING_ROUND:
      return getTimedFundingRoundInfo(strategy, awards);
    default:
      throw new Error(`Unknown house strategy type: ${strategy.strategyType}.`);
  }
};
