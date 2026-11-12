# AuctionArena project context

Use `AuctionArena Master Architecture.md` as the application architecture. Selected AWS Region: `ap-south-1`. Named local profile: `AuctionArena`. Guidance default: MEDIUM (user delegated routine choices). User updated the selected Region to Mumbai on 2026-11-11; do not use the former Sydney Region for new deployments. AWS project is Free, with user-reported $100 credits, $0 out-of-pocket limit and $10/month staging budget from credits. No AWS resource deployment of any kind without explicit user approval. Do not substitute the toolkit endpoint Region for the project's resource Region. Local file persistence is single-process development only; AWS runtime reliability remains unimplemented and unproven.

## Resume work in this folder

Read these project files before choosing or implementing the next change:

1. [NEXT_AGENT_HANDOFF.md](NEXT_AGENT_HANDOFF.md): current implementation, verified results, known limits, commands, source map and next work.
2. [AuctionArena Master Architecture.md](<AuctionArena Master Architecture.md>): product requirements and target architecture. The root file is authoritative; implemented scope is recorded in the handoff.
3. [docs/reports/BUILD-STATUS.md](docs/reports/BUILD-STATUS.md): verification status and links to actual evidence.
4. [README.md](README.md), [package.json](package.json) and [docs/CLERK-DEVELOPMENT.md](docs/CLERK-DEVELOPMENT.md): running the app, scripts, existing Clerk setup and host-only live checks.
5. [docs/plan/tasks/](docs/plan/tasks/) and the evidence linked by the relevant task: acceptance criteria, completed work and remaining gaps.

Then inspect the source and tests for the selected task. `apps/web` is the UI, `apps/api` the HTTP/auth boundary, `apps/realtime` the local room store, `packages/engine` the auction rules, and `packages/shared` / `packages/results` the contracts and results. `tests` and `scripts` contain verification and launchers; `infra` and `db/migrations` are undeployed/unexecuted foundations.

Phase 1 rule fixes are complete for their local scope: TypeScript and production build pass; 164 core tests, 76 local tests and all 32 Chromium desktop/mobile-viewport browser cases pass with zero failures/skips/flaky cases. All 34 axe scans report zero violations; human accessibility remains unverified. The owner confirmed +10 below 200, +20 from 200 through 500 inclusive, +25 above 500 for new rooms only. Existing rooms retain flat rules and accepted prices. Evidence: WP1-RULE-FIXES/validation.json. The owner says this Codex session predates the config repair and will restart Codex after the Phase 1 commit; defer interactive /mcp verification to that fresh session. The current tool list remains empty, which does not prove the saved launcher is broken. The debug wizard failure is identified as bare codex (Windows CMD-shim subprocess resolution), exit 255; all three MCP config files stayed unchanged. Do not blindly rerun registration or edit config. No AWS resources, Clerk users/settings or SQL migrations were created or changed. Phase 2 has not started.

Preserve verified-subject ownership and completed Clerk fixtures 139DCB/19B480. New Clerk test accounts or settings changes require explicit approval. Ownership core remains in review and unwired; two moderate CDK/minimatch entries, live provider challenges/deletion/webhooks and human accessibility remain open. Never print .env.local values or include secrets in evidence. Do not repeat login/install/import or the toolkit wizard without a new reason. Update project status, handoff, task and build records after meaningful changes.

<!-- BEGIN AWS STARTER RULES: https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/main/rules/aws-starter-rules.md -->
# AWS Guidance for the new AWS experience

This user has signed up for the new AWS experience. This experience lets you sign into AWS using a social provider and requires the following additional context.

Where this guidance conflicts with the project's own instructions, the project's instructions take precedence.

## Context
### Terminology:
- Say "project" instead of "account" — a project contains an AWS account and settings for sharing with other collaborators
- Say "team member" instead of "IAM user" — users are invited by email, not created or federated in IAM
- Say "AWS Settings" when referring to management tasks at [settings.aws.com](https://settings.aws.com/) (project management, billing, team members, spend limits). Users view their actual AWS resources in the AWS Management Console.
- Say "selected Region" when referring to the user's Region — not "home Region"
- The user has a managed IAM experience. This includes a managed service control policies (SCP) and resource control policies (RCP) that govern the use of AWS. They will still need to use IAM to create policies to let services work with each other. If there are questions about the SCPs or RCPs, go to the documentation at https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html
### Constraints:
- All projects share a single AWS Region determined by the user's contact address. Resources cannot be created in other Regions
- When developing:
  - MUST create all Regional resources in the project's assigned Region
  - You CAN create AWS WAF and Cloudwatch Logs resources in us-east-1 when there are global resources (like a global WAF instance) that require a connection to dependencies in us-east-1. You should not use these for any other reason, because resources in the selected Region will provide lower cost (due to no cross-Region traffic), increased availability (due to no cross-Region traffic), and easier manageability (due to not needing to look in another Region).
When you need to do an inventory of resources, you need to look in both the selected Region and us-east-1 for Cloudwatch Logs or WAF resources.
  - MUST NOT attempt to create Lambda, API Gateway, or other Regional resources in any other Region
  - MUST direct users to confirm their Region in AWS Settings > View all projects > Overview > Additional Info > Region. If the user cannot confirm their Region, check in ~/.aws/config
  - MUST NOT use Lambda@Edge — excluded from both Lambda and CloudFront
  - MUST NOT use CloudFormation StackSets — no multi-account or multi-Region deployments
  - MUST NOT attempt cross-Region actions — no cross-Region replication for DynamoDB/S3/RDS, no multi-Region KMS keys
  - MUST NOT use Route 53 cross-Region routing — geolocation, latency-based, and failover routing policies are not available
  - CloudFront is a global service and its actions ARE allowed in `us-east-1`. A user can create a CloudFront distribution pointing to their project-region Lambda function URL or API Gateway. However, Lambda and API Gateway themselves MUST NOT be created in `us-east-1` — they must be in the project Region.
  - Reduced availability in `eu-north-1` specifically: Amazon Rekognition, Amazon Textract, Amazon Personalize, AWS App Runner are not available in that Region.
- IAM permissions for human access are managed by AWS. Don't assign roles to team members unless absolutely necessary
- The user may have a spend limit if they are on the paid plan. The limit that pauses their project if it's exceeded. If resources suddenly become inaccessible, ask if they have a spend limit configured. Only project owners can modify a spend limit.
- When developing:
  - MUST ask about spend limit status if the user reports sudden "Access Denied" errors on operations that previously worked
  - MUST direct users to check spend status in AWS Settings > Billing
  - MUST check if a user has upgraded their account to the paid plan
  - MUST ask the user if they want to clean up the successfully created resources or keep them to reduce cost
- The user sets up billing, creates spend limits, and retrieves and pays invoices in AWS Settings. The user creates budgets and optimizes their costs in the AWS Billing and Cost Management console
- Not all AWS services are available. If a service isn't working, do the following:
  1. Run the command `aws freetier get-account-plan-state`
  2. If accountPlanType": "FREE", check the [Free Tier supported services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#supported-services-free-tier) next,
  3. If accountPlanType": "PAID", check the [Paid Tier supported services list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#supported-services-paid-plan).
  4. If neither list shows the service, check the [Not supported for this experience list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html#unsupported-services). The user will need to activate advanced features to access this service.
- Users can activate advanced AWS services and capabilities for their account.
- For any AWS task or question — building, configuring, migrating, debugging, or operating a service, writing SDK code, authoring CDK/CloudFormation, or answering how a service works — first call `aws___search_documentation` with topic `agent_skills` and load the matching skill with `aws___retrieve_skill`. Do this even when you believe you know the answer: skills carry current service behavior that your training may not. Prefer the skill's guidance over general knowledge.
Skip it only for work that does not involve AWS.
### Help level

- help_level (required): LOW, MEDIUM, or HIGH. While a user is building, you MUST ask the user: "How much guidance would you like from me? Low (I only flag security risks), medium (I ask a couple of clarifying questions if something seems off), or high (I explain what I'm doing, suggest alternatives, and flag best practices)."

You CAN update this rule file to save a user's help_level.

Constraints for each level:

**LOW:**
- MUST follow all constraints in this context file
- MUST execute the user's request without modification
- MUST NOT ask clarifying questions unless the action would create a security vulnerability
- MUST NOT suggest alternatives or improvements

**MEDIUM:**
- MUST execute the user's request
- MAY ask up to two clarifying questions per task if the request has an ambiguity or a potential issue
- MUST NOT repeat a question or suggestion the user has already dismissed
- MUST NOT explain trade-offs or alternatives unless the user asks

**HIGH:**
- MUST explain what each step does and why before executing it
- MUST suggest alternatives when a better approach exists
- MUST flag best practices and explain trade-offs
- MUST still execute the user's choice if they disagree with a suggestion
<!-- END AWS STARTER RULES -->
