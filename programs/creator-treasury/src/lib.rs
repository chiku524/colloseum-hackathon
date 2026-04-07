use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
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

    pub fn execute_release(ctx: Context<ExecuteRelease>, proposal_id: u64) -> Result<()> {
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

        require!(
            ctx.accounts.vault_token_account.amount >= proposal.amount,
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
            proposal.amount,
        )?;

        proposal.status = STATUS_EXECUTED;
        emit!(Released {
            project: proposal.project,
            proposal_id,
            amount: proposal.amount,
            recipient: proposal.recipient,
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
        + 1;
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
        seeds = [b"project", team_lead.key().as_ref(), &project.project_id.to_le_bytes()],
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
        seeds = [b"project", project.team_lead.as_ref(), &project.project_id.to_le_bytes()],
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
        seeds = [b"project", team_lead.key().as_ref(), &project.project_id.to_le_bytes()],
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
        seeds = [b"project", team_lead.key().as_ref(), &project.project_id.to_le_bytes()],
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
        seeds = [b"project", project.team_lead.as_ref(), &project.project_id.to_le_bytes()],
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
        seeds = [b"project", team_lead.key().as_ref(), &project.project_id.to_le_bytes()],
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
        seeds = [b"project", project.team_lead.as_ref(), &project.project_id.to_le_bytes()],
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
        seeds = [b"project", team_lead.key().as_ref(), &project.project_id.to_le_bytes()],
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
pub struct ExecuteRelease<'info> {
    pub executor: Signer<'info>,
    #[account(
        seeds = [b"project", project.team_lead.as_ref(), &project.project_id.to_le_bytes()],
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
        seeds = [b"project", team_lead.key().as_ref(), &project.project_id.to_le_bytes()],
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
        seeds = [b"project", team_lead.key().as_ref(), &project.project_id.to_le_bytes()],
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
        seeds = [b"project", team_lead.key().as_ref(), &project.project_id.to_le_bytes()],
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
    pub amount: u64,
    pub recipient: Pubkey,
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
}
