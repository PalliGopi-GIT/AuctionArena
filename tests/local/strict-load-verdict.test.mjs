import assert from 'node:assert/strict';
import test from 'node:test';
import { strictVerdict } from '../../scripts/strict-load-verdict.mjs';

function fixture(code) {
  const report = {
    setup: { rooms: 1, membersPerRoom: [10] }, connections: { attempted: 10, connected: 10 },
    claims: { errors: 0, startedRooms: 1 }, http: { errors: 0 }, ping: { errors: 0, messages: 20 },
    actions: { accepted: 8, errors: 0, expectedConflicts: 1, conflictCodes: ['STALE_VERSION'] },
    sockets: { connected: 10, errors: 0, closedEarly: 0 },
    samples: { bid: Array(8).fill(30), broadcast: Array(90).fill(20), ping: Array(20).fill(10) },
    broadcast: { deliverySummary: { count: 90 }, missing: 0 }, activityStart: 1000, activityEnd: 71000,
    workload: { mode: 'quick' }, settlement: [{ room: code, status: 'RESULT', clients: 10, expectedClients: 10,
      expectedSale: true, playerId: 'P001', soldPrice: 300, soldTo: 't1' }],
  };
  const state = { pass: true, rooms: 1, roomDetails: [{ code, members: 10, players: 80, bidEvents: 9, soldPlayers: 1,
    firstSold: { id: 'P001', price: 300, team: 't1' } }] };
  return { report, state };
}
test('strict run requires matching connected clients, exact versions and the durable auction result', () => {
  const { report, state } = fixture('ABCDEF');
  assert.equal(strictVerdict([report], [state], 1, 1).pass, true);
  state.roomDetails[0].firstSold.team = 't2';
  report.samples.broadcast.pop();
  const { pass, failures } = strictVerdict([report], [state], 1, 1);
  assert.equal(pass, false);
  assert.ok(failures.some(f => f.includes('exact version')));
  assert.ok(failures.some(f => f.includes('durable outcome')));
});
test('strict latency bounds exclude equality and incomplete or nonfinite observations', () => {
  const { report, state } = fixture('ABCDEF');
  report.samples.bid.fill(1000); report.samples.broadcast.fill(NaN); report.samples.ping.fill(500);
  const { pass, failures } = strictVerdict([report], [state], 1, 1);
  assert.equal(pass, false);
  for (const name of ['bid', 'broadcast', 'ping']) assert.ok(failures.some(f => f.includes('runtime 0 ' + name)));
});
test('multi-runtime checks reject overlapping codes, disjoint time windows and slow individual runtimes', () => {
  const a = fixture('ABCDEF'), b = fixture('ABCDEF');
  b.report.activityStart += 3000; b.report.samples.ping.splice(-2, 2, 600, 600);
  const data = strictVerdict([a.report, b.report], [a.state, b.state], 2, 2);
  assert.equal(data.latency.ping.p95, 10);
  assert.equal(data.perInstance[1].ping.p95, 600);
  assert.equal(data.pass, false);
  for (const phrase of ['duplicate room', 'simultaneous', 'runtime 1 ping']) assert.ok(data.failures.some(f => f.includes(phrase)));
});
test('a shared Directory must contain all room projections and memberships in one SQL database', () => {
  const a = fixture('ABCDEF'), b = fixture('AAAAAA');
  const row=code=>({code, members:10, memberships:10});
  a.state.directories=[[row('ABCDEF'),row('AAAAAA')]];
  b.state.directories=[];
  const run=()=>strictVerdict([a.report,b.report],[a.state,b.state],2,2,{sharedDirectory:true});
  assert.equal(run().pass,true);
  b.state.directories.push([a.state.directories[0].pop()]);
  assert.equal(run().pass,false);
  a.state.directories[0].push(...b.state.directories.pop());
  a.state.directories[0][1].memberships--;
  assert.equal(run().pass,false);
});
test('a dedicated Directory owner requires its own successful SQLite inspection', () => {
  const { report, state } = fixture('ABCDEF');
  state.directories = [];
  const directoryIntegrity = { pass:true, rooms:0, directories:[[{code:'ABCDEF',members:10,memberships:10}]] };
  const verdict = () => strictVerdict([report],[state],1,1,{sharedDirectory:true,directoryIntegrity});
  assert.equal(verdict().pass,true);
  directoryIntegrity.pass=false;
  assert.equal(verdict().pass,false);
});
