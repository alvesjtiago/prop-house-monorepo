import { TimedAuction, Community } from '@nouns/prop-house-wrapper/dist/builders';
import { nameToSlug } from './communitySlugs';

/**
 * build url path to round (/:community-name/:round-name)
 */
export const buildRoundPath = (community: Community, round: TimedAuction) =>
  `/${nameToSlug(community.name)}/${nameToSlug(round.title)}`;
