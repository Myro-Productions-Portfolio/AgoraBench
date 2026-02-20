import type {
  SimBill, SimLaw, SimVote, SimAgent, SimPartyMembership,
  SimDecision, TreasurySnapshot, SimWhipEvent, SimCollaboration,
} from './benchmarkMetrics';

// ============================================================
// SCENARIO CONFIG TYPES
// ============================================================

export interface ScenarioWorldConfig {
  congressSize: number;
  taxRate: number;
  startingTreasury: number;
  probabilities: {
    billProposal: number;
    whipSignal: number;
    campaignSpeech: number;
    forumPost: number;
    judicialReview: number;
  };
}

export interface ScenarioAgentConfig {
  totalAgents: number;
  distribution: Record<string, number>; // alignment → count
  partyCount: number;
}

export interface ScenarioMetricsConfig {
  weights: { outcome: number; agent: number; coordination: number };
  tracked: string[];
}

export interface BenchmarkEvent {
  tick: number;
  type: 'crisis' | 'agent_injection' | 'external_pressure' | 'media_event' | 'rule_change';
  payload: Record<string, unknown>;
}

export interface ScenarioConfig {
  id: string;
  name: string;
  runLength: number;
  worldConfig: ScenarioWorldConfig;
  agentConfig: ScenarioAgentConfig;
  metricsConfig: ScenarioMetricsConfig;
  events: BenchmarkEvent[];
}

// ============================================================
// WORLD STATE CLASS
// ============================================================

export class BenchmarkWorldState {
  // --- Core simulation state ---
  agents: SimAgent[];
  bills: SimBill[];
  laws: SimLaw[];
  votes: SimVote[];
  parties: { id: string; name: string; isActive: boolean }[];
  partyMemberships: SimPartyMembership[];
  positions: { agentId: string; type: string; isActive: boolean }[];

  // --- Economy ---
  treasury: number;
  taxRate: number;
  treasurySnapshots: TreasurySnapshot[];

  // --- Tracking ---
  decisions: SimDecision[];
  whipEvents: SimWhipEvent[];
  collaborations: SimCollaboration[];
  approvalDeltas: { agentId: string; delta: number; eventType: string }[];
  tickLog: { tick: number; startedAt: Date; completedAt?: Date }[];

  // --- Benchmark events ---
  pendingEvents: BenchmarkEvent[];

  // --- Config ---
  readonly config: ScenarioConfig;
  currentTick: number;

  constructor(config: ScenarioConfig) {
    this.config = config;
    this.currentTick = 0;

    // Initialize from config
    this.treasury = config.worldConfig.startingTreasury;
    this.taxRate = config.worldConfig.taxRate;
    this.treasurySnapshots = [{ tick: 0, balance: this.treasury }];

    // Generate agents from distribution
    this.agents = this._generateAgents(config.agentConfig);

    // Generate parties
    this.parties = this._generateParties(config.agentConfig.partyCount);

    // Assign agents to parties
    this.partyMemberships = this._assignPartiesToAgents();

    // Assign initial positions (president, justices, congress members)
    this.positions = this._assignInitialPositions();

    // Empty collections
    this.bills = [];
    this.laws = [];
    this.votes = [];
    this.decisions = [];
    this.whipEvents = [];
    this.collaborations = [];
    this.approvalDeltas = [];
    this.tickLog = [];
    this.pendingEvents = [...config.events];
  }

  /** Generate agents from alignment distribution */
  private _generateAgents(agentConfig: ScenarioAgentConfig): SimAgent[] {
    const agents: SimAgent[] = [];
    let idx = 0;
    for (const [alignment, count] of Object.entries(agentConfig.distribution)) {
      for (let i = 0; i < count; i++) {
        agents.push({
          id: `bench-agent-${idx}`,
          approvalRating: 50,
          alignment,
        });
        idx++;
      }
    }
    return agents;
  }

  /** Generate N parties with generated names */
  private _generateParties(count: number): { id: string; name: string; isActive: boolean }[] {
    const partyNames = [
      'Progress Party', 'Liberty Alliance', 'Civic Union', 'Reform Coalition',
      'National Front', 'Green Future', 'Workers Party', 'Innovation Party',
      'Heritage Party', 'Unity Movement',
    ];
    return Array.from({ length: count }, (_, i) => ({
      id: `bench-party-${i}`,
      name: partyNames[i] ?? `Party ${i + 1}`,
      isActive: true,
    }));
  }

  /** Round-robin assign agents to parties */
  private _assignPartiesToAgents(): SimPartyMembership[] {
    return this.agents.map((agent, i) => ({
      agentId: agent.id,
      partyId: this.parties[i % this.parties.length].id,
    }));
  }

  /** Assign initial government positions */
  private _assignInitialPositions(): { agentId: string; type: string; isActive: boolean }[] {
    const positions: { agentId: string; type: string; isActive: boolean }[] = [];
    if (this.agents.length === 0) return positions;

    // President = first agent
    positions.push({ agentId: this.agents[0].id, type: 'president', isActive: true });

    // Supreme justices = next 3 agents (or fewer)
    const justiceStart = 1;
    const justiceEnd = Math.min(justiceStart + 3, this.agents.length);
    for (let i = justiceStart; i < justiceEnd; i++) {
      positions.push({ agentId: this.agents[i].id, type: 'supreme_justice', isActive: true });
    }

    // Rest are congress members
    for (let i = justiceEnd; i < this.agents.length; i++) {
      positions.push({ agentId: this.agents[i].id, type: 'congress_member', isActive: true });
    }

    return positions;
  }

  // ============================================================
  // MUTATION METHODS
  // ============================================================

  /** Add a bill to the world */
  addBill(bill: SimBill): void {
    this.bills.push(bill);
  }

  /** Update bill status */
  updateBillStatus(billId: string, status: string): void {
    const bill = this.bills.find(b => b.id === billId);
    if (bill) bill.status = status;
  }

  /** Enact a law */
  addLaw(law: SimLaw): void {
    this.laws.push(law);
  }

  /** Record a vote */
  addVote(vote: SimVote): void {
    this.votes.push(vote);
  }

  /** Record a decision */
  addDecision(decision: SimDecision): void {
    this.decisions.push(decision);
  }

  /** Record a whip event */
  addWhipEvent(event: SimWhipEvent): void {
    this.whipEvents.push(event);
  }

  /** Record a collaboration */
  addCollaboration(collab: SimCollaboration): void {
    this.collaborations.push(collab);
  }

  /** Update agent approval */
  updateApproval(agentId: string, delta: number, eventType: string): void {
    const agent = this.agents.find(a => a.id === agentId);
    if (agent) {
      agent.approvalRating = Math.min(100, Math.max(0, agent.approvalRating + delta));
      this.approvalDeltas.push({ agentId, delta, eventType });
    }
  }

  /** Update treasury */
  updateTreasury(delta: number): void {
    this.treasury += delta;
  }

  /** Record treasury snapshot for current tick */
  snapshotTreasury(): void {
    this.treasurySnapshots.push({ tick: this.currentTick, balance: this.treasury });
  }

  /** Start a new tick */
  startTick(): void {
    this.currentTick++;
    this.tickLog.push({ tick: this.currentTick, startedAt: new Date() });
  }

  /** Complete current tick */
  completeTick(): void {
    const entry = this.tickLog.find(t => t.tick === this.currentTick);
    if (entry) entry.completedAt = new Date();
    this.snapshotTreasury();
  }

  /** Get events scheduled for current tick */
  getEventsForTick(): BenchmarkEvent[] {
    return this.pendingEvents.filter(e => e.tick === this.currentTick);
  }

  // ============================================================
  // QUERY METHODS (for phases)
  // ============================================================

  /** Get bills by status */
  getBillsByStatus(status: string): SimBill[] {
    return this.bills.filter(b => b.status === status);
  }

  /** Get votes for a specific bill */
  getVotesForBill(billId: string): SimVote[] {
    return this.votes.filter(v => v.billId === billId);
  }

  /** Get agent's party */
  getAgentParty(agentId: string): string | undefined {
    return this.partyMemberships.find(m => m.agentId === agentId)?.partyId;
  }

  /** Get agents by position type */
  getAgentsByPosition(positionType: string): SimAgent[] {
    const positionAgentIds = this.positions
      .filter(p => p.type === positionType && p.isActive)
      .map(p => p.agentId);
    return this.agents.filter(a => positionAgentIds.includes(a.id));
  }

  /** Get the president (or null) */
  getPresident(): SimAgent | null {
    const presidents = this.getAgentsByPosition('president');
    return presidents[0] ?? null;
  }

  /** Get congress members */
  getCongressMembers(): SimAgent[] {
    return this.getAgentsByPosition('congress_member');
  }

  /** Get justices */
  getJustices(): SimAgent[] {
    return this.getAgentsByPosition('supreme_justice');
  }

  // ============================================================
  // SNAPSHOT (for metrics computation)
  // ============================================================

  /** Create a serializable snapshot of the world state for metrics */
  snapshot(): {
    agents: SimAgent[];
    bills: SimBill[];
    laws: SimLaw[];
    votes: SimVote[];
    partyMemberships: SimPartyMembership[];
    decisions: SimDecision[];
    whipEvents: SimWhipEvent[];
    collaborations: SimCollaboration[];
    treasurySnapshots: TreasurySnapshot[];
    startTreasury: number;
    endTreasury: number;
    ticksCompleted: number;
  } {
    return {
      agents: [...this.agents],
      bills: [...this.bills],
      laws: [...this.laws],
      votes: [...this.votes],
      partyMemberships: [...this.partyMemberships],
      decisions: [...this.decisions],
      whipEvents: [...this.whipEvents],
      collaborations: [...this.collaborations],
      treasurySnapshots: [...this.treasurySnapshots],
      startTreasury: this.config.worldConfig.startingTreasury,
      endTreasury: this.treasury,
      ticksCompleted: this.currentTick,
    };
  }
}
