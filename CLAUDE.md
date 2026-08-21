# CLAUDE PROJECT MEMORY

MKH Property — internal financial-operations web app for PT. Maha Karya Haluoleo. Static HTML frontend talking directly to Supabase (PostgREST + Auth + two Edge Functions). No build tooling, no framework, no test suite, no CI/CD. See `/docs/project-memory/` for the full audit.

Before doing any coding work:

1. Read this file.
2. Read /docs/project-memory/PROJECT_CONTEXT.md
3. Read /docs/project-memory/CURRENT_STATE.md
4. Read /docs/project-memory/DEVELOPMENT_WORKFLOW.md
5. Read /docs/project-memory/GIT_WORKFLOW.md
6. Read /docs/project-memory/DEPLOYMENT.md
7. Read relevant documentation before modifying a feature.

IMPORTANT:

DO NOT TRUST CHAT MEMORY.
TRUST THE REPOSITORY MEMORY.

The repository is the persistent memory of this project.

Before modifying existing functionality:

- inspect existing implementation
- understand dependencies
- understand database impact
- understand production impact
- reuse existing patterns

Never:

- delete working functionality without explicit approval
- change architecture without approval
- change database schema without approval
- change production configuration without approval
- expose secrets
- commit secrets
- invent APIs
- invent features
- assume deployment destination

## PRODUCTION SAFETY

Before pushing or deploying, ALWAYS determine:
- current branch
- target branch
- whether target is production
- what will be deployed
- whether database changes are included
- whether environment variables are affected

NEVER push directly to production if the existing workflow indicates another process.
NEVER run destructive production commands without explicit approval.

## MEMORY UPDATE RULE

When a significant feature or architectural change is completed, update the relevant project-memory files. At minimum consider: CURRENT_STATE.md, CHANGELOG.md, ROADMAP.md, ARCHITECTURE.md. Do not update memory with guesses.
