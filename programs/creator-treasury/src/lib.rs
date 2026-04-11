use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::spl_token::state::Account as SplTokenAccountState;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("BYZFRa7NzDB7bKwxxkntewHfWwjBBqM6nsfrVeakBHjV");

pub const MAX_APPROVERS: usize = 5;
pub const MAX_NAME_LEN: usize = 64;
pub const MAX_ARTIFACT_URI_LEN: usize = 200;
pub const MAX_ARTIFACT_LABEL_LEN: usize = 64;

pub const STATUS_PENDING: u8 = 0;
pub const STATUS_TIMELOCK: u8 = 1;
pub const STATUS_EXECUTED: u8 = 2;
pub const STATUS_CANCELLED: u8 = 3;

pub const MAX_AUTO_RECIPIENTS: usize = 8;
pub const AUTOMATION_MODE_NONE: u8 = 0;
pub const AUTOMATION_MODE_SPLIT_CRANK: u8 = 1;
/// `Project` body size before automation fields (Borsh, excludes 8-byte account discriminator).
pub const PROJECT_LEGACY_BODY_LEN: usize = 315;
/// `Project` serialized body size before `pending_team_lead` + `pda_seed_owner` (used in `upgrade_project_layout`).
pub const PROJECT_LAYOUT_PRE_HANDOFF_LEN: usize = 614;

#[program]
pub mod creator_treasury {
    use super::*;

    pub fn initialize_project(
        ctx: Context<InitializeProject>,
        project_id: u64,
        name: Vec<u8>,
        approvers: Vec<Pubkey>,
        approval_threshold: u8,
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, ErrorCode::InvalidNameLength);
        require!(!approvers.is_empty(), ErrorCode::InvalidThreshold);
        require!(
            approvers.len() <= MAX_APPROVERS,
            ErrorCode::TooManyApprovers
        );
        require!(
            approval_threshold >= 1 && approval_threshold <= approvers.len() as u8,
            ErrorCode::InvalidThreshold
        );
        require!(
            approvers[0] == ctx.accounts.team_lead.key(),
            ErrorCode::LeadMustBeFirstApprover
        );

        for (i, k) in approvers.iter().enumerate() {
            require!(*k != Pubkey::default(), ErrorCode::InvalidApprover);
            for j in i + 1..approvers.len() {
                require!(approvers[j] != *k, ErrorCode::DuplicateApprover);
            }
        }

        let project = &mut ctx.accounts.project;
        project.team_lead = ctx.accounts.team_lead.key();
        project.approver_count = approvers.len() as u8;
        project.approvers = [Pubkey::default(); MAX_APPROVERS];
        for (i, k) in approvers.iter().enumerate() {
            project.approvers[i] = *k;
        }
        project.approval_threshold = approval_threshold;
        project.name = [0u8; MAX_NAME_LEN];
        project.name[..name.len()].copy_from_slice(&name);
        project.name_len = name.len() as u8;
        project.project_id = project_id;
        project.next_proposal_id = 0;
        project.frozen = false;
        project.vault_initialized = false;
        project.policy_version = 0;
        project.policy_hash = [0u8; 32];
        project.require_artifact_for_execute = false;
        project.bump = ctx.bumps.project;
        project.automation_mode = AUTOMATION_MODE_NONE;
        project.automation_paused = false;
        project.automation_interval_secs = 0;
        project.automation_next_eligible_ts = 0;
        project.automation_max_per_tick = 0;
        project.auto_recipient_count = 0;
        project.auto_recipients = [Pubkey::default(); MAX_AUTO_RECIPIENTS];
        project.auto_bps = [0u16; MAX_AUTO_RECIPIENTS];
        project.pending_team_lead = Pubkey::default();
        project.pda_seed_owner = ctx.accounts.team_lead.key();

        emit!(ProjectCreated {
            project: project.key(),
            team_lead: project.team_lead,
            project_id,
        });
        Ok(())
    }

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let project = &mut ctx.accounts.project;
        require!(!project.vault_initialized, ErrorCode::VaultAlreadyInitialized);

        let vs = &mut ctx.accounts.vault_state;
        vs.project = project.key();
        vs.mint = ctx.accounts.mint.key();
        vs.bump = ctx.bumps.vault_state;

        project.vault_initialized = true;

        emit!(VaultInitialized {
            project: project.key(),
            mint: vs.mint,
            vault_token_account: ctx.accounts.vault_token_account.key(),
        });
        Ok(())
    }

    pub fn set_policy(ctx: Context<SetPolicy>, policy_hash: [u8; 32]) -> Result<()> {
        require!(policy_hash != [0u8; 32], ErrorCode::PolicyHashZero);
        let project = &mut ctx.accounts.project;
        project.policy_version = project
            .policy_version
            .checked_add(1)
            .ok_or(ErrorCode::PolicyVersionOverflow)?;
        project.policy_hash = policy_hash;
        emit!(PolicySet {
            project: project.key(),
            policy_version: project.policy_version,
            policy_hash,
        });
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        let project_key = ctx.accounts.project.key();
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.depositor_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
        )?;
        emit!(Deposited {
            project: project_key,
            amount,
            depositor: ctx.accounts.depositor.key(),
        });
        Ok(())
    }

    pub fn propose_release(
        ctx: Context<ProposeRelease>,
        amount: u64,
        recipient: Pubkey,
        timelock_duration_secs: i64,
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(recipient != Pubkey::default(), ErrorCode::InvalidRecipient);
        require!(timelock_duration_secs >= 0, ErrorCode::InvalidTimelock);

        let project = &mut ctx.accounts.project;
        let proposal_id = project.next_proposal_id;

        let prop = &mut ctx.accounts.proposal;
        prop.project = project.key();
        prop.proposal_id = proposal_id;
        prop.amount = amount;
        prop.recipient = recipient;
        prop.timelock_duration_secs = timelock_duration_secs;
        prop.timelock_ends_at = 0;
        prop.approved_mask = 0;
        prop.status = STATUS_PENDING;
        prop.policy_version_at_proposal = project.policy_version;
        prop.artifact_sha256 = [0u8; 32];
        prop.artifact_uri = [0u8; MAX_ARTIFACT_URI_LEN];
        prop.artifact_uri_len = 0;
        prop.artifact_label = [0u8; MAX_ARTIFACT_LABEL_LEN];
        prop.artifact_label_len = 0;
        prop.linked_milestone_id = 0;
        prop.dispute_active = false;
        prop.released_so_far = 0;
        prop.bump = ctx.bumps.proposal;

        project.next_proposal_id = project
            .next_proposal_id
            .checked_add(1)
            .ok_or(ErrorCode::ProposalIdOverflow)?;

        emit!(ReleaseProposed {
            project: prop.project,
            proposal_id,
            amount,
            recipient,
            timelock_duration_secs,
        });
        Ok(())
    }

    pub fn attach_proposal_artifact(
        ctx: Context<AttachProposalArtifact>,
        proposal_id: u64,
        artifact_sha256: [u8; 32],
        uri: Vec<u8>,
        label: Vec<u8>,
        linked_milestone_id: u64,
    ) -> Result<()> {
        require!(artifact_sha256 != [0u8; 32], ErrorCode::ArtifactHashZero);
        require!(uri.len() <= MAX_ARTIFACT_URI_LEN, ErrorCode::ArtifactUriTooLong);
        require!(label.len() <= MAX_ARTIFACT_LABEL_LEN, ErrorCode::ArtifactLabelTooLong);

        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.proposal_id == proposal_id, ErrorCode::InvalidProposal);
        require!(
            proposal.artifact_sha256 == [0u8; 32],
            ErrorCode::ArtifactAlreadyAttached
        );
        require!(
            proposal.status == STATUS_PENDING || proposal.status == STATUS_TIMELOCK,
            ErrorCode::InvalidProposalState
        );

        proposal.artifact_sha256 = artifact_sha256;
        proposal.artifact_uri = [0u8; MAX_ARTIFACT_URI_LEN];
        proposal.artifact_uri[..uri.len()].copy_from_slice(&uri);
        proposal.artifact_uri_len = uri.len() as u16;
        proposal.artifact_label = [0u8; MAX_ARTIFACT_LABEL_LEN];
        proposal.artifact_label[..label.len()].copy_from_slice(&label);
        proposal.artifact_label_len = label.len() as u8;
        proposal.linked_milestone_id = linked_milestone_id;

        emit!(ProposalArtifactAttached {
            project: proposal.project,
            proposal_id,
            artifact_sha256,
        });
        Ok(())
    }

    pub fn open_dispute(ctx: Context<OpenDispute>, proposal_id: u64) -> Result<()> {
        let project = &ctx.accounts.project;
        let opener = ctx.accounts.opener.key();
        require!(
            opener == project.team_lead || find_approver_index(project, &opener).is_ok(),
            ErrorCode::Unauthorized
        );

        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.proposal_id == proposal_id, ErrorCode::InvalidProposal);
        require!(
            proposal.status == STATUS_PENDING || proposal.status == STATUS_TIMELOCK,
            ErrorCode::InvalidProposalState
        );
        require!(!proposal.dispute_active, ErrorCode::DisputeAlreadyOpen);

        proposal.dispute_active = true;
        emit!(DisputeOpened {
            project: proposal.project,
            proposal_id,
            opener,
        });
        Ok(())
    }

    pub fn resolve_dispute(ctx: Context<ResolveDispute>, proposal_id: u64) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.proposal_id == proposal_id, ErrorCode::InvalidProposal);
        require!(proposal.dispute_active, ErrorCode::DisputeNotActive);

        proposal.dispute_active = false;
        emit!(DisputeResolved {
            project: proposal.project,
            proposal_id,
        });
        Ok(())
    }

    pub fn approve_release(ctx: Context<ApproveRelease>, proposal_id: u64) -> Result<()> {
        let project = &ctx.accounts.project;
        let proposal = &mut ctx.accounts.proposal;
        require!(!project.frozen, ErrorCode::VaultFrozen);
        require!(proposal.proposal_id == proposal_id, ErrorCode::InvalidProposal);
        require!(
            proposal.status == STATUS_PENDING || proposal.status == STATUS_TIMELOCK,
            ErrorCode::InvalidProposalState
        );

        let approver = ctx.accounts.approver.key();
        let idx = find_approver_index(project, &approver)?;
        let bit = 1u8
            .checked_shl(idx as u32)
            .ok_or(ErrorCode::InvalidApprover)?;
        require!(
            proposal.approved_mask & bit == 0,
            ErrorCode::AlreadyApproved
        );
        proposal.approved_mask |= bit;

        if proposal.status == STATUS_PENDING {
            let needed = project.approval_threshold as u32;
            let have = approval_count(proposal.approved_mask, project.approver_count) as u32;
            if have >= needed {
                let now = Clock::get()?.unix_timestamp;
                proposal.timelock_ends_at = now
                    .checked_add(proposal.timelock_duration_secs)
                    .ok_or(ErrorCode::TimelockOverflow)?;
                proposal.status = STATUS_TIMELOCK;
                emit!(TimelockStarted {
                    project: proposal.project,
                    proposal_id: proposal.proposal_id,
                    ends_at: proposal.timelock_ends_at,
                });
            }
        }

        emit!(Approved {
            project: proposal.project,
            proposal_id: proposal.proposal_id,
            approver,
        });
        Ok(())
    }

    pub fn cancel_proposal(ctx: Context<CancelProposal>, proposal_id: u64) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.proposal_id == proposal_id, ErrorCode::InvalidProposal);
        require!(proposal.released_so_far == 0, ErrorCode::CannotCancelAfterPartialRelease);
        require!(
            proposal.status == STATUS_PENDING || proposal.status == STATUS_TIMELOCK,
            ErrorCode::InvalidProposalState
        );
        proposal.status = STATUS_CANCELLED;
        emit!(ProposalCancelled {
            project: proposal.project,
            proposal_id,
        });
        Ok(())
    }

    pub fn execute_release(
        ctx: Context<ExecuteRelease>,
        proposal_id: u64,
        release_amount: u64,
    ) -> Result<()> {
        let project = &ctx.accounts.project;
        require!(!project.frozen, ErrorCode::VaultFrozen);

        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.proposal_id == proposal_id, ErrorCode::InvalidProposal);
        require!(!proposal.dispute_active, ErrorCode::DisputeActive);
        require!(proposal.status == STATUS_TIMELOCK, ErrorCode::TimelockNotReady);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= proposal.timelock_ends_at, ErrorCode::TimelockNotReady);
        if project.require_artifact_for_execute {
            require!(
                proposal.artifact_sha256 != [0u8; 32],
                ErrorCode::ArtifactRequiredForExecute
            );
        }

        require!(release_amount > 0, ErrorCode::InvalidAmount);
        let remaining = proposal
            .amount
            .checked_sub(proposal.released_so_far)
            .ok_or(ErrorCode::PartialReleaseExceedsCap)?;
        require!(
            release_amount <= remaining,
            ErrorCode::PartialReleaseExceedsCap
        );

        require!(
            ctx.accounts.vault_token_account.amount >= release_amount,
            ErrorCode::InsufficientVaultBalance
        );
        require!(
            ctx.accounts.vault_token_account.mint == ctx.accounts.vault_state.mint,
            ErrorCode::InvalidMint
        );
        require!(
            ctx.accounts.recipient_token_account.mint == ctx.accounts.vault_state.mint,
            ErrorCode::InvalidMint
        );
        require!(
            ctx.accounts.recipient_token_account.owner == proposal.recipient,
            ErrorCode::InvalidRecipientAta
        );

        let project_key = project.key();
        let bump = ctx.accounts.vault_state.bump;
        let seeds: &[&[u8]] = &[b"vault", project_key.as_ref(), &[bump]];
        let signer = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.vault_state.to_account_info(),
                },
                signer,
            ),
            release_amount,
        )?;

        let new_released = proposal
            .released_so_far
            .checked_add(release_amount)
            .ok_or(ErrorCode::PartialReleaseExceedsCap)?;
        proposal.released_so_far = new_released;
        let fully_settled = new_released == proposal.amount;
        if fully_settled {
            proposal.status = STATUS_EXECUTED;
        }

        emit!(Released {
            project: proposal.project,
            proposal_id,
            amount: release_amount,
            recipient: proposal.recipient,
            cumulative_released: new_released,
            fully_settled,
        });
        Ok(())
    }

    pub fn set_frozen(ctx: Context<SetFrozen>, frozen: bool) -> Result<()> {
        ctx.accounts.project.frozen = frozen;
        emit!(FrozenToggled {
            project: ctx.accounts.project.key(),
            frozen,
        });
        Ok(())
    }

    pub fn set_require_artifact(ctx: Context<SetRequireArtifact>, require: bool) -> Result<()> {
        ctx.accounts.project.require_artifact_for_execute = require;
        emit!(RequireArtifactToggled {
            project: ctx.accounts.project.key(),
            require,
        });
        Ok(())
    }

    /// Current team lead invites `new_team_lead` (pubkey only). The invitee must call `accept_team_lead_transfer` while connected as that wallet.
    pub fn begin_team_lead_transfer(
        ctx: Context<BeginTeamLeadTransfer>,
        new_team_lead: Pubkey,
    ) -> Result<()> {
        require!(
            new_team_lead != Pubkey::default(),
            ErrorCode::InvalidTransferTarget
        );
        let project = &mut ctx.accounts.project;
        require!(
            new_team_lead != project.team_lead,
            ErrorCode::InvalidTransferTarget
        );
        require!(
            project.pending_team_lead == Pubkey::default(),
            ErrorCode::PendingTransferActive
        );
        require!(
            project.approvers[0] == project.team_lead,
            ErrorCode::LeadMustBeFirstApprover
        );
        for i in 1..project.approver_count as usize {
            require!(
                project.approvers[i] != new_team_lead,
                ErrorCode::DuplicateApprover
            );
        }
        project.pending_team_lead = new_team_lead;
        emit!(TeamLeadTransferBegun {
            project: project.key(),
            from: project.team_lead,
            to: new_team_lead,
        });
        Ok(())
    }

    /// New team lead accepts a pending transfer started by the current lead.
    pub fn accept_team_lead_transfer(ctx: Context<AcceptTeamLeadTransfer>) -> Result<()> {
        let project = &mut ctx.accounts.project;
        let pending = project.pending_team_lead;
        require!(pending != Pubkey::default(), ErrorCode::PendingTransferNone);
        require!(
            pending == ctx.accounts.new_team_lead.key(),
            ErrorCode::PendingTransferMismatch
        );
        require!(
            project.approvers[0] == project.team_lead,
            ErrorCode::LeadMustBeFirstApprover
        );
        let old = project.team_lead;
        project.team_lead = pending;
        project.approvers[0] = pending;
        project.pending_team_lead = Pubkey::default();
        emit!(TeamLeadTransferred {
            project: project.key(),
            from: old,
            to: pending,
        });
        Ok(())
    }

    /// Current team lead cancels a pending transfer.
    pub fn cancel_team_lead_transfer(ctx: Context<CancelTeamLeadTransfer>) -> Result<()> {
        let project = &mut ctx.accounts.project;
        require!(
            project.pending_team_lead != Pubkey::default(),
            ErrorCode::PendingTransferNone
        );
        project.pending_team_lead = Pubkey::default();
        emit!(TeamLeadTransferCancelled {
            project: project.key(),
        });
        Ok(())
    }

    /// Extends an older `Project` account to the current size (payer covers extra rent). Idempotent.
    pub fn upgrade_project_layout(ctx: Context<UpgradeProjectLayout>, project_id: u64) -> Result<()> {
        let acc = ctx.accounts.project.to_account_info();
        let target = 8 + Project::LEN;
        if acc.data_len() >= target {
            return Ok(());
        }
        require!(
            acc.data_len() >= 8 + PROJECT_LEGACY_BODY_LEN,
            ErrorCode::InvalidAccountData
        );
        {
            let data = acc.try_borrow_data()?;
            let tl = Pubkey::try_from(&data[8..40]).map_err(|_| error!(ErrorCode::InvalidAccountData))?;
            require_keys_eq!(tl, ctx.accounts.team_lead.key());
            let pid = u64::from_le_bytes(
                data[267..275]
                    .try_into()
                    .map_err(|_| error!(ErrorCode::InvalidAccountData))?,
            );
            require!(pid == project_id, ErrorCode::InvalidProjectIdArg);
            let (pda_expected, bump_expected) = Pubkey::find_program_address(
                &[b"project", tl.as_ref(), &pid.to_le_bytes()],
                ctx.program_id,
            );
            require_keys_eq!(pda_expected, acc.key());
            require_eq!(data[322], bump_expected);
        }
        let rent = Rent::get()?;
        let new_minimum = rent.minimum_balance(target);
        let lamports_extra = new_minimum.saturating_sub(acc.lamports());
        if lamports_extra > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: acc.clone(),
                    },
                ),
                lamports_extra,
            )?;
        }
        acc.realloc(target, true)?;
        {
            let mut data = acc.try_borrow_mut_data()?;
            if data.len() >= 8 + Project::LEN {
                let tl = Pubkey::try_from(&data[8..40]).map_err(|_| error!(ErrorCode::InvalidAccountData))?;
                let pending_off = 8 + PROJECT_LAYOUT_PRE_HANDOFF_LEN;
                let pda_seed_off = pending_off + 32;
                data[pending_off..pda_seed_off].fill(0);
                data[pda_seed_off..pda_seed_off + 32].copy_from_slice(tl.as_ref());
            }
        }
        Ok(())
    }

    /// Team lead configures permissionless split crank (bounded recipients + bps). Set `mode` to `AUTOMATION_MODE_NONE` to disable.
    pub fn configure_automation(
        ctx: Context<ConfigureAutomation>,
        mode: u8,
        paused: bool,
        interval_secs: i64,
        max_per_tick: u64,
        next_eligible_ts: i64,
        recipients: Vec<Pubkey>,
        bps: Vec<u16>,
    ) -> Result<()> {
        let project = &mut ctx.accounts.project;
        if mode == AUTOMATION_MODE_NONE {
            project.automation_mode = AUTOMATION_MODE_NONE;
            project.automation_paused = false;
            project.automation_interval_secs = 0;
            project.automation_next_eligible_ts = 0;
            project.automation_max_per_tick = 0;
            project.auto_recipient_count = 0;
            project.auto_recipients = [Pubkey::default(); MAX_AUTO_RECIPIENTS];
            project.auto_bps = [0u16; MAX_AUTO_RECIPIENTS];
            emit!(AutomationConfigured {
                project: project.key(),
                mode: AUTOMATION_MODE_NONE,
            });
            return Ok(());
        }
        require!(
            mode == AUTOMATION_MODE_SPLIT_CRANK,
            ErrorCode::InvalidAutomationMode
        );
        require!(!recipients.is_empty(), ErrorCode::InvalidAutomationRecipients);
        require!(
            recipients.len() <= MAX_AUTO_RECIPIENTS,
            ErrorCode::TooManyAutomationRecipients
        );
        require!(recipients.len() == bps.len(), ErrorCode::InvalidAutomationRecipients);
        require!(interval_secs > 0, ErrorCode::InvalidAutomationInterval);
        require!(max_per_tick > 0, ErrorCode::InvalidAutomationMaxPerTick);
        let mut sum: u32 = 0;
        for k in &recipients {
            require!(*k != Pubkey::default(), ErrorCode::InvalidRecipient);
        }
        for b in &bps {
            require!(*b <= 10_000, ErrorCode::InvalidAutomationBps);
            sum = sum.checked_add(*b as u32).ok_or(ErrorCode::InvalidAutomationBps)?;
        }
        require!(sum > 0 && sum <= 10_000, ErrorCode::InvalidAutomationBps);

        project.automation_mode = AUTOMATION_MODE_SPLIT_CRANK;
        project.automation_paused = paused;
        project.automation_interval_secs = interval_secs;
        project.automation_max_per_tick = max_per_tick;
        project.automation_next_eligible_ts = next_eligible_ts;
        project.auto_recipient_count = recipients.len() as u8;
        project.auto_recipients = [Pubkey::default(); MAX_AUTO_RECIPIENTS];
        project.auto_bps = [0u16; MAX_AUTO_RECIPIENTS];
        for (i, pk) in recipients.iter().enumerate() {
            project.auto_recipients[i] = *pk;
            project.auto_bps[i] = bps[i];
        }
        emit!(AutomationConfigured {
            project: project.key(),
            mode: AUTOMATION_MODE_SPLIT_CRANK,
        });
        Ok(())
    }

    /// Anyone may call when automation is due: moves up to `min(vault, max_per_tick)` split by configured bps.
    pub fn crank_automation<'info>(
        ctx: Context<'_, '_, '_, 'info, CrankAutomation<'info>>,
    ) -> Result<()> {
        let p = &ctx.accounts.project;
        let project_key = p.key();
        require!(
            p.automation_mode == AUTOMATION_MODE_SPLIT_CRANK,
            ErrorCode::AutomationNotActive
        );
        require!(!p.automation_paused, ErrorCode::AutomationPaused);
        require!(!p.frozen, ErrorCode::VaultFrozen);
        require!(p.vault_initialized, ErrorCode::VaultNotInitialized);
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= p.automation_next_eligible_ts,
            ErrorCode::CrankNotYetEligible
        );
        let count = p.auto_recipient_count as usize;
        require!(count > 0, ErrorCode::InvalidAutomationRecipients);
        require!(
            ctx.remaining_accounts.len() == count,
            ErrorCode::InvalidAutomationRecipientAccounts
        );

        let mut owners = [Pubkey::default(); MAX_AUTO_RECIPIENTS];
        let mut bps_arr = [0u16; MAX_AUTO_RECIPIENTS];
        for i in 0..count {
            owners[i] = p.auto_recipients[i];
            bps_arr[i] = p.auto_bps[i];
        }
        let interval = p.automation_interval_secs;
        let max_per = p.automation_max_per_tick;
        let mint = ctx.accounts.vault_state.mint;
        let bump = ctx.accounts.vault_state.bump;
        let vault_amount = ctx.accounts.vault_token_account.amount;
        let budget = vault_amount.min(max_per);
        require!(budget > 0, ErrorCode::InsufficientVaultBalance);
        require!(
            vault_amount >= budget,
            ErrorCode::InsufficientVaultBalance
        );

        let seeds: &[&[u8]] = &[b"vault", project_key.as_ref(), &[bump]];
        let signer = &[seeds];

        for i in 0..count {
            let rec_data = ctx.remaining_accounts[i].try_borrow_data()?;
            let rec_state = SplTokenAccountState::unpack(&rec_data)
                .map_err(|_| error!(ErrorCode::InvalidMint))?;
            require_keys_eq!(rec_state.owner, owners[i]);
            require_keys_eq!(rec_state.mint, mint);
        }

        let token_prog_ai = ctx.accounts.token_program.to_account_info();
        let vault_from_ai = ctx.accounts.vault_token_account.to_account_info();
        let vault_auth_ai = ctx.accounts.vault_state.to_account_info();
        let mut recipient_ais: Vec<AccountInfo> = Vec::with_capacity(count);
        for i in 0..count {
            recipient_ais.push(ctx.remaining_accounts[i].clone());
        }

        let mut remainder = budget;
        for i in 0..count {
            let share = if i + 1 == count {
                remainder
            } else {
                let s = (budget as u128)
                    .checked_mul(bps_arr[i] as u128)
                    .ok_or(ErrorCode::InvalidAmount)?
                    / 10_000u128;
                let s64 = u64::try_from(s).map_err(|_| error!(ErrorCode::InvalidAmount))?;
                remainder = remainder
                    .checked_sub(s64)
                    .ok_or(ErrorCode::InvalidAmount)?;
                s64
            };
            if share == 0 {
                continue;
            }
            token::transfer(
                CpiContext::new_with_signer(
                    token_prog_ai.clone(),
                    Transfer {
                        from: vault_from_ai.clone(),
                        to: recipient_ais[i].clone(),
                        authority: vault_auth_ai.clone(),
                    },
                    signer,
                ),
                share,
            )?;
        }

        let project_mut = &mut ctx.accounts.project;
        project_mut.automation_next_eligible_ts = now
            .checked_add(interval)
            .ok_or(ErrorCode::TimelockOverflow)?;
        emit!(AutomationCranked {
            project: project_key,
            budget,
            next_eligible_ts: project_mut.automation_next_eligible_ts,
        });
        Ok(())
    }
}

fn find_approver_index(project: &Project, approver: &Pubkey) -> Result<u8> {
    for i in 0..project.approver_count as usize {
        if project.approvers[i] == *approver {
            return Ok(i as u8);
        }
    }
    err!(ErrorCode::Unauthorized)
}

fn approval_count(mask: u8, approver_count: u8) -> u8 {
    let n = approver_count.min(MAX_APPROVERS as u8);
    let mut c = 0u8;
    for i in 0..n {
        if (mask & (1u8 << i)) != 0 {
            c = c.saturating_add(1);
        }
    }
    c
}

#[account]
pub struct Project {
    pub team_lead: Pubkey,
    pub approver_count: u8,
    pub approvers: [Pubkey; MAX_APPROVERS],
    pub approval_threshold: u8,
    pub name: [u8; MAX_NAME_LEN],
    pub name_len: u8,
    pub project_id: u64,
    pub next_proposal_id: u64,
    pub frozen: bool,
    pub vault_initialized: bool,
    /// Monotonic revision; `0` means no policy committed yet (`policy_hash` is all zero).
    pub policy_version: u32,
    /// SHA-256 over canonical off-chain policy JSON (see `apps/web` helpers).
    pub policy_hash: [u8; 32],
    /// When set, `execute_release` requires a non-zero proposal artifact hash.
    pub require_artifact_for_execute: bool,
    pub bump: u8,
    /// See `AUTOMATION_MODE_*`.
    pub automation_mode: u8,
    pub automation_paused: bool,
    pub automation_interval_secs: i64,
    pub automation_next_eligible_ts: i64,
    /// Upper bound on tokens moved per crank (smallest units).
    pub automation_max_per_tick: u64,
    pub auto_recipient_count: u8,
    pub auto_recipients: [Pubkey; MAX_AUTO_RECIPIENTS],
    pub auto_bps: [u16; MAX_AUTO_RECIPIENTS],
    /// `Pubkey::default()` = none. Two-step handoff of operational team lead.
    pub pending_team_lead: Pubkey,
    /// Immutable pubkey used in the project PDA seeds (never changes after init / upgrade).
    pub pda_seed_owner: Pubkey,
}

impl Project {
    pub const LEN: usize = 32
        + 1
        + 32 * MAX_APPROVERS
        + 1
        + MAX_NAME_LEN
        + 1
        + 8
        + 8
        + 1
        + 1
        + 4
        + 32
        + 1
        + 1
        + 1
        + 1
        + 8
        + 8
        + 8
        + 1
        + 32 * MAX_AUTO_RECIPIENTS
        + 2 * MAX_AUTO_RECIPIENTS
        + 32
        + 32;
}

#[account]
pub struct VaultState {
    pub project: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,
}

impl VaultState {
    pub const LEN: usize = 32 + 32 + 1;
}

#[account]
pub struct ReleaseProposal {
    pub project: Pubkey,
    pub proposal_id: u64,
    pub amount: u64,
    pub recipient: Pubkey,
    pub timelock_duration_secs: i64,
    pub timelock_ends_at: i64,
    pub approved_mask: u8,
    pub status: u8,
    /// Snapshot of `Project.policy_version` when this proposal was created.
    pub policy_version_at_proposal: u32,
    /// Deliverable commitment (SHA-256). All zero = not attached yet.
    pub artifact_sha256: [u8; 32],
    pub artifact_uri: [u8; MAX_ARTIFACT_URI_LEN],
    pub artifact_uri_len: u16,
    pub artifact_label: [u8; MAX_ARTIFACT_LABEL_LEN],
    pub artifact_label_len: u8,
    /// Opaque id for an off-chain milestone row (0 = none).
    pub linked_milestone_id: u64,
    /// When true, `execute_release` is blocked until the lead clears it.
    pub dispute_active: bool,
    /// Sum of token amounts already transferred for this proposal (tranches).
    pub released_so_far: u64,
    pub bump: u8,
}

impl ReleaseProposal {
    pub const LEN: usize = 32
        + 8
        + 8
        + 32
        + 8
        + 8
        + 1
        + 1
        + 4
        + 32
        + MAX_ARTIFACT_URI_LEN
        + 2
        + MAX_ARTIFACT_LABEL_LEN
        + 1
        + 8
        + 1
        + 8
        + 1;
}

#[derive(Accounts)]
#[instruction(project_id: u64)]
pub struct InitializeProject<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub team_lead: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Project::LEN,
        seeds = [b"project", team_lead.key().as_ref(), &project_id.to_le_bytes()],
        bump
    )]
    pub project: Account<'info, Project>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub team_lead: Signer<'info>,
    #[account(
        mut,
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.team_lead == team_lead.key() @ ErrorCode::Unauthorized,
        constraint = !project.vault_initialized @ ErrorCode::VaultAlreadyInitialized,
    )]
    pub project: Account<'info, Project>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        space = 8 + VaultState::LEN,
        seeds = [b"vault", project.key().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = vault_state,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(
        mut,
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.vault_initialized @ ErrorCode::VaultNotInitialized,
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [b"vault", project.key().as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.project == project.key() @ ErrorCode::InvalidVault,
    )]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        mut,
        address = anchor_spl::associated_token::get_associated_token_address(&vault_state.key(), &vault_state.mint),
        constraint = vault_token_account.mint == vault_state.mint @ ErrorCode::InvalidMint,
        constraint = vault_token_account.owner == vault_state.key() @ ErrorCode::InvalidVaultTokenAccount,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = depositor_token_account.owner == depositor.key() @ ErrorCode::Unauthorized,
        constraint = depositor_token_account.mint == vault_state.mint @ ErrorCode::InvalidMint,
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ProposeRelease<'info> {
    #[account(mut)]
    pub team_lead: Signer<'info>,
    #[account(
        mut,
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.team_lead == team_lead.key() @ ErrorCode::Unauthorized,
        constraint = project.vault_initialized @ ErrorCode::VaultNotInitialized,
        constraint = !project.frozen @ ErrorCode::VaultFrozen,
    )]
    pub project: Account<'info, Project>,
    #[account(
        init,
        payer = team_lead,
        space = 8 + ReleaseProposal::LEN,
        seeds = [b"proposal", project.key().as_ref(), &project.next_proposal_id.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, ReleaseProposal>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct AttachProposalArtifact<'info> {
    pub team_lead: Signer<'info>,
    #[account(
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.team_lead == team_lead.key() @ ErrorCode::Unauthorized,
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [b"proposal", project.key().as_ref(), &proposal_id.to_le_bytes()],
        bump = proposal.bump,
        constraint = proposal.project == project.key() @ ErrorCode::InvalidProposal,
    )]
    pub proposal: Account<'info, ReleaseProposal>,
}

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct OpenDispute<'info> {
    pub opener: Signer<'info>,
    #[account(
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [b"proposal", project.key().as_ref(), &proposal_id.to_le_bytes()],
        bump = proposal.bump,
        constraint = proposal.project == project.key() @ ErrorCode::InvalidProposal,
    )]
    pub proposal: Account<'info, ReleaseProposal>,
}

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct ResolveDispute<'info> {
    pub team_lead: Signer<'info>,
    #[account(
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.team_lead == team_lead.key() @ ErrorCode::Unauthorized,
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [b"proposal", project.key().as_ref(), &proposal_id.to_le_bytes()],
        bump = proposal.bump,
        constraint = proposal.project == project.key() @ ErrorCode::InvalidProposal,
    )]
    pub proposal: Account<'info, ReleaseProposal>,
}

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct ApproveRelease<'info> {
    pub approver: Signer<'info>,
    #[account(
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = !project.frozen @ ErrorCode::VaultFrozen,
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [b"proposal", project.key().as_ref(), &proposal_id.to_le_bytes()],
        bump = proposal.bump,
        constraint = proposal.project == project.key() @ ErrorCode::InvalidProposal,
    )]
    pub proposal: Account<'info, ReleaseProposal>,
}

#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct CancelProposal<'info> {
    pub team_lead: Signer<'info>,
    #[account(
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.team_lead == team_lead.key() @ ErrorCode::Unauthorized,
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [b"proposal", project.key().as_ref(), &proposal_id.to_le_bytes()],
        bump = proposal.bump,
        constraint = proposal.project == project.key() @ ErrorCode::InvalidProposal,
    )]
    pub proposal: Account<'info, ReleaseProposal>,
}

#[derive(Accounts)]
#[instruction(proposal_id: u64, release_amount: u64)]
pub struct ExecuteRelease<'info> {
    pub executor: Signer<'info>,
    #[account(
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [b"vault", project.key().as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.project == project.key() @ ErrorCode::InvalidVault,
    )]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        mut,
        address = anchor_spl::associated_token::get_associated_token_address(&vault_state.key(), &vault_state.mint),
        constraint = vault_token_account.owner == vault_state.key() @ ErrorCode::InvalidVaultTokenAccount,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"proposal", project.key().as_ref(), &proposal_id.to_le_bytes()],
        bump = proposal.bump,
        constraint = proposal.project == project.key() @ ErrorCode::InvalidProposal,
    )]
    pub proposal: Account<'info, ReleaseProposal>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetPolicy<'info> {
    pub team_lead: Signer<'info>,
    #[account(
        mut,
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.team_lead == team_lead.key() @ ErrorCode::Unauthorized,
        constraint = !project.frozen @ ErrorCode::VaultFrozen,
    )]
    pub project: Account<'info, Project>,
}

#[derive(Accounts)]
pub struct SetFrozen<'info> {
    pub team_lead: Signer<'info>,
    #[account(
        mut,
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.team_lead == team_lead.key() @ ErrorCode::Unauthorized,
    )]
    pub project: Account<'info, Project>,
}

#[derive(Accounts)]
pub struct SetRequireArtifact<'info> {
    pub team_lead: Signer<'info>,
    #[account(
        mut,
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.team_lead == team_lead.key() @ ErrorCode::Unauthorized,
    )]
    pub project: Account<'info, Project>,
}

#[derive(Accounts)]
#[instruction(project_id: u64)]
pub struct UpgradeProjectLayout<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub team_lead: Signer<'info>,
    #[account(mut)]
    pub project: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfigureAutomation<'info> {
    pub team_lead: Signer<'info>,
    #[account(
        mut,
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.team_lead == team_lead.key() @ ErrorCode::Unauthorized,
        constraint = project.vault_initialized @ ErrorCode::VaultNotInitialized,
    )]
    pub project: Account<'info, Project>,
}

#[derive(Accounts)]
pub struct CrankAutomation<'info> {
    pub executor: Signer<'info>,
    #[account(
        mut,
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [b"vault", project.key().as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.project == project.key() @ ErrorCode::InvalidVault,
    )]
    pub vault_state: Account<'info, VaultState>,
    #[account(
        mut,
        constraint = vault_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&vault_state.key(), &vault_state.mint),
        constraint = vault_token_account.owner == vault_state.key() @ ErrorCode::InvalidVaultTokenAccount,
        constraint = vault_token_account.mint == vault_state.mint @ ErrorCode::InvalidMint,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BeginTeamLeadTransfer<'info> {
    pub team_lead: Signer<'info>,
    #[account(
        mut,
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.team_lead == team_lead.key() @ ErrorCode::Unauthorized,
    )]
    pub project: Account<'info, Project>,
}

#[derive(Accounts)]
pub struct AcceptTeamLeadTransfer<'info> {
    pub new_team_lead: Signer<'info>,
    #[account(
        mut,
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
    )]
    pub project: Account<'info, Project>,
}

#[derive(Accounts)]
pub struct CancelTeamLeadTransfer<'info> {
    pub team_lead: Signer<'info>,
    #[account(
        mut,
        seeds = [b"project", project.pda_seed_owner.as_ref(), &project.project_id.to_le_bytes()],
        bump = project.bump,
        constraint = project.team_lead == team_lead.key() @ ErrorCode::Unauthorized,
    )]
    pub project: Account<'info, Project>,
}

#[event]
pub struct ProjectCreated {
    pub project: Pubkey,
    pub team_lead: Pubkey,
    pub project_id: u64,
}

#[event]
pub struct TeamLeadTransferBegun {
    pub project: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
}

#[event]
pub struct TeamLeadTransferred {
    pub project: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
}

#[event]
pub struct TeamLeadTransferCancelled {
    pub project: Pubkey,
}

#[event]
pub struct PolicySet {
    pub project: Pubkey,
    pub policy_version: u32,
    pub policy_hash: [u8; 32],
}

#[event]
pub struct VaultInitialized {
    pub project: Pubkey,
    pub mint: Pubkey,
    pub vault_token_account: Pubkey,
}

#[event]
pub struct Deposited {
    pub project: Pubkey,
    pub amount: u64,
    pub depositor: Pubkey,
}

#[event]
pub struct ReleaseProposed {
    pub project: Pubkey,
    pub proposal_id: u64,
    pub amount: u64,
    pub recipient: Pubkey,
    pub timelock_duration_secs: i64,
}

#[event]
pub struct ProposalArtifactAttached {
    pub project: Pubkey,
    pub proposal_id: u64,
    pub artifact_sha256: [u8; 32],
}

#[event]
pub struct DisputeOpened {
    pub project: Pubkey,
    pub proposal_id: u64,
    pub opener: Pubkey,
}

#[event]
pub struct DisputeResolved {
    pub project: Pubkey,
    pub proposal_id: u64,
}

#[event]
pub struct TimelockStarted {
    pub project: Pubkey,
    pub proposal_id: u64,
    pub ends_at: i64,
}

#[event]
pub struct Approved {
    pub project: Pubkey,
    pub proposal_id: u64,
    pub approver: Pubkey,
}

#[event]
pub struct ProposalCancelled {
    pub project: Pubkey,
    pub proposal_id: u64,
}

#[event]
pub struct Released {
    pub project: Pubkey,
    pub proposal_id: u64,
    /// Tokens moved in this transaction.
    pub amount: u64,
    pub recipient: Pubkey,
    /// Total released for this proposal after this transaction.
    pub cumulative_released: u64,
    pub fully_settled: bool,
}

#[event]
pub struct FrozenToggled {
    pub project: Pubkey,
    pub frozen: bool,
}

#[event]
pub struct RequireArtifactToggled {
    pub project: Pubkey,
    pub require: bool,
}

#[event]
pub struct AutomationConfigured {
    pub project: Pubkey,
    pub mode: u8,
}

#[event]
pub struct AutomationCranked {
    pub project: Pubkey,
    pub budget: u64,
    pub next_eligible_ts: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Too many approvers (max 5)")]
    TooManyApprovers,
    #[msg("Invalid approval threshold")]
    InvalidThreshold,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid proposal")]
    InvalidProposal,
    #[msg("Proposal is not in a valid state for this action")]
    InvalidProposalState,
    #[msg("Timelock has not ended yet")]
    TimelockNotReady,
    #[msg("Proposal already executed")]
    AlreadyExecuted,
    #[msg("Approver already recorded for this proposal")]
    AlreadyApproved,
    #[msg("Vault is frozen")]
    VaultFrozen,
    #[msg("Insufficient balance in vault token account")]
    InsufficientVaultBalance,
    #[msg("Name exceeds max length")]
    InvalidNameLength,
    #[msg("Proposal cancelled")]
    ProposalCancelledErr,
    #[msg("Invalid timelock configuration")]
    InvalidTimelock,
    #[msg("Vault not initialized")]
    VaultNotInitialized,
    #[msg("Vault already initialized")]
    VaultAlreadyInitialized,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Invalid vault state")]
    InvalidVault,
    #[msg("Vault token account does not match derived ATA")]
    InvalidVaultTokenAccount,
    #[msg("Amount must be > 0")]
    InvalidAmount,
    #[msg("Invalid recipient")]
    InvalidRecipient,
    #[msg("Recipient token account owner mismatch")]
    InvalidRecipientAta,
    #[msg("Team lead must be approvers[0]")]
    LeadMustBeFirstApprover,
    #[msg("Duplicate approver")]
    DuplicateApprover,
    #[msg("Invalid approver pubkey")]
    InvalidApprover,
    #[msg("Proposal id overflow")]
    ProposalIdOverflow,
    #[msg("Timelock arithmetic overflow")]
    TimelockOverflow,
    #[msg("Policy hash cannot be all zero")]
    PolicyHashZero,
    #[msg("Policy version overflow")]
    PolicyVersionOverflow,
    #[msg("Artifact hash cannot be all zero")]
    ArtifactHashZero,
    #[msg("Artifact URI too long")]
    ArtifactUriTooLong,
    #[msg("Artifact label too long")]
    ArtifactLabelTooLong,
    #[msg("Artifact already attached to this proposal")]
    ArtifactAlreadyAttached,
    #[msg("A dispute is already open for this proposal")]
    DisputeAlreadyOpen,
    #[msg("No active dispute on this proposal")]
    DisputeNotActive,
    #[msg("Cannot execute while a dispute is active")]
    DisputeActive,
    #[msg("Project requires an attached artifact before execute")]
    ArtifactRequiredForExecute,
    #[msg("Release amount exceeds remaining approved cap for this proposal")]
    PartialReleaseExceedsCap,
    #[msg("Cannot cancel after funds have been released from this proposal")]
    CannotCancelAfterPartialRelease,
    #[msg("Project account data is invalid or too small for this operation")]
    InvalidAccountData,
    #[msg("Instruction project_id does not match on-chain project")]
    InvalidProjectIdArg,
    #[msg("Invalid automation mode")]
    InvalidAutomationMode,
    #[msg("Invalid automation recipients or bps")]
    InvalidAutomationRecipients,
    #[msg("Too many automation recipients (max 8)")]
    TooManyAutomationRecipients,
    #[msg("Automation interval must be positive")]
    InvalidAutomationInterval,
    #[msg("Automation max_per_tick must be positive when enabled")]
    InvalidAutomationMaxPerTick,
    #[msg("Invalid automation bps configuration")]
    InvalidAutomationBps,
    #[msg("Automation is not active on this project")]
    AutomationNotActive,
    #[msg("Automation is paused")]
    AutomationPaused,
    #[msg("Crank is not yet eligible (wait for next_eligible_ts)")]
    CrankNotYetEligible,
    #[msg("Remaining accounts must be one writable token account per automation recipient, in order")]
    InvalidAutomationRecipientAccounts,
    #[msg("A team-lead transfer is already pending")]
    PendingTransferActive,
    #[msg("No pending team-lead transfer")]
    PendingTransferNone,
    #[msg("Signer does not match pending team lead")]
    PendingTransferMismatch,
    #[msg("Invalid team-lead transfer target")]
    InvalidTransferTarget,
}
