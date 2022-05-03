import classes from './FullAuction.module.css';
import Card, { CardBgColor, CardBorderRadius } from '../Card';
import AuctionHeader from '../AuctionHeader';
import ProposalCards from '../ProposalCards';
import { Row, Col } from 'react-bootstrap';
import { StoredAuction, Vote } from '@nouns/prop-house-wrapper/dist/builders';
import { auctionStatus, AuctionStatus } from '../../utils/auctionStatus';
import { getNounerVotes, getNounishVotes } from 'prop-house-nounish-contracts';
import { useEthers } from '@usedapp/core';
import clsx from 'clsx';
import { useEffect, useState, useRef } from 'react';
import useWeb3Modal from '../../hooks/useWeb3Modal';
import { useDispatch } from 'react-redux';
import { useAppSelector } from '../../hooks';
import { VoteAllotment, updateVoteAllotment } from '../../utils/voteAllotment';
import { PropHouseWrapper } from '@nouns/prop-house-wrapper';
import { refreshActiveProposals } from '../../utils/refreshActiveProposal';
import Modal, { ModalData } from '../Modal';
import { aggVoteWeightForProps } from '../../utils/aggVoteWeight';
import {
  setDelegatedVotes,
  sortProposals,
  setActiveProposals,
} from '../../state/slices/propHouse';
import {
  auctionEmptyContent,
  auctionNotStartedContent,
  connectedCopy,
  disconnectedCopy,
} from './content';

const FullAuction: React.FC<{
  auction: StoredAuction;
}> = (props) => {
  const { auction } = props;

  const { account, library } = useEthers();
  const [earliestFirst, setEarliestFirst] = useState(false);
  const [voteAllotments, setVoteAllotments] = useState<VoteAllotment[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState<ModalData>();

  const connect = useWeb3Modal();
  const dispatch = useDispatch();
  const proposals = useAppSelector((state) => state.propHouse.activeProposals);
  const delegatedVotes = useAppSelector(
    (state) => state.propHouse.delegatedVotes
  );
  const host = useAppSelector((state) => state.configuration.backendHost);
  const client = useRef(new PropHouseWrapper(host));

  // aggregate vote weight of already stored votes
  const userVotesWeight = () => {
    if (!account || !proposals) return 0;
    return aggVoteWeightForProps(proposals, account);
  };

  useEffect(() => {
    client.current = new PropHouseWrapper(host, library?.getSigner());
  }, [library, host]);

  // fetch votes/delegated votes allowed for user to use
  useEffect(() => {
    if (!account || !library) return;

    const fetchVotes = async (getVotes: Promise<number>): Promise<boolean> => {
      const votes = await getVotes;
      if (Number(votes) === 0) return false;
      dispatch(setDelegatedVotes(votes));
      return true;
    };

    const fetch = async () => {
      try {
        const nouner = await fetchVotes(getNounerVotes(account));
        if (!nouner) fetchVotes(getNounishVotes(account, library));
      } catch (e) {
        console.log('error getting votes');
      }
    };

    fetch();
  }, [account, library, dispatch]);

  // fetch proposals
  useEffect(() => {
    const fetchAuctionProposals = async () => {
      const proposals = await client.current.getAuctionProposals(auction.id);
      dispatch(setActiveProposals(proposals));
    };
    fetchAuctionProposals();
  }, [auction.id, dispatch, account]);

  // check vote allotment against vote user is allowed to use
  const canAllotVotes = () => {
    if (!delegatedVotes) return false;

    const numAllotedVotes = voteAllotments.reduce(
      (counter, allotment) => counter + allotment.votes,
      0
    );
    return numAllotedVotes < delegatedVotes - userVotesWeight();
  };

  // manage vote alloting
  const handleVoteAllotment = (proposalId: number, support: boolean) => {
    setVoteAllotments((prev) => {
      // if no votes have been allotted yet, add new
      if (prev.length === 0) return [{ proposalId, votes: 1 }];

      const preexistingVoteAllotment = prev.find(
        (allotment) => allotment.proposalId === proposalId
      );

      // if not already alloted to specific proposal,  add new allotment
      if (!preexistingVoteAllotment) return [...prev, { proposalId, votes: 1 }];

      // if already allotted to a specific proposal, add one vote to allotment
      const updated = prev.map((a) =>
        a.proposalId === preexistingVoteAllotment.proposalId
          ? updateVoteAllotment(a, support)
          : a
      );

      return updated;
    });
  };

  // handle voting
  const handleVote = async () => {
    if (!delegatedVotes) return;

    const votes = voteAllotments.map((a) => new Vote(1, a.proposalId, a.votes));
    await client.current.logVotes(votes);

    // setShowModal(true);
    // try {
    //   setModalData({
    //     title: 'Voting',
    //     content: `Please sign the message to vote for proposal #${proposalId}`,
    //     onDismiss: () => setShowModal(false),
    //   });

    //   setModalData({
    //     title: 'Success',
    //     content: `You have successfully voted for proposal #${proposalId}`,
    //     onDismiss: () => setShowModal(false),
    //   });

    refreshActiveProposals(client.current, auction.id, dispatch);
    // } catch (e) {
    //   setModalData({
    //     title: 'Error',
    //     content: `Failed to vote on proposal #${proposalId}.\n\nError message: ${e}`,
    //     onDismiss: () => setShowModal(false),
    //   });
    // }
  };

  const handleSort = () => {
    setEarliestFirst((prev) => {
      dispatch(sortProposals(!prev));
      return !prev;
    });
  };

  return (
    <>
      {showModal && modalData && <Modal data={modalData} />}
      {auctionStatus(auction) === AuctionStatus.AuctionVoting &&
        ((delegatedVotes && delegatedVotes > 0) || account === undefined) && (
          <Card
            bgColor={CardBgColor.White}
            borderRadius={CardBorderRadius.twenty}
          >
            <div>
              {delegatedVotes && delegatedVotes > 0
                ? connectedCopy
                : disconnectedCopy(connect)}
            </div>
          </Card>
        )}
      <AuctionHeader
        auction={auction}
        clickable={false}
        classNames={classes.auctionHeader}
        totalVotes={delegatedVotes}
        votesLeft={delegatedVotes && delegatedVotes - userVotesWeight()}
        handleVote={handleVote}
      />
      <Card
        bgColor={CardBgColor.LightPurple}
        borderRadius={CardBorderRadius.thirty}
        classNames={clsx(classes.customCardHeader, classes.fixedHeight)}
      >
        <Row>
          <Col xs={6} md={2}>
            <div className={classes.proposalTitle}>
              Proposals{' '}
              <span onClick={handleSort}>{earliestFirst ? '↓' : '↑'}</span>
            </div>
          </Col>
          <Col xs={6} md={10}>
            <div className={classes.divider} />
          </Col>
        </Row>

        {auctionStatus(auction) === AuctionStatus.AuctionNotStarted ? (
          auctionNotStartedContent
        ) : auction.proposals.length === 0 ? (
          auctionEmptyContent
        ) : (
          <>
            <ProposalCards
              auction={auction}
              voteAllotments={voteAllotments}
              canAllotVotes={canAllotVotes}
              handleVoteAllotment={handleVoteAllotment}
            />
          </>
        )}
      </Card>
    </>
  );
};

export default FullAuction;
