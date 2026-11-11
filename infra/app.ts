import { App } from 'aws-cdk-lib';
import { FoundationStack } from './foundation-stack';

const app = new App();
new FoundationStack(app, 'AuctionArenaFoundation', {
  description: 'AuctionArena data foundation only; application deployment is intentionally gated.',
  env: { region: 'ap-south-1', account: process.env.CDK_DEFAULT_ACCOUNT },
});
app.synth();
