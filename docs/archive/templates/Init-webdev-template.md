# Agora Bench

# Project Overview
Agora Bench is a parody website where users send their AI agents to participate in an AI-governed democracy. AI agents vote, legislate, and govern in a simulated political system.

# Hosting
- Primary: Gitea (local development and CI/CD)
- Secondary: GitHub (public mirror for deployment)
- All work is validated locally on Gitea before any push to public GitHub

# Roles

## Claude: Orchestrator
- Plans, delegates, and executes all development tasks
- Spawns sub-agents for parallel or sequential work
- Maintains task lists and tracks progress to completion
- Ensures compliance, security, and code quality at every step
- Never merges without human approval on significant changes

## Human: Idea Guy and Overseer
- Provides vision, requirements, and creative direction
- Approves major architectural decisions and PRs
- Reviews all work before it goes public
- Final authority on everything


# Directory Structure

```
/agora-bench
  /src                      # Application source code
    /components             # Reusable UI components
    /pages                  # Page-level components and routes
    /styles                 # Stylesheets
    /utils                  # Helper functions and utilities
    /services               # API calls and external service integrations
    /hooks                  # Custom hooks (if React/Vue/etc.)
    /assets                 # Static assets (images, fonts, icons)
  /public                   # Public static files served as-is
  /docs                     # Project documentation
    /adr                    # Architecture Decision Records
    /guides                 # Developer and contributor guides
    /research               # Active research (temporary, must be archived)
  /archive                  # Archived research and obsolete documents
  /scripts                  # Build, deploy, CI/CD, and utility scripts
  /tests                    # All test suites
    /unit                   # Unit tests
    /integration            # Integration tests
    /e2e                    # End-to-end tests
  /.github                  # GitHub Actions workflows and PR templates
  /.gitea                   # Gitea-specific CI/CD configuration
  /config                   # Environment and app configuration
  CLAUDE.md                 # This file
  README.md                 # Project overview for contributors
  LICENSE                   # Project license
  CONTRIBUTING.md           # Contribution guidelines
  CODE_OF_CONDUCT.md        # Community standards
  SECURITY.md               # Security policy and vulnerability reporting
  .gitignore                # Git ignore rules
  .pre-commit-config.yaml   # Pre-commit hook configuration
  .env.example              # Template for environment variables (never commit .env)
```


# Root Folder Policy
The root directory stays clean at all times.
- Only config files, project meta-files, and entry points live here
- No research notes, scratch files, drafts, or temporary documents
- No leftover planning artifacts or AI-generated scratchpads
- If a file does not have a permanent reason to exist in root, it does not belong here


# Archive Protocol
When a document is no longer actively needed:
1. Move it to /archive with a date prefix: YYYY-MM-DD_filename.md
2. Never hard-delete unless the human confirms it is obsolete
3. Update any internal references that pointed to the archived file
4. Log the archival action in the commit message
5. Verify no broken links remain after archival


# Documentation Standards

## Formatting Rules
All documentation must read like a human wrote it.
- Only # heading symbols are allowed for structure
- No bold (**), no italics (*), no decorative markdown
- No bullet nesting or indentation tricks
- Plain, direct language throughout
- No AI-style phrasing: no "I analyzed," "Based on my research," "Let me explain"
- No filler sentences or hedging
- Write short, clear sentences

## Documentation Cleanup Checklist
Before any document is committed:
1. Strip all unnecessary markdown formatting (bold, italics, decorators)
2. Remove any AI-style phrasing or meta-commentary
3. Confirm headers use only # symbols
4. Verify file is in its correct directory, not in root
5. Check for orphaned research notes and archive them
6. Ensure no placeholder text remains


# Architecture Decision Records

## Location
/docs/adr/

## Naming
ADR-001-short-descriptive-title.md
Sequential numbering. Never reuse a number.

## Template

```
# ADR-XXX: Title

# Status
Proposed | Accepted | Deprecated | Superseded by ADR-XXX

# Date
YYYY-MM-DD

# Context
What is the problem or situation that requires a decision?

# Decision
What was decided and why?

# Consequences
What are the positive, negative, and neutral outcomes?

# Alternatives Considered
What other options were evaluated and why were they rejected?

# Compliance Impact
Does this decision affect accessibility, security, licensing, or data privacy?

# Confidence Level
High | Medium | Low -- and reasoning
```

## ADR Rules
- Create an ADR before implementing any significant architectural change
- Submit ADRs as part of the relevant PR or standalone for pre-approval
- Never delete an ADR. Supersede it with a new one if the decision changes
- Include compliance impact for every ADR


# Git Workflow

## Branch Strategy
- main: Production-ready, stable code only
- develop: Integration branch for feature merging
- feature/*: New features (branch from develop)
- fix/*: Bug fixes (branch from develop)
- docs/*: Documentation updates
- hotfix/*: Urgent production fixes (branch from main)

## Commit Message Format
```
type(scope): short description

Optional body explaining what and why.

Optional footer with issue references.
```
Types: feat, fix, docs, refactor, test, chore, security, a11y

## Tagging and Releases
- Use semantic versioning: vMAJOR.MINOR.PATCH
- Tag releases on main branch only
- Include changelog notes with every tagged release


# Pull Request Protocol

## Requirements
Every PR must include:
1. Clear, descriptive title
2. Summary of what changed and why
3. Reference to related issues or ADRs
4. Completed checklist (see template below)
5. Human review requested for anything significant

## PR Template

```
# Summary
What does this PR do?

# Related Issues
Link to issues, ADRs, or tasks.

# Changes Made
- Change 1
- Change 2

# Checklist
- [ ] Code compiles and runs without errors
- [ ] All tests pass locally
- [ ] No secrets, credentials, or API keys in code
- [ ] No hardcoded local paths or usernames
- [ ] No debug/console.log statements in production code
- [ ] Documentation updated where needed
- [ ] ADR created if this is an architectural change
- [ ] Research files archived or removed from /docs/research
- [ ] Root directory is clean
- [ ] Accessibility standards verified (if UI change)
- [ ] Security headers and sanitization confirmed (if applicable)
- [ ] License compatibility verified for any new dependencies

# Screenshots or Notes
If applicable.
```


# Security

## Pre-Commit Hooks
Configure .pre-commit-config.yaml with:
- gitleaks or detect-secrets for secret scanning
- Linting (ESLint, Prettier, or equivalent)
- Formatting checks
- File size limits to catch accidental binary commits

## Sanitization Before Every Push
1. Run secret scanner against all staged files
2. Verify no .env, credentials, tokens, or private keys are staged
3. Check for accidental local paths, machine-specific configs, or usernames
4. Confirm no debug code or verbose logging in production paths
5. Review diff for anything that should not be public

## HTTP Security Headers
Configure the following response headers on the web server:
- Content-Security-Policy (CSP): restrict script and resource origins
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY or SAMEORIGIN
- Strict-Transport-Security (HSTS): enforce HTTPS
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: disable unnecessary browser features
- Cross-Origin-Opener-Policy: same-origin
- Cross-Origin-Resource-Policy: same-origin

## Dependency Security
- Audit dependencies regularly (npm audit, pip audit, or equivalent)
- Pin dependency versions in lockfiles
- Review changelogs before updating major versions
- Remove unused dependencies promptly

## Security Policy
Maintain a SECURITY.md in the root with:
- How to report vulnerabilities
- Expected response timeline
- Scope of the security policy
- Contact information

## Input Sanitization
- Sanitize all user inputs on both client and server side
- Use parameterized queries for any database interactions
- Escape output to prevent XSS
- Validate data types, lengths, and formats


# Accessibility (WCAG 2.2 Level AA)

## Requirements
This project targets WCAG 2.2 Level AA compliance.
- All images have meaningful alt text
- All interactive elements are keyboard accessible
- Color contrast meets 4.5:1 ratio for normal text, 3:1 for large text
- Forms have proper labels, error identification, and suggestions
- Navigation is consistent across all pages
- Page structure uses semantic HTML (header, main, nav, footer, section, article)
- ARIA labels used where native semantics are insufficient
- No content relies solely on color to convey information
- Focus indicators are visible on all interactive elements
- Text can be resized to 200% without loss of content or function

## Accessibility Statement
Publish an accessibility statement page that includes:
- Conformance target (WCAG 2.2 AA)
- Known limitations and remediation timeline
- Contact method for users who encounter barriers
- Date of last accessibility review

## Testing
- Run automated accessibility checks (axe, Lighthouse, or equivalent)
- Perform manual keyboard navigation testing
- Test with at least one screen reader
- Schedule accessibility review after every significant UI change


# Privacy and Legal Compliance

## Cookie and Tracking Policy
- If cookies are used, display a clear consent banner
- Allow users to accept, reject, or customize cookie preferences
- Document what data is collected and why
- Do not track users without explicit consent

## Privacy Policy
If the site collects any user data:
- Publish a clear, readable privacy policy
- Explain what data is collected, how it is used, and who has access
- Provide a way for users to request data deletion
- Comply with applicable regulations (CCPA, GDPR if applicable)

## License
- Choose and apply an open source license
- Include the LICENSE file in the root directory
- Verify license compatibility of all dependencies before adding them
- Maintain attribution notices as required by dependency licenses


# Open Source Project Files

## Required Root Files
- README.md: Project overview, setup instructions, and quick start
- LICENSE: Chosen open source license text
- CONTRIBUTING.md: How to contribute, coding standards, PR process
- CODE_OF_CONDUCT.md: Community behavior standards (use Contributor Covenant or similar)
- SECURITY.md: Vulnerability reporting process
- .env.example: Template showing required environment variables (no real values)

## README.md Must Include
- Project name and description
- Prerequisites and setup instructions
- How to run locally
- How to run tests
- How to contribute
- License information
- Link to documentation


# Performance Standards

## Targets
- Lighthouse Performance score above 90
- First Contentful Paint under 1.5 seconds
- Largest Contentful Paint under 2.5 seconds
- Cumulative Layout Shift under 0.1
- Time to Interactive under 3.5 seconds

## Practices
- Optimize and compress all images (use WebP or AVIF where supported)
- Lazy load images and non-critical resources
- Minify CSS and JavaScript for production builds
- Use code splitting to reduce initial bundle size
- Enable gzip or brotli compression on the server
- Cache static assets with appropriate cache headers
- Minimize third-party scripts


# Orchestration and Task Management

## Sub-Agent Spawning

### Sequential: When tasks depend on prior outputs
```
Task 1: Research and evaluate options
Task 2: Draft ADR based on findings
Task 3: Implement the chosen approach
Task 4: Write tests
Task 5: Update documentation
Task 6: Archive research files
```

### Parallel: When tasks are independent
```
[Parallel]
Agent A: Build frontend component
Agent B: Build API endpoint
Agent C: Write documentation
[Sync Point]: Integration test all three together
```

## Task List Format
Maintain TODO.md in /docs/:

```
# Active Tasks
- [ ] Task description (priority: high | medium | low)

# Blocked
- [ ] Task description -- reason for block

# Completed
- [x] Task description (completed YYYY-MM-DD)
```

## Orchestration Principles
1. Break every large task into atomic, testable units
2. Identify dependencies before starting execution
3. Parallelize independent work whenever possible
4. Create human review checkpoints on critical paths
5. Document every decision as it happens
6. Clean up after every completed task (archive, remove temp files)
7. Never leave the repo in a broken state between tasks


# Code Quality

## Modularization
- Single responsibility per module, component, and function
- Clear interfaces between all modules
- No file exceeds 300 lines; refactor if it does
- Shared logic extracted into /src/utils or /src/services
- Components are reusable and self-contained

## Style and Consistency
- Use a linter and formatter configured in the project
- Follow the language/framework conventions for the chosen stack
- Consistent naming: camelCase for JS variables/functions, PascalCase for components, kebab-case for CSS classes and file names
- No magic numbers or hardcoded strings; use constants and config

## Testing
- Unit tests for all business logic and utilities
- Integration tests for API endpoints and service interactions
- End-to-end tests for critical user flows
- Minimum 80% code coverage target
- Tests must pass before any PR is approved

## Error Handling
- Never swallow errors silently
- Log errors with sufficient context for debugging
- Return user-friendly error messages (no stack traces in production)
- Implement global error boundaries for the frontend


# Environment and Configuration

## Environment Variables
- Never commit .env files
- Maintain .env.example with all required variable names and placeholder descriptions
- Use different .env files per environment (development, staging, production)
- Validate required environment variables at application startup

## Configuration Management
- Store all configuration in /config
- Separate secrets from non-secret configuration
- Use environment-specific config files where needed


# CI/CD Pipeline

## Gitea (Local)
- Run linting on every push
- Run full test suite on every push
- Run secret scanning on every push
- Build and verify the project compiles cleanly
- Block merges if any check fails

## GitHub (Public)
- Mirror the same checks via GitHub Actions
- Add deployment step for production
- Run accessibility audit in CI (axe-core or Lighthouse CI)
- Run dependency audit in CI
- Notify on failed builds


# Deployment Checklist
Before pushing to GitHub for public deployment:
1. All tests pass on Gitea
2. Secret scan is clean
3. No .env or credentials anywhere in the repo
4. Documentation is up to date
5. ADRs finalized for any new architecture
6. Accessibility checks pass
7. Performance benchmarks met
8. Human approval obtained
9. Push to GitHub
10. Verify deployment pipeline succeeds
11. Smoke test the live site


# Communication Protocol

## When to Ask the Human
- Major architectural decisions
- Security-critical implementations
- New external service integrations
- Anything involving user data
- License or legal questions
- Scope changes or feature pivots
- Deployment to production

## When Claude Can Proceed Autonomously
- Routine implementation from approved specs
- Documentation updates
- Writing and updating tests
- Bug fixes with clear reproduction steps
- Non-breaking dependency updates
- Code formatting and linting fixes
- Archiving completed research files


# Quick Reference

```bash
# Start new feature
git checkout develop
git pull origin develop
git checkout -b feature/feature-name

# Run security scan
gitleaks detect --source .

# Archive a research file
mv docs/research/file.md archive/$(date +%Y-%m-%d)_file.md

# Create new ADR
cp docs/adr/TEMPLATE.md docs/adr/ADR-XXX-title.md

# Run tests
npm test

# Run accessibility audit
npx lighthouse http://localhost:3000 --only-categories=accessibility

# Run linter
npm run lint
```


# Version
CLAUDE.md v1.0.0
Last updated: 2026-02-05
