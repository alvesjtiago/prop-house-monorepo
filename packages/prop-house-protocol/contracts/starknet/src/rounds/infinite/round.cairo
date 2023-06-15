#[contract]
mod InfiniteRound {
    use starknet::{EthAddress, get_block_timestamp};
    use prop_house::rounds::infinite::config::{
        IInfiniteRound, RoundState, RoundParams, RoundConfig, Proposal, ProposalState,
        ProposalVote, VoteDirection,
    };
    use prop_house::rounds::infinite::constants::{MAX_WINNER_TREE_DEPTH, MAX_REQUESTED_ASSET_COUNT};
    use prop_house::common::libraries::round::{Asset, Round, UserStrategy, StrategyGroup};
    use prop_house::common::utils::contract::get_round_dependency_registry;
    use prop_house::common::utils::traits::{
        IExecutionStrategyDispatcherTrait, IExecutionStrategyDispatcher,
        IRoundDependencyRegistryDispatcherTrait,
    };
    use prop_house::common::utils::hash::{keccak_u256s_be, LegacyHashEthAddress};
    use prop_house::common::utils::constants::{DependencyKey, StrategyType};
    use prop_house::common::utils::merkle::IncrementalMerkleTreeTrait;
    use prop_house::common::utils::array::assert_no_duplicates_u256;
    use prop_house::common::utils::integer::Felt252TryIntoU250;
    use prop_house::common::utils::storage::SpanStorageAccess;
    use prop_house::common::utils::serde::SpanSerde;
    use nullable::{match_nullable, FromNullableResult};
    use array::{ArrayTrait, SpanTrait};
    use integer::u256_from_felt252;
    use traits::{TryInto, Into};
    use dict::Felt252DictTrait;
    use option::OptionTrait;
    use zeroable::Zeroable;
    use box::BoxTrait;

    struct Storage {
        _config: RoundConfig,
        _proposal_count: u32,
        _winner_count: u32,
        _last_reported_winner_count: u32,
        _winner_merkle_root: u256,
        _winner_merkle_sub_trees: LegacyMap<u32, Span<u256>>,
        _proposals: LegacyMap<u32, Proposal>,
        _spent_voting_power: LegacyMap<(EthAddress, u32), u256>,
        _asset_balances: LegacyMap<u256, u256>,
    }

    #[event]
    fn ProposalCreated(
        proposal_id: u32, proposer_address: EthAddress, metadata_uri: Array<felt252>, requested_assets: Array<Asset>,
    ) {}

    #[event]
    fn ProposalEdited(proposal_id: u32, updated_metadata_uri: Array<felt252>, updated_requested_assets: Array<Asset>) {}

    #[event]
    fn ProposalCancelled(proposal_id: u32) {}

    #[event]
    fn ProposalApproved(proposal_id: u32) {}

    #[event]
    fn ProposalRejected(proposal_id: u32) {}

    #[event]
    fn VoteCast(proposal_id: u32, voter_address: EthAddress, voting_power: u256, direction: VoteDirection) {}

    #[event]
    fn ResultsReported(winner_count: u32, merkle_root: u256) {}

    impl InfiniteRound of IInfiniteRound {
        fn get_proposal(proposal_id: u32) -> Proposal {
            let proposal = _proposals::read(proposal_id);
            assert(proposal.proposer.is_non_zero(), 'IR: Proposal does not exist');

            proposal
        }

        fn propose(
            proposer_address: EthAddress,
            metadata_uri: Array<felt252>,
            requested_assets: Array<Asset>,
            used_proposing_strategies: Array<UserStrategy>,
        ) {
            _assert_caller_valid_and_round_active();
            _assert_asset_request_valid(requested_assets.span());

            let config = _config::read();

            // Determine the cumulative proposition power of the user
            let cumulative_proposition_power = Round::get_cumulative_governance_power(
                config.start_timestamp,
                proposer_address,
                StrategyType::PROPOSING,
                used_proposing_strategies.span(),
            );
            assert(
                cumulative_proposition_power >= config.proposal_threshold.inner.into(),
                'IR: Proposition power too low'
            );

            let requested_assets_hash = Round::compute_asset_hash(requested_assets.span());
            let proposal_id = _proposal_count::read() + 1;
            let proposal = Proposal {
                version: 1,
                state: ProposalState::Active(()),
                received_at: get_block_timestamp(),
                proposer: proposer_address,
                requested_assets_hash,
                voting_power_for: 0,
                voting_power_against: 0,
            };

            // Store the proposal and increment the proposal count
            _proposals::write(proposal_id, proposal);
            _proposal_count::write(proposal_id);

            ProposalCreated(proposal_id, proposer_address, metadata_uri, requested_assets);
        }

        fn edit_proposal(
            proposer_address: EthAddress, proposal_id: u32, metadata_uri: Array<felt252>, requested_assets: Array<Asset>,
        ) {
            let mut proposal = _proposals::read(proposal_id);

            _assert_caller_valid_and_round_active();
            _assert_can_modify_proposal(proposer_address, proposal);
            _assert_asset_request_valid(requested_assets.span());

            // Increment the proposal version, update the requested assets, clear 'for' votes,
            // and emit the metadata URI.
            proposal.version += 1;
            proposal.voting_power_for = 0;
            proposal.requested_assets_hash = Round::compute_asset_hash(requested_assets.span());
            _proposals::write(proposal_id, proposal);

            ProposalEdited(proposal_id, metadata_uri, requested_assets);
        }

        fn cancel_proposal(proposer_address: EthAddress, proposal_id: u32) {
            let mut proposal = _proposals::read(proposal_id);

            _assert_caller_valid_and_round_active();
            _assert_can_modify_proposal(proposer_address, proposal);

            // Cancel the proposal
            proposal.state = ProposalState::Cancelled(());
            _proposals::write(proposal_id, proposal);

            ProposalCancelled(proposal_id);
        }

        fn vote(
            voter_address: EthAddress,
            proposal_votes: Array<ProposalVote>,
            used_voting_strategies: Array<UserStrategy>,
        ) {
            _assert_caller_valid_and_round_active();

            // Determine the cumulative voting power of the user
            let cumulative_voting_power = Round::get_cumulative_governance_power(
                _config::read().start_timestamp,
                voter_address,
                StrategyType::VOTING,
                used_voting_strategies.span(),
            );
            assert(cumulative_voting_power.is_non_zero(), 'IR: User has no voting power');

            let mut proposal_votes = proposal_votes.span();
            loop {
                match proposal_votes.pop_front() {
                    Option::Some(proposal_vote) => _cast_votes_on_proposal(voter_address, *proposal_vote, cumulative_voting_power),
                    Option::None(_) => {
                        break;
                    },
                };
            };
        }

        /// Report new winners to a consuming contract. Revert if there are no new winners.
        fn report_results() {
            // Verify that the round is active
            _assert_round_active();

            let winner_count = _winner_count::read();
            assert(winner_count > 0 & winner_count > _last_reported_winner_count::read(), 'IR: No new winners');

            // Update the last reported winner count
            _last_reported_winner_count::write(winner_count);

            let merkle_root = _winner_merkle_root::read();
            let execution_strategy_address = get_round_dependency_registry().get_caller_dependency_at_key(
                Round::chain_id(), DependencyKey::EXECUTION_STRATEGY
            );
            if execution_strategy_address.is_non_zero() {
                let execution_strategy = IExecutionStrategyDispatcher {
                    contract_address: execution_strategy_address,
                };
                execution_strategy.execute(_build_execution_params(merkle_root));
            }

            ResultsReported(winner_count, merkle_root);
        }
    }

    #[constructor]
    fn constructor(round_params: Array<felt252>) {
        initializer(round_params.span());
    }

    /// Returns the proposal for the given proposal ID.
    /// * `proposal_id` - The proposal ID.
    #[view]
    fn get_proposal(proposal_id: u32) -> Proposal {
        InfiniteRound::get_proposal(proposal_id)
    }

    /// Submit a proposal to the round.
    /// * `proposer_address` - The address of the proposer.
    /// * `metadata_uri` - The proposal metadata URI.
    /// * `requested_assets` - The assets requested by the proposal.
    /// * `used_proposing_strategies` - The strategies used to propose.
    #[external]
    fn propose(
        proposer_address: EthAddress,
        metadata_uri: Array<felt252>,
        requested_assets: Array<Asset>,
        used_proposing_strategies: Array<UserStrategy>,
    ) {
        InfiniteRound::propose(
            proposer_address,
            metadata_uri,
            requested_assets,
            used_proposing_strategies,
        );
    }

    /// Edit a proposal.
    /// * `proposer_address` - The address of the proposer.
    /// * `proposal_id` - The ID of the proposal to cancel.
    /// * `metadata_uri` - The updated proposal metadata URI.
    /// * `requested_assets` - The updated assets requested by the proposal.
    #[external]
    fn edit_proposal(proposer_address: EthAddress, proposal_id: u32, metadata_uri: Array<felt252>, requested_assets: Array<Asset>) {
        InfiniteRound::edit_proposal(proposer_address, proposal_id, metadata_uri, requested_assets);
    }

    /// Cancel a proposal.
    /// * `proposer_address` - The address of the proposer.
    /// * `proposal_id` - The ID of the proposal to cancel.
    #[external]
    fn cancel_proposal(proposer_address: EthAddress, proposal_id: u32) {
        InfiniteRound::cancel_proposal(proposer_address, proposal_id);
    }

    /// Cast votes on one or more proposals.
    /// * `voter_address` - The address of the voter.
    /// * `proposal_votes` - The votes to cast.
    /// * `used_voting_strategies` - The strategies used to vote.
    #[external]
    fn vote(
        voter_address: EthAddress,
        proposal_votes: Array<ProposalVote>,
        used_voting_strategies: Array<UserStrategy>,
    ) {
        InfiniteRound::vote(
            voter_address,
            proposal_votes,
            used_voting_strategies,
        );
    }

    /// Report all round winners since the last report.
    #[external]
    fn report_results() {
        InfiniteRound::report_results();
    }

    ///
    /// Internals
    ///

    /// Initialize the round.
    fn initializer(round_params_: Span<felt252>) {
        let RoundParams {
            start_timestamp,
            vote_period,
            quorum_for,
            quorum_against,
            proposal_threshold,
            proposing_strategies,
            voting_strategies,
        } = _decode_param_array(round_params_);


        assert(start_timestamp.is_non_zero(), 'IR: Invalid start timestamp');
        assert(vote_period.is_non_zero(), 'IR: Invalid vote period');
        assert(quorum_for.is_non_zero(), 'IR: Quorums must be non-zero');
        assert(quorum_against.is_non_zero(), 'IR: Quorums must be non-zero');
        assert(voting_strategies.len().is_non_zero(), 'IR: No voting strategies');

        _config::write(
            RoundConfig {
                round_state: RoundState::Active(()),
                start_timestamp,
                vote_period,
                quorum_for,
                quorum_against,
                proposal_threshold,
            }
        );

        let mut strategy_groups = Default::default();
        strategy_groups.append(
            StrategyGroup {
                strategy_type: StrategyType::PROPOSING,
                strategies: proposing_strategies
            },
        );
        strategy_groups.append(
            StrategyGroup {
                strategy_type: StrategyType::VOTING,
                strategies: voting_strategies
            },
        );
        Round::initializer(1, strategy_groups.span()); // TODO: How to get chain ID?
    }

    /// Decode the round parameters from an array of felt252s.
    /// * `params` - The array of felt252s.
    fn _decode_param_array(params: Span<felt252>) -> RoundParams {
        let start_timestamp = (*params.at(0)).try_into().unwrap();
        let vote_period = (*params.at(1)).try_into().unwrap();
        let quorum_for = (*params.at(2)).try_into().unwrap();
        let quorum_against = (*params.at(3)).try_into().unwrap();
        let proposal_threshold = (*params.at(4)).try_into().unwrap();

        let (proposing_strategies, offset) = Round::parse_strategies(params, 5);
        let (voting_strategies, _) = Round::parse_strategies(params, offset);

        RoundParams {
            start_timestamp,
            vote_period,
            quorum_for,
            quorum_against,
            proposal_threshold,
            proposing_strategies,
            voting_strategies,
        }
    }

    /// Asserts that the round is active.
    fn _assert_round_active() {
        assert(_config::read().round_state == RoundState::Active(()), 'IR: Round not active');
    }

    /// Asserts that caller is a valid auth strategy and that the round is active.
    fn _assert_caller_valid_and_round_active() {
        // Verify that the caller is a valid auth strategy
        Round::assert_caller_is_valid_auth_strategy();

        // Verify that the round is active
        _assert_round_active();
    }

    /// Asserts that `proposer_address` can modify `proposal`. This includes
    /// an assertion that the proposal exists, that `proposer_address` is the proposer,
    /// and that the proposal is active.
    fn _assert_can_modify_proposal(proposer_address: EthAddress, proposal: Proposal) {
        assert(proposal.proposer.is_non_zero(), 'IR: Proposal does not exist');
        assert(proposer_address == proposal.proposer, 'IR: Caller is not proposer');
        assert(_get_proposal_state(proposal) == ProposalState::Active(()), 'IR: Proposal is not active');     
    }

    /// Assert the validity of an asset request. This includes an assertion
    /// that the request is not too large, that there are no duplicate assets,
    /// and that the round has sufficient balances of the requested assets.
    /// * `requested_assets` - The requested assets.
    fn _assert_asset_request_valid(mut requested_assets: Span<Asset>) {
        assert(requested_assets.len() < MAX_REQUESTED_ASSET_COUNT, 'IR: Too many assets requested');

        _assert_no_duplicate_assets(requested_assets);
        _assert_sufficient_asset_balances(requested_assets);
    }

    /// Reverts if the asset array contains duplicate assets.
    /// * `assets` - The array of assets.
    fn _assert_no_duplicate_assets(mut assets: Span<Asset>) {
        let mut asset_ids = Default::default();
        loop {
            match assets.pop_front() {
                Option::Some(a) => {
                    asset_ids.append(*a.asset_id);
                },
                Option::None(()) => {
                    break;
                },
            };
        };
        assert_no_duplicates_u256(asset_ids.span());
    }

    /// Reverts if the strategy does not have sufficient balances to fulfill the request.
    /// Note that this function does NOT handle duplicate asset requests. Ensure duplicate
    /// validation has occurred prior to calling this function.
    /// * `requested_assets` - The assets requested by the proposer.
    fn _assert_sufficient_asset_balances(mut requested_assets: Span<Asset>) {
        loop {
            match requested_assets.pop_front() {
                Option::Some(a) => {
                    let a = *a;
                    let asset_balance = _asset_balances::read(a.asset_id);
                    assert(asset_balance >= a.amount, 'IR: Insufficient balance');
                },
                Option::None(_) => {
                    break;
                },
            };
        };
    }

    /// Cast votes on a single proposal.
    /// * `voter_address` - The address of the voter.
    /// * `proposal_vote` - The proposal vote information.
    /// * `cumulative_voting_power` - The cumulative voting power of the voter.
    fn _cast_votes_on_proposal(
        voter_address: EthAddress, proposal_vote: ProposalVote, cumulative_voting_power: u256, 
    ) {
        let proposal_id = proposal_vote.proposal_id;
        let voting_power = proposal_vote.voting_power;
        let direction = proposal_vote.direction;

        let mut proposal = _proposals::read(proposal_id);
        assert(proposal.proposer.is_non_zero(), 'IR: Proposal does not exist');

        // Exit early if the proposal is not active
        if _get_proposal_state(proposal) != ProposalState::Active(()) {
            return;
        }
        // Exit early if the proposal version has changed
        if proposal_vote.proposal_version != proposal.version {
            return;
        }

        let mut spent_voting_power = _spent_voting_power::read((voter_address, proposal_id));
        let mut remaining_voting_power = cumulative_voting_power - spent_voting_power;

        assert(voting_power.is_non_zero(), 'IR: No voting power provided');
        assert(remaining_voting_power >= voting_power, 'IR: Insufficient voting power');

        match direction {
            VoteDirection::For(()) => {
                proposal.voting_power_for += voting_power;
            },
            VoteDirection::Against(()) => {
                proposal.voting_power_against += voting_power;
            },
        };

        let config = _config::read();
        if proposal.voting_power_for >= config.quorum_for.inner.into() {
            _approve_proposal(proposal_id, ref proposal);
        } else if proposal.voting_power_against >= config.quorum_against.inner.into() {
            _reject_proposal(proposal_id, ref proposal);
        }
        _proposals::write(proposal_id, proposal);
        _spent_voting_power::write((voter_address, proposal_id), spent_voting_power);

        VoteCast(proposal_id, voter_address, voting_power, direction);
    }

    /// Approve a proposal, setting its state to `Approved`, and appending the
    /// proposal's leaf to the incremental merkle tree.
    /// * `proposal_id` - The ID of the proposal to approve.
    /// * `proposal` - The proposal to approve.
    fn _approve_proposal(proposal_id: u32, ref proposal: Proposal) {
        proposal.state = ProposalState::Approved(());

        let winner_count = _winner_count::read();
        let mut incremental_merkle_tree = IncrementalMerkleTreeTrait::<u256>::new(
            MAX_WINNER_TREE_DEPTH,
            winner_count,
            _read_sub_trees_from_storage(),
        );
        let leaf = _compute_leaf(proposal_id, proposal);

        // The maximum winner count for this round is 2^10 (1024). If the max
        // count is reached, then no `append_leaf` will revert.
        _winner_merkle_root::write(incremental_merkle_tree.append_leaf(leaf));
        _winner_count::write(winner_count + 1);

        ProposalApproved(proposal_id);
    }

    /// Reject a proposal, setting its state to `Rejected`.
    /// * `proposal_id` - The ID of the proposal to reject.
    /// * `proposal` - The proposal to reject.
    fn _reject_proposal(proposal_id: u32, ref proposal: Proposal) {
        proposal.state = ProposalState::Rejected(());
        ProposalRejected(proposal_id);
    }

    /// Build the execution parameters that will be passed to the execution strategy.
    /// * `merkle_root` - The merkle root that will be used for asset claims.
    fn _build_execution_params(merkle_root: u256) -> Span<felt252> {
        let mut execution_params = Default::default();
        execution_params.append(merkle_root.low.into());
        execution_params.append(merkle_root.high.into());

        execution_params.span()
    }

    /// Compute a single leaf consisting of a proposal ID, proposer address, and requested asset hash.
    /// * `proposal_id` - The ID of the proposal to compute the leaf for.
    /// * `proposal` - The proposal to compute the leaf for.
    fn _compute_leaf(proposal_id: u32, proposal: Proposal) -> u256 {
        let mut leaf_input = Default::default();
        leaf_input.append(u256_from_felt252(proposal_id.into()));
        leaf_input.append(u256_from_felt252(proposal.proposer.into()));
        leaf_input.append(u256_from_felt252(proposal.requested_assets_hash.into()));

        keccak_u256s_be(leaf_input.span())
    }

    /// Read existing incremental merkle tree sub trees from storage.
    fn _read_sub_trees_from_storage() -> Felt252Dict<Nullable<Span<u256>>> {
        let mut sub_trees = Default::default();

        let mut curr_depth = 0;
        loop {
            if curr_depth > MAX_WINNER_TREE_DEPTH {
                break;
            }
            let sub_tree = _winner_merkle_sub_trees::read(curr_depth);
            if sub_tree.len().is_zero() {
                break;
            }
            sub_trees.insert(curr_depth.into(), nullable_from_box(BoxTrait::new(sub_tree)));
        };
        sub_trees
    }

    /// Write the incrmeental merkle tree sub trees to storage.
    /// The user will not be charged storage costs for sub trees that are already in storage.
    /// * `sub_trees` - The sub trees to write to storage.
    fn _write_sub_trees_to_storage(ref sub_trees: Felt252Dict<Nullable<Span<u256>>>) {
        let mut curr_depth = 0;
        loop {
            match match_nullable(sub_trees.get(curr_depth.into())) {
                FromNullableResult::Null(()) => {
                    break;
                },
                FromNullableResult::NotNull(sub_tree) => {
                    _winner_merkle_sub_trees::write(curr_depth, sub_tree.unbox());
                    curr_depth += 1;
                },
            };
        };
    }

    /// Get the state of the given proposal.
    /// * `proposal` - The proposal to get the state of.
    fn _get_proposal_state(proposal: Proposal) -> ProposalState {
        if proposal.state == ProposalState::Active(()) {
            // If the proposal is active, check if it has become stale.
            if get_block_timestamp() > proposal.received_at + _config::read().vote_period {
                return ProposalState::Stale(());
            }
        }
        proposal.state
    }
}
