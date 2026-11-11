import { Stack, Duration, RemovalPolicy, CfnOutput, aws_ec2 as ec2, aws_dynamodb as dynamodb, aws_elasticache as elasticache, aws_rds as rds, aws_sqs as sqs, aws_s3 as s3, aws_secretsmanager as secretsmanager, aws_ecs as ecs, aws_logs as logs, aws_cloudwatch as cloudwatch } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/** Foundation only. Never attach the local file adapter to horizontally scaled ECS tasks. */
export class FoundationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const vpc = new ec2.Vpc(this, 'Network', {
      maxAzs: 2, natGateways: 2,
      subnetConfiguration: [
        { name: 'edge', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'application', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });
    vpc.addGatewayEndpoint('DynamoEndpoint', { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB });
    vpc.addGatewayEndpoint('S3Endpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });
    const application = new ec2.SecurityGroup(this, 'ApplicationSecurityGroup', { vpc });
    const data = new ec2.SecurityGroup(this, 'DataSecurityGroup', { vpc, allowAllOutbound: false });
    data.addIngressRule(application, ec2.Port.tcp(5432), 'Application to Aurora');
    data.addIngressRule(application, ec2.Port.tcp(6379), 'Application to encrypted Redis');
    const roomTable = new dynamodb.Table(this, 'LiveRooms', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'expires_at', deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    roomTable.addGlobalSecondaryIndex({
      indexName: 'open_lot_deadline',
      partitionKey: { name: 'timer_bucket', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'fire_at_ms', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });
    const redisSecret = new secretsmanager.Secret(this, 'RedisAuth', {
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });
    const redisSubnets = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
      description: 'Isolated AuctionArena Redis subnets',
      subnetIds: vpc.isolatedSubnets.map(s => s.subnetId),
    });
    const redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: 'Ephemeral room coordination, never durable auction state',
      engine: 'redis', engineVersion: '7.1', cacheNodeType: 'cache.t4g.small',
      numCacheClusters: 2, automaticFailoverEnabled: true, multiAzEnabled: true,
      atRestEncryptionEnabled: true, transitEncryptionEnabled: true,
      authToken: redisSecret.secretValue.unsafeUnwrap(),
      cacheSubnetGroupName: redisSubnets.ref, securityGroupIds: [data.securityGroupId],
      snapshotRetentionLimit: 1,
    });
    redis.applyRemovalPolicy(RemovalPolicy.RETAIN);
    const database = new rds.DatabaseCluster(this, 'ArchiveDatabase', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_6 }),
      writer: rds.ClusterInstance.serverlessV2('writer', { publiclyAccessible: false }),
      readers: [rds.ClusterInstance.serverlessV2('reader', { scaleWithWriter: true, publiclyAccessible: false })],
      serverlessV2MinCapacity: 0.5, serverlessV2MaxCapacity: 4,
      vpc, vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }, securityGroups: [data],
      credentials: rds.Credentials.fromGeneratedSecret('arena_admin'),
      defaultDatabaseName: 'auctionarena', iamAuthentication: true,
      storageEncrypted: true, deletionProtection: true, removalPolicy: RemovalPolicy.RETAIN,
      backup: { retention: Duration.days(7) },
      cloudwatchLogsExports: ['postgresql'],
    });
    const dlq = new sqs.Queue(this, 'ArchiveDLQ', { encryption: sqs.QueueEncryption.SQS_MANAGED, enforceSSL: true, retentionPeriod: Duration.days(14) });
    const archiveQueue = new sqs.Queue(this, 'ArchiveQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED, enforceSSL: true,
      visibilityTimeout: Duration.minutes(3), deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
    });
    new cloudwatch.Alarm(this, 'ArchiveBacklog', { metric: archiveQueue.metricApproximateAgeOfOldestMessage(), threshold: 300, evaluationPeriods: 2 });
    new cloudwatch.Alarm(this, 'ArchiveFailures', { metric: dlq.metricApproximateNumberOfMessagesVisible(), threshold: 1, evaluationPeriods: 1 });
    new s3.Bucket(this, 'WebAssets', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED, enforceSSL: true,
      versioned: true, removalPolicy: RemovalPolicy.RETAIN,
    });
    new ecs.Cluster(this, 'Services', { vpc });
    new logs.LogGroup(this, 'ApplicationLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN });
    // No public listener, tasks, image, or service is created until cloud adapters pass staging drills.
    new CfnOutput(this, 'RoomTableName', { value: roomTable.tableName });
    new CfnOutput(this, 'ArchiveQueueUrl', { value: archiveQueue.queueUrl });
    new CfnOutput(this, 'DatabaseEndpoint', { value: database.clusterEndpoint.hostname });
    new CfnOutput(this, 'RedisEndpoint', { value: redis.attrPrimaryEndPointAddress });
    new CfnOutput(this, 'ApplicationSecurityGroupId', { value: application.securityGroupId });
  }
}
