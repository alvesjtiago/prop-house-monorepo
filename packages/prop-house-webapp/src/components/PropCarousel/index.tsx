import classes from "./PropCarousel.module.css";
import CarouselSection from "../CarouselSection";
import { useAppSelector } from "../../hooks";
import ProposalCard from "../ProposalCard";
import { PropHouseWrapper } from "@nouns/prop-house-wrapper";
import { useRef, useEffect, useState } from "react";
import { useEthers } from "@usedapp/core";
import { useDispatch } from "react-redux";
import { StoredProposalWithVotes } from "@nouns/prop-house-wrapper/dist/builders";
import LoadingIndicator from "../LoadingIndicator";

const PropCarousel = () => {
  const { library } = useEthers();
  const dispatch = useDispatch();
  const [proposals, setProposals] = useState<StoredProposalWithVotes[]>();
  const [isLoading, setIsLoading] = useState(false);
  const host = useAppSelector((state) => state.configuration.backendHost);
  const client = useRef(new PropHouseWrapper(host));

  useEffect(() => {
    client.current = new PropHouseWrapper(host, library?.getSigner());
  }, [library, host]);

  // fetch proposals
  useEffect(() => {
    setIsLoading(true);
    const fetchAuctionProposals = async () => {
      const proposals = await client.current.getAllProposals();
      setProposals(proposals);
      setIsLoading(false);
    };
    fetchAuctionProposals();
  }, [dispatch]);

  const propCards =
    proposals &&
    proposals.slice(0, 20).map((_, index) => {
      return (
        <div className={classes.propCardContainer} key={index}>
          <ProposalCard proposal={proposals[index]} />
        </div>
      );
    });

  return isLoading ? (
    <LoadingIndicator />
  ) : (
    <CarouselSection
      contextTitle="Browse proposals"
      mainTitle="Recent proposals "
      cards={propCards ? propCards : []}
    />
  );
};

export default PropCarousel;