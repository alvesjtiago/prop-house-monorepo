import classes from './RoundsFeed.module.css';
import { RoundWithHouse, usePropHouse } from '@prophouse/sdk-react';
import React, { useEffect, useState } from 'react';
import { Col, Dropdown, Row } from 'react-bootstrap';
import JumboRoundCard from '../JumboRoundCard';
import Button, { ButtonColor } from '../Button';
import { useAccount } from 'wagmi';
import { getFavoriteCommunities } from '../../hooks/useFavoriteCommunities';
import { RoundsFilter, useRoundsFilter } from '../../hooks/useRoundsFilter';
import { GiSurprisedSkull } from 'react-icons/gi';
import { FaRegSurprise } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { isMobile } from 'web3modal';
import { fetchRoundsForFilter } from '../../utils/fetchRoundsForFilter';
import { COMPLETED_ROUND_OVERRIDES } from '../../utils/roundOverrides';
import { useFeaturedRounds } from '../../hooks/useFeaturedRounds';
import { JumboCardLoading } from '../LoadingCards';

const RoundsFeed: React.FC<{}> = () => {
  useAccount({
    onConnect({ isReconnected }) {
      if (!isReconnected) setFetchNewRounds(true);
    },
  });
  const propHouse = usePropHouse();
  const navigate = useNavigate();
  const favorites = getFavoriteCommunities();
  const { roundsFilter, updateRoundsFilter } = useRoundsFilter();
  const [rounds, setRounds] = useState<RoundWithHouse[] | undefined>();
  const [fetchingRounds, setFetchingRounds] = useState(true);
  const [fetchNewRounds, setFetchNewRounds] = useState(true);
  const [noMoreRounds, setNoMoreRounds] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);
  const [newFilter, setNewFilter] = useState<boolean>();
  const { featuredRounds } = useFeaturedRounds();
  const [sortedForFeatured, setSortedForFeatured] = useState(false);

  const handleFilterChange = (filter: RoundsFilter) => {
    const isNewFilter = roundsFilter !== filter;
    if (!isNewFilter) return;

    setNewFilter(isNewFilter);
    setPageIndex(1);
    updateRoundsFilter(filter);
    setFetchNewRounds(true);
    setRounds(undefined);
  };

  useEffect(() => {
    if (!fetchNewRounds) return;

    const _fetchRounds = async () => {
      try {
        setFetchingRounds(true);
        setFetchNewRounds(false);

        const fetchedRounds = (
          await fetchRoundsForFilter(propHouse, favorites, roundsFilter, pageIndex, 12)
        ).map(round => {
          if (COMPLETED_ROUND_OVERRIDES[round.address]) {
            round.state = COMPLETED_ROUND_OVERRIDES[round.address].state;
          }
          return round;
        });

        setFetchingRounds(false);

        if (fetchedRounds.length === 0) {
          setNoMoreRounds(true);
          return;
        }

        if (newFilter) {
          setRounds(fetchedRounds);
        } else {
          setPageIndex(prev => prev + 1);
          setRounds(prev => {
            if (prev) return [...prev, ...fetchedRounds];
            return fetchedRounds;
          });
        }
      } catch (e) {
        console.log(e);
        setFetchNewRounds(false);
        setFetchingRounds(false);
      }
    };
    _fetchRounds();
  }, [fetchNewRounds, pageIndex, propHouse, favorites, roundsFilter, newFilter]);

  useEffect(() => {
    if (!rounds || sortedForFeatured) return;
    const updatedRounds = rounds.filter(round => !featuredRounds!.includes(round.address));
    const featuredRoundsInFetched = rounds.filter(round => featuredRounds!.includes(round.address));
    setRounds([...featuredRoundsInFetched, ...updatedRounds]);
    setSortedForFeatured(true);
  }, [featuredRounds, rounds, sortedForFeatured]);

  return (
    <>
      <div className={classes.roundsHeader}>
        {!isMobile() && <div className={classes.sectionTitle}>Rounds</div>}
        <Dropdown drop="down" align="end">
          <Dropdown.Toggle id="dropdown-basic" className={classes.dropdown}>
            Show: {roundsFilter}
          </Dropdown.Toggle>

          <Dropdown.Menu className={classes.dropdownMenu}>
            {[
              RoundsFilter.Relevant,
              RoundsFilter.Proposing,
              RoundsFilter.Voting,
              RoundsFilter.Favorites,
            ].map((filter, i) => (
              <Dropdown.Item
                key={i}
                onClick={() => {
                  handleFilterChange(filter);
                }}
              >
                {filter}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown>
      </div>
      {roundsFilter === RoundsFilter.Favorites && favorites.length === 0 ? (
        <div className={classes.emptyContentContainer}>
          <GiSurprisedSkull size={100} />
          <p>You haven't added any communities to your favorites. </p>
          <Button
            text="Add one now"
            bgColor={ButtonColor.Pink}
            onClick={() => navigate('/houses')}
          />
        </div>
      ) : roundsFilter === RoundsFilter.Favorites &&
        favorites.length > 0 &&
        rounds?.length === 0 ? (
        <div>
          <FaRegSurprise />
          <div>Your favorite communites haven't run any rounds yet... awkward.</div>
        </div>
      ) : fetchingRounds && rounds === undefined ? (
        <Row>
          {Array(5)
            .fill(0)
            .map((_, i) => {
              return (
                <Col xl={12} key={i}>
                  <JumboCardLoading />
                </Col>
              );
            })}
        </Row>
      ) : (
        <>
          <Row>
            {rounds &&
              rounds.map((round, i) => {
                return (
                  <Col xl={12} key={i}>
                    <JumboRoundCard round={round} house={round.house} displayHorizontal />
                  </Col>
                );
              })}
          </Row>
          <Row>
            <Col>
              <Button
                bgColor={ButtonColor.PurpleLight}
                text={
                  noMoreRounds
                    ? 'No more rounds available'
                    : fetchingRounds
                    ? 'Loading...'
                    : 'Load more rounds'
                }
                classNames={classes.loadMoreBtn}
                onClick={() => setFetchNewRounds(true)}
                disabled={noMoreRounds || fetchingRounds}
              />
            </Col>
          </Row>
        </>
      )}
    </>
  );
};
export default RoundsFeed;
