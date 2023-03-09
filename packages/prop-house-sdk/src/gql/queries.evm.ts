import { graphql } from './evm';

export const TimedFundingRoundConfigParts = graphql(`
  fragment TimedFundingRoundConfigParts on TimedFundingRoundConfig {
    winnerCount
    proposalPeriodStartTimestamp
    proposalPeriodDuration
    votePeriodStartTimestamp
    votePeriodDuration
    votingStrategies {
      id
      type
      address
      params
    }
    awards {
      asset {
        assetType
        token
        identifier
      }
      amount
    }
  }
`);

export const ManyHousesSimpleQuery = graphql(`
  query manyHousesSimple(
    $first: Int!
    $skip: Int!
    $orderBy: House_orderBy
    $orderDirection: OrderDirection
  ) {
    houses(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
      id
      name
      description
      imageURI
      createdAt
    }
  }
`);

export const ManyHousesSimpleWhereAccountHasCreatorPermissionsQuery = graphql(`
  query manyHousesSimpleWhereAccountHasCreatorPermissions(
    $creator: String!
    $first: Int!
    $skip: Int!
    $orderBy: Round_orderBy
    $orderDirection: OrderDirection
  ) {
    houses(where: { roundCreators_: { creator: $creator } }) {
      id
      name
      description
      imageURI
      createdAt
    }
  }
`);

export const ManyHousesSimpleWhereAccountIsOwnerQuery = graphql(`
  query manyHousesSimpleWhereAccountIsOwner(
    $owner: String!
    $first: Int!
    $skip: Int!
    $orderBy: Round_orderBy
    $orderDirection: OrderDirection
  ) {
    houses(where: { owner: $owner }) {
      id
      name
      description
      imageURI
      createdAt
    }
  }
`);

export const ManyRoundsSimpleQuery = graphql(`
  query manyRoundsSimple(
    $first: Int!
    $skip: Int!
    $orderBy: Round_orderBy
    $orderDirection: OrderDirection
  ) {
    rounds(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
      id
      type
      title
      description
      createdAt
      state
    }
  }
`);

export const ManyRoundsSimpleForHouseQuery = graphql(`
  query manyRoundsSimpleForHouse(
    $house: String!
    $first: Int!
    $skip: Int!
    $orderBy: Round_orderBy
    $orderDirection: OrderDirection
  ) {
    rounds(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: { house: $house }
    ) {
      id
      type
      title
      description
      createdAt
      state
    }
  }
`);

export const ManyRoundsSimpleWhereTitleContainsQuery = graphql(`
  query manyRoundsSimpleWhereTitleContains(
    $titleContains: String!
    $first: Int!
    $skip: Int!
    $orderBy: Round_orderBy
    $orderDirection: OrderDirection
  ) {
    rounds(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: { title_contains_nocase: $titleContains }
    ) {
      id
      type
      title
      description
      createdAt
      state
    }
  }
`);

export const RoundQuery = graphql(`
  query round($id: ID!) {
    round(id: $id) {
      id
      type
      title
      description
      createdAt
      state
      manager {
        id
      }
      timedFundingConfig {
        ...TimedFundingRoundConfigParts
      }
    }
  }
`);

export const ManyRoundBalancesQuery = graphql(`
  query manyRoundBalances(
    $round: String!
    $first: Int!
    $skip: Int!
    $orderBy: Balance_orderBy
    $orderDirection: OrderDirection
  ) {
    balances(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: { round: $round }
    ) {
      id
      asset {
        assetType
        token
        identifier
      }
      balance
      updatedAt
    }
  }
`);

export const ManyRoundsSimpleManagedByAccountQuery = graphql(`
  query manyRoundsSimpleManagedByAccount(
    $manager: String!
    $first: Int!
    $skip: Int!
    $orderBy: Round_orderBy
    $orderDirection: OrderDirection
  ) {
    rounds(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: { manager: $manager }
    ) {
      id
      type
      title
      description
      createdAt
      state
    }
  }
`);

export const ManyDepositsByAccountQuery = graphql(`
  query manyDepositsByAccount(
    $depositor: String!
    $first: Int!
    $skip: Int!
    $orderBy: Deposit_orderBy
    $orderDirection: OrderDirection
  ) {
    deposits(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: { depositor: $depositor }
    ) {
      id
      depositedAt
      asset {
        assetType
        token
        identifier
      }
      amount
      round {
        id
      }
    }
  }
`);

export const ManyClaimsByAccountQuery = graphql(`
  query manyClaimsByAccount(
    $claimer: String!
    $first: Int!
    $skip: Int!
    $orderBy: Claim_orderBy
    $orderDirection: OrderDirection
  ) {
    claims(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: { claimer: $claimer }
    ) {
      id
      claimedAt
      recipient
      proposalId
      round {
        id
      }
      asset {
        assetType
        token
        identifier
      }
      amount
    }
  }
`);
